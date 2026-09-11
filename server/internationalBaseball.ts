import type { Express } from "express";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import {
  canonicalTeamKey,
  dateInLeagueZone,
  getOfficialResults,
  getOfficialTeamMetrics,
  type League,
  type OfficialTeamMetric,
} from "./internationalBaseballOfficial.js";

neonConfig.webSocketConstructor = ws;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
const API_BASE = "https://api.the-odds-api.com/v4/sports";
const MODEL_VERSION = "intl-baseball-v2-free-official";
const ODDS_CACHE_MS = 5 * 60_000;
const oddsCache = new Map<League, { expiresAt: number; games: ApiGame[] }>();
const oddsInflight = new Map<League, Promise<ApiGame[]>>();

type Status = "BEST_PLAY" | "PLAY" | "LEAN" | "NO_PLAY";
type ApiOutcome = { name: string; price: number; point?: number };
type ApiMarket = { key: string; outcomes: ApiOutcome[] };
type ApiBook = { key: string; title: string; last_update: string; markets: ApiMarket[] };
type ApiGame = { id: string; sport_key: string; commence_time: string; home_team: string; away_team: string; bookmakers: ApiBook[] };

type ModeledPick = {
  pick: string;
  probability: number;
  marketProbability: number;
  edge: number;
  status: Status;
  price: number | null;
  expected?: number;
  line?: number;
};

type MarketSnapshot = {
  moneyline: {
    homePrice: number | null;
    awayPrice: number | null;
    bookCount: number;
  };
  total: {
    line: number;
    overPrice: number | null;
    underPrice: number | null;
    bookCount: number;
  } | null;
};

type ModeledGame = {
  id: string;
  league: League;
  startTime: string;
  awayTeam: string;
  homeTeam: string;
  bookCount: number;
  modelReady: boolean;
  source: "official-free" | "market-only";
  moneyline: ModeledPick;
  total: ModeledPick | null;
  marketSnapshot: MarketSnapshot;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function logistic(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function americanToProb(odds: number) {
  if (!Number.isFinite(odds) || odds === 0) return 0.5;
  return odds < 0 ? (-odds) / ((-odds) + 100) : 100 / (odds + 100);
}

function fairTwo(a: number, b: number): [number, number] {
  const x = americanToProb(a);
  const y = americanToProb(b);
  const z = x + y;
  return z > 0 ? [x / z, y / z] : [0.5, 0.5];
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function existingMedian(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function statusFor(edge: number, books: number): Status {
  if (books < 2 || edge < 0.025) return "NO_PLAY";
  if (edge >= 0.06) return "BEST_PLAY";
  if (edge >= 0.04) return "PLAY";
  return "LEAN";
}

async function ensureTable() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS international_baseball_predictions(
      id varchar(220) PRIMARY KEY,
      league text NOT NULL,
      event_id text NOT NULL,
      game_start_at timestamptz NOT NULL,
      home_team text NOT NULL,
      away_team text NOT NULL,
      market text NOT NULL,
      selection text NOT NULL,
      line real,
      american_odds integer,
      model_probability real NOT NULL,
      market_probability real NOT NULL,
      edge real NOT NULL,
      status text NOT NULL,
      model_version text NOT NULL,
      locked_at timestamptz NOT NULL DEFAULT now(),
      result text,
      actual_score text,
      created_at timestamptz NOT NULL DEFAULT now(),
      graded_at timestamptz
    );
    ALTER TABLE international_baseball_predictions ADD COLUMN IF NOT EXISTS american_odds integer;
    ALTER TABLE international_baseball_predictions ADD COLUMN IF NOT EXISTS actual_score text;
    CREATE INDEX IF NOT EXISTS international_baseball_predictions_start_idx
      ON international_baseball_predictions(game_start_at DESC);
  `);
}

function sportKey(league: League) {
  return league === "KBO" ? "baseball_kbo" : "baseball_npb";
}

async function fetchLeague(league: League): Promise<ApiGame[]> {
  const key = process.env.ODDS_API_KEY?.trim();
  if (!key) return [];

  const cached = oddsCache.get(league);
  if (cached && cached.expiresAt > Date.now()) return cached.games;

  const existing = oddsInflight.get(league);
  if (existing) return existing;

  const request = (async () => {
    const url = `${API_BASE}/${sportKey(league)}/odds?regions=us&markets=h2h,totals&oddsFormat=american&apiKey=${encodeURIComponent(key)}`;
    const response = await fetch(url, { headers: { "User-Agent": "PreziTools/1.0" } });
    if (!response.ok) {
      const stale = oddsCache.get(league);
      if (stale?.games?.length) {
        console.warn(`[Intl Baseball] ${league} odds returned ${response.status}; serving stale cache`);
        return stale.games;
      }
      throw new Error(`${league} odds returned ${response.status}`);
    }
    const games = await response.json() as ApiGame[];
    oddsCache.set(league, { expiresAt: Date.now() + ODDS_CACHE_MS, games });
    return games;
  })();

  oddsInflight.set(league, request);
  try {
    return await request;
  } finally {
    oddsInflight.delete(league);
  }
}

function metricFor(league: League, team: string, metrics: Record<League, Map<string, OfficialTeamMetric>>) {
  const key = canonicalTeamKey(league, team);
  return key ? metrics[league].get(key) ?? null : null;
}

function venuePct(metric: OfficialTeamMetric, home: boolean) {
  return home ? (metric.homePct ?? metric.winPct) : (metric.awayPct ?? metric.winPct);
}

function modelGame(league: League, game: ApiGame, metrics: Record<League, Map<string, OfficialTeamMetric>>): ModeledGame {
  const homeMetric = metricFor(league, game.home_team, metrics);
  const awayMetric = metricFor(league, game.away_team, metrics);
  const modelReady = Boolean(
    homeMetric && awayMetric &&
    homeMetric.games >= 20 && awayMetric.games >= 20 &&
    homeMetric.runsPerGame > 0 && awayMetric.runsPerGame > 0 &&
    homeMetric.runsAllowedPerGame > 0 && awayMetric.runsAllowedPerGame > 0
  );

  const h2h = game.bookmakers.flatMap(book => {
    const market = book.markets.find(item => item.key === "h2h");
    if (!market) return [];
    const home = market.outcomes.find(item => item.name === game.home_team);
    const away = market.outcomes.find(item => item.name === game.away_team);
    return home && away ? [{ book: book.title, home: home.price, away: away.price }] : [];
  });
  const fair = h2h.map(item => fairTwo(item.home, item.away));
  const homeMarket = median(fair.map(item => item[0])) ?? 0.5;
  const awayMarket = 1 - homeMarket;
  const homePrice = median(h2h.map(item => item.home));
  const awayPrice = median(h2h.map(item => item.away));

  let homeModel = homeMarket;
  let expectedHome = 0;
  let expectedAway = 0;
  if (modelReady && homeMetric && awayMetric) {
    const homeFieldRuns = league === "KBO" ? 0.16 : 0.12;
    expectedHome = (homeMetric.runsPerGame + awayMetric.runsAllowedPerGame) / 2 + homeFieldRuns;
    expectedAway = (awayMetric.runsPerGame + homeMetric.runsAllowedPerGame) / 2;
    const winStrength = (homeMetric.winPct - awayMetric.winPct) * 2.35;
    const venueStrength = (venuePct(homeMetric, true) - venuePct(awayMetric, false)) * 1.15;
    const runStrength = (expectedHome - expectedAway) * 0.31;
    homeModel = clamp(logistic(winStrength + venueStrength + runStrength + 0.08), 0.2, 0.8);
  }
  const awayModel = 1 - homeModel;
  const homeEdge = homeModel - homeMarket;
  const awayEdge = awayModel - awayMarket;
  const mlHome = homeEdge >= awayEdge;
  const mlEdge = Math.max(homeEdge, awayEdge);
  const mlBooks = h2h.length;
  const mlPrice = mlHome ? homePrice : awayPrice;
  const moneyline: ModeledPick = {
    pick: mlHome ? game.home_team : game.away_team,
    probability: +((mlHome ? homeModel : awayModel) * 100).toFixed(1),
    marketProbability: +((mlHome ? homeMarket : awayMarket) * 100).toFixed(1),
    edge: +(Math.max(0, mlEdge) * 100).toFixed(1),
    status: modelReady ? statusFor(mlEdge, mlBooks) : "NO_PLAY",
    price: mlPrice == null ? null : Math.round(mlPrice),
  };

  const totals = game.bookmakers.flatMap(book => {
    const market = book.markets.find(item => item.key === "totals");
    if (!market) return [];
    const over = market.outcomes.find(item => item.name.toLowerCase() === "over");
    const under = market.outcomes.find(item => item.name.toLowerCase() === "under");
    return over && under && over.point != null && under.point != null
      ? [{ book: book.title, line: over.point, over: over.price, under: under.price }]
      : [];
  });
  const line = existingMedian(totals.map(item => item.line));
  let total: ModeledPick | null = null;
  let totalSnapshot: MarketSnapshot["total"] = null;
  if (line != null) {
    const sameLine = totals.filter(item => Math.abs(item.line - line) < 0.001);
    const totalFair = sameLine.map(item => fairTwo(item.over, item.under));
    const overMarket = median(totalFair.map(item => item[0])) ?? 0.5;
    const underMarket = 1 - overMarket;
    const overPrice = median(sameLine.map(item => item.over));
    const underPrice = median(sameLine.map(item => item.under));
    const expectedTotal = expectedHome + expectedAway;
    const overModel = modelReady ? clamp(logistic((expectedTotal - line) / 1.55), 0.2, 0.8) : overMarket;
    const underModel = 1 - overModel;
    const overEdge = overModel - overMarket;
    const underEdge = underModel - underMarket;
    const pickOver = overEdge >= underEdge;
    const totalEdge = Math.max(overEdge, underEdge);
    const totalPrice = pickOver ? overPrice : underPrice;
    total = {
      pick: pickOver ? "Over" : "Under",
      line,
      expected: modelReady ? +expectedTotal.toFixed(2) : undefined,
      probability: +((pickOver ? overModel : underModel) * 100).toFixed(1),
      marketProbability: +((pickOver ? overMarket : underMarket) * 100).toFixed(1),
      edge: +(Math.max(0, totalEdge) * 100).toFixed(1),
      status: modelReady ? statusFor(totalEdge, sameLine.length) : "NO_PLAY",
      price: totalPrice == null ? null : Math.round(totalPrice),
    };
    totalSnapshot = {
      line,
      overPrice: overPrice == null ? null : Math.round(overPrice),
      underPrice: underPrice == null ? null : Math.round(underPrice),
      bookCount: sameLine.length,
    };
  }

  return {
    id: game.id,
    league,
    startTime: game.commence_time,
    awayTeam: game.away_team,
    homeTeam: game.home_team,
    bookCount: game.bookmakers.length,
    modelReady,
    source: modelReady ? "official-free" : "market-only",
    moneyline,
    total,
    marketSnapshot: {
      moneyline: {
        homePrice: homePrice == null ? null : Math.round(homePrice),
        awayPrice: awayPrice == null ? null : Math.round(awayPrice),
        bookCount: mlBooks,
      },
      total: totalSnapshot,
    },
  };
}

async function lock(rows: ModeledGame[]) {
  if (!pool) return;
  await ensureTable();
  for (const game of rows) {
    if (new Date(game.startTime).getTime() <= Date.now() || !game.modelReady) continue;
    for (const [market, pick] of [["moneyline", game.moneyline], ["total", game.total]] as const) {
      if (!pick || pick.status === "NO_PLAY") continue;
      const id = `${game.league}:${game.id}:${market}:${MODEL_VERSION}`;
      await pool.query(
        `INSERT INTO international_baseball_predictions(
          id,league,event_id,game_start_at,home_team,away_team,market,selection,line,american_odds,
          model_probability,market_probability,edge,status,model_version
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT(id) DO NOTHING`,
        [
          id, game.league, game.id, game.startTime, game.homeTeam, game.awayTeam, market, pick.pick,
          pick.line ?? null, pick.price, pick.probability / 100, pick.marketProbability / 100,
          pick.edge / 100, pick.status, MODEL_VERSION,
        ],
      );
    }
  }
}

export async function gradePendingInternationalBaseball(limit = 80) {
  if (!pool) return 0;
  await ensureTable();
  const pending = await pool.query(
    `SELECT id,league,game_start_at,home_team,away_team,market,selection,line
     FROM international_baseball_predictions
     WHERE result IS NULL AND game_start_at < now() - interval '3 hours'
     ORDER BY game_start_at ASC LIMIT $1`,
    [limit],
  );
  if (!pending.rows.length) return 0;

  const grouped = new Map<string, any[]>();
  for (const row of pending.rows) {
    const league = String(row.league) as League;
    const date = dateInLeagueZone(new Date(row.game_start_at), league);
    const key = `${league}:${date}`;
    const list = grouped.get(key) ?? [];
    list.push({ ...row, league, date });
    grouped.set(key, list);
  }

  let graded = 0;
  for (const [groupKey, rows] of grouped) {
    const [league, date] = groupKey.split(":") as [League, string];
    let results;
    try {
      results = await getOfficialResults(league, date);
    } catch (error) {
      console.warn(`[Intl Baseball] ${league} grading source unavailable for ${date}`, error);
      continue;
    }
    for (const row of rows) {
      const homeKey = canonicalTeamKey(league, String(row.home_team));
      const awayKey = canonicalTeamKey(league, String(row.away_team));
      const final = results.find(item => item.homeKey === homeKey && item.awayKey === awayKey);
      if (!final) continue;
      const totalRuns = final.homeScore + final.awayScore;
      let result: "won" | "lost" | "push";
      if (row.market === "moneyline") {
        if (final.homeScore === final.awayScore) result = "push";
        else {
          const winnerKey = final.homeScore > final.awayScore ? final.homeKey : final.awayKey;
          const pickKey = canonicalTeamKey(league, String(row.selection));
          result = winnerKey === pickKey ? "won" : "lost";
        }
      } else {
        const line = Number(row.line);
        if (!Number.isFinite(line)) continue;
        if (totalRuns === line) result = "push";
        else if (String(row.selection).toLowerCase() === "over") result = totalRuns > line ? "won" : "lost";
        else result = totalRuns < line ? "won" : "lost";
      }
      await pool.query(
        `UPDATE international_baseball_predictions SET result=$2,actual_score=$3,graded_at=now() WHERE id=$1 AND result IS NULL`,
        [row.id, result, `${final.awayScore}-${final.homeScore}`],
      );
      graded++;
    }
  }
  return graded;
}

async function slate() {
  const marketConfigured = Boolean(process.env.ODDS_API_KEY?.trim());
  if (!marketConfigured) {
    return {
      modelVersion: MODEL_VERSION,
      modelReady: true,
      officialDataStatus: "live",
      marketStatus: "configuration_required",
      updatedAt: new Date().toISOString(),
      games: [] as ModeledGame[],
    };
  }

  const [kbo, npb, metrics] = await Promise.all([
    fetchLeague("KBO"),
    fetchLeague("NPB"),
    getOfficialTeamMetrics(),
  ]);
  const games = [
    ...kbo.map(game => modelGame("KBO", game, metrics)),
    ...npb.map(game => modelGame("NPB", game, metrics)),
  ];
  void lock(games).catch(error => console.warn("[Intl Baseball] lock failed", error));
  void gradePendingInternationalBaseball(30).catch(error => console.warn("[Intl Baseball] grading failed", error));
  return {
    modelVersion: MODEL_VERSION,
    modelReady: games.some(game => game.modelReady),
    officialDataStatus: "live",
    marketStatus: "live",
    oddsCacheSeconds: ODDS_CACHE_MS / 1000,
    oddsRegions: ["us"],
    updatedAt: new Date().toISOString(),
    games,
  };
}

export function registerInternationalBaseballRoutes(app: Express) {
  app.get("/api/international-baseball", async (_req, res) => {
    try {
      const data = await slate();
      res.setHeader("Cache-Control", "public, max-age=90, stale-while-revalidate=300");
      return res.json(data);
    } catch (error) {
      console.error("[Intl Baseball]", error);
      return res.status(502).json({ error: "Unable to load KBO / NPB model" });
    }
  });

  app.get("/api/international-baseball/performance", async (_req, res) => {
    if (!pool) return res.json({ graded: 0, wins: 0, losses: 0, pushes: 0, winRate: null, units: 0, roi: null, modelVersion: MODEL_VERSION });
    try {
      await ensureTable();
      await gradePendingInternationalBaseball(80);
      const result = await pool.query(`
        SELECT
          count(*) FILTER(WHERE result IN ('won','lost'))::int graded,
          count(*) FILTER(WHERE result='won')::int wins,
          count(*) FILTER(WHERE result='lost')::int losses,
          count(*) FILTER(WHERE result='push')::int pushes,
          coalesce(sum(CASE WHEN result='won' THEN CASE WHEN american_odds>0 THEN american_odds/100.0 ELSE 100.0/abs(american_odds) END WHEN result='lost' THEN -1 ELSE 0 END),0)::real units
        FROM international_baseball_predictions
        WHERE model_version=$1
      `, [MODEL_VERSION]);
      const row = result.rows[0] ?? {};
      const graded = Number(row.graded ?? 0);
      const wins = Number(row.wins ?? 0);
      const units = Number(row.units ?? 0);
      return res.json({
        graded,
        wins,
        losses: Number(row.losses ?? 0),
        pushes: Number(row.pushes ?? 0),
        winRate: graded ? wins / graded : null,
        units,
        roi: graded ? units / graded : null,
        modelVersion: MODEL_VERSION,
        gradingSource: "official KBO / NPB results",
      });
    } catch (error) {
      console.error("[Intl Baseball] performance failed", error);
      return res.status(500).json({ error: "Unable to load performance" });
    }
  });
}
