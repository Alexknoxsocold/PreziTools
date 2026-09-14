import type { ModelResult } from './nflModels.js';

type TeamEvidence = {
  record: string | null;
};

function gamesPlayed(record: string | null) {
  if (!record) return 0;
  const m = record.match(/(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);
  return m ? Number(m[1]) + Number(m[2]) + Number(m[3] ?? 0) : 0;
}

/**
 * Converts raw NFL moneyline value into an official recommendation.
 * Positive EV alone is intentionally insufficient. The independent model must
 * disagree with the market by a meaningful amount and have enough team evidence
 * to justify trusting that disagreement.
 */
export function gateNflMoneylineRecommendation(
  result: ModelResult | null,
  side: TeamEvidence,
  opponent: TeamEvidence,
): ModelResult | null {
  if (!result) return null;

  const sideGames = gamesPlayed(side.record);
  const opponentGames = gamesPlayed(opponent.record);
  const sampleGames = Math.min(sideGames, opponentGames);

  // Early-season estimates are allowed to exist as LEANs, but require a larger
  // disagreement before PreziTools will officially recommend them.
  const establishedSample = sampleGames >= 4;
  const minimumEdge = establishedSample ? 4.5 : 6.0;
  const minimumEv = establishedSample ? 0.065 : 0.09;
  const minimumProbability = 42;
  const independentConviction =
    result.modelProbability >= minimumProbability &&
    result.edgePoints >= minimumEdge &&
    result.expectedValue >= minimumEv;

  const qualifies = establishedSample && independentConviction;
  const confidence = qualifies
    ? result.edgePoints >= 7 && result.expectedValue >= 0.11
      ? 'elite'
      : 'strong'
    : 'watch';

  return {
    ...result,
    qualifies,
    confidence,
    reasons: [
      ...result.reasons,
      `Recommendation gate: ${qualifies ? 'PASS' : 'LEAN only'}`,
      `Independent conviction: ${result.edgePoints.toFixed(1)}-pt model/market disagreement · ${(result.expectedValue * 100).toFixed(1)}% EV`,
      `Evidence sample: ${sampleGames} games minimum across both teams${establishedSample ? '' : ' · official play requires 4+'}`,
      qualifies
        ? 'Official moneyline: model evidence independently supports the market disagreement'
        : 'Positive EV alone does not qualify as an official PreziTools moneyline play',
    ],
  };
}
