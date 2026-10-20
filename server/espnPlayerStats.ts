// ESPN Player Stats Service
// Fetches season-aware NBA stats + first basket odds/history.

import { currentAndPreviousSeasonLabels, getFirstBasketSeasonRows } from './fbSeasonStore';
import { nbaSeasonForDate } from './nbaSeason';
import { formatAmericanOdds, parseAmericanOdds } from './odds/normalized';

export interface EspnPlayerStat {
  player: string;
  team: string;
  espnId: string;
  position: string;
  gamesPlayed: number;
  avgPoints: number;
  avgFGA: number;
  fgPct: number;
  avgMinutes: number;
  avgAssists: number;
  avgRebounds: number;
  firstBasketPct: number;
  firstBasketsScored?: number;
  currentSeasonFirstBaskets?: number;
  currentSeasonGamesTracked?: number;
  previousSeasonFirstBaskets?: number;
  previousSeasonGamesTracked?: number;
  q1FgaRate: number;
  odds: string;
  liveOdds?: string;
  liveOddsSource?: 'espn-core';
  liveOddsSportsbook?: string;
  headshot?: string;
  injuryStatus?: string;
  isStarter?: boolean;
}

interface RosterEntry {
  id: string;
  displayName: string;
  position?: { abbreviation: string };
  headshot?: { href: string };
  injuries?: Array<{ status: string; type: string; shortComment?: string }>;
  status?: { name: string };
}

type HistoryRow = {
  fbScored: number;
  gamesTracked: number;
};

async function fetchJson(url: string): Promise<any> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getTeamRoster(teamAbbr: string): Promise<RosterEntry[]> {
  const data = await fetchJson(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamAbbr}/roster`
  );
  return data?.athletes || [];
}

function normalizeName(name: string): string {
  return name.toLowerCase()
    .replace(/[.''\u2019-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function historyKey(playerName: string, team: string): string {
  return `${normalizeName(playerName)}|${team.toUpperCase()}`;
}

function matchPlayer(starterName: string, roster: RosterEntry[]): RosterEntry | null {
  const normalizedStarter = normalizeName(starterName);
  let match = roster.find(p => normalizeName(p.displayName) === normalizedStarter);
  if (match) return match;
  const starterLastName = normalizedStarter.split(' ').slice(-1)[0];
  match = roster.find(p => normalizeName(p.displayName).split(' ').slice(-1)[0] === starterLastName);
  return match || null;
}

async function getPlayerStats(espnId: string): Promise<any> {
  const currentSeason = nbaSeasonForDate();
  const previousSeason = currentSeason.espnSeason - 1;

  const parseStats = (data: any): any => {
    if (!data?.splits?.categories) return null;
    const cats = data.splits.categories;
    const getStat = (catName: string, statName: string): number => {
      const cat = cats.find((c: any) => c.name === catName);
      const stat = cat?.stats?.find((s: any) => s.name === statName);
      return parseFloat(stat?.value || stat?.displayValue?.replace(/[^0-9.]/g, '') || '0') || 0;
    };
    return {
      gamesPlayed: getStat('general', 'gamesPlayed'),
      avgPoints: getStat('offensive', 'avgPoints'),
      avgFGA: getStat('offensive', 'avgFieldGoalsAttempted'),
      fgPct: getStat('offensive', 'fieldGoalPct'),
      avgMinutes: getStat('general', 'avgMinutes'),
      avgAssists: getStat('offensive', 'avgAssists'),
      avgRebounds: getStat('general', 'avgRebounds'),
      avgFTA: getStat('offensive', 'avgFreeThrowsAttempted'),
    };
  };

  const fetchSeason = async (season: number) => parseStats(await fetchJson(
    `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${season}/types/2/athletes/${espnId}/statistics/0`
  ));

  // At preseason / opening night the new regular-season stats endpoint can be
  // empty or contain fewer than the minimum eligible games. Use last season's
  // completed regular-season baseline until the current-season sample is usable.
  const current = await fetchSeason(currentSeason.espnSeason);
  if (current && current.gamesPlayed >= 3 && current.avgMinutes >= 8) return current;

  const previous = await fetchSeason(previousSeason);
  if (previous && previous.gamesPlayed >= 3 && previous.avgMinutes >= 8) return previous;

  // Keep a small current-season sample if no prior-season baseline is available.
  return current ?? previous ?? null;
}

function deriveFirstBasketPct(stats: any, position: string): { fbPct: number; q1FgaRate: number; odds: string } {
  const { avgFGA, avgPoints, fgPct, avgMinutes } = stats;
  const fgaShare = avgFGA / 90;
  let fbScore = fgaShare * 40;
  fbScore += (avgPoints / 45) * 8;
  fbScore += ((fgPct - 43) / 30) * 4;
  fbScore += (Math.min(avgMinutes, 36) / 36) * 3;
  if (position === 'C') fbScore *= 1.12;
  else if (position === 'PG') fbScore *= 1.05;
  fbScore = Math.max(fbScore, 3);
  const fbPct = Math.min(Math.round(fbScore * 10) / 10, 35);
  const q1FgaRate = Math.round((avgFGA / 4) * 10) / 10;
  const impliedProb = Math.max(fbPct / 100, 0.01);
  const odds = impliedProb >= 0.5
    ? `-${Math.round((impliedProb / (1 - impliedProb)) * 100)}`
    : `+${Math.round(((1 - impliedProb) / impliedProb) * 100)}`;
  return { fbPct, q1FgaRate, odds };
}

/**
 * Season-aware evidence blend.
 * Previous season is a bounded prior; current-season verified results gain
 * influence naturally as the new sample grows. The opportunity model remains
 * the floor when current evidence is sparse.
 */
function blendSeasonalFirstBasketPct(
  modelPct: number,
  previous: HistoryRow | undefined,
  current: HistoryRow | undefined,
): number {
  const modelPseudoGames = 12;
  let numerator = (modelPct / 100) * modelPseudoGames;
  let denominator = modelPseudoGames;

  if (previous && previous.gamesTracked > 0) {
    const priorGames = Math.min(previous.gamesTracked, 18);
    const priorRate = previous.fbScored / previous.gamesTracked;
    numerator += priorRate * priorGames;
    denominator += priorGames;
  }

  if (current && current.gamesTracked > 0) {
    numerator += current.fbScored;
    denominator += current.gamesTracked;
  }

  const pct = (numerator / denominator) * 100;
  return Math.max(1, Math.min(35, Math.round(pct * 10) / 10));
}

function isPlayerOut(entry: RosterEntry): boolean {
  const inj = entry.injuries?.[0];
  if (!inj) return false;
  const status = inj.status?.toLowerCase() || '';
  return status.includes('out') || status.includes('suspend') || status === 'inactive';
}

function getInjuryStatus(entry: RosterEntry): string | undefined {
  return entry.injuries?.[0]?.status || undefined;
}

export async function fetchFirstBasketOdds(eventIds: string[]): Promise<Record<string, string>> {
  const oddsMap: Record<string, string> = {};
  await Promise.all(eventIds.map(async (eventId) => {
    for (let page = 1; page <= 12; page++) {
      const data = await fetchJson(
        `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${eventId}/competitions/${eventId}/odds/100/propBets?lang=en&region=us&limit=100&page=${page}`
      );
      if (!data?.items) break;
      let foundOnPage = false;
      for (const prop of data.items) {
        if (prop.type?.name !== 'First Basket') continue;
        foundOnPage = true;
        const athleteRef = prop.athlete?.$ref || '';
        const espnId = athleteRef.match(/athletes\/(\d+)/)?.[1];
        const americanOdds = parseAmericanOdds(prop.odds?.american?.value);
        if (espnId && americanOdds !== null) {
          oddsMap[espnId] = formatAmericanOdds(americanOdds);
        }
      }
      const passedFirstBasket = Object.keys(oddsMap).length > 0 && !foundOnPage;
      if (passedFirstBasket && page > 5) break;
      if ((data.pageIndex || page) >= (data.pageCount || 1)) break;
    }
  }));
  console.log(`[ESPN Odds] Found first basket odds for ${Object.keys(oddsMap).length} players`);
  return oddsMap;
}

export async function getTodayEspnEventIds(dateISO?: string): Promise<string[]> {
  let dateStr: string;
  if (dateISO) dateStr = dateISO.replace(/-/g, '');
  else {
    const today = new Date();
    dateStr = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
  }
  const data = await fetchJson(
    `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events?dates=${dateStr}&limit=20`
  );
  return (data?.items || []).map((it: any) => String(it.$ref || '').match(/events\/(\d+)/)?.[1]).filter(Boolean);
}

export async function fetchEspnTeamStats(
  teams: string[],
  starterMap: Record<string, string[]> = {},
  firstBasketOddsMap: Record<string, string> = {}
): Promise<EspnPlayerStat[]> {
  const results: EspnPlayerStat[] = [];
  const seasonLabels = currentAndPreviousSeasonLabels();
  const [currentRows, previousRows] = await Promise.all([
    getFirstBasketSeasonRows(seasonLabels.current).catch(() => []),
    getFirstBasketSeasonRows(seasonLabels.previous).catch(() => []),
  ]);

  const currentMap = new Map<string, HistoryRow>();
  const previousMap = new Map<string, HistoryRow>();
  for (const row of currentRows) currentMap.set(historyKey(row.playerName, row.team), { fbScored: row.fbScored, gamesTracked: row.gamesTracked });
  for (const row of previousRows) previousMap.set(historyKey(row.playerName, row.team), { fbScored: row.fbScored, gamesTracked: row.gamesTracked });

  const rosterMap: Record<string, RosterEntry[]> = {};
  await Promise.all(teams.map(async (team) => {
    rosterMap[team] = await getTeamRoster(team);
    console.log(`[ESPN] Fetched ${rosterMap[team].length} players for ${team}`);
  }));

  for (const team of teams) {
    const roster = rosterMap[team] || [];
    const starters = starterMap[team] || [];
    const hasLineupData = starters.length > 0;
    const activePlayers = roster.filter(p => !isPlayerOut(p));
    const teamPlayers: EspnPlayerStat[] = [];

    for (let i = 0; i < activePlayers.length; i += 8) {
      const batch = activePlayers.slice(i, i + 8);
      await Promise.all(batch.map(async (player) => {
        const statsData = await getPlayerStats(player.id);
        if (!statsData || statsData.gamesPlayed < 3 || statsData.avgMinutes < 8) return;
        const position = player.position?.abbreviation || 'G';
        const { fbPct, q1FgaRate, odds } = deriveFirstBasketPct(statsData, position);
        const liveOdds = firstBasketOddsMap[player.id];
        const isStarterByLineup = hasLineupData
          ? starters.some(s => normalizeName(s) === normalizeName(player.displayName))
          : false;
        const key = historyKey(player.displayName, team);
        const current = currentMap.get(key);
        const previous = previousMap.get(key);

        teamPlayers.push({
          player: player.displayName,
          team,
          espnId: player.id,
          position,
          gamesPlayed: statsData.gamesPlayed,
          avgPoints: Math.round(statsData.avgPoints * 10) / 10,
          avgFGA: Math.round(statsData.avgFGA * 10) / 10,
          fgPct: Math.round(statsData.fgPct * 10) / 10,
          avgMinutes: Math.round(statsData.avgMinutes * 10) / 10,
          avgAssists: Math.round(statsData.avgAssists * 10) / 10,
          avgRebounds: Math.round(statsData.avgRebounds * 10) / 10,
          firstBasketPct: blendSeasonalFirstBasketPct(fbPct, previous, current),
          firstBasketsScored: current?.fbScored ?? 0,
          currentSeasonFirstBaskets: current?.fbScored ?? 0,
          currentSeasonGamesTracked: current?.gamesTracked ?? 0,
          previousSeasonFirstBaskets: previous?.fbScored ?? 0,
          previousSeasonGamesTracked: previous?.gamesTracked ?? 0,
          q1FgaRate,
          odds,
          liveOdds,
          liveOddsSource: liveOdds ? 'espn-core' : undefined,
          headshot: player.headshot?.href,
          injuryStatus: getInjuryStatus(player),
          isStarter: isStarterByLineup,
        });
      }));
    }

    if (!hasLineupData && teamPlayers.length > 0) {
      const sorted = [...teamPlayers].sort((a, b) => b.avgMinutes - a.avgMinutes);
      const top5Names = new Set(sorted.slice(0, 5).map(p => p.player));
      teamPlayers.forEach(p => { p.isStarter = top5Names.has(p.player); });
    }
    results.push(...teamPlayers);
  }

  // Odds availability must not remove otherwise eligible model candidates.
  const filtered = results;
  console.log(`[FBTracker] Loaded ${currentRows.length} ${seasonLabels.current} rows and ${previousRows.length} ${seasonLabels.previous} prior rows`);

  // Only blend verified per-game starter records from fb_tracking. The older
  // roster-schedule backfill counted the same game once per team and assigned
  // player season GP as the denominator, which could inflate counts and distort
  // first-basket rates. Missing history stays missing until the strict tracker
  // records a verified ten-starter game; the opportunity model remains the floor.

  return filtered;
}

export async function fetchEspnPlayerStats(
  starters: { team: string; players: string[] }[]
): Promise<EspnPlayerStat[]> {
  const results: EspnPlayerStat[] = [];
  const allTeams = [...new Set(starters.map(s => s.team))];
  const rosterMap: Record<string, RosterEntry[]> = {};
  await Promise.all(allTeams.map(async team => { rosterMap[team] = await getTeamRoster(team); }));
  const globalRoster: RosterEntry[] = Object.values(rosterMap).flat();

  for (const { team, players } of starters) {
    await Promise.all(players.map(async (playerName) => {
      let matched = matchPlayer(playerName, rosterMap[team] || []);
      if (!matched) matched = matchPlayer(playerName, globalRoster);
      if (!matched || isPlayerOut(matched)) return;
      const statsData = await getPlayerStats(matched.id);
      if (!statsData || statsData.gamesPlayed === 0) return;
      const position = matched.position?.abbreviation || 'G';
      const { fbPct, q1FgaRate, odds } = deriveFirstBasketPct(statsData, position);
      results.push({
        player: playerName,
        team,
        espnId: matched.id,
        position,
        gamesPlayed: statsData.gamesPlayed,
        avgPoints: Math.round(statsData.avgPoints * 10) / 10,
        avgFGA: Math.round(statsData.avgFGA * 10) / 10,
        fgPct: Math.round(statsData.fgPct * 10) / 10,
        avgMinutes: Math.round(statsData.avgMinutes * 10) / 10,
        avgAssists: Math.round(statsData.avgAssists * 10) / 10,
        avgRebounds: Math.round(statsData.avgRebounds * 10) / 10,
        firstBasketPct: fbPct,
        q1FgaRate,
        odds,
        headshot: matched.headshot?.href,
        injuryStatus: getInjuryStatus(matched),
        isStarter: true,
      });
    }));
  }
  return results;
}
