import type { WnbaCandidate, WnbaGame, WnbaSlate } from "./wnbaFirstBasket.js";

export type WnbaSequenceCandidate = WnbaCandidate & {
  baseProbability: number;
  sequenceProbability: number;
  sequenceAdjustment: number;
  projectedFirstPossessionPct: number | null;
  sequenceWeight: number;
  sequenceRank: number;
  tipConflict: boolean;
  tipEdge: number | null;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function confidenceWeight(confidence: WnbaGame["tipSignal"]["confidence"]): number {
  if (confidence === "usable") return 0.25;
  if (confidence === "emerging") return 0.12;
  return 0;
}

function sequenceTarget(candidate: WnbaCandidate, possessionPct: number): number {
  const base = candidate.probability;
  const possessionMultiplier =
    1 + clamp((possessionPct - 50) / 50, -0.7, 0.7) * 0.18;
  const openingRate = candidate.openingFirstShotRate;
  const openingMultiplier = openingRate === null
    ? 1
    : 1 + clamp((openingRate - 10) / 20, -0.5, 1) * 0.10;
  const finishingPct = candidate.openingShotFgPct ?? candidate.fgPct;
  const finishingMultiplier = Number.isFinite(finishingPct)
    ? 1 + clamp((finishingPct - 45) / 25, -0.5, 0.8) * 0.05
    : 1;
  return clamp(base * possessionMultiplier * openingMultiplier * finishingMultiplier, 1, 35);
}

function applyToGame(game: WnbaGame): WnbaGame {
  if (!game.candidates.length) return game;
  const weight = confidenceWeight(game.tipSignal.confidence);
  const hasPossessionSignal =
    weight > 0 &&
    game.tipSignal.awayTipPct !== null &&
    game.tipSignal.homeTipPct !== null;
  const tipEdge = hasPossessionSignal
    ? Math.abs(game.tipSignal.awayTipPct! - game.tipSignal.homeTipPct!)
    : null;
  const projectedTipTeam = game.tipSignal.projectedFirstPossessionTeam;

  const shadow = game.candidates.map(candidate => {
    const possessionPct = hasPossessionSignal
      ? (candidate.team === game.awayTeam ? game.tipSignal.awayTipPct! : game.tipSignal.homeTipPct!)
      : null;
    const target = possessionPct === null ? candidate.probability : sequenceTarget(candidate, possessionPct);
    const sequenceProbability = Math.round(
      clamp(candidate.probability * (1 - weight) + target * weight, 1, 35) * 10,
    ) / 10;
    const candidateTipFavored = projectedTipTeam !== null && projectedTipTeam === candidate.team;
    const tipConflict =
      projectedTipTeam !== null &&
      tipEdge !== null &&
      tipEdge >= 15 &&
      candidate.rank <= 2 &&
      !candidateTipFavored;

    return {
      ...candidate,
      baseProbability: candidate.probability,
      sequenceProbability,
      sequenceAdjustment: Math.round((sequenceProbability - candidate.probability) * 10) / 10,
      projectedFirstPossessionPct: possessionPct === null ? null : Math.round(possessionPct * 10) / 10,
      sequenceWeight: weight,
      sequenceRank: candidate.rank,
      tipConflict,
      tipEdge: tipEdge === null ? null : Math.round(tipEdge * 10) / 10,
    } satisfies WnbaSequenceCandidate;
  });

  const sequenceRanks = [...shadow]
    .sort((a, b) => b.sequenceProbability - a.sequenceProbability || b.avgFga - a.avgFga || b.avgMinutes - a.avgMinutes)
    .map((candidate, index) => ({
      key: `${candidate.team}|${candidate.name}`.toLowerCase(),
      rank: index + 1,
    }));
  const rankByPlayer = new Map(sequenceRanks.map(item => [item.key, item.rank]));

  // Public probability, public rank, topPick, and locked predictions remain
  // tied to the existing production model until the challenger is graded
  // out-of-sample. The richer fields are research telemetry only.
  const candidates = shadow.map(candidate => ({
    ...candidate,
    sequenceRank: rankByPlayer.get(`${candidate.team}|${candidate.name}`.toLowerCase()) ?? candidate.rank,
  }));
  return { ...game, candidates };
}

/**
 * Possession-first challenger: tip win -> opening-shot opportunity -> finishing.
 * It remains shadow-only until enough graded games demonstrate better
 * calibration. It is more responsive to meaningful tip edges and explicitly
 * flags large tip/model conflicts for audit.
 */
export function applyWnbaSequenceModel(slate: WnbaSlate): WnbaSlate {
  const games = slate.games.map(applyToGame);
  return {
    ...slate,
    games,
    modelVersion: `${slate.modelVersion}+SEQ-SHADOW-V2`,
    source: `${slate.source} + possession-first sequence challenger v2 (shadow-only; stronger tip conditioning + conflict telemetry)`,
  };
}
