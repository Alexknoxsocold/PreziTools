import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const MLB_STATS = "https://statsapi.mlb.com/api/v1";
const SOURCE = "MLB Stats API schedule hydrate=team,linescore";
const RESEARCH_VERSION = "historical-fi-baseline-v1";
const LOOKBACK_GAMES = 15;
const DECAY = 0.92;

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function db(): Pool {
  const url = process.env.MLB_RESEARCH_DATABASE_URL;
  if (!url) throw new Error("MLB_RESEARCH_DATABASE_URL is required for historical research");
  if (process.env.DATABASE_URL && url === process.env.DATABASE_URL) {
    throw new Error("MLB_RESEARCH_DATABASE_URL must point to a separate research database branch");
  }
  if (!pool) pool = new Pool({ connectionString: url });
  return pool;
}

async function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  const connection = db();
  schemaReady = connection.query(`
    CREATE SCHEMA IF NOT EXISTS mlb_research;
    CREATE TABLE IF NOT EXISTS mlb_research.historical_games (
      game_id text PRIMARY KEY,
      game_date date NOT NULL,
      game_start_at timestamptz NOT NULL,
      away_team_id text NOT NULL,
      away_team text NOT NULL,
      home_team_id text NOT NULL,
      home_team text NOT NULL,
      away_first_runs integer NOT NULL CHECK (away_first_runs >= 0),
      home_first_runs integer NOT NULL CHECK (home_first_runs >= 0),
      outcome text NOT NULL CHECK (outcome IN ('NRFI','YRFI')),
      source text NOT NULL,
      imported_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS historical_games_date_idx
      ON mlb_research.historical_games(game_date, game_start_at, game_id);
    CREATE TABLE IF NOT EXISTS mlb_research.replay_predictions (
      id bigserial PRIMARY KEY,
      research_version text NOT NULL,
      target_date date NOT NULL,
      game_id text NOT NULL,
      matchup text NOT NULL,
      recommendation text NOT NULL CHECK (recommendation IN ('NRFI','YRFI')),
      probability numeric(6,5) NOT NULL CHECK (probability >= 0 AND probability <= 1),
      actual_outcome text CHECK (actual_outcome IN ('NRFI','YRFI')),
      first_inning_score text,
      training_games integer NOT NULL DEFAULT 0,
      source text NOT NULL,
      feature_cutoff_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (research_version, target_date, game_id)
    );
  `).then(() => undefined).catch(error => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

type ScheduleGame = {
  gamePk?: number;
  gameDate?: string;
  status?: { abstractGameState?: string; codedGameState?: string };
  teams?: {
    away?: { team?: { id?: number; name?: string } };
    home?: { team?: { id?: number; name?: string } };
  };
  linescore?: { innings?: Array<{ num?: number; away?: { runs?: number }; home?: { runs?: number } }> };
};

type ScheduleResponse = { dates?: Array<{ date?: string; games?: ScheduleGame[] }> };

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function assertDateRange(dateFrom: string, dateTo: string): void {
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  if (!valid.test(dateFrom) || !valid.test(dateTo) || dateFrom > dateTo) {
    throw new Error("Use a valid YYYY-MM-DD date range");
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { "User-Agent": "PreziBaskets-Research/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`MLB Stats API ${response.status}`);
  return await response.json() as T;
}

function monthChunks(dateFrom: string, dateTo: string): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  let cursor = dateFrom;
  while (cursor <= dateTo) {
    const end = addDays(cursor, 30);
    const to = end < dateTo ? end : dateTo;
    chunks.push({ from: cursor, to });
    cursor = addDays(to, 1);
  }
  return chunks;
}

export async function backfillHistoricalFirstInnings(
  dateFrom: string,
  dateTo: string,
): Promise<{ games: number; chunks: number; skipped: number }> {
  assertDateRange(dateFrom, dateTo);
  await ensureSchema();
  const connection = db();
  let games = 0;
  let skipped = 0;
  const chunks = monthChunks(dateFrom, dateTo);

  for (const chunk of chunks) {
    const url = `${MLB_STATS}/schedule?sportId=1&gameType=R&startDate=${chunk.from}&endDate=${chunk.to}&hydrate=team,linescore`;
    const data = await fetchJson<ScheduleResponse>(url);
    for (const day of data.dates ?? []) {
      for (const game of day.games ?? []) {
        const id = game.gamePk ? String(game.gamePk) : "";
        const start = game.gameDate ? new Date(game.gameDate) : null;
        const awayId = game.teams?.away?.team?.id ? String(game.teams.away.team.id) : "";
        const homeId = game.teams?.home?.team?.id ? String(game.teams.home.team.id) : "";
        const awayName = game.teams?.away?.team?.name ?? "";
        const homeName = game.teams?.home?.team?.name ?? "";
        const first = game.linescore?.innings?.find(i => i.num === 1);
        const awayRuns = first?.away?.runs;
        const homeRuns = first?.home?.runs;

        if (
          !id || !start || !awayId || !homeId || !awayName || !homeName ||
          !Number.isFinite(awayRuns) || !Number.isFinite(homeRuns)
        ) {
          skipped++;
          continue;
        }

        const outcome = Number(awayRuns) === 0 && Number(homeRuns) === 0 ? "NRFI" : "YRFI";
        await connection.query(`
          INSERT INTO mlb_research.historical_games(
            game_id,game_date,game_start_at,away_team_id,away_team,home_team_id,home_team,
            away_first_runs,home_first_runs,outcome,source
          )
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT(game_id) DO UPDATE SET
            game_date=EXCLUDED.game_date,
            game_start_at=EXCLUDED.game_start_at,
            away_team_id=EXCLUDED.away_team_id,
            away_team=EXCLUDED.away_team,
            home_team_id=EXCLUDED.home_team_id,
            home_team=EXCLUDED.home_team,
            away_first_runs=EXCLUDED.away_first_runs,
            home_first_runs=EXCLUDED.home_first_runs,
            outcome=EXCLUDED.outcome,
            source=EXCLUDED.source
        `, [
          id,
          day.date ?? isoDate(start),
          start,
          awayId,
          awayName,
          homeId,
          homeName,
          awayRuns,
          homeRuns,
          outcome,
          SOURCE,
        ]);
        games++;
      }
    }
  }

  return { games, chunks: chunks.length, skipped };
}

type HistoricalGameRow = {
  game_id: string;
  game_date: string;
  game_start_at: Date;
  away_team_id: string;
  away_team: string;
  home_team_id: string;
  home_team: string;
  away_first_runs: number;
  home_first_runs: number;
  outcome: "NRFI" | "YRFI";
};

type TeamRow = { scored: number; allowed: number; nrfi: number };

function weighted(rows: TeamRow[]): { scoreless: number; allowed: number } {
  const recent = rows.slice(-LOOKBACK_GAMES).reverse();
  if (!recent.length) return { scoreless: 0.50, allowed: 0.50 };
  let weight = 0;
  let scoreless = 0;
  let allowed = 0;
  recent.forEach((row, index) => {
    const w = Math.pow(DECAY, index);
    weight += w;
    scoreless += row.nrfi * w;
    allowed += row.allowed * w;
  });
  return { scoreless: scoreless / weight, allowed: allowed / weight };
}

/**
 * Creates a deliberately simple leakage-safe baseline from historical labels.
 * The history map is updated only after each target game's prediction is frozen,
 * so no target result can leak into its own features.
 */
export async function buildHistoricalWalkForward(
  dateFrom: string,
  dateTo: string,
): Promise<{ predictions: number; graded: number }> {
  assertDateRange(dateFrom, dateTo);
  await ensureSchema();
  const connection = db();
  const result = await connection.query<HistoricalGameRow>(`
    SELECT game_id,game_date::text,game_start_at,away_team_id,away_team,home_team_id,home_team,
           away_first_runs,home_first_runs,outcome
      FROM mlb_research.historical_games
     WHERE game_date <= $1::date
     ORDER BY game_start_at ASC,game_id ASC
  `, [dateTo]);

  const history = new Map<string, TeamRow[]>();
  let predictions = 0;
  let graded = 0;

  for (const game of result.rows) {
    const targetDate = String(game.game_date).slice(0, 10);
    const eligible = targetDate >= dateFrom && targetDate <= dateTo;

    if (eligible) {
      const away = weighted(history.get(game.away_team_id) ?? []);
      const home = weighted(history.get(game.home_team_id) ?? []);
      const teamNrfi = clamp((away.scoreless + home.scoreless) / 2, 0.30, 0.75);
      const runPressure = clamp((away.allowed + home.allowed) / 2, 0.10, 1.50);
      const nrfi = clamp(0.50 + (teamNrfi - 0.50) * 0.70 - (runPressure - 0.50) * 0.04, 0.25, 0.75);
      const recommendation: "NRFI" | "YRFI" = nrfi >= 0.50 ? "NRFI" : "YRFI";
      const probability = recommendation === "NRFI" ? nrfi : 1 - nrfi;
      const trainingGames = (history.get(game.away_team_id)?.length ?? 0) + (history.get(game.home_team_id)?.length ?? 0);

      await connection.query(`
        INSERT INTO mlb_research.replay_predictions(
          research_version,target_date,game_id,matchup,recommendation,probability,actual_outcome,
          first_inning_score,training_games,source,feature_cutoff_at
        )
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(research_version,target_date,game_id) DO UPDATE SET
          recommendation=EXCLUDED.recommendation,
          probability=EXCLUDED.probability,
          actual_outcome=EXCLUDED.actual_outcome,
          first_inning_score=EXCLUDED.first_inning_score,
          training_games=EXCLUDED.training_games,
          source=EXCLUDED.source,
          feature_cutoff_at=EXCLUDED.feature_cutoff_at
      `, [
        RESEARCH_VERSION,
        targetDate,
        game.game_id,
        `${game.away_team} @ ${game.home_team}`,
        recommendation,
        probability,
        game.outcome,
        `${game.away_first_runs}-${game.home_first_runs}`,
        trainingGames,
        SOURCE,
        game.game_start_at,
      ]);
      predictions++;
      graded++;
    }

    const awayRows = history.get(game.away_team_id) ?? [];
    awayRows.push({
      scored: game.away_first_runs,
      allowed: game.home_first_runs,
      nrfi: game.away_first_runs === 0 ? 1 : 0,
    });
    history.set(game.away_team_id, awayRows);

    const homeRows = history.get(game.home_team_id) ?? [];
    homeRows.push({
      scored: game.home_first_runs,
      allowed: game.away_first_runs,
      nrfi: game.home_first_runs === 0 ? 1 : 0,
    });
    history.set(game.home_team_id, homeRows);
  }

  return { predictions, graded };
}
