import {
  expectedValuePerDollar,
  formatAmericanOdds,
  modelEdgePoints,
  parseAmericanOdds,
  qualifiesAsMarketValue,
} from './normalized';

const PARLAY_URL = 'https://parlay-api.com/v1/sports/basketball_wnba/props';
const CACHE_TTL_MS = 20 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6500;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

type ParlayPropRow = Record<string, unknown>;

export type WnbaFirstBasketMarket = {
  source: 'ParlayAPI';
  market: 'player_first_basket';
  bestOdds: number;
  bestOddsDisplay: string;
  bestBook: string;
  fanduelOdds: number | null;
  draftkingsOdds: number | null;
  impliedProbability: number;
  edgePoints: number;
  expectedValue: number;
  qualifiesValue: boolean;
  lastUpdate: string | null;
};

export type ParlayWnbaDiagnostics = {
  keyConfigured: boolean;
  endpoint: string;
  cacheAgeSeconds: number | null;
  rawRowCount: number;
  firstBasketRowCount: number;
  marketKeys: string[];
  books: string[];
  draftkingsRows: number;
  fanduelRows: number;
  sample: Array<{ player: string; market: string; book: string; odds: number | null }>;
  lastFetchAt: string | null;
  lastHttpStatus: number | null;
  payloadShape: string;
};

let cache: { at: number; rows: ParlayPropRow[] } | null = null;
let inFlight: Promise<ParlayPropRow[]> | null = null;
let diagnostics: ParlayWnbaDiagnostics = {
  keyConfigured: Boolean(process.env.PARLAY_API_KEY),
  endpoint: PARLAY_URL,
  cacheAgeSeconds: null,
  rawRowCount: 0,
  firstBasketRowCount: 0,
  marketKeys: [],
  books: [],
  draftkingsRows: 0,
  fanduelRows: 0,
  sample: [],
  lastFetchAt: null,
  lastHttpStatus: null,
  payloadShape: 'not-fetched',
};

function normalizeName(value: unknown): string {
  return String(value ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[.'’\-]/g, '').replace(/\s+/g, ' ').trim();
}
function rowPlayer(row: ParlayPropRow): string { return String(row.player ?? row.player_name ?? row.athlete ?? row.selection ?? '').trim(); }
function rowMarket(row: ParlayPropRow): string { return String(row.market_key ?? row.market ?? row.marketKey ?? row.market_name ?? '').trim(); }
function rowBookKey(row: ParlayPropRow): string { return String(row.bookmaker ?? row.source ?? row.bookmaker_key ?? row.book ?? '').toLowerCase().trim(); }
function rowBookTitle(row: ParlayPropRow): string {
  const key = rowBookKey(row);
  const title = String(row.bookmaker_title ?? row.source_title ?? row.bookmaker_name ?? row.book_name ?? '').trim();
  if (title) return title;
  if (key === 'fanduel') return 'FanDuel';
  if (key === 'draftkings') return 'DraftKings';
  return key || 'Sportsbook';
}
function rowOdds(row: ParlayPropRow): number | null {
  for (const value of [row.price_american, row.price, row.over_price, row.odds, row.american_odds]) {
    const parsed = parseAmericanOdds(value as string | number | null | undefined);
    if (parsed !== null) return parsed;
  }
  return null;
}
function rowLastUpdate(row: ParlayPropRow): string | null {
  const raw = row.last_update ?? row.snapshot_time ?? row.updated_at;
  if (raw === null || raw === undefined || raw === '') return null;
  const d = typeof raw === 'number' ? new Date(raw > 10_000_000_000 ? raw : raw * 1000) : new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function payloadShape(payload: any): string {
  if (Array.isArray(payload)) return 'array';
  if (!payload || typeof payload !== 'object') return typeof payload;
  const keys = Object.keys(payload).slice(0, 12);
  const arrays = keys.filter(key => Array.isArray(payload[key]));
  return `object keys=[${keys.join(',')}] arrays=[${arrays.join(',')}]`;
}
function extractRows(payload: any): ParlayPropRow[] {
  if (Array.isArray(payload)) return payload;
  const direct = [payload?.data, payload?.results, payload?.props, payload?.markets, payload?.items];
  for (const candidate of direct) if (Array.isArray(candidate)) return candidate;
  for (const container of direct) {
    if (!container || typeof container !== 'object' || Array.isArray(container)) continue;
    for (const value of Object.values(container)) if (Array.isArray(value)) return value as ParlayPropRow[];
  }
  return [];
}
function updateDiagnostics(rawRows: ParlayPropRow[], firstBasketRows: ParlayPropRow[], status: number | null, shape: string) {
  const marketKeys = [...new Set(rawRows.map(rowMarket).filter(Boolean))].sort();
  const books = [...new Set(rawRows.map(rowBookKey).filter(Boolean))].sort();
  diagnostics = {
    keyConfigured: Boolean(process.env.PARLAY_API_KEY), endpoint: PARLAY_URL, cacheAgeSeconds: 0,
    rawRowCount: rawRows.length, firstBasketRowCount: firstBasketRows.length,
    marketKeys: marketKeys.slice(0, 30), books: books.slice(0, 20),
    draftkingsRows: rawRows.filter(row => rowBookKey(row) === 'draftkings').length,
    fanduelRows: rawRows.filter(row => rowBookKey(row) === 'fanduel').length,
    sample: rawRows.slice(0, 8).map(row => ({ player: rowPlayer(row), market: rowMarket(row), book: rowBookTitle(row), odds: rowOdds(row) })),
    lastFetchAt: new Date().toISOString(), lastHttpStatus: status, payloadShape: shape,
  };
}
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function staleRows(reason: string): ParlayPropRow[] {
  if (cache?.rows?.length) {
    console.warn(`[ParlayAPI] WNBA ${reason}; serving last valid cached first-basket market (${Math.round((Date.now() - cache.at) / 1000)}s old)`);
    return cache.rows;
  }
  return [];
}
async function requestRows(): Promise<ParlayPropRow[]> {
  const apiKey = process.env.PARLAY_API_KEY;
  if (!apiKey) return [];
  const url = new URL(PARLAY_URL);
  url.searchParams.set('markets', 'player_first_basket');
  url.searchParams.set('bookmakers', 'fanduel,draftkings');
  url.searchParams.set('include', 'slim');
  url.searchParams.set('limit', '1000');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        diagnostics = { ...diagnostics, keyConfigured: true, lastFetchAt: new Date().toISOString(), lastHttpStatus: response.status };
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        console.warn(`[ParlayAPI] WNBA first-basket request failed: ${response.status}${response.status === 403 ? ' (provider quota/tier rejected request)' : ''}${retryable && attempt < MAX_ATTEMPTS ? `; retrying (${attempt}/${MAX_ATTEMPTS})` : ''}`);
        if (retryable && attempt < MAX_ATTEMPTS) {
          const retryAfter = Number(response.headers.get('retry-after'));
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 3000) : RETRY_DELAY_MS * attempt);
          continue;
        }
        return staleRows(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const rows = extractRows(payload);
      const firstBasketRows = rows.filter(row => {
        const market = rowMarket(row).toLowerCase();
        return market === 'player_first_basket' || market.includes('first_basket') || market.includes('first point scorer');
      });
      // Only replace a known-good cache with usable market rows. A temporary
      // empty provider payload must not erase the last valid WNBA market.
      if (firstBasketRows.length > 0) cache = { at: Date.now(), rows: firstBasketRows };
      updateDiagnostics(rows, firstBasketRows, response.status, payloadShape(payload));
      console.log('[ParlayAPI][WNBA diagnostics]', JSON.stringify({ httpStatus: diagnostics.lastHttpStatus, payloadShape: diagnostics.payloadShape, rawRows: diagnostics.rawRowCount, firstBasketRows: diagnostics.firstBasketRowCount, markets: diagnostics.marketKeys, books: diagnostics.books, draftkingsRows: diagnostics.draftkingsRows, fanduelRows: diagnostics.fanduelRows, sample: diagnostics.sample }));
      if (firstBasketRows.length === 0) return staleRows('returned zero first-basket rows');
      return firstBasketRows;
    } catch (error) {
      const isLastAttempt = attempt === MAX_ATTEMPTS;
      console.warn(`[ParlayAPI] WNBA first-basket request error${isLastAttempt ? '' : `; retrying (${attempt}/${MAX_ATTEMPTS})`}:`, error);
      if (!isLastAttempt) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      return staleRows('request timed out/failed');
    }
  }
  return staleRows('request failed');
}
async function fetchRows(): Promise<ParlayPropRow[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  if (inFlight) return inFlight;
  inFlight = requestRows();
  try { return await inFlight; } finally { inFlight = null; }
}
export function getParlayWnbaDiagnostics(): ParlayWnbaDiagnostics {
  return { ...diagnostics, cacheAgeSeconds: cache ? Math.round((Date.now() - cache.at) / 1000) : null, sample: diagnostics.sample.map(row => ({ ...row })), marketKeys: [...diagnostics.marketKeys], books: [...diagnostics.books] };
}

export async function getWnbaFirstBasketMarket(playerName: string, modelProbabilityPct: number, rank: number): Promise<WnbaFirstBasketMarket | null> {
  const rows = await fetchRows();
  const target = normalizeName(playerName);
  const matches = rows.filter(row => normalizeName(rowPlayer(row)) === target).map(row => ({ row, odds: rowOdds(row) })).filter((entry): entry is { row: ParlayPropRow; odds: number } => entry.odds !== null).sort((a, b) => b.odds - a.odds);
  if (!matches.length) return null;
  const best = matches[0];
  const fanduel = matches.filter(x => rowBookKey(x.row) === 'fanduel').sort((a, b) => b.odds - a.odds)[0]?.odds ?? null;
  const draftkings = matches.filter(x => rowBookKey(x.row) === 'draftkings').sort((a, b) => b.odds - a.odds)[0]?.odds ?? null;
  const edgePoints = modelEdgePoints(modelProbabilityPct, best.odds);
  const expectedValue = expectedValuePerDollar(modelProbabilityPct, best.odds);
  return { source: 'ParlayAPI', market: 'player_first_basket', bestOdds: best.odds, bestOddsDisplay: formatAmericanOdds(best.odds), bestBook: rowBookTitle(best.row), fanduelOdds: fanduel, draftkingsOdds: draftkings, impliedProbability: Math.max(0, modelProbabilityPct - edgePoints), edgePoints, expectedValue, qualifiesValue: rank <= 3 && qualifiesAsMarketValue(modelProbabilityPct, best.odds), lastUpdate: rowLastUpdate(best.row) };
}

export async function attachWnbaFirstBasketMarkets<T extends { name: string; probability: number; rank: number }>(candidates: T[]): Promise<Array<T & { marketOdds: WnbaFirstBasketMarket | null }>> {
  return Promise.all(candidates.map(async candidate => ({ ...candidate, marketOdds: await getWnbaFirstBasketMarket(candidate.name, candidate.probability, candidate.rank) })));
}
