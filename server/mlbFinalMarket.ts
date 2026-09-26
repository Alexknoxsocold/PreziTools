import type { NrfiGame, NrfiMarketValue } from "./mlbNrfi.js";
import type { FirstInningMarket } from "./mlbFirstInningMarkets.js";

export function finalNrfiMarketValue(
  game: Pick<NrfiGame, "recommendation" | "nrfiProbability">,
  market: FirstInningMarket | undefined,
): NrfiMarketValue | null {
  if (!market || market.selection !== game.recommendation) return null;
  const probability = game.recommendation === "NRFI" ? game.nrfiProbability / 100 : 1 - game.nrfiProbability / 100;
  if (!Number.isFinite(probability) || !Number.isFinite(market.price) || market.price === 0 ||
      !Number.isFinite(market.noVigProbability)) return null;
  const edge = probability * 100 - market.noVigProbability;
  const profit = market.price > 0 ? market.price / 100 : 100 / Math.abs(market.price);
  const ev = (probability * profit - (1 - probability)) * 100;
  return {
    available: true, selection: market.selection, book: market.book,
    price: market.price, impliedProbability: market.impliedProbability,
    noVigProbability: market.noVigProbability, edge, ev,
    valuePlay: edge >= 2 && ev > 0,
    updatedAt: market.capturedAt, quotes: market.quotes, quoteCount: market.quoteCount,
  };
}
