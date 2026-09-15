import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const MLB_STATS = "https://statsapi.mlb.com/api/v1";
const SOURCE = "MLB Stats API schedule hydrate=team,probablePitcher";

type Pitcher = { id?: number; fullName?: string };
type ScheduleGame = {
  gamePk?: number;
  gameDate?: string;
  teams?: {
    away?: { team?: { id?: number; name?: string }; probablePitcher?: Pitcher };
    home?: { team?: { id?: number; name?: string }; probablePitcher?: Pitcher };
  };
};
type ScheduleResponse = { dates?: Array<{ date?: string; games?: ScheduleGame[] }> };

function requiredResearchUrl(): string {
  const url = process.env.MLB_RESEARCH_DATABASE_URL;
  if (!url) throw new Error("MLB_RESEARCH_DATABASE_URL is required");
  if (process.env.DATABASE_URL && url === process.env.DATABASE_URL) {
    throw new Error("Research database must be separate from production");
  }
  return url;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
}

function chunks(from: string, to: string): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  let cursor = from;
  while (cursor <= to) {
    const end = addDays(cursor, 30);
    const stop = end < to ? end : to;
    out.push({ from: cursor, to: stop });
    cursor = addDays(stop, 1);
  }
  return out;
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, {
    headers: { "User-Agent": "PreziBaskets-Research/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`MLB Stats API ${r.status}`);
  return await r.json() as T;
}

async function main(): Promise<void> {
  const dateFrom = process.argv[2] ?? "2024-03-20";
  const dateTo = process.argv[3] ?? "2025-09-28";
  assertDate(dateFrom);
  assertDate(dateTo);
  if (dateFrom > dateTo) throw new Error("date_from must be <= date_to");

  const pool = new Pool({ connectionString: requiredResearchUrl() });
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS mlb_research;
    CREATE TABLE IF NOT EXISTS mlb_research.historical_pitchers (
      game_id text PRIMARY KEY,
      game_date date NOT NULL,
      game_start_at timestamptz NOT NULL,
      away_pitcher_id text,
      away_pitcher_name text,
      home_pitcher_id text,
      home_pitcher_name text,
      source text NOT NULL,
      imported_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS historical_pitchers_date_idx
      ON mlb_research.historical_pitchers(game_date, game_start_at, game_id);
    CREATE INDEX IF NOT EXISTS historical_pitchers_away_idx
      ON mlb_research.historical_pitchers(away_pitcher_id, game_start_at);
    CREATE INDEX IF NOT EXISTS historical_pitchers_home_idx
      ON mlb_research.historical_pitchers(home_pitcher_id, game_start_at);
  `);

  let seen = 0;
  let complete = 0;
  let missing = 0;

  for (const chunk of chunks(dateFrom, dateTo)) {
    const url = `${MLB_STATS}/schedule?sportId=1&gameType=R&startDate=${chunk.from}&endDate=${chunk.to}&hydrate=team,probablePitcher`;
    const data = await fetchJson<ScheduleResponse>(url);
    for (const day of data.dates ?? []) {
      for (const game of day.games ?? []) {
        const gameId = game.gamePk ? String(game.gamePk) : "";
        const started = game.gameDate ? new Date(game.gameDate) : null;
        if (!gameId || !started || Number.isNaN(started.getTime())) continue;

        seen++;
        const away = game.teams?.away?.probablePitcher;
        const home = game.teams?.home?.probablePitcher;
        const awayId = away?.id ? String(away.id) : null;
        const homeId = home?.id ? String(home.id) : null;
        if (awayId && homeId) complete++; else missing++;

        await pool.query(`
          INSERT INTO mlb_research.historical_pitchers(
            game_id,game_date,game_start_at,away_pitcher_id,away_pitcher_name,
            home_pitcher_id,home_pitcher_name,source
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(game_id) DO UPDATE SET
            game_date=EXCLUDED.game_date,
            game_start_at=EXCLUDED.game_start_at,
            away_pitcher_id=EXCLUDED.away_pitcher_id,
            away_pitcher_name=EXCLUDED.away_pitcher_name,
            home_pitcher_id=EXCLUDED.home_pitcher_id,
            home_pitcher_name=EXCLUDED.home_pitcher_name,
            source=EXCLUDED.source,
            imported_at=now()
        `, [
          gameId,
          day.date ?? isoDate(started),
          started,
          awayId,
          away?.fullName ?? null,
          homeId,
          home?.fullName ?? null,
          SOURCE,
        ]);
      }
    }
  }

  console.log(JSON.stringify({ dateFrom, dateTo, seen, complete, missing }));
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
