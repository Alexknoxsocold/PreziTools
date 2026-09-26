export const NFL_TD_V4_SHADOW_VERSION = "nfl-td-v4-shadow-3" as const;

export type NflTdV4Features = {
  touchesPerGame?: number | null;
  targetsPerGame?: number | null;
  yardsPerGame?: number | null;
  tdPerGame?: number | null;
  redZoneGames?: number | null;
  redZoneOppPerGame?: number | null;
  inside10PerGame?: number | null;
  inside5PerGame?: number | null;
  firstHalfRedZonePerGame?: number | null;
  evidenceStrength?: number | null;
  roleMultiplier?: number | null;
  teamPpg?: number | null;
  opponentPointsAllowed?: number | null;
  statsSource?: string | null;
  redZoneSource?: string | null;
};

export type NflTdV4ShadowInput = {
  market: "first_td" | "anytime_td";
  player: string;
  team?: string | null;
  position?: string | null;
  v3ModelProbability: number;
  marketProbability: number;
  bestOdds: number;
  edgePoints?: number | null;
  expectedValue?: number | null;
  quoteCount?: number | null;
  reasons?: string[] | null;
  features?: NflTdV4Features | null;
  capturedAt: string;
};

export type NflTdV4ShadowEvaluation = {
  version: typeof NFL_TD_V4_SHADOW_VERSION;
  mode: "shadow";
  automaticPromotion: false;
  sourceModel: "nfl-td-v3";
  input: NflTdV4ShadowInput;
  candidateProbability: number;
  candidateEdgePoints: number;
  featureAdjustmentPoints: number;
  notes: string[];
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value);

function structuredFeatureAdjustment(input: NflTdV4ShadowInput) {
  const f = input.features;
  if (!f) return 0;
  let score = 0;
  let weight = 0;
  const add = (value: number | null | undefined, center: number, scale: number, w: number) => {
    if (!finite(value)) return;
    score += clamp((Number(value) - center) / scale, -1, 1) * w;
    weight += w;
  };
  // First TD is primarily an early-drive / goal-line opportunity market.
  // Anytime TD is a full-game scoring-opportunity market. Keep the challenger
  // deliberately separate so ordinary volume cannot overpower scoring role.
  if (input.market === "first_td") {
    add(f.firstHalfRedZonePerGame, .75, .75, 1.75);
    add(f.inside5PerGame, .30, .40, 1.65);
    add(f.inside10PerGame, .65, .65, 1.45);
    add(f.redZoneOppPerGame, 1.5, 1.25, 1.15);
    add(f.tdPerGame, .55, .45, .8);
    add(f.targetsPerGame, 5, 5, .35);
    add(f.touchesPerGame, 12, 12, .3);
  } else {
    add(f.inside5PerGame, .30, .40, 1.55);
    add(f.inside10PerGame, .65, .65, 1.4);
    add(f.redZoneOppPerGame, 1.5, 1.25, 1.35);
    add(f.tdPerGame, .55, .45, 1.25);
    add(f.touchesPerGame, 12, 12, .65);
    add(f.targetsPerGame, 5, 5, .55);
    add(f.yardsPerGame, 65, 65, .35);
  }
  add(f.evidenceStrength, .75, .25, 1.0);
  add(f.roleMultiplier, 1, .15, .8);
  add(f.teamPpg, 22.5, 8, .7);
  add(f.opponentPointsAllowed, 22.5, 8, .55);
  if (!weight) return 0;
  const sampleTrust = finite(f.redZoneGames) ? clamp(Number(f.redZoneGames) / 8, .35, 1) : .35;
  return clamp((score / weight) * (input.market === "first_td" ? 2.6 : 3.4) * sampleTrust, input.market === "first_td" ? -3 : -3.75, input.market === "first_td" ? 3 : 3.75);
}

/** Observation-only challenger. V3 remains the production qualifier. */
export function evaluateNflTdV4Shadow(input: NflTdV4ShadowInput): NflTdV4ShadowEvaluation {
  const baseV3Weight = input.market === "first_td" ? 0.68 : 0.76;
  const quoteEvidence = clamp((input.quoteCount ?? 0) / 5, 0.35, 1);
  const v3Weight = clamp(baseV3Weight * quoteEvidence, 0.35, 0.82);
  const anchored = input.v3ModelProbability * v3Weight + input.marketProbability * (1 - v3Weight);
  const featureAdjustmentPoints = structuredFeatureAdjustment(input);
  const candidateProbability = clamp(anchored + featureAdjustmentPoints, 0.1, 95);

  return {
    version: NFL_TD_V4_SHADOW_VERSION,
    mode: "shadow",
    automaticPromotion: false,
    sourceModel: "nfl-td-v3",
    input,
    candidateProbability,
    candidateEdgePoints: candidateProbability - input.marketProbability,
    featureAdjustmentPoints,
    notes: [
      "Observation only; never used to qualify an Official Play.",
      input.features ? (input.market === "first_td" ? "Uses frozen early-drive, goal-line, red-zone, role and environment features." : "Uses frozen full-game scoring, goal-line, red-zone, role and environment features.") : "Structured feature snapshot unavailable; candidate falls back to conservative V3/market anchoring.",
      "Promotion requires chronological out-of-sample validation and an explicit version change.",
    ],
  };
}
