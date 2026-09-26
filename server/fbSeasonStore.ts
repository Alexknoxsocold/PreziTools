import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { nbaSeasonForDate, previousNbaSeason } from './nbaSeason';

neonConfig.webSocketConstructor = ws;

export type FirstBasketSeasonRow = {
  id: string;
  playerName: string;
  team: string;
  fbScored: number;
  gamesTracked: number;
  season: string;
  lastUpdated: string | null;
};

export type FirstBasketStarter = { playerName: string; team: string };

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

function mapRow(row: any): FirstBasketSeasonRow {
  return {
    id: String(row.id),
    playerName: String(row.player_name),
    team: String(row.team),
    fbScored: Number(row.fb_scored ?? 0),
    gamesTracked: Number(row.games_tracked ?? 0),
    season: String(row.season),
    lastUpdated: row.last_updated ?? null,
  };
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[.'’\-]/g, '').replace(/\s+/g, ' ').trim();
}

export async function getFirstBasketSeasonRows(season: string): Promise<FirstBasketSeasonRow[]> {
  if (!pool) return [];
  const result = await pool.query(
    `SELECT id, player_name, team, fb_scored, games_tracked, season, last_updated
       FROM fb_tracking
      WHERE season = $1
        AND trim(team) <> ''
      ORDER BY player_name, team`,
    [season],
  );
  return result.rows.map(mapRow);
}

export async function getFirstBasketPlayerSeason(
  playerName: string,
  team: string,
  season: string,
): Promise<FirstBasketSeasonRow | null> {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id, player_name, team, fb_scored, games_tracked, season, last_updated
       FROM fb_tracking
      WHERE lower(player_name) = lower($1)
        AND upper(team) = upper($2)
        AND season = $3
      ORDER BY games_tracked DESC, fb_scored DESC, id
      LIMIT 1`,
    [playerName, team, season],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function upsertFirstBasketPlayerSeason(
  playerName: string,
  team: string,
  fbScored: number,
  gamesTracked: number,
  season: string,
): Promise<void> {
  if (!pool || !team.trim()) return;
  const now = new Date().toISOString();
  const existing = await getFirstBasketPlayerSeason(playerName, team, season);
  if (existing) {
    await pool.query(
      `UPDATE fb_tracking
          SET fb_scored = $1,
              games_tracked = $2,
              last_updated = $3
        WHERE id = $4`,
      [fbScored, gamesTracked, now, existing.id],
    );
    return;
  }
  await pool.query(
    `INSERT INTO fb_tracking (player_name, team, fb_scored, games_tracked, season, last_updated)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [playerName.trim(), team.trim().toUpperCase(), fbScored, gamesTracked, season, now],
  );
}

/**
 * Records one completed game atomically enough for a single production worker:
 * every verified starter gets one denominator game, while only the first-field-
 * goal scorer gets the numerator. This fixes the old inflated-rate bug where
 * gamesTracked only moved for the scorer.
 */
export async function recordCurrentSeasonFirstBasketGame(
  starters: FirstBasketStarter[],
  scorer: FirstBasketStarter,
  date = new Date(),
): Promise<void> {
  if (!pool) return;
  const season = nbaSeasonForDate(date).label;
  const uniqueStarters = [...new Map(
    starters
      .filter(s => s.playerName.trim() && s.team.trim())
      .map(s => [`${normalizeName(s.playerName)}|${s.team.toUpperCase()}`, { playerName: s.playerName.trim(), team: s.team.trim().toUpperCase() }]),
  ).values()];

  if (uniqueStarters.length < 10) {
    throw new Error(`Expected 10 verified NBA starters, received ${uniqueStarters.length}`);
  }

  const now = new Date().toISOString();
  for (const starter of uniqueStarters) {
    const existing = await getFirstBasketPlayerSeason(starter.playerName, starter.team, season);
    const scored = normalizeName(starter.playerName) === normalizeName(scorer.playerName)
      && starter.team.toUpperCase() === scorer.team.toUpperCase();
    if (existing) {
      await pool.query(
        `UPDATE fb_tracking
            SET fb_scored = fb_scored + $1,
                games_tracked = games_tracked + 1,
                last_updated = $2
          WHERE id = $3`,
        [scored ? 1 : 0, now, existing.id],
      );
    } else {
      await pool.query(
        `INSERT INTO fb_tracking (player_name, team, fb_scored, games_tracked, season, last_updated)
         VALUES ($1, $2, $3, 1, $4, $5)`,
        [starter.playerName, starter.team, scored ? 1 : 0, season, now],
      );
    }
  }
}

export async function isVerifiedFirstBasketGameProcessed(espnGameId: string): Promise<boolean> {
  if (!pool) return false;
  const result = await pool.query(
    `SELECT 1
       FROM fb_processed_games
      WHERE espn_game_id = $1
        AND first_scorer IS NOT NULL
        AND trim(first_scorer) <> ''
        AND first_scorer_team IS NOT NULL
        AND trim(first_scorer_team) <> ''
      LIMIT 1`,
    [espnGameId],
  );
  return result.rows.length > 0;
}

export async function markVerifiedFirstBasketGame(
  espnGameId: string,
  playerName: string,
  team: string,
): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO fb_processed_games (espn_game_id, first_scorer, first_scorer_team, processed_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (espn_game_id)
     DO UPDATE SET first_scorer = EXCLUDED.first_scorer,
                   first_scorer_team = EXCLUDED.first_scorer_team,
                   processed_at = EXCLUDED.processed_at`,
    [espnGameId, playerName.trim(), team.trim().toUpperCase(), new Date().toISOString()],
  );
}

export function currentAndPreviousSeasonLabels(date = new Date()): { current: string; previous: string } {
  return {
    current: nbaSeasonForDate(date).label,
    previous: previousNbaSeason(date).label,
  };
}

/** Results and new-game season counters commit together; legacy counters are never guessed. */
export async function recordVerifiedNbaGame(gameId: string, starters: FirstBasketStarter[], scorer: FirstBasketStarter, gameDate: Date): Promise<boolean> {
  if (!pool || !Number.isFinite(gameDate.getTime())) return false;
  const unique = [...new Map(starters.map(s => [`${normalizeName(s.playerName)}|${s.team.toUpperCase()}`, s])).values()];
  if (unique.length !== 10 || !scorer.playerName || !scorer.team) throw new Error('Incomplete NBA evidence');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // One lock also serializes counters for players shared by different games.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('nba-verified-results'))");
    const existing = await client.query('SELECT first_scorer,first_scorer_team FROM fb_processed_games WHERE espn_game_id=$1 FOR UPDATE', [gameId]);
    if (existing.rows[0]?.first_scorer?.trim() && existing.rows[0]?.first_scorer_team?.trim()) { await client.query('ROLLBACK'); return false; }
    const season = nbaSeasonForDate(gameDate).label;
    // Legacy rows may already have contributed to counters. Repair their result only.
    if (!existing.rows.length) for (const starter of unique) {
      const scored = normalizeName(starter.playerName) === normalizeName(scorer.playerName) && starter.team.toUpperCase() === scorer.team.toUpperCase();
      const prior = await client.query('SELECT id FROM fb_tracking WHERE lower(player_name)=lower($1) AND upper(team)=upper($2) AND season=$3 ORDER BY games_tracked DESC,fb_scored DESC,id LIMIT 1 FOR UPDATE', [starter.playerName,starter.team,season]);
      if (prior.rows.length) await client.query('UPDATE fb_tracking SET fb_scored=fb_scored+$1,games_tracked=games_tracked+1,last_updated=now() WHERE id=$2', [Number(scored),prior.rows[0].id]);
      else await client.query('INSERT INTO fb_tracking(player_name,team,fb_scored,games_tracked,season,last_updated) VALUES($1,$2,$3,1,$4,now())', [starter.playerName,starter.team,Number(scored),season]);
    }
    await client.query(`INSERT INTO fb_processed_games(espn_game_id,first_scorer,first_scorer_team,processed_at) VALUES($1,$2,$3,now()) ON CONFLICT(espn_game_id) DO UPDATE SET first_scorer=EXCLUDED.first_scorer,first_scorer_team=EXCLUDED.first_scorer_team,processed_at=EXCLUDED.processed_at`, [gameId,scorer.playerName,scorer.team]);
    await client.query('COMMIT');
    return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function unresolvedNbaGameIds(limit = 5): Promise<string[]> {
  if (!pool) return [];
  await pool.query('CREATE TABLE IF NOT EXISTS fb_legacy_verification_attempts(espn_game_id text PRIMARY KEY,attempted_at timestamptz NOT NULL DEFAULT now())');
  const rows = await pool.query(`SELECT p.espn_game_id FROM fb_processed_games p LEFT JOIN fb_legacy_verification_attempts a USING(espn_game_id) WHERE (coalesce(trim(p.first_scorer),'')='' OR coalesce(trim(p.first_scorer_team),'')='') AND (a.attempted_at IS NULL OR a.attempted_at<now()-interval '1 day') ORDER BY a.attempted_at ASC NULLS FIRST,p.espn_game_id LIMIT $1`, [Math.min(20,Math.max(1,limit))]);
  for (const row of rows.rows) await pool.query('INSERT INTO fb_legacy_verification_attempts(espn_game_id) VALUES($1) ON CONFLICT(espn_game_id) DO UPDATE SET attempted_at=now()', [row.espn_game_id]);
  return rows.rows.map(x => String(x.espn_game_id));
}

export async function getVerifiedNbaResult(gameId: string): Promise<FirstBasketStarter | null> {
  if (!pool) return null;
  const result = await pool.query("SELECT first_scorer,first_scorer_team FROM fb_processed_games WHERE espn_game_id=$1 AND coalesce(trim(first_scorer),'')<>'' AND coalesce(trim(first_scorer_team),'')<>''", [gameId]);
  return result.rows.length ? {playerName:result.rows[0].first_scorer,team:result.rows[0].first_scorer_team} : null;
}
