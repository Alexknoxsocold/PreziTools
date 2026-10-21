import type { Express } from 'express';
import { getFirstBasketSeasonRows } from './fbSeasonStore';
import { nbaSeasonForDate, previousNbaSeason } from './nbaSeason';

const NBA_TEAMS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GS',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NO', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SA', 'TOR', 'UTAH', 'WSH',
] as const;

type TeamAbbr = typeof NBA_TEAMS[number];

const NBA_TEAM_IDS: Record<TeamAbbr, number> = {
  ATL: 1, BOS: 2, BKN: 17, CHA: 30, CHI: 4, CLE: 5, DAL: 6, DEN: 7, DET: 8, GS: 9,
  HOU: 10, IND: 11, LAC: 12, LAL: 13, MEM: 29, MIA: 14, MIL: 15, MIN: 16, NO: 3, NYK: 18,
  OKC: 25, ORL: 19, PHI: 20, PHX: 21, POR: 22, SAC: 23, SA: 24, TOR: 28, UTAH: 26, WSH: 27,
};

type Candidate = {
  id: string;
  player: string;
  team: TeamAbbr;
  position?: string;
  headshot?: string;
  injuryStatus?: string;
  depthRank: number;
};

type PriorStats = {
  gamesPlayed: number;
  avgMinutes: number;
  avgPoints: number;
};

export type ProjectedNbaPlayer = Candidate & PriorStats & {
  firstBasketPct: number;
  previousSeasonFirstBaskets: number;
  previousSeasonGamesTracked: number;
  projectionSource: 'offseason-depth-chart' | 'offseason-role-fallback';
  isStarter: false;
};

type CachedProjection = {
  season: string;
  previousSeason: string;
  generatedAt: string;
  teamCount: number;
  players: ProjectedNbaPlayer[];
};

let projectionCache: { value: CachedProjection; expiresAt: number } | null = null;
const HEALTHY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEGRADED_CACHE_TTL_MS = 2 * 60 * 1000;
let espnFallbackCount = 0;

async function fetchOnce(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      'Accept': 'application/json,text/plain,*/*',
      'Referer': 'https://www.espn.com/',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchJson(url: string): Promise<any> {
  try {
    return await fetchOnce(url);
  } catch (primaryError) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== 'site.api.espn.com') throw primaryError;
      parsed.hostname = 'site.web.api.espn.com';
      const value = await fetchOnce(parsed.toString());
      espnFallbackCount++;
      return value;
    } catch (fallbackError) {
      console.warn('[NBA Projection] ESPN request failed:', url, fallbackError instanceof Error ? fallbackError.message : fallbackError);
      return null;
    }
  }
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[.'’\-]/g, '').replace(/\s+/g, ' ').trim();
}

function unavailable(status?: string): boolean {
  const value = (status ?? '').toLowerCase();
  return value.includes('out') || value.includes('suspend') || value === 'inactive';
}

function athleteFrom(value: any): any {
  return value?.athlete ?? value?.player ?? value?.person ?? value;
}

function athleteId(value: any): string {
  const athlete = athleteFrom(value);
  return String(athlete?.id ?? athlete?.uid ?? value?.id ?? '').replace(/^s:\d+~l:\d+~a:/, '');
}

function athleteName(value: any): string {
  const athlete = athleteFrom(value);
  return String(athlete?.displayName ?? athlete?.fullName ?? athlete?.name ?? value?.displayName ?? value?.name ?? '').trim();
}

function athleteHeadshot(value: any): string | undefined {
  const athlete = athleteFrom(value);
  const raw = athlete?.headshot?.href ?? athlete?.headshot ?? value?.headshot?.href ?? value?.headshot;
  return typeof raw === 'string' ? raw : undefined;
}

function athleteInjury(value: any): string | undefined {
  const athlete = athleteFrom(value);
  const injury = athlete?.injuries?.[0] ?? value?.injuries?.[0];
  return injury?.status ?? injury?.type ?? athlete?.status?.name ?? value?.status?.name;
}

function positionFrom(value: any, parent?: any): string | undefined {
  const athlete = athleteFrom(value);
  const raw = athlete?.position?.abbreviation
    ?? value?.position?.abbreviation
    ?? parent?.position?.abbreviation
    ?? parent?.abbreviation
    ?? parent?.position?.name;
  return typeof raw === 'string' ? raw.toUpperCase() : undefined;
}

function extractDepthCandidates(data: any, team: TeamAbbr): Candidate[] {
  const found: Candidate[] = [];
  const seenNodes = new Set<any>();

  const visit = (node: any, parent?: any) => {
    if (!node || typeof node !== 'object' || seenNodes.has(node)) return;
    seenNodes.add(node);

    if (Array.isArray(node.athletes)) {
      node.athletes.forEach((entry: any, index: number) => {
        const player = athleteName(entry);
        const id = athleteId(entry);
        if (!player || !id) return;
        const rawRank = Number(entry?.rank ?? entry?.slot ?? entry?.depth ?? entry?.order ?? index + 1);
        found.push({
          id,
          player,
          team,
          position: positionFrom(entry, node),
          headshot: athleteHeadshot(entry),
          injuryStatus: athleteInjury(entry),
          depthRank: Number.isFinite(rawRank) && rawRank > 0 ? rawRank : index + 1,
        });
      });
    }

    if (Array.isArray(node)) node.forEach(child => visit(child, parent));
    else Object.values(node).forEach(child => visit(child, node));
  };

  visit(data);
  const deduped = new Map<string, Candidate>();
  for (const candidate of found) {
    const key = candidate.id || normalizeName(candidate.player);
    const existing = deduped.get(key);
    if (!existing || candidate.depthRank < existing.depthRank) deduped.set(key, candidate);
  }
  return [...deduped.values()].filter(player => !unavailable(player.injuryStatus));
}

function extractRosterCandidates(data: any, team: TeamAbbr): Candidate[] {
  const found: Candidate[] = [];
  const seen = new Set<any>();
  const visit = (node: any, parent?: any) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const id = athleteId(node);
    const player = athleteName(node);
    const position = positionFrom(node, parent);
    if (id && player && position) {
      found.push({
        id,
        player,
        team,
        position,
        headshot: athleteHeadshot(node),
        injuryStatus: athleteInjury(node),
        depthRank: found.length + 1,
      });
    }
    if (Array.isArray(node)) node.forEach(child => visit(child, parent));
    else Object.values(node).forEach(child => visit(child, node));
  };
  visit(data);
  const deduped = new Map<string, Candidate>();
  for (const candidate of found) if (!deduped.has(candidate.id)) deduped.set(candidate.id, candidate);
  return [...deduped.values()].filter(player => !unavailable(player.injuryStatus));
}

async function fetchPreviousStats(espnId: string, espnSeason: number): Promise<PriorStats> {
  const data = await fetchJson(
    `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${espnSeason}/types/2/athletes/${espnId}/statistics/0`
  );
  const categories = data?.splits?.categories;
  if (!Array.isArray(categories)) return { gamesPlayed: 0, avgMinutes: 0, avgPoints: 0 };

  const stat = (category: string, name: string): number => {
    const cat = categories.find((item: any) => item?.name === category);
    const row = cat?.stats?.find((item: any) => item?.name === name);
    const value = Number(row?.value ?? String(row?.displayValue ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(value) ? value : 0;
  };

  return {
    gamesPlayed: stat('general', 'gamesPlayed'),
    avgMinutes: stat('general', 'avgMinutes'),
    avgPoints: stat('offensive', 'avgPoints'),
  };
}

function positionBucket(position?: string): 'G' | 'F' | 'C' {
  const value = (position ?? '').toUpperCase();
  if (value === 'C') return 'C';
  if (value.includes('F')) return 'F';
  return 'G';
}

function roleScore(player: Candidate & PriorStats): number {
  const depthBonus = Math.max(0, 8 - player.depthRank) * 10000;
  return depthBonus + player.avgMinutes * 100 + player.avgPoints * 5 + player.gamesPlayed;
}

function selectFive(players: Array<Candidate & PriorStats>): Array<Candidate & PriorStats> {
  const sorted = [...players].sort((a, b) => roleScore(b) - roleScore(a));
  if (sorted.length <= 5) return sorted;

  const chosen: Array<Candidate & PriorStats> = [];
  const take = (bucket: 'G' | 'F' | 'C') => {
    const match = sorted.find(player => positionBucket(player.position) === bucket && !chosen.includes(player));
    if (match) chosen.push(match);
  };

  take('G');
  take('G');
  take('F');
  take('F');
  take('C');
  for (const player of sorted) {
    if (chosen.length >= 5) break;
    if (!chosen.includes(player)) chosen.push(player);
  }
  return chosen.slice(0, 5).sort((a, b) => roleScore(b) - roleScore(a));
}

async function projectTeam(team: TeamAbbr, previousEspnSeason: number): Promise<Array<Candidate & PriorStats & { projectionSource: ProjectedNbaPlayer['projectionSource'] }>> {
  const teamId = NBA_TEAM_IDS[team];
  const [depthData, rosterData] = await Promise.all([
    fetchJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/depthcharts`),
    fetchJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`),
  ]);

  let candidates = extractDepthCandidates(depthData, team);
  const hasUsefulDepthChart = candidates.length >= 5;
  if (!hasUsefulDepthChart) candidates = extractRosterCandidates(rosterData, team);
  if (!candidates.length) return [];

  const shortlist = hasUsefulDepthChart
    ? [...candidates].sort((a, b) => a.depthRank - b.depthRank).slice(0, 10)
    : candidates.slice(0, 15);

  const enriched = await Promise.all(shortlist.map(async candidate => ({
    ...candidate,
    ...(await fetchPreviousStats(candidate.id, previousEspnSeason)),
  })));

  return selectFive(enriched).map(player => ({
    ...player,
    projectionSource: hasUsefulDepthChart ? 'offseason-depth-chart' : 'offseason-role-fallback',
  }));
}

export async function getNbaProjectedLineups(forceRefresh = false): Promise<CachedProjection> {
  if (!forceRefresh && projectionCache && projectionCache.expiresAt > Date.now()) return projectionCache.value;

  const current = nbaSeasonForDate();
  const previous = previousNbaSeason();
  const historyRows = await getFirstBasketSeasonRows(previous.label).catch(() => []);
  const historyByTeamAndName = new Map<string, typeof historyRows[number]>();
  const historyByName = new Map<string, typeof historyRows[number]>();
  for (const row of historyRows) {
    const name = normalizeName(row.playerName);
    historyByTeamAndName.set(`${row.team.toUpperCase()}|${name}`, row);
    const existing = historyByName.get(name);
    if (!existing || row.gamesTracked > existing.gamesTracked) historyByName.set(name, row);
  }

  const teamResults = await Promise.all(NBA_TEAMS.map(async team => {
    try {
      return await projectTeam(team, previous.espnSeason);
    } catch (error) {
      console.warn(`[NBA Projection] ${team} failed:`, error);
      return [];
    }
  }));

  const players: ProjectedNbaPlayer[] = teamResults.flat().map(player => {
    const normalized = normalizeName(player.player);
    const history = historyByTeamAndName.get(`${player.team}|${normalized}`) ?? historyByName.get(normalized);
    const gamesTracked = history?.gamesTracked ?? 0;
    const firstBaskets = history?.fbScored ?? 0;
    return {
      ...player,
      firstBasketPct: gamesTracked > 0 ? Math.round((firstBaskets / gamesTracked) * 1000) / 10 : 0,
      previousSeasonFirstBaskets: firstBaskets,
      previousSeasonGamesTracked: gamesTracked,
      isStarter: false,
    };
  });

  const teamCount = new Set(players.map(player => player.team)).size;
  const value: CachedProjection = {
    season: current.label,
    previousSeason: previous.label,
    generatedAt: new Date().toISOString(),
    teamCount,
    players,
  };
  const healthy = teamCount >= 25 && players.length >= 125;
  projectionCache = { value, expiresAt: Date.now() + (healthy ? HEALTHY_CACHE_TTL_MS : DEGRADED_CACHE_TTL_MS) };
  console.log(`[NBA Projection] teams=${teamCount} players=${players.length} healthy=${healthy} espnFallbacks=${espnFallbackCount}`);
  if (!healthy) console.warn(`[NBA Projection] Degraded projection feed: expected most of 30 teams, received ${teamCount}. Retrying soon instead of caching for six hours.`);
  return value;
}

export function registerNbaProjectedLineupRoutes(app: Express): void {
  app.get('/api/nba/projected-lineups', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === '1';
      const data = await getNbaProjectedLineups(forceRefresh);
      res.setHeader('Cache-Control', data.teamCount >= 25 ? 'public, max-age=300, stale-while-revalidate=1800' : 'public, max-age=30, stale-while-revalidate=60');
      return res.json(data);
    } catch (error) {
      console.error('[NBA Projection] Feed failed:', error);
      return res.status(502).json({ error: 'Unable to load NBA projected lineups' });
    }
  });
}


export interface NbaDailyProjectedLineupPlayer {
  playerId: string;
  name: string;
  position: string | null;
  lineupStatus: string;
  confidence: 'projected' | 'confirmed';
  updatedAt: string | null;
}
export interface NbaDailyProjectedLineupTeam {
  teamId: string | null;
  abbreviation: string;
  players: NbaDailyProjectedLineupPlayer[];
}
export interface NbaDailyProjectedLineupGame {
  gameId: string;
  gameStatus: number | null;
  gameStatusText: string;
  homeTeam: NbaDailyProjectedLineupTeam;
  awayTeam: NbaDailyProjectedLineupTeam;
}
function nbaDailyLineupDateKey(date?: string): string {
  if (date && !/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) throw new Error('date must use YYYY-MM-DD format');
  if (date) return date.replace(/-/g, '');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return part('year') + part('month') + part('day');
}
function parseDailyLineupTeam(raw: any): NbaDailyProjectedLineupTeam | null {
  const abbreviation = String(raw?.teamAbbreviation ?? '').trim().toUpperCase();
  if (!abbreviation || !Array.isArray(raw?.players)) return null;
  const players: NbaDailyProjectedLineupPlayer[] = raw.players.flatMap((player: any) => {
    const name = String(player?.playerName ?? player?.name ?? '').trim();
    const playerId = String(player?.personId ?? player?.playerId ?? '').trim();
    if (!name || !playerId) return [];
    const lineupStatus = String(player?.lineupStatus ?? 'Unknown').trim();
    // The feed currently reports "Expected". Never promote that to confirmed.
    const confidence = /^(confirmed|confirmed starter)$/i.test(lineupStatus) ? 'confirmed' as const : 'projected' as const;
    return [{
      playerId,
      name,
      position: player?.position == null ? null : String(player.position),
      lineupStatus,
      confidence,
      updatedAt: player?.timestamp == null ? null : String(player.timestamp),
    }];
  });
  return { teamId: raw?.teamId == null ? null : String(raw.teamId), abbreviation, players };
}
/**
 * Read-only adapter for the NBA.com daily lineup feed.
 * It deliberately does not write game starters, confirmed-lineup state, or prediction-ledger rows.
 */
export async function fetchNbaDailyProjectedLineups(date?: string): Promise<{
  date: string;
  source: 'nba.com daily lineups';
  fetchedAt: string;
  games: NbaDailyProjectedLineupGame[];
}> {
  const dateKey = nbaDailyLineupDateKey(date);
  const response = await fetch(`https://stats.nba.com/js/data/leaders/00_daily_lineups_${dateKey}.json`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; PreziTools/1.0)',
      'Referer': 'https://www.nba.com/',
      'Origin': 'https://www.nba.com',
      'Accept': 'application/json, text/plain, */*',
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error(`NBA daily lineups feed returned HTTP ${response.status}`);
  const payload: any = await response.json();
  if (!Array.isArray(payload?.games)) throw new Error('NBA daily lineups feed has an unexpected schema');
  const games: NbaDailyProjectedLineupGame[] = payload.games.flatMap((raw: any) => {
    const homeTeam = parseDailyLineupTeam(raw?.homeTeam);
    const awayTeam = parseDailyLineupTeam(raw?.awayTeam);
    const gameId = String(raw?.gameId ?? '').trim();
    if (!gameId || !homeTeam || !awayTeam) return [];
    return [{
      gameId,
      gameStatus: raw?.gameStatus == null ? null : Number(raw.gameStatus),
      gameStatusText: String(raw?.gameStatusText ?? ''),
      homeTeam,
      awayTeam,
    }];
  });
  return {
    date: `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`,
    source: 'nba.com daily lineups',
    fetchedAt: new Date().toISOString(),
    games,
  };
}
