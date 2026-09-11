import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.MLB_RESEARCH_DATABASE_URL;
if (!connectionString) throw new Error("Missing MLB_RESEARCH_DATABASE_URL");
if (process.env.DATABASE_URL && process.env.DATABASE_URL === connectionString) {
  throw new Error("Research database must be separate from production DATABASE_URL");
}

const pool = new Pool({ connectionString });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const num = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

function inningsToOuts(value: unknown): number {
  const [whole, partial = "0"] = String(value ?? "0").split(".");
  return (Number(whole) || 0) * 3 + Math.min(Math.max(Number(partial) || 0, 0), 2);
}

type TargetGame = {
  gameId: string;
  gameDate: string;
  pitcherId: string;
  side: "away" | "home";
  firstInningRunsAllowed: number;
};

type PitchingLog = {
  date: string;
  outs: number;
  hits: number;
  walks: number;
  strikeouts: number;
  earnedRuns: number;
  battersFaced: number;
};

async function fetchJson(url: string, attempt = 1): Promise<any> {
  const response = await fetch(url, { headers: { "user-agent": "First-Basket-Pro-Research/1.0" } });
  if (response.ok) return response.json();
  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    await sleep(500 * attempt * attempt);
    return fetchJson(url, attempt + 1);
  }
  throw new Error(`MLB Stats API ${response.status}: ${url}`);
}

async function fetchPitcherSeasonLogs(pitcherId: string, season: number): Promise<PitchingLog[]> {
  const url = `https://statsapi.mlb.com/api/v1/people/${encodeURIComponent(pitcherId)}/stats?stats=gameLog&group=pitching&season=${season}`;
  const json = await fetchJson(url);
  const splits = Array.isArray(json?.stats?.[0]?.splits) ? json.stats[0].splits : [];
  return splits.map((split: any) => ({
    date: String(split?.date ?? ""),
    outs: inningsToOuts(split?.stat?.inningsPitched),
    hits: num(split?.stat?.hits),
    walks: num(split?.stat?.baseOnBalls),
    strikeouts: num(split?.stat?.strikeOuts),
    earnedRuns: num(split?.stat?.earnedRuns),
    battersFaced: num(split?.stat?.battersFaced),
  })).filter((row: PitchingLog) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
}

function priorSeasonMetrics(logs: PitchingLog[], beforeDate: string) {
  let outs = 0, hits = 0, walks = 0, strikeouts = 0, earnedRuns = 0, battersFaced = 0, appearances = 0;
  for (const row of logs) {
    if (row.date >= beforeDate) continue;
    outs += row.outs;
    hits += row.hits;
    walks += row.walks;
    strikeouts += row.strikeouts;
    earnedRuns += row.earnedRuns;
    battersFaced += row.battersFaced;
    appearances += 1;
  }
  const innings = outs / 3;
  return {
    appearances,
    innings,
    era: innings > 0 ? earnedRuns * 9 / innings : null,
    whip: innings > 0 ? (walks + hits) / innings : null,
    strikeoutPct: battersFaced > 0 ? strikeouts / battersFaced : null,
    walkPct: battersFaced > 0 ? walks / battersFaced : null,
  };
}

function priorFirstInningRate(starts: TargetGame[], beforeDate: string): number | null {
  let n = 0;
  let allowed = 0;
  for (const start of starts) {
    if (start.gameDate >= beforeDate) continue;
    n += 1;
    if (start.firstInningRunsAllowed > 0) allowed += 1;
  }
  return n ? allowed / n : null;
}

async function main() {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS mlb_research;
    CREATE TABLE IF NOT EXISTS mlb_research.historical_pitcher_metrics (
      game_id text NOT NULL,
      game_date date NOT NULL,
      side text NOT NULL CHECK (side IN ('away','home')),
      pitcher_id text NOT NULL,
      prior_appearances integer NOT NULL,
      prior_innings numeric,
      era numeric,
      whip numeric,
      strikeout_pct numeric,
      walk_pct numeric,
      first_inning_runs_allowed_rate numeric,
      source text NOT NULL,
      imported_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (game_id, side)
    );
    CREATE INDEX IF NOT EXISTS historical_pitcher_metrics_pitcher_idx
      ON mlb_research.historical_pitcher_metrics(pitcher_id, game_date);
  `);

  const result = await pool.query<{
    game_id: string;
    game_date: string;
    away_pitcher_id: string | null;
    home_pitcher_id: string | null;
    away_first_runs: number;
    home_first_runs: number;
  }>(`
    SELECT p.game_id, p.game_date::text, p.away_pitcher_id, p.home_pitcher_id,
           g.away_first_runs, g.home_first_runs
      FROM mlb_research.historical_pitchers p
      JOIN mlb_research.historical_games g USING(game_id)
     ORDER BY p.game_date, p.game_id
  `);

  const targets: TargetGame[] = [];
  for (const row of result.rows) {
    if (row.away_pitcher_id) targets.push({
      gameId: row.game_id, gameDate: row.game_date, pitcherId: row.away_pitcher_id,
      side: "away", firstInningRunsAllowed: row.home_first_runs,
    });
    if (row.home_pitcher_id) targets.push({
      gameId: row.game_id, gameDate: row.game_date, pitcherId: row.home_pitcher_id,
      side: "home", firstInningRunsAllowed: row.away_first_runs,
    });
  }

  const startsByPitcher = new Map<string, TargetGame[]>();
  const byPitcherSeason = new Map<string, TargetGame[]>();
  for (const target of targets) {
    const starts = startsByPitcher.get(target.pitcherId) ?? [];
    starts.push(target);
    startsByPitcher.set(target.pitcherId, starts);

    const season = Number(target.gameDate.slice(0, 4));
    const key = `${target.pitcherId}:${season}`;
    const games = byPitcherSeason.get(key) ?? [];
    games.push(target);
    byPitcherSeason.set(key, games);
  }

  const entries = [...byPitcherSeason.entries()];
  let cursor = 0;
  let written = 0;
  let failed = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= entries.length) return;
      const [key, games] = entries[index];
      const [pitcherId, seasonText] = key.split(":");
      const season = Number(seasonText);
      try {
        const logs = await fetchPitcherSeasonLogs(pitcherId, season);
        const pitcherStarts = startsByPitcher.get(pitcherId) ?? [];
        for (const game of games) {
          const metrics = priorSeasonMetrics(logs, game.gameDate);
          const firstInningRate = priorFirstInningRate(pitcherStarts, game.gameDate);
          await pool.query(`
            INSERT INTO mlb_research.historical_pitcher_metrics(
              game_id,game_date,side,pitcher_id,prior_appearances,prior_innings,
              era,whip,strikeout_pct,walk_pct,first_inning_runs_allowed_rate,source
            ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT(game_id,side) DO UPDATE SET
              pitcher_id=EXCLUDED.pitcher_id,
              prior_appearances=EXCLUDED.prior_appearances,
              prior_innings=EXCLUDED.prior_innings,
              era=EXCLUDED.era,
              whip=EXCLUDED.whip,
              strikeout_pct=EXCLUDED.strikeout_pct,
              walk_pct=EXCLUDED.walk_pct,
              first_inning_runs_allowed_rate=EXCLUDED.first_inning_runs_allowed_rate,
              source=EXCLUDED.source,
              imported_at=now()
          `, [
            game.gameId, game.gameDate, game.side, game.pitcherId,
            metrics.appearances, metrics.innings, metrics.era, metrics.whip,
            metrics.strikeoutPct, metrics.walkPct, firstInningRate,
            "MLB Stats API gameLog, prior-to-game only",
          ]);
          written += 1;
        }
      } catch (error) {
        failed += games.length;
        console.warn(`[Pitcher metrics] ${pitcherId} ${season} failed:`, error);
      }
      if ((index + 1) % 50 === 0) console.log(`[Pitcher metrics] processed ${index + 1}/${entries.length}; rows=${written}; failed=${failed}`);
      await sleep(80);
    }
  }

  await Promise.all(Array.from({ length: 6 }, () => worker()));
  console.log(`[Pitcher metrics] complete. pitcher-seasons=${entries.length}, rows=${written}, failed=${failed}`);
  await pool.end();
}

main().catch(async error => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
