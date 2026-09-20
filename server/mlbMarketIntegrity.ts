export type MarketIntegrityQuote = {
  americanOdds: number;
  capturedAt?: string | null;
  updatedAt?: string | null;
};

const MAX_QUOTE_AGE_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;
const MIN_STANDARD_BINARY_PROBABILITY = 0.12;
const MAX_STANDARD_BINARY_PROBABILITY = 0.88;
const MAX_CONSENSUS_DISTANCE = 0.25;
const MAX_TWO_BOOK_DISTANCE = 0.30;

export function marketImpliedProbability(americanOdds: number): number | null {
  if (!Number.isFinite(americanOdds) || americanOdds === 0) return null;
  return americanOdds > 0
    ? 100 / (americanOdds + 100)
    : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Removes quotes that cannot be trusted for a standard two-way 0.5-run market.
 * Prices must be timestamped and fresh. With multiple books, a quote must also
 * remain reasonably close to the side consensus; otherwise an accidentally
 * mapped alternate market (for example +1000 beside normal RFI prices) cannot
 * become the displayed best price merely because it produces the largest EV.
 */
export function filterRfiMarketQuotes<T extends MarketIntegrityQuote>(quotes: T[], now = new Date()): T[] {
  const currentTime = now.getTime();
  const candidates = quotes.filter(quote => {
    const implied = marketImpliedProbability(quote.americanOdds);
    if (implied === null || implied < MIN_STANDARD_BINARY_PROBABILITY || implied > MAX_STANDARD_BINARY_PROBABILITY) return false;
    const rawTimestamp = quote.capturedAt ?? quote.updatedAt;
    if (!rawTimestamp) return false;
    const timestamp = new Date(rawTimestamp).getTime();
    if (!Number.isFinite(timestamp)) return false;
    const age = currentTime - timestamp;
    return age >= -MAX_FUTURE_SKEW_MS && age <= MAX_QUOTE_AGE_MS;
  });

  if (candidates.length < 2) return candidates;
  const probabilities = candidates.map(quote => marketImpliedProbability(quote.americanOdds) as number);
  if (candidates.length === 2 && Math.abs(probabilities[0] - probabilities[1]) > MAX_TWO_BOOK_DISTANCE) return [];
  if (candidates.length < 3) return candidates;
  const consensus = median(probabilities);
  return candidates.filter(quote => Math.abs((marketImpliedProbability(quote.americanOdds) as number) - consensus) <= MAX_CONSENSUS_DISTANCE);
}

/** Validates that opposite sides offered by one book resemble one binary market. */
export function hasCoherentTwoWayPrice(targetOdds: number, oppositeOdds: number): boolean {
  const target = marketImpliedProbability(targetOdds);
  const opposite = marketImpliedProbability(oppositeOdds);
  if (target === null || opposite === null) return false;
  const total = target + opposite;
  return total >= 0.85 && total <= 1.25;
}
