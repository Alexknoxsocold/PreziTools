export const NFL_TD_V4_SHADOW_VERSION = "nfl-td-v4-shadow-2" as const;

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
  add(f.tdPerGame, .55, .45, 1.1);
  add(f.redZoneOppPerGame, 1.5, 1.25, 1.2);
  add(f.inside10PerGame, .65, .65, 1.25);
  add(f.inside5PerGame, .30, .40, 1.35);
  if (input.market === "first_td") add(f.firstHalfRedZonePerGame, .75, .75, 1.4);
  add(f.evidenceStrength, .75, .25, .9);
  add(f.roleMultiplier, 1, .15, .65);
  add(f.teamPpg, 22.5, 8, .55);
  add(f.opponentPointsAllowed, 22.5, 8, .45);
  if (!weight) return 0;
  const sampleTrust = finite(f.redZoneGames) ? clamp(Number(f.redZoneGames) / 8, .35, 1) : .35;
  return clamp((score / weight) * (input.market === "first_td" ? 2.2 : 3.2) * sampleTrust, input.market === "first_td" ? -2.5 : -3.5, input.market === "first_td" ? 2.5 : 3.5);
}

/** Observation-only challenger. V3 remains the production qualifier. */
export function evaluateNflTdV4Shadow(input: NflTdV4ShadowInput): NflTdV4ShadowEvaluation {
  const baseV3Weight = input.market === "first_td" ? 0.72 : 0.8;
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
      input.features ? "Uses frozen structured usage, red-zone, role and environment features." : "Structured feature snapshot unavailable; candidate falls back to conservative V3/market anchoring.",
      "Promotion requires chronological out-of-sample validation and an explicit version change.",
    ],
  };
}
