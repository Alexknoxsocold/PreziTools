import "./espnFetchPatch.js";
import { propLineGet } from "./propLineClient.js";
import {
  modelMoneyline,
  qualifyTdMarkets,
  type ModelConfidence,
} from "./nflModels.js";
import { modelMoneylineV2 } from "./nflMoneylineV2.js";
import { gateNflMoneylineRecommendation } from "./nflMoneylineRecommendation.js";
import {
  captureNflTdDisplayPlays,
  captureNflTdOfficialLock,
  getHeldNflTdPlays,
  getNflTdOfficialLock,
} from "./nflTdDisplayHold.js";
import {
  captureNflMoneylineShadow,
  gradePendingNflMoneylineShadow,
} from "./nflMoneylineShadowLedger.js";
import {
  captureNflTdPredictions,
  captureNflTdClosingLines,
  gradePendingNflTdPredictions,
} from "./nflTdCalibration.js";

const ESPN_NFL_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const FEED_CACHE_MS = 5 * 60 * 1000;
const H2H_CACHE_MS = 15 * 60 * 1000;
const TD_PROP_CACHE_FAR_MS = 15 * 60 * 1000;
const TD_PROP_CACHE_NEAR_MS = 5 * 60 * 1000;
// Keep the next NFL game-day slate visible even when it is more than 24 clock
// hours away (for example Friday evening -> Sunday afternoon).
const PLAYER_PROP_LOOKAHEAD_MS = 72 * 60 * 60 * 1000;
const SPORT_KEYS = ["football_nfl", "americanfootball_nfl"] as const;
export type NflBookQuote = {
  bookmaker: string;
  bookmakerKey: string;
  americanOdds: number;
  updatedAt: string | null;
};
export type NflModelFields = {
  modelProbability: number;
  edgePoints: number;
  expectedValue: number;
  confidence: ModelConfidence;
  qualifies: boolean;
  reasons: string[];
};
export type NflPlayerMarket = {
  player: string;
  bestOdds: number;
  bestBook: string;
  impliedProbability: number;
  quoteCount: number;
  quotes: NflBookQuote[];
  team?: string;
  position?: string;
  espnId?: string;
  headshot?: string;
  modelProbability?: number;
  edgePoints?: number;
  expectedValue?: number;
  confidence?: ModelConfidence;
  qualifies?: boolean;
  reasons?: string[];
  dataStatus?: "modeled" | "not-ready";
  result?: "won" | "lost" | "pending";
};
export type NflMoneylineSide = {
  team: string;
  bestOdds: number | null;
  bestBook: string | null;
  impliedProbability: number | null;
  consensusNoVigProbability: number | null;
  quotes: NflBookQuote[];
  model?: NflModelFields | null;
};
export type NflGameContext = {
  venue: string | null;
  city: string | null;
  indoor: boolean | null;
  surface: string | null;
  temperatureF: number | null;
  windMph: number | null;
  condition: string | null;
  weatherAvailable: boolean;
  contextVersion: "NFL-TD-CONTEXT-SHADOW-V1";
};
export type NflMarketGame = {
  id: string;
  date: string;
  status: string;
  context: NflGameContext;
  away: {
    abbreviation: string;
    name: string;
    logo: string | null;
    record: string | null;
  };
  home: {
    abbreviation: string;
    name: string;
    logo: string | null;
    record: string | null;
  };
  marketStatus: "available" | "unavailable";
  marketAvailable: { moneyline: boolean; anytimeTd: boolean; firstTd: boolean };
  modelReady: { moneyline: boolean; anytimeTd: boolean; firstTd: boolean };
  moneyline: { away: NflMoneylineSide; home: NflMoneylineSide } | null;
  anytimeTd: NflPlayerMarket[];
  firstTd: NflPlayerMarket[];
  qualified: { moneyline: boolean; anytimeTd: boolean; firstTd: boolean };
  tdLocks: { anytimeTd: string | null; firstTd: string | null };
};
export type NflMarketFeed = {
  source: "ESPN + PropLine + PreziTools NFL Model";
  marketStatus: "available" | "unavailable" | "disabled";
  updatedAt: string;
  games: NflMarketGame[];
  health: {
    rawTdCandidates: number;
    modeledTdCandidates: number;
    notReadyTdCandidates: number;
    modelCoveragePct: number;
  };
  thresholds: {
    moneyline: { minEdge: number; minEv: number };
    anytimeTd: {
      minEdge: number;
      minEv: number;
      minBooks: number;
      minProbability: number;
    };
    firstTd: {
      minEdge: number;
      minEv: number;
      minBooks: number;
      minProbability: number;
    };
  };
};
type PropOutcome = {
  name?: string;
  description?: string;
  price?: number;
  book_updated_at?: string;
  last_change_at?: string;
};
type PropMarket = { key?: string; outcomes?: PropOutcome[] };
type PropBook = {
  key?: string;
  title?: string;
  last_update?: string;
  markets?: PropMarket[];
};
type PropOdds = {
  id?: string | number;
  event_id?: string | number;
  home_team?: string;
  away_team?: string;
  commence_time?: string;
  bookmakers?: PropBook[];
};
type EspnCompetitor = {
  homeAway?: string;
  team?: { abbreviation?: string; displayName?: string; logo?: string };
  records?: { summary?: string }[];
};
type EspnCompetition = {
  competitors?: EspnCompetitor[];
  venue?: {
    fullName?: string;
    indoor?: boolean;
    grass?: boolean;
    address?: { city?: string };
  };
  weather?: {
    displayValue?: string;
    temperature?: number;
    conditionId?: string;
    windSpeed?: number;
  }[];
};
type EspnEvent = {
  id?: string;
  date?: string;
  status?: { type?: { description?: string; state?: string } };
  competitions?: EspnCompetition[];
};
let cache: { expiresAt: number; value: NflMarketFeed } | null = null;
let espnFallbackCount = 0;
function normalize(v: string) {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
const NFL_TEAM_ALIASES: Record<string, string[]> = {
  ARI: ["arizona", "cardinals"], ATL: ["atlanta", "falcons"], BAL: ["baltimore", "ravens"], BUF: ["buffalo", "bills"],
  CAR: ["carolina", "panthers"], CHI: ["chicago", "bears"], CIN: ["cincinnati", "bengals"], CLE: ["cleveland", "browns"],
  DAL: ["dallas", "cowboys"], DEN: ["denver", "broncos"], DET: ["detroit", "lions"], GB: ["greenbay", "packers"],
  HOU: ["houston", "texans"], IND: ["indianapolis", "colts"], JAX: ["jacksonville", "jaguars", "jags"], KC: ["kansascity", "chiefs"],
  LV: ["lasvegas", "raiders", "oaklandraiders"], LAC: ["losangeleschargers", "lachargers", "chargers"], LAR: ["losangelesrams", "larams", "rams"],
  MIA: ["miami", "dolphins"], MIN: ["minnesota", "vikings"], NE: ["newengland", "patriots"], NO: ["neworleans", "saints"],
  NYG: ["newyorkgiants", "nygiants", "giants"], NYJ: ["newyorkjets", "nyjets", "jets"], PHI: ["philadelphia", "eagles"],
  PIT: ["pittsburgh", "steelers"], SEA: ["seattle", "seahawks"], SF: ["sanfrancisco", "49ers", "niners"], TB: ["tampabay", "buccaneers", "bucs"],
  TEN: ["tennessee", "titans"], WAS: ["washington", "commanders", "washingtonfootballteam", "redskins"],
};
function sameTeam(team: NflMarketGame["away"], rawName: string) {
  const expected = normalize(team.name), raw = normalize(rawName);
  if (!raw) return false;
  if (raw === expected || raw.includes(expected) || expected.includes(raw)) return true;
  return (NFL_TEAM_ALIASES[team.abbreviation] ?? []).some((alias) => raw === alias || raw.includes(alias));
}
function cleanPlayerName(v: string) {
  return v
    .trim()
    .replace(/\s*\([A-Z0-9]{2,5}\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
// Sportsbooks are inconsistent about suffixes (James Cook vs James Cook III,
// Jr. vs Jr, etc.). They are the same scoring market, so aggregate them before
// modeling instead of letting one player occupy multiple candidate slots.
function playerMarketKey(v: string) {
  return normalize(cleanPlayerName(v))
    .replace(/(?:junior|jr|senior|sr|iii|ii|iv|v)$/i, "");
}
function americanImplied(o: number) {
  if (!Number.isFinite(o) || o === 0) return null;
  return o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100);
}
function ymd(d: Date) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
function emptyQualified() {
  return { moneyline: false, anytimeTd: false, firstTd: false };
}
function eventContext(event: EspnEvent): NflGameContext {
  const competition = event.competitions?.[0],
    venue = competition?.venue,
    weather = competition?.weather?.[0],
    temperature = Number(weather?.temperature),
    wind = Number(weather?.windSpeed);
  return {
    venue: venue?.fullName ?? null,
    city: venue?.address?.city ?? null,
    indoor: typeof venue?.indoor === "boolean" ? venue.indoor : null,
    surface:
      typeof venue?.grass === "boolean"
        ? venue.grass
          ? "grass"
          : "artificial"
        : null,
    temperatureF: Number.isFinite(temperature) ? temperature : null,
    windMph: Number.isFinite(wind) ? wind : null,
    condition: weather?.displayValue ?? weather?.conditionId ?? null,
    weatherAvailable: Boolean(weather),
    contextVersion: "NFL-TD-CONTEXT-SHADOW-V1",
  };
}
function oddsRows(payload: unknown): PropOdds[] {
  if (Array.isArray(payload)) return payload as PropOdds[];
  if (payload && typeof payload === "object") {
    const row = payload as Record<string, unknown>;
    for (const key of ["events", "data", "odds"])
      if (Array.isArray(row[key])) return row[key] as PropOdds[];
    if (row.data && typeof row.data === "object") {
      const nested = row.data as Record<string, unknown>;
      for (const key of ["events", "data", "odds"])
        if (Array.isArray(nested[key])) return nested[key] as PropOdds[];
    }
    if ("bookmakers" in row || "home_team" in row || "away_team" in row)
      return [payload as PropOdds];
  }
  return [];
}
async function fetchOnce<T>(url: string, timeout: number): Promise<T> {
  const c = new AbortController(),
    t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: c.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json,text/plain,*/*",
        Referer: "https://www.espn.com/",
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}
async function fetchJson<T>(url: string, timeout = 9000): Promise<T> {
  try {
    return await fetchOnce<T>(url, timeout);
  } catch (primaryError) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== "site.api.espn.com") throw primaryError;
      parsed.hostname = "site.web.api.espn.com";
      const value = await fetchOnce<T>(parsed.toString(), timeout);
      espnFallbackCount++;
      return value;
    } catch (fallbackError) {
      throw new Error(
        `ESPN fetch failed: primary=${primaryError instanceof Error ? primaryError.message : String(primaryError)} fallback=${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
      );
    }
  }
}
function quote(book: PropBook, outcome: PropOutcome): NflBookQuote | null {
  const price = Number(outcome.price);
  if (!Number.isFinite(price) || price === 0) return null;
  return {
    bookmaker: String(book.title ?? book.key ?? "Sportsbook"),
    bookmakerKey: String(book.key ?? ""),
    americanOdds: price,
    updatedAt:
      outcome.book_updated_at ??
      outcome.last_change_at ??
      book.last_update ??
      null,
  };
}
function buildPlayerMarkets(
  payload: unknown,
  marketKey: string,
): NflPlayerMarket[] {
  const by = new Map<string, { player: string; quotes: NflBookQuote[] }>();
  for (const row of oddsRows(payload))
    for (const book of row.bookmakers ?? [])
      for (const market of book.markets ?? []) {
        if (market.key !== marketKey) continue;
        for (const o of market.outcomes ?? []) {
          const name = String(o.name ?? "").trim(),
            desc = String(o.description ?? "").trim(),
            rawPlayer = desc && !/^(yes|no)$/i.test(desc) ? desc : name,
            player = cleanPlayerName(rawPlayer);
          if (!player || /^(yes|no)$/i.test(player) || /^no$/i.test(name))
            continue;
          const q = quote(book, o);
          if (!q) continue;
          const k = playerMarketKey(player),
            e = by.get(k) ?? { player, quotes: [] };
          e.quotes.push(q);
          // Prefer the cleaner display form when books disagree only on suffix.
          if (player.length < e.player.length) e.player = player;
          by.set(k, e);
        }
      }
  return [...by.values()]
    .map((e) => {
      // One quote per sportsbook prevents duplicate aliases from inflating the
      // market-depth count while preserving the best available price per book.
      const uniqueBooks = new Map<string, NflBookQuote>();
      for (const q of e.quotes) {
        const bookKey = normalize(q.bookmakerKey || q.bookmaker);
        const prior = uniqueBooks.get(bookKey);
        if (!prior || q.americanOdds > prior.americanOdds) uniqueBooks.set(bookKey, q);
      }
      const quotes = [...uniqueBooks.values()].sort(
        (a, b) => b.americanOdds - a.americanOdds,
      );
      const best = quotes[0];
      return {
        player: e.player,
        bestOdds: best.americanOdds,
        bestBook: best.bookmaker,
        impliedProbability: (americanImplied(best.americanOdds) ?? 0) * 100,
        quoteCount: quotes.length,
        quotes,
      };
    })
    .sort((a, b) => b.impliedProbability - a.impliedProbability)
    .slice(0, 20);
}
function fallbackRows(raw: NflPlayerMarket[], modeled: NflPlayerMarket[]) {
  if (modeled.length) return modeled;
  return raw
    .slice(0, 3)
    .map((row) => ({
      ...row,
      qualifies: false,
      dataStatus: "not-ready" as const,
      reasons: [
        "DATA NOT READY — sportsbook market shown for transparency only. PreziTools did not produce a statistical TD baseline, so this is not a model prediction or Official Play.",
      ],
    }));
}
function buildMoneyline(row: PropOdds, game: NflMarketGame) {
  const aq: NflBookQuote[] = [],
    hq: NflBookQuote[] = [],
    paired: { away: number; home: number }[] = [];
  const an = normalize(game.away.name),
    hn = normalize(game.home.name);
  for (const book of row.bookmakers ?? [])
    for (const market of book.markets ?? []) {
      if (market.key !== "h2h") continue;
      let ap: number | null = null,
        hp: number | null = null;
      for (const o of market.outcomes ?? []) {
        const n = normalize(String(o.name ?? o.description ?? "")),
          q = quote(book, o);
        if (!q) continue;
        if (n === an || n.includes(an) || an.includes(n)) {
          aq.push(q);
          ap = q.americanOdds;
        }
        if (n === hn || n.includes(hn) || hn.includes(n)) {
          hq.push(q);
          hp = q.americanOdds;
        }
      }
      if (ap !== null && hp !== null) {
        const a = americanImplied(ap),
          h = americanImplied(hp);
        if (a !== null && h !== null && a + h > 0)
          paired.push({ away: a / (a + h), home: h / (a + h) });
      }
    }
  if (!aq.length || !hq.length) return null;
  aq.sort((a, b) => b.americanOdds - a.americanOdds);
  hq.sort((a, b) => b.americanOdds - a.americanOdds);
  const avA = paired.length
      ? paired.reduce((s, x) => s + x.away, 0) / paired.length
      : null,
    avH = paired.length
      ? paired.reduce((s, x) => s + x.home, 0) / paired.length
      : null;
  const side = (
    team: string,
    quotes: NflBookQuote[],
    nv: number | null,
  ): NflMoneylineSide => ({
    team,
    bestOdds: quotes[0]?.americanOdds ?? null,
    bestBook: quotes[0]?.bookmaker ?? null,
    impliedProbability: quotes[0]
      ? (americanImplied(quotes[0].americanOdds) ?? 0) * 100
      : null,
    consensusNoVigProbability: nv === null ? null : nv * 100,
    quotes,
    model: null,
  });
  return {
    away: side(game.away.name, aq, avA),
    home: side(game.home.name, hq, avH),
  };
}
function sameTeams(game: NflMarketGame, row: PropOdds) {
  return sameTeam(game.away, row.away_team ?? "") && sameTeam(game.home, row.home_team ?? "");
}
function eventTimeDistance(game: NflMarketGame, row: PropOdds) {
  const gameTime = new Date(game.date).getTime(), marketTime = new Date(row.commence_time ?? "").getTime();
  return Number.isFinite(marketTime) ? Math.abs(gameTime - marketTime) : Number.POSITIVE_INFINITY;
}
async function holdTdAfterKickoff(game: NflMarketGame) {
  const startsIn = new Date(game.date).getTime() - Date.now();
  if (startsIn >= 0 || startsIn < -90 * 60 * 1000) return;
  const locked = await getNflTdOfficialLock(game.id);
  if (locked.anytime.length || locked.first.length) {
    game.anytimeTd = locked.anytime;
    game.firstTd = locked.first;
    game.tdLocks.anytimeTd = locked.anytimeLockedAt;
    game.tdLocks.firstTd = locked.firstLockedAt;
  } else {
    // Legacy/fallback path for games captured before the official-lock feature.
    const held = await getHeldNflTdPlays(game.id);
    game.anytimeTd = held.anytime as NflPlayerMarket[];
    game.firstTd = held.first as NflPlayerMarket[];
  }
  game.marketAvailable.anytimeTd = game.anytimeTd.length > 0;
  game.marketAvailable.firstTd = game.firstTd.length > 0;
  game.modelReady.anytimeTd = game.anytimeTd.length > 0;
  game.modelReady.firstTd = game.firstTd.length > 0;
  game.qualified.anytimeTd = game.anytimeTd.some(play=>play.qualifies===true);
  game.qualified.firstTd = game.firstTd.some(play=>play.qualifies===true);
}
async function fetchUpcomingEspnGames(): Promise<NflMarketGame[]> {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 4);
  const range = `${ymd(start)}-${ymd(end)}`;
  let payload: { events?: EspnEvent[] };
  try {
    payload = await fetchJson(
      `${ESPN_NFL_SCOREBOARD}?limit=200&dates=${range}`,
    );
  } catch {
    payload = await fetchJson(`${ESPN_NFL_SCOREBOARD}?limit=200`);
  }
  const now = Date.now(),
    earliest = now - 90 * 60 * 1000,
    latest = now + PLAYER_PROP_LOOKAHEAD_MS;
  return (payload.events ?? [])
    .map((e) => {
      const comps = e.competitions?.[0]?.competitors ?? [],
        away = comps.find((c) => c.homeAway === "away"),
        home = comps.find((c) => c.homeAway === "home");
      return {
        id: String(e.id ?? ""),
        date: String(e.date ?? ""),
        status: e.status?.type?.description ?? "Scheduled",
        context: eventContext(e),
        away: {
          abbreviation: away?.team?.abbreviation ?? "AWAY",
          name: away?.team?.displayName ?? "Away",
          logo: away?.team?.logo ?? null,
          record: away?.records?.[0]?.summary ?? null,
        },
        home: {
          abbreviation: home?.team?.abbreviation ?? "HOME",
          name: home?.team?.displayName ?? "Home",
          logo: home?.team?.logo ?? null,
          record: home?.records?.[0]?.summary ?? null,
        },
        marketStatus: "unavailable" as const,
        marketAvailable: emptyQualified(),
        modelReady: emptyQualified(),
        moneyline: null,
        anytimeTd: [],
        firstTd: [],
        qualified: emptyQualified(),
        tdLocks: { anytimeTd: null, firstTd: null },
      };
    })
    .filter((g) => {
      const start = new Date(g.date).getTime();
      return g.id && g.date && Number.isFinite(start) && start >= earliest && start <= latest;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}
const thresholds = {
  moneyline: { minEdge: 4.5, minEv: 0.065 },
  anytimeTd: { minEdge: 3, minEv: 0.07, minBooks: 2, minProbability: 15 },
  firstTd: { minEdge: 2.5, minEv: 0.1, minBooks: 3, minProbability: 3 },
};
export async function fetchNflMarkets(): Promise<NflMarketFeed> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  void gradePendingNflMoneylineShadow().catch(() => {});
  void gradePendingNflTdPredictions(30).catch((error) =>
    console.warn("[NFL TD] grading pass failed:", error),
  );
  let games: NflMarketGame[] = [];
  try {
    games = await fetchUpcomingEspnGames();
  } catch (error) {
    console.warn("[NFL Markets] ESPN upcoming slate unavailable:", error);
  }
  const apiKey = process.env.PROPLINE_API_KEY?.trim();
  const health = {
    rawTdCandidates: 0,
    modeledTdCandidates: 0,
    notReadyTdCandidates: 0,
    modelCoveragePct: 0,
  };
  if (!apiKey) {
    const value: NflMarketFeed = {
      source: "ESPN + PropLine + PreziTools NFL Model",
      marketStatus: "disabled",
      updatedAt: new Date().toISOString(),
      games,
      health,
      thresholds,
    };
    cache = { expiresAt: Date.now() + 300000, value };
    return value;
  }
  let propRows: PropOdds[] = [];
  for (const sport of SPORT_KEYS) {
    try {
      const payload = await propLineGet<unknown>(
        `/sports/${sport}/odds?markets=h2h`,
        { cacheMs: H2H_CACHE_MS },
      );
      const rows = oddsRows(payload);
      if (rows.length) {
        propRows = rows;
        break;
      }
    } catch (error) {
      console.warn(`[NFL Markets] ${sport} bulk h2h failed:`, error);
    }
  }
  const propRowsByGame = new Map<string, PropOdds>();
  for (const game of games) {
    const row = propRows
      .filter((r) => sameTeams(game, r))
      .sort((a, b) => eventTimeDistance(game, a) - eventTimeDistance(game, b))[0];
    if (row) propRowsByGame.set(game.id, row);
  }
  for (const game of games) {
    const startsIn = new Date(game.date).getTime() - Date.now();
    const row = propRowsByGame.get(game.id);
    if (!row) {
      await holdTdAfterKickoff(game);
      game.marketStatus =
        game.anytimeTd.length > 0 || game.firstTd.length > 0
          ? "available"
          : "unavailable";
      continue;
    }
    const rawMoneyline = buildMoneyline(row, game);
    game.marketAvailable.moneyline = rawMoneyline !== null;
    if (rawMoneyline && startsIn >= 0) {
      try {
        const rawModeled = await modelMoneyline(
          game,
          rawMoneyline.away.bestOdds,
          rawMoneyline.home.bestOdds,
        );
        const modeled = {
          away: gateNflMoneylineRecommendation(
            rawModeled.away,
            game.away,
            game.home,
          ),
          home: gateNflMoneylineRecommendation(
            rawModeled.home,
            game.home,
            game.away,
          ),
        };
        rawMoneyline.away.model = modeled.away;
        rawMoneyline.home.model = modeled.home;
        game.modelReady.moneyline = Boolean(modeled.away || modeled.home);
        game.qualified.moneyline = !!(
          modeled.away?.qualifies || modeled.home?.qualifies
        );
        try {
          const v2 = await modelMoneylineV2(
            game,
            rawMoneyline.away.bestOdds,
            rawMoneyline.home.bestOdds,
            rawMoneyline.away.consensusNoVigProbability,
            rawMoneyline.home.consensusNoVigProbability,
          );
          await captureNflMoneylineShadow({
            gameId: game.id,
            gameStartAt: game.date,
            awayTeam: game.away.name,
            homeTeam: game.home.name,
            awayBestOdds: rawMoneyline.away.bestOdds,
            homeBestOdds: rawMoneyline.home.bestOdds,
            awayConsensus: rawMoneyline.away.consensusNoVigProbability,
            homeConsensus: rawMoneyline.home.consensusNoVigProbability,
            v1Away: modeled.away,
            v1Home: modeled.home,
            v2Away: v2.away,
            v2Home: v2.home,
          });
        } catch {}
        game.moneyline = game.qualified.moneyline ? rawMoneyline : null;
      } catch {
        game.moneyline = null;
      }
    }
    const eventId = String(row.id ?? row.event_id ?? "");
    if (eventId && startsIn >= 0 && startsIn <= PLAYER_PROP_LOOKAHEAD_MS) {
      for (const sport of SPORT_KEYS) {
        try {
          const p = await propLineGet<unknown>(
            `/sports/${sport}/events/${encodeURIComponent(eventId)}/odds?markets=player_anytime_td,player_1st_td`,
            { cacheMs: startsIn <= 2 * 60 * 60 * 1000 ? TD_PROP_CACHE_NEAR_MS : TD_PROP_CACHE_FAR_MS },
          );
          const rawAnytime = buildPlayerMarkets(p, "player_anytime_td"),
            rawFirst = buildPlayerMarkets(p, "player_1st_td");
          game.marketAvailable.anytimeTd = rawAnytime.length > 0;
          game.marketAvailable.firstTd = rawFirst.length > 0;
          const modeledAnytime = (await qualifyTdMarkets(
              game,
              rawAnytime,
              "anytime",
            )) as NflPlayerMarket[],
            modeledFirst = (await qualifyTdMarkets(
              game,
              rawFirst,
              "first",
            )) as NflPlayerMarket[];
          game.modelReady.anytimeTd = modeledAnytime.length > 0;
          game.modelReady.firstTd = modeledFirst.length > 0;
          health.rawTdCandidates += rawAnytime.length + rawFirst.length;
          health.modeledTdCandidates +=
            modeledAnytime.length + modeledFirst.length;
          game.anytimeTd = fallbackRows(rawAnytime, modeledAnytime);
          game.firstTd = fallbackRows(rawFirst, modeledFirst);
          health.notReadyTdCandidates +=
            game.anytimeTd.filter((x) => x.dataStatus === "not-ready").length +
            game.firstTd.filter((x) => x.dataStatus === "not-ready").length;
          game.qualified.anytimeTd = modeledAnytime.some((x) => x.qualifies);
          game.qualified.firstTd = modeledFirst.some((x) => x.qualifies);
          try {
            // More than 35 minutes out these are live PREVIEW candidates and may
            // move as prices/model evidence update. Inside 35 minutes, freeze the
            // first modeled board as the official pregame lock.
            await captureNflTdOfficialLock(game);
            const locked = await getNflTdOfficialLock(game.id);
            if (locked.anytime.length) {
              game.anytimeTd = locked.anytime;
              game.tdLocks.anytimeTd = locked.anytimeLockedAt;
              game.qualified.anytimeTd = game.anytimeTd.some((x) => x.qualifies);
            }
            if (locked.first.length) {
              game.firstTd = locked.first;
              game.tdLocks.firstTd = locked.firstLockedAt;
              game.qualified.firstTd = game.firstTd.some((x) => x.qualifies);
            }
            await captureNflTdDisplayPlays(game);
            if (game.tdLocks.anytimeTd || game.tdLocks.firstTd)
              await captureNflTdPredictions(game);
            await captureNflTdClosingLines(game);
          } catch (error) {
            console.warn(
              `[NFL TD] ledger capture failed for ${game.id}:`,
              error,
            );
          }
          break;
        } catch (error) {
          console.warn(
            `[NFL Markets] TD props/model unavailable for ${eventId}:`,
            error,
          );
        }
      }
    } else if (startsIn < 0) {
      await holdTdAfterKickoff(game);
    }
    game.marketStatus =
      game.qualified.moneyline ||
      game.anytimeTd.length > 0 ||
      game.firstTd.length > 0
        ? "available"
        : "unavailable";
  }
  health.modelCoveragePct = health.rawTdCandidates
    ? +((health.modeledTdCandidates / health.rawTdCandidates) * 100).toFixed(1)
    : 0;
  console.info(
    `[NFL TD Health] raw=${health.rawTdCandidates} modeled=${health.modeledTdCandidates} notReady=${health.notReadyTdCandidates} coverage=${health.modelCoveragePct}%`,
  );
  const value: NflMarketFeed = {
    source: "ESPN + PropLine + PreziTools NFL Model",
    marketStatus: games.some((g) => g.marketStatus === "available")
      ? "available"
      : "unavailable",
    updatedAt: new Date().toISOString(),
    games,
    health,
    thresholds,
  };
  cache = { expiresAt: Date.now() + FEED_CACHE_MS, value };
  return value;
}
