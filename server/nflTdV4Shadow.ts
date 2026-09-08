export const NFL_TD_V4_SHADOW_VERSION = "nfl-td-v4-shadow-1" as const;

/**
 * V4 is observation-only. It must never replace or mutate V3 automatically.
 * Every candidate evaluation is versioned and derived from the frozen V3
 * prediction snapshot so forward testing stays reproducible.
 */
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
  notes: string[];
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/**
 * Initial shadow candidate intentionally stays conservative. This is NOT used
 * for public picks. It creates a separately versioned candidate probability
 * that can be graded chronologically against V3 before any future promotion.
 */
export function evaluateNflTdV4Shadow(input: NflTdV4ShadowInput): NflTdV4ShadowEvaluation {
  const marketWeight = input.market === "first_td" ? 0.72 : 0.8;
  const evidenceWeight = clamp((input.quoteCount ?? 0) / 5, 0.35, 1);
  const v3Weight = clamp(marketWeight * evidenceWeight, 0.35, 0.82);
  const candidateProbability = clamp(
    input.v3ModelProbability * v3Weight + input.marketProbability * (1 - v3Weight),
    0.1,
    95,
  );

  return {
    version: NFL_TD_V4_SHADOW_VERSION,
    mode: "shadow",
    automaticPromotion: false,
    sourceModel: "nfl-td-v3",
    input,
    candidateProbability,
    candidateEdgePoints: candidateProbability - input.marketProbability,
    notes: [
      "Observation only; never used to qualify an Official Play.",
      "Derived from the frozen V3 snapshot and sportsbook consensus.",
      "Promotion requires chronological out-of-sample validation and an explicit version change.",
    ],
  };
}
