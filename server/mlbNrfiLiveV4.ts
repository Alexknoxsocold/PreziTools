import { calibrateRecommendedProbability } from "./mlbCalibration.js";
import { getMlbAdaptiveDecisionPolicy, type MlbAdaptiveDecisionPolicy } from "./mlbAdaptiveDecision.js";
import { fetchNrfiData, type NrfiGame, type NrfiResponse, type NrfiWindowResponse } from "./mlbNrfi.js";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
type PlayStatus = NrfiGame["playStatus"];

type DecisionAudit = {
  v3Probability: number;
  v4Probability: number | null;
  agreement: "strong" | "mixed" | "none";
  separation: number;
};

function buildDecisionAudit(game: NrfiGame): DecisionAudit {
  const v3Probability = game.nrfiProbability / 100;
  const v4Probability = game.v4Shadow?.uncertaintyAdjustedNrfiProbability ?? null;
  if (v4Probability === null) return { v3Probability, v4Probability, agreement: "none", separation: 0 };
  const v3Side = v3Probability >= 0.5 ? "NRFI" : "YRFI";
  const v4Side = v4Probability >= 0.5 ? "NRFI" : "YRFI";
  const agreement = v3Side !== v4Side ? "mixed" : Math.abs(v3Probability - v4Probability) <= 0.035 ? "strong" : "mixed";
  return { v3Probability, v4Probability, agreement, separation: Math.abs(v3Probability - 0.5) };
}

function adaptiveLeanThreshold(probability: number, policy: MlbAdaptiveDecisionPolicy): number {
  return probability >= 0.5 ? policy.nrfiLeanThreshold : policy.yrfiLeanThreshold;
}

function classifyLivePlay(
  probability: number,
  confidence: NrfiGame["confidence"],
  sampleSize: number,
  agreement: DecisionAudit["agreement"],
  policy: MlbAdaptiveDecisionPolicy,
): PlayStatus {
  const edge = Math.abs(probability - 0.5);
  const learnedLeanThreshold = adaptiveLeanThreshold(probability, policy);

  if (sampleSize < 3 || confidence === "Low") return edge >= 0.04 && agreement === "strong" ? "LEAN" : "NO_PLAY";
  if (agreement === "mixed") {
    if (edge >= 0.07 && confidence === "High" && sampleSize >= 8) return "LEAN";
    return edge >= policy.defaultLeanThreshold ? "LEAN" : "NO_PLAY";
  }
  if (edge >= 0.10 && confidence === "High" && sampleSize >= 10 && agreement === "strong") return "BEST_PLAY";
  if (edge >= 0.06 && sampleSize >= 5 && agreement === "strong") return "PLAY";
  if (edge >= learnedLeanThreshold) return "LEAN";
  return "NO_PLAY";
}

function decisionGate(
  status: PlayStatus,
  probability: number,
  confidence: NrfiGame["confidence"],
  sampleSize: number,
  agreement: DecisionAudit["agreement"],
  policy: MlbAdaptiveDecisionPolicy,
): string {
  const separationPts = Math.abs(probability - 0.5) * 100;
  const sep = separationPts.toFixed(1);
  const threshold = adaptiveLeanThreshold(probability, policy);
  const adaptiveActive = threshold < policy.defaultLeanThreshold;
  const thresholdPts = (threshold * 100).toFixed(1);
  if (status === "BEST_PLAY") return `Decision gate: BEST PLAY — ${sep}-point separation, High confidence, ${sampleSize}-game sample and strong V3/V4 agreement clear every promotion gate.`;
  if (status === "PLAY") return `Decision gate: PLAY — ${sep}-point separation with ${confidence} confidence, ${sampleSize}-game sample and strong V3/V4 agreement clears the 6-point play threshold.`;
  if (status === "LEAN") {
    if (confidence === "Low" || sampleSize < 3) return `Decision gate: LEAN — direction is meaningful (${sep} points), but ${confidence === "Low" ? "data confidence is Low" : `the sample is only ${sampleSize} games`}, so promotion to PLAY is blocked.`;
    if (agreement === "mixed") return `Decision gate: LEAN — ${sep}-point separation, but V3 and V4 signals are mixed, so promotion is intentionally capped.`;
    if (adaptiveActive && separationPts < 3.5) return `Decision gate: LEAN — ${sep}-point separation clears the learned ${thresholdPts}-point lean gate. This small adjustment is backed by 30+ graded V4 NO PLAY examples for this side; PLAY thresholds are unchanged.`;
    if (separationPts < 6) return `Decision gate: LEAN — ${sep}-point separation clears the lean threshold but remains below the 6-point PLAY threshold.`;
    return `Decision gate: LEAN — probability is separated by ${sep} points, but evidence quality does not clear all PLAY requirements.`;
  }
  if (confidence === "Low") return `Decision gate: NO PLAY — data confidence is Low; the model will not promote an uncertain signal even when one side is slightly favored.`;
  if (sampleSize < 3) return `Decision gate: NO PLAY — only ${sampleSize} verified recent games are available, below the minimum evidence requirement.`;
  if (agreement === "mixed" && separationPts < 3.5) return `Decision gate: NO PLAY — V3/V4 signals are mixed and ${sep}-point separation is below the 3.5-point lean threshold.`;
  if (agreement === "mixed") return `Decision gate: NO PLAY — V3/V4 disagreement prevents promotion at the current ${sep}-point separation.`;
  return `Decision gate: NO PLAY — ${sep}-point separation is below the ${thresholdPts}-point lean threshold${adaptiveActive ? " after conservative NO PLAY learning" : ""}.`;
}

function applyLiveV4(game: NrfiGame, policy: MlbAdaptiveDecisionPolicy): NrfiGame {
  const v4 = game.v4Shadow;
  if (!v4) return game;
  const audit = buildDecisionAudit(game);
  const v3 = audit.v3Probability;
  const quality = v4.uncertainty.score;
  const v4Weight = clamp(0.20 + quality * 0.35, 0.20, 0.55);
  const blended = v3 * (1 - v4Weight) + v4.uncertaintyAdjustedNrfiProbability * v4Weight;
  const provisional = clamp(blended, 0.35, 0.65);
  const nrfiProbability = Math.round(provisional * 1000) / 10;
  const recommendation: NrfiGame["recommendation"] = nrfiProbability >= 50 ? "NRFI" : "YRFI";
  const modelEdge = Math.round(Math.abs(nrfiProbability - 50) * 10) / 10;
  const confidence: NrfiGame["confidence"] = v4.uncertainty.label === "Low" ? "Low" : game.confidence;
  const playStatus = classifyLivePlay(nrfiProbability / 100, confidence, game.sampleSize, audit.agreement, policy);
  const factors = [
    ...(game.factors ?? []).filter(f => !f.startsWith("Model v4 live") && !f.startsWith("Decision agreement:") && !f.startsWith("Decision gate:") && !f.startsWith("NO PLAY learning:")),
    `Model v4 live: ${(v4Weight * 100).toFixed(0)}% V4 blend, ${(quality * 100).toFixed(0)}% data-quality score${v4.uncertainty.penalties.length ? ` (${v4.uncertainty.penalties.join(", ")})` : ""}`,
    `Decision agreement: ${audit.agreement === "strong" ? "V3 and V4 agree on direction" : audit.agreement === "mixed" ? "V3/V4 signals are mixed; promotion is capped" : "V4 comparison unavailable"}`,
    `NO PLAY learning: NRFI lean gate ${(policy.nrfiLeanThreshold * 100).toFixed(1)} pts, YRFI lean gate ${(policy.yrfiLeanThreshold * 100).toFixed(1)} pts; PLAY remains 6.0 pts.`,
    decisionGate(playStatus, nrfiProbability / 100, confidence, game.sampleSize, audit.agreement, policy),
  ];
  return { ...game, nrfiProbability, recommendation, modelEdge, confidence, playStatus, factors };
}

async function calibrateGame(game: NrfiGame, policy: MlbAdaptiveDecisionPolicy): Promise<NrfiGame> {
  const transformed = applyLiveV4(game, policy);
  const transformedNrfi = transformed.nrfiProbability / 100;
  const transformedSideProbability = transformedNrfi >= 0.5 ? transformedNrfi : 1 - transformedNrfi;

  const calibrated = transformedSideProbability >= 0.55
    ? clamp(await calibrateRecommendedProbability(transformedNrfi), 0.35, 0.65)
    : transformedNrfi;

  const nrfiProbability = Math.round(calibrated * 1000) / 10;
  const recommendation: NrfiGame["recommendation"] = nrfiProbability >= 50 ? "NRFI" : "YRFI";
  const modelEdge = Math.round(Math.abs(nrfiProbability - 50) * 10) / 10;
  const agreement = buildDecisionAudit(game).agreement;
  const playStatus = classifyLivePlay(nrfiProbability / 100, transformed.confidence, transformed.sampleSize, agreement, policy);
  const factors = [
    ...(transformed.factors ?? []).filter(f => !f.startsWith("Decision gate:") && !f.startsWith("Historical calibration:")),
    transformedSideProbability >= 0.55
      ? "Historical calibration: applied because the live side probability cleared 55%."
      : "Historical calibration: held neutral below 55% so weak historical buckets cannot flatten a live directional signal.",
    decisionGate(playStatus, nrfiProbability / 100, transformed.confidence, transformed.sampleSize, agreement, policy),
  ];

  // Preserve the base feed's settled first-inning outcome immediately. The base
  // feed only resolves outcome after both first-inning line scores are present
  // and the event is no longer pregame, so a 0-0 NRFI is not graded mid-inning.
  return { ...transformed, nrfiProbability, recommendation, modelEdge, playStatus, factors };
}

function rankTopPick(games: NrfiGame[]): NrfiGame | null {
  return [...games].filter(game => game.playStatus === "BEST_PLAY" || game.playStatus === "PLAY").sort((a, b) => b.modelEdge - a.modelEdge || (b.confidence === "High" ? 1 : 0) - (a.confidence === "High" ? 1 : 0))[0] ?? null;
}

export async function fetchNrfiDataV4Live(date?: string): Promise<NrfiResponse> {
  const [base, policy] = await Promise.all([fetchNrfiData(date), getMlbAdaptiveDecisionPolicy(90)]);
  const games = await Promise.all(base.games.map(game => calibrateGame(game, policy)));
  return {
    ...base,
    games,
    averageNrfiProbability: games.length ? Math.round(games.reduce((sum, game) => sum + game.nrfiProbability, 0) / games.length * 10) / 10 : null,
    topPick: rankTopPick(games),
    methodology: "V4 live blend: V3 baseline + uncertainty-adjusted V4 first-inning signal. V4 influence scales with data quality, weak inputs shrink toward neutral, and disagreement caps promotion. Historical bucket calibration is only allowed to alter calls whose live side probability is already at least 55%, preventing the large near-50/50 bucket from flattening valid directional leans. Correct historical V4 NO PLAY calls may lower the matching side's LEAN gate from 3.5 to 3.0 probability points only after 30+ graded examples with a 55%+ hit rate and a 2-point positive calibration gap. PLAY and BEST PLAY gates never auto-relax.",
  };
}

export async function fetchUpcomingNrfiDataV4Live(days = 3): Promise<NrfiWindowResponse> {
  const safeDays = Math.min(Math.max(days, 1), 3);
  const dates = Array.from({ length: safeDays }, (_, index) => { const date = new Date(); date.setUTCDate(date.getUTCDate() + index); return date.toISOString().slice(0, 10); });
  const responses = await Promise.all(dates.map(date => fetchNrfiDataV4Live(date)));
  const games = responses.flatMap(response => response.games);
  return { startDate: responses[0]?.date ?? dates[0], endDate: responses[responses.length - 1]?.date ?? dates[dates.length - 1], days: responses, games, averageNrfiProbability: games.length ? Math.round(games.reduce((sum, game) => sum + game.nrfiProbability, 0) / games.length * 10) / 10 : null, topPick: rankTopPick(games), updatedAt: new Date().toISOString() };
}
