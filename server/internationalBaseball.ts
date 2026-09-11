import type { Express } from "express";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
const API_BASE = "https://api.the-odds-api.com/v4/sports";
const MODEL_VERSION = "intl-baseball-v1-market-baseline";

type League = "KBO" | "NPB";
type Status = "BEST_PLAY" | "PLAY" | "LEAN" | "NO_PLAY";
type ApiOutcome = { name: string; price: number; point?: number };
type ApiMarket = { key: string; outcomes: ApiOutcome[] };
type ApiBook = { key: string; title: string; last_update: string; markets: ApiMarket[] };
type ApiGame = { id: string; sport_key: string; commence_time: string; home_team: string; away_team: string; bookmakers: ApiBook[] };

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
      model_probability real NOT NULL,
      market_probability real NOT NULL,
      edge real NOT NULL,
      status text NOT NULL,
      model_version text NOT NULL,
      locked_at timestamptz NOT NULL DEFAULT now(),
      result text,
      created_at timestamptz NOT NULL DEFAULT now(),
      graded_at timestamptz
    );
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
  const url = `${API_BASE}/${sportKey(league)}/odds?regions=us,eu,au&markets=h2h,totals&oddsFormat=american&apiKey=${encodeURIComponent(key)}`;
  const response = await fetch(url, { headers: { "User-Agent": "PreziTools/1.0" } });
  if (!response.ok) throw new Error(`${league} odds returned ${response.status}`);
  return response.json() as Promise<ApiGame[]>;
}

function modelGame(league: League, game: ApiGame) {
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
  const mlPick = homeMarket >= awayMarket ? game.home_team : game.away_team;
  const mlMarketProbability = Math.max(homeMarket, awayMarket);

  const totals = game.bookmakers.flatMap(book => {
    const market = book.markets.find(item => item.key === "totals");
    if (!market) return [];
    const over = market.outcomes.find(item => item.name.toLowerCase() === "over");
    const under = market.outcomes.find(item => item.name.toLowerCase() === "under");
    return over && under && over.point != null
      ? [{ book: book.title, line: over.point, over: over.price, under: under.price }]
      : [];
  });

  const line = median(totals.map(item => item.line));
  const totalFair = totals.map(item => fairTwo(item.over, item.under));
  const overMarket = median(totalFair.map(item => item[0])) ?? 0.5;
  const underMarket = 1 - overMarket;
  const totalPick = overMarket >= underMarket ? "Over" : "Under";
  const totalMarketProbability = Math.max(overMarket, underMarket);

  // V1 intentionally exposes a verified no-vig market baseline only. Until the
  // independent KBO/NPB team/pitching model is connected, model probability is
  // not allowed to masquerade as an edge over the market.
  return {
    id: game.id,
    league,
    startTime: game.commence_time,
    awayTeam: game.away_team,
    homeTeam: game.home_team,
    bookCount: game.bookmakers.length,
    modelReady: false,
    moneyline: {
      pick: mlPick,
      probability: +(mlMarketProbability * 100).toFixed(1),
      marketProbability: +(mlMarketProbability * 100).toFixed(1),
      edge: 0,
      status: "NO_PLAY" as Status,
    },
    total: line == null ? null : {
      pick: totalPick,
      line,
      probability: +(totalMarketProbability * 100).toFixed(1),
      marketProbability: +(totalMarketProbability * 100).toFixed(1),
      edge: 0,
      status: "NO_PLAY" as Status,
    },
  };
}

async function lock(rows: ReturnType<typeof modelGame>[]) {
  if (!pool) return;
  await ensureTable();
  for (const game of rows) {
    if (new Date(game.startTime).getTime() <= Date.now()) continue;
    if (!game.modelReady) continue;
    for (const [market, pick] of [["moneyline", game.moneyline], ["total", game.total]] as const) {
      if (!pick || pick.status === "NO_PLAY") continue;
      const id = `${game.league}:${game.id}:${market}:${MODEL_VERSION}`;
      await pool.query(
        `INSERT INTO international_baseball_predictions(
          id,league,event_id,game_start_at,home_team,away_team,market,selection,line,
          model_probability,market_probability,edge,status,model_version
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT(id) DO NOTHING`,
        [
          id,
          game.league,
          game.id,
          game.startTime,
          game.homeTeam,
          game.awayTeam,
          market,
          pick.pick,
          "line" in pick ? pick.line : null,
          pick.probability / 100,
          pick.marketProbability / 100,
          pick.edge / 100,
          pick.status,
          MODEL_VERSION,
        ],
      );
    }
  }
}

async function slate() {
  const [kbo, npb] = await Promise.all([fetchLeague("KBO"), fetchLeague("NPB")]);
  const games = [...kbo.map(game => modelGame("KBO", game)), ...npb.map(game => modelGame("NPB", game))];
  void lock(games).catch(error => console.warn("[Intl Baseball] lock failed", error));
  return {
    modelVersion: MODEL_VERSION,
    modelReady: false,
    marketStatus: process.env.ODDS_API_KEY?.trim() ? "live" : "configuration_required",
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
      return res.status(502).json({ error: "Unable to load KBO / NPB markets" });
    }
  });

  app.get("/api/international-baseball/performance", async (_req, res) => {
    if (!pool) return res.json({ graded: 0, wins: 0, losses: 0, winRate: null, modelVersion: MODEL_VERSION });
    try {
      await ensureTable();
      const result = await pool.query(`
        SELECT
          count(*) FILTER(WHERE result IN ('won','lost'))::int graded,
          count(*) FILTER(WHERE result='won')::int wins,
          count(*) FILTER(WHERE result='lost')::int losses
        FROM international_baseball_predictions
      `);
      const row = result.rows[0] ?? {};
      return res.json({
        ...row,
        winRate: row.graded ? row.wins / row.graded : null,
        modelVersion: MODEL_VERSION,
      });
    } catch {
      return res.status(500).json({ error: "Unable to load performance" });
    }
  });
}
