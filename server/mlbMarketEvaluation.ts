import { evaluateMlbMarketValue, type MlbMarketQuote, type MlbMarketValue } from "./mlbMarketValue.js";
import type { NormalizedMlbMarketQuote } from "./mlbMarketCollector.js";
import { filterRfiMarketQuotes } from "./mlbMarketIntegrity.js";

export type GameMarketEvaluation = {
  gameId: string;
  marketValue: MlbMarketValue;
};

function sameMarket(a: NormalizedMlbMarketQuote, b: NormalizedMlbMarketQuote): boolean {
  return a.sportsbook.toLowerCase() === b.sportsbook.toLowerCase()
    && a.market.toLowerCase() === b.market.toLowerCase();
}

/**
 * Connects normalized collector output to the verified value engine.
 * A game only receives a value result when a quote for the model side exists.
 * No-vig comparisons are only made between the two sides from the same book
 * and market. When several books are available, the best valid EV is selected.
 */
export function evaluateGameMarket(input: {
  gameId: string;
  modelSide: "NRFI" | "YRFI";
  modelProbability: number;
  quotes: NormalizedMlbMarketQuote[];
  now?: Date;
}): GameMarketEvaluation {
  const gameQuotes = input.quotes.filter(q => q.gameId === input.gameId);
  const targets = filterRfiMarketQuotes(gameQuotes.filter(q => q.side === input.modelSide), input.now);
  const opposites = filterRfiMarketQuotes(gameQuotes.filter(q => q.side !== input.modelSide), input.now);
  let best: MlbMarketValue | null = null;

  for (const target of targets) {
    const opposite = opposites.find(q => sameMarket(target, q)) ?? null;
    const value = evaluateMlbMarketValue({
      modelSide: input.modelSide,
      modelProbability: input.modelProbability,
      target: target as MlbMarketQuote,
      opposite: opposite as MlbMarketQuote | null,
      now: input.now,
    });
    if (!value.available) continue;
    if (!best || (value.expectedValue ?? -Infinity) > (best.expectedValue ?? -Infinity)) best = value;
  }

  if (best) return { gameId: input.gameId, marketValue: best };

  const target = targets[0] ?? null;
  const fallback = evaluateMlbMarketValue({
    modelSide: input.modelSide,
    modelProbability: input.modelProbability,
    target: target as MlbMarketQuote | null,
    opposite: null,
    now: input.now,
  });
  return { gameId: input.gameId, marketValue: fallback };
}

export function evaluateGameMarkets(inputs: Array<{
  gameId: string;
  modelSide: "NRFI" | "YRFI";
  modelProbability: number;
  quotes: NormalizedMlbMarketQuote[];
}>, now = new Date()): GameMarketEvaluation[] {
  return inputs.map(input => evaluateGameMarket({ ...input, now }));
}
