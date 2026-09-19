import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { storage } from "./storage";
import { nbaSeasonForDate } from "./nbaSeason";
neonConfig.webSocketConstructor = ws;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
const MODEL_VERSION = "FB-SEASONAL-V1",
  LOCK_WINDOW_MS = 2 * 60 * 60 * 1000,
  MAX_LINEUP_AGE_MS = 3 * 60 * 60 * 1000;
function normalizeName(n: string) {
  return n
    .toLowerCase()
    .replace(/[.'’\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizeTeam(t: string) {
  const v = t.toUpperCase().trim(),
    m: Record<string, string> = {
      GSW: "GS",
      NOP: "NO",
      NYK: "NY",
      SAS: "SA",
      PHO: "PHX",
      UTA: "UTAH",
      WSH: "WAS",
    };
  return m[v] || v;
}
async function ledgerExists() {
  if (!pool) return false;
  const r = await pool.query(
    `SELECT to_regclass('public.fb_prediction_ledger') AS name`,
  );
  return Boolean(r.rows[0]?.name);
}
async function ensureContextColumns() {
  if (!pool) return;
  await pool.query(
    `ALTER TABLE fb_prediction_ledger ADD COLUMN IF NOT EXISTS away_team text,ADD COLUMN IF NOT EXISTS home_team text,ADD COLUMN IF NOT EXISTS opponent text,ADD COLUMN IF NOT EXISTS is_home boolean,ADD COLUMN IF NOT EXISTS venue text,ADD COLUMN IF NOT EXISTS lineup_source text,ADD COLUMN IF NOT EXISTS context_snapshot jsonb`,
  );
}
async function gameVenue(gameId: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${encodeURIComponent(gameId)}`,
      {
        headers: { "User-Agent": "PreziTools/1.0" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!r.ok) return null;
    const x: any = await r.json();
    return (
      x?.header?.competitions?.[0]?.venue?.fullName ??
      x?.gameInfo?.venue?.fullName ??
      null
    );
  } catch {
    return null;
  }
}
async function confirmedLineup(
  gameId: string,
): Promise<{ away: string[]; home: string[]; source: string } | null> {
  if (!pool) return null;
  try {
    const r = await pool.query(
      `SELECT away_starters,home_starters,source,updated_at FROM nba_lineup_state WHERE espn_game_id=$1 AND status='confirmed' LIMIT 1`,
      [gameId],
    );
    const row = r.rows[0];
    if (!row) return null;
    const age = Date.now() - new Date(row.updated_at).getTime();
    if (!Number.isFinite(age) || age < 0 || age > MAX_LINEUP_AGE_MS)
      return null;
    const away = Array.isArray(row.away_starters) ? row.away_starters : [],
      home = Array.isArray(row.home_starters) ? row.home_starters : [];
    return away.length === 5 && home.length === 5
      ? { away, home, source: String(row.source || "unknown") }
      : null;
  } catch {
    return null;
  }
}
export async function lockUpcomingFirstBasketPredictions(): Promise<{
  eligible: number;
  locked: number;
  skipped: number;
}> {
  const result = { eligible: 0, locked: 0, skipped: 0 };
  if (!pool || !(await ledgerExists())) return result;
  await ensureContextColumns();
  const now = Date.now(),
    games = await storage.getGames(),
    eligible = games.filter((g) => {
      if (!g.espnGameId || !g.gameTime) return false;
      const t = new Date(g.gameTime).getTime();
      return Number.isFinite(t) && t > now && t - now <= LOCK_WINDOW_MS;
    });
  result.eligible = eligible.length;
  for (const game of eligible) {
    const gameTime = game.gameTime,
      gameId = game.espnGameId;
    if (!gameTime || !gameId) {
      result.skipped++;
      continue;
    }
    const existing = await pool.query(
      `SELECT 1 FROM fb_prediction_ledger WHERE espn_game_id=$1 LIMIT 1`,
      [gameId],
    );
    if (existing.rows.length) {
      result.skipped++;
      continue;
    }
    const lineup = await confirmedLineup(gameId);
    if (!lineup) {
      console.log(
        `[FB Ledger] ${game.awayTeam} @ ${game.homeTeam}: waiting for fresh confirmed starters.`,
      );
      result.skipped++;
      continue;
    }
    try {
      const [{ fetchEspnTeamStats }, venue] = await Promise.all([
        import("./espnPlayerStats.js"),
        gameVenue(gameId),
      ]);
      const starterMap: Record<string, string[]> = {
        [game.awayTeam]: lineup.away,
        [game.homeTeam]: lineup.home,
      };
      const stats = await fetchEspnTeamStats(
        [game.awayTeam, game.homeTeam],
        starterMap,
        {},
      );
      const expected = new Set([
        ...lineup.away.map(
          (n) => `${normalizeName(n)}|${normalizeTeam(game.awayTeam)}`,
        ),
        ...lineup.home.map(
          (n) => `${normalizeName(n)}|${normalizeTeam(game.homeTeam)}`,
        ),
      ]);
      const candidates = stats
        .filter((p) =>
          expected.has(`${normalizeName(p.player)}|${normalizeTeam(p.team)}`),
        )
        .sort((a, b) => b.firstBasketPct - a.firstBasketPct);
      if (candidates.length !== 10) {
        console.warn(
          `[FB Ledger] ${game.awayTeam} @ ${game.homeTeam}: confirmed 10 starters but modeled ${candidates.length}; not locking.`,
        );
        result.skipped++;
        continue;
      }
      const lockedAt = new Date().toISOString(),
        season = nbaSeasonForDate(new Date(gameTime)).label;
      for (let i = 0; i < candidates.length; i++) {
        const p = candidates[i],
          isHome = normalizeTeam(p.team) === normalizeTeam(game.homeTeam),
          opponent = isHome ? game.awayTeam : game.homeTeam,
          context = {
            contextVersion: "NBA-FB-CONTEXT-SHADOW-V1",
            awayTeam: game.awayTeam,
            homeTeam: game.homeTeam,
            opponent,
            isHome,
            venue,
            lineupSource: lineup.source,
            awayStarters: lineup.away,
            homeStarters: lineup.home,
            currentSeasonFirstBaskets: p.currentSeasonFirstBaskets ?? 0,
            currentSeasonGamesTracked: p.currentSeasonGamesTracked ?? 0,
            previousSeasonFirstBaskets: p.previousSeasonFirstBaskets ?? 0,
            previousSeasonGamesTracked: p.previousSeasonGamesTracked ?? 0,
          };
        await pool.query(
          `INSERT INTO fb_prediction_ledger (espn_game_id,season,game_start_at,locked_at,model_version,player_name,team,model_probability,model_rank,is_top_pick,current_season_fb,current_season_games,previous_season_fb,previous_season_games,away_team,home_team,opponent,is_home,venue,lineup_source,context_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ON CONFLICT (espn_game_id,player_name,team) DO NOTHING`,
          [
            gameId,
            season,
            gameTime,
            lockedAt,
            MODEL_VERSION,
            p.player,
            p.team,
            p.firstBasketPct,
            i + 1,
            i === 0,
            p.currentSeasonFirstBaskets ?? 0,
            p.currentSeasonGamesTracked ?? 0,
            p.previousSeasonFirstBaskets ?? 0,
            p.previousSeasonGamesTracked ?? 0,
            game.awayTeam,
            game.homeTeam,
            opponent,
            isHome,
            venue,
            lineup.source,
            JSON.stringify(context),
          ],
        );
      }
      result.locked++;
      console.log(
        `[FB Ledger] Locked ${game.awayTeam} @ ${game.homeTeam} from ${lineup.source} confirmed starters (${MODEL_VERSION}) with contextual shadow evidence.`,
      );
    } catch (e) {
      console.warn(
        `[FB Ledger] Could not lock ${game.awayTeam} @ ${game.homeTeam}:`,
        e,
      );
      result.skipped++;
    }
  }
  return result;
}
export async function gradeFirstBasketPredictionGame(
  gameId: string,
  scorer: string,
  team: string,
): Promise<number> {
  if (!pool || !(await ledgerExists())) return 0;
  const r = await pool.query(
    `UPDATE fb_prediction_ledger SET actual_first_scorer=$2,actual_first_scorer_team=$3,won=(lower(player_name)=lower($2) AND upper(team)=upper($3)),graded_at=$4 WHERE espn_game_id=$1 AND graded_at IS NULL RETURNING id`,
    [gameId, scorer, team, new Date().toISOString()],
  );
  if (r.rows.length)
    console.log(
      `[FB Ledger] Graded ${r.rows.length} rows for game ${gameId}: ${scorer} (${team}).`,
    );
  return r.rows.length;
}
export async function getFirstBasketLedgerSummary(
  days = 30,
): Promise<{
  modelVersion: string;
  lockedGames: number;
  gradedGames: number;
  topPickWins: number;
  topPickAccuracy: number | null;
  candidateBrier: number | null;
}> {
  if (!pool || !(await ledgerExists()))
    return {
      modelVersion: MODEL_VERSION,
      lockedGames: 0,
      gradedGames: 0,
      topPickWins: 0,
      topPickAccuracy: null,
      candidateBrier: null,
    };
  const r = await pool.query(
    `WITH recent AS (SELECT * FROM fb_prediction_ledger WHERE locked_at::timestamptz>=now()-($1::text||' days')::interval),gc AS (SELECT count(DISTINCT espn_game_id) locked_games,count(DISTINCT espn_game_id) FILTER(WHERE graded_at IS NOT NULL) graded_games FROM recent),tp AS (SELECT count(*) FILTER(WHERE won=true) wins,count(*) FILTER(WHERE graded_at IS NOT NULL) graded FROM recent WHERE is_top_pick=true),cs AS (SELECT avg(power(model_probability/100.0-CASE WHEN won THEN 1 ELSE 0 END,2)) brier FROM recent WHERE graded_at IS NOT NULL) SELECT gc.locked_games,gc.graded_games,tp.wins,tp.graded,cs.brier FROM gc,tp,cs`,
    [Math.max(1, Math.min(days, 365))],
  );
  const row = r.rows[0] ?? {},
    g = Number(row.graded ?? 0),
    w = Number(row.wins ?? 0);
  return {
    modelVersion: MODEL_VERSION,
    lockedGames: Number(row.locked_games ?? 0),
    gradedGames: Number(row.graded_games ?? 0),
    topPickWins: w,
    topPickAccuracy: g > 0 ? Math.round((w / g) * 1000) / 10 : null,
    candidateBrier:
      row.brier == null ? null : Math.round(Number(row.brier) * 10000) / 10000,
  };
}
