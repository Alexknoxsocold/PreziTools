import { fetchLiveMlbMarketQuotes } from "./mlbMarketService.js";
import { evaluateMlbMarketValue, type MlbMarketQuote } from "./mlbMarketValue.js";
import type { NormalizedMlbMarketQuote } from "./mlbMarketCollector.js";

export type MlbRfiMarket = {
  available: boolean;
  book: string | null;
  selection: "NRFI" | "YRFI" | null;
  price: number | null;
  impliedProbability: number | null;
  noVigProbability: number | null;
  edge: number | null;
  ev: number | null;
  valuePlay?: boolean;
  updatedAt: string | null;
  ageSeconds?: number | null;
};

const TTL = 60_000;
let cache: { value: NormalizedMlbMarketQuote[]; expiresAt: number } | null = null;
let inflight: Promise<NormalizedMlbMarketQuote[]> | null = null;

const norm = (value: string | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const keyFor = (away: string | undefined, home: string | undefined) => `${norm(away)}@${norm(home)}`;

function quoteToLegacyMarket(quote: NormalizedMlbMarketQuote): MlbRfiMarket {
  return {
    available: true,
    book: quote.sportsbook,
    selection: quote.side,
    price: quote.americanOdds,
    impliedProbability: null,
    noVigProbability: null,
    edge: null,
    ev: null,
    valuePlay: false,
    updatedAt: quote.capturedAt,
  };
}

export function getCachedMlbRfiQuotes(): NormalizedMlbMarketQuote[] {
  if (!cache || cache.expiresAt <= Date.now()) return [];
  return cache.value;
}

export function getCachedMlbRfiMarkets(): Map<string, MlbRfiMarket> {
  const quotes = getCachedMlbRfiQuotes();
  const out = new Map<string, MlbRfiMarket>();
  for (const quote of quotes) {
    const key = `${keyFor(quote.awayTeam ?? undefined, quote.homeTeam ?? undefined)}:${quote.side}:${quote.sportsbook}`;
    out.set(key, quoteToLegacyMarket(quote));
  }
  return out;
}

export async function fetchMlbRfiMarkets(): Promise<Map<string, MlbRfiMarket>> {
  if (cache && cache.expiresAt > Date.now()) return getCachedMlbRfiMarkets();
  if (inflight) {
    await inflight;
    return getCachedMlbRfiMarkets();
  }

  inflight = (async () => {
    try {
      const quotes = await fetchLiveMlbMarketQuotes();
      cache = { value: quotes, expiresAt: Date.now() + TTL };
      console.log(`[MLB Odds] Verified RFI market refresh: ${quotes.length} side quotes collected.`);
      return quotes;
    } catch (error) {
      console.warn("[MLB Odds] Verified market refresh failed:", error);
      return cache?.value ?? [];
    } finally {
      inflight = null;
    }
  })();

  await inflight;
  return getCachedMlbRfiMarkets();
}

function quoteMatchesGame(quote: NormalizedMlbMarketQuote, away: string, home: string): boolean {
  return keyFor(quote.awayTeam ?? undefined, quote.homeTeam ?? undefined) === keyFor(away, home);
}

function evaluateQuotesForTeams(
  quotes: NormalizedMlbMarketQuote[],
  away: string,
  home: string,
  side: "NRFI" | "YRFI",
  modelProbability: number,
  now = new Date(),
): MlbRfiMarket | null {
  let best: MlbRfiMarket | null = null;
  for (const target of quotes.filter(q => q.side === side && quoteMatchesGame(q, away, home))) {
    const opposite = quotes.find(q =>
      q.gameId === target.gameId &&
      q.side !== side &&
      q.sportsbook.toLowerCase() === target.sportsbook.toLowerCase() &&
      q.market.toLowerCase() === target.market.toLowerCase()
    ) ?? null;

    const value = evaluateMlbMarketValue({
      modelSide: side,
      modelProbability,
      target: target as MlbMarketQuote,
      opposite: opposite as MlbMarketQuote | null,
      now,
    });
    if (!value.available) continue;

    const candidate: MlbRfiMarket = {
      available: true,
      book: value.sportsbook,
      selection: value.side,
      price: value.americanOdds,
      impliedProbability: value.impliedProbability,
      noVigProbability: value.noVigProbability,
      edge: value.edge,
      ev: value.expectedValue,
      valuePlay: value.valuePlay,
      updatedAt: value.capturedAt,
      ageSeconds: value.ageSeconds,
    };
    if (!best || (candidate.ev ?? -Infinity) > (best.ev ?? -Infinity)) best = candidate;
  }
  return best;
}

/**
 * Synchronous path for the Express response decorator. It only evaluates the
 * already-warmed verified quote cache; it never waits on a sportsbook source.
 */
export function valueFromCachedQuotesForTeams(
  away: string,
  home: string,
  side: "NRFI" | "YRFI",
  modelProbability: number,
  now = new Date(),
): MlbRfiMarket | null {
  return evaluateQuotesForTeams(getCachedMlbRfiQuotes(), away, home, side, modelProbability, now);
}

/**
 * Compatibility path for callers that already consume the legacy Map shape.
 * It intentionally has no-vig unavailable because the opposite quote is not
 * represented in that Map. New code should use valueFromCachedQuotesForTeams.
 */
export function valueFromMarketForTeams(
  market: Map<string, MlbRfiMarket>,
  away: string,
  home: string,
  side: "NRFI" | "YRFI",
  modelProbability: number,
): MlbRfiMarket | null {
  const prefix = `${keyFor(away, home)}:${side}:`;
  let best: MlbRfiMarket | null = null;
  for (const [key, item] of market) {
    if (!key.startsWith(prefix) || item.price === null) continue;
    const captured = item.updatedAt ? new Date(item.updatedAt).getTime() : NaN;
    const ageSeconds = Number.isFinite(captured) ? Math.max(0, (Date.now() - captured) / 1000) : Infinity;
    if (!Number.isFinite(ageSeconds) || ageSeconds > 15 * 60) continue;
    const decimal = item.price > 0 ? 1 + item.price / 100 : 1 + 100 / Math.abs(item.price);
    const ev = modelProbability * decimal - 1;
    const scored = { ...item, ev, ageSeconds };
    if (!best || (scored.ev ?? -Infinity) > (best.ev ?? -Infinity)) best = scored;
  }
  return best;
}

export async function valueLiveMarketForTeams(
  away: string,
  home: string,
  side: "NRFI" | "YRFI",
  modelProbability: number,
  now = new Date(),
): Promise<MlbRfiMarket | null> {
  const quotes = cache && cache.expiresAt > Date.now() ? cache.value : await fetchLiveMlbMarketQuotes();
  return evaluateQuotesForTeams(quotes, away, home, side, modelProbability, now);
}
