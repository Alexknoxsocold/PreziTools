import type { Express } from 'express';
import { fetchHomeRunMarkets, normalizeHomeRunPlayer, type HomeRunMarket } from './mlbHomeRunMarkets';
import { fetchGameHrWeather, type HrWeatherSnapshot } from './mlbHrWeather';

const MLB_BASE = 'https://statsapi.mlb.com/api/v1';
const LEAGUE_HR_PER_PA = 0.032;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const NEAR_GAME_CACHE_TTL_MS = 60 * 1000;

export type MlbHomeRunMarket = {
  source: 'PropLine'; bestOdds: number; bestBook: string; impliedProbability: number; consensusImpliedProbability: number;
  quoteCount: number; trustedQuoteCount: number; outlierQuoteCount: number; priceVerified: boolean; modelEdge: number;
  expectedValue: number; valueTier: 'BEST_VALUE' | 'VALUE' | 'NONE';
  quotes: { bookmaker: string; bookmakerKey: string; americanOdds: number; updatedAt: string | null }[]; capturedAt: string;
};

export type MlbHomeRunCandidate = {
  gamePk: number; gameTime: string; playerId: number; player: string; team: string; opponent: string; headshot: string;
  battingOrder: number | null; lineupConfirmed: boolean; probablePitcher: string | null; venue: string | null;
  probability: number; confidence: number; tier: 'POWER_PLAY' | 'STRONG' | 'WATCH';
  season: { plateAppearances: number; homeRuns: number; homeRunRate: number; slugging: number | null; ops: number | null };
  recent: { plateAppearances: number; homeRuns: number; homeRunRate: number | null };
  pitcher: { battersFaced: number; homeRunsAllowed: number; homeRunRateAllowed: number | null };
  environment: {
    parkFactor: number; temperatureF: number | null; windMph: number | null; windDirection: string | null; windDegrees: number | null;
    precipitationProbability: number | null; condition: string | null; weatherSource: 'MLB' | 'Open-Meteo' | 'unavailable'; weatherFactor: number;
  };
  factors: string[]; market: MlbHomeRunMarket | null; homepageEligible: boolean;
};

export type MlbHomeRunResponse = {
  date: string; modelVersion: 'hr-v2-value'; updatedAt: string; candidates: MlbHomeRunCandidate[]; strongest: MlbHomeRunCandidate[];
  valuePlays: MlbHomeRunCandidate[]; watchlist: MlbHomeRunCandidate[]; gamesWithConfirmedLineups: number; teamsWithConfirmedLineups: number;
  totalGames: number; marketStatus: 'available' | 'unavailable' | 'disabled'; marketGamesMatched: number; marketPlayersPriced: number;
  homepageReady: boolean; methodology: string; note: string;
};

type StatSplit = { player?: { id?: number; fullName?: string }; stat?: { plateAppearances?: number; homeRuns?: number; sluggingPercentage?: string | number; ops?: string | number; battersFaced?: number } };
type StatsResponse = { stats?: { splits?: StatSplit[] }[] };
type TeamRef = { id?: number; name?: string; abbreviation?: string };
type PitcherRef = { id?: number; fullName?: string };
type ScheduleSide = { team?: TeamRef; probablePitcher?: PitcherRef };
type ScheduleGame = { gamePk: number; gameDate: string; venue?: { name?: string }; teams?: { away?: ScheduleSide; home?: ScheduleSide } };
type ScheduleResponse = { dates?: { games?: ScheduleGame[] }[] };
type FeedPlayer = { person?: { id?: number; fullName?: string }; position?: { type?: string; abbreviation?: string } };
type FeedTeam = { battingOrder?: number[]; players?: Record<string, FeedPlayer> };
type NativeWeather = { temp?: number; wind?: string; condition?: string };
type FeedResponse = { gameData?: { weather?: NativeWeather; venue?: { name?: string } }; liveData?: { boxscore?: { teams?: { away?: FeedTeam; home?: FeedTeam } } } };
type BoxscoreResponse = { teams?: { away?: FeedTeam; home?: FeedTeam } };
type RosterResponse = { roster?: { person?: { id?: number; fullName?: string }; position?: { type?: string; abbreviation?: string } }[] };
type StatLine = { id: number; name: string; plateAppearances: number; homeRuns: number; slugging: number | null; ops: number | null; battersFaced: number };
type PlayerInput = { id: number; name: string; order: number | null; lineupConfirmed: boolean; source: 'feed' | 'boxscore' | 'feed-pool' | 'roster' };

const cache = new Map<string, { expiresAt: number; value: MlbHomeRunResponse }>();

async function fetchJson<T>(url: string, timeoutMs = 7000): Promise<T> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'PreziTools/1.0' } }); if (!response.ok) throw new Error(`MLB API ${response.status}`); return await response.json() as T; }
  finally { clearTimeout(timer); }
}
function etDateISO(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}`;
}
function toNumber(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) ? n : null; }
function statMap(response: StatsResponse): Map<number, StatLine> {
  const map = new Map<number, StatLine>();
  for (const block of response.stats ?? []) for (const split of block.splits ?? []) {
    const id = Number(split.player?.id); if (!Number.isFinite(id)) continue;
    const pa = Number(split.stat?.plateAppearances ?? 0), hr = Number(split.stat?.homeRuns ?? 0), bf = Number(split.stat?.battersFaced ?? 0);
    map.set(id, { id, name: split.player?.fullName ?? String(id), plateAppearances: Number.isFinite(pa) ? pa : 0, homeRuns: Number.isFinite(hr) ? hr : 0, slugging: toNumber(split.stat?.sluggingPercentage), ops: toNumber(split.stat?.ops), battersFaced: Number.isFinite(bf) ? bf : 0 });
  }
  return map;
}
async function fetchStats(season: number, group: 'hitting' | 'pitching', statType = 'season', startDate?: string, endDate?: string): Promise<Map<number, StatLine>> {
  const params = new URLSearchParams({ stats: statType, group, season: String(season), sportIds: '1', playerPool: 'ALL', limit: '2000', hydrate: 'person' });
  if (startDate) params.set('startDate', startDate); if (endDate) params.set('endDate', endDate);
  return statMap(await fetchJson<StatsResponse>(`${MLB_BASE}/stats?${params.toString()}`, 10000));
}
function parseLineup(team: FeedTeam | undefined, source: 'feed' | 'boxscore'): PlayerInput[] {
  if (!team?.battingOrder?.length || !team.players) return [];
  const rows = team.battingOrder.map((id, index) => ({ id, name: team.players?.[`ID${id}`]?.person?.fullName ?? String(id), order: index + 1, lineupConfirmed: true, source } satisfies PlayerInput)).filter(row => row.name !== String(row.id));
  return rows.length >= 9 ? rows.slice(0, 9) : [];
}
function parseFeedHitters(team: FeedTeam | undefined): PlayerInput[] {
  if (!team?.players) return []; const seen = new Set<number>(), rows: PlayerInput[] = [];
  for (const row of Object.values(team.players)) {
    if (row.position?.type === 'Pitcher' || row.position?.abbreviation === 'P') continue;
    const id = Number(row.person?.id), name = row.person?.fullName ?? ''; if (!Number.isFinite(id) || !name || seen.has(id)) continue;
    seen.add(id); rows.push({ id, name, order: null, lineupConfirmed: false, source: 'feed-pool' });
  }
  return rows;
}
function rosterPlayers(roster: RosterResponse): PlayerInput[] {
  return (roster.roster ?? []).filter(r => r.position?.type !== 'Pitcher' && r.position?.abbreviation !== 'P').map(r => ({ id: Number(r.person?.id), name: r.person?.fullName ?? '', order: null, lineupConfirmed: false, source: 'roster' as const })).filter(r => Number.isFinite(r.id) && r.name.length > 0);
}
async function fetchActiveHitters(teamId: number | undefined, date: string): Promise<PlayerInput[]> {
  if (!teamId) return [];
  for (const url of [`${MLB_BASE}/teams/${teamId}/roster?rosterType=active&date=${date}`, `${MLB_BASE}/teams/${teamId}/roster?rosterType=active`, `${MLB_BASE}/teams/${teamId}/roster?rosterType=40Man`]) {
    try { const rows = rosterPlayers(await fetchJson<RosterResponse>(url, 6500)); if (rows.length) return rows; } catch {}
  }
  return [];
}
function parkFactor(venue?: string | null): number {
  const n = (venue ?? '').toLowerCase();
  if (n.includes('coors')) return 1.12; if (n.includes('great american')) return 1.07; if (n.includes('yankee')) return 1.05; if (n.includes('citizens bank')) return 1.05; if (n.includes('fenway')) return 1.03; if (n.includes('wrigley')) return 1.02; if (n.includes('dodger')) return 1.02; if (n.includes('camden')) return 0.99; if (n.includes('oracle')) return 0.96; if (n.includes('petco')) return 0.96; if (n.includes('t-mobile')) return 0.97; return 1;
}
function parseWind(wind?: string | null) {
  if (!wind) return { mph: null as number | null, direction: null as string | null, multiplier: 1 };
  const m = wind.match(/(\d+(?:\.\d+)?)\s*mph/i); const mph = m ? Number(m[1]) : null; const lower = wind.toLowerCase(); let sign = 0;
  if (lower.includes('out to') || lower.includes('blowing out')) sign = 1; else if (lower.includes('in from') || lower.includes('blowing in')) sign = -1;
  const amt = mph === null ? 0 : Math.min(0.08, mph * 0.005); return { mph, direction: wind, multiplier: 1 + sign * amt };
}
function weatherFactor(weather: HrWeatherSnapshot) {
  const tempAdj = weather.tempF === null ? 0 : Math.max(-0.06, Math.min(0.06, (weather.tempF - 72) * 0.0025));
  const w = parseWind(weather.windDirection); const actualMph = weather.windMph ?? w.mph;
  return { factor: Math.max(0.86, Math.min(1.15, (1 + tempAdj) * w.multiplier)), windMph: actualMph, direction: weather.windDirection };
}
function expectedPlateAppearances(order: number | null): number { if (order === null) return 4.15; return [4.65,4.55,4.45,4.35,4.25,4.15,4.05,3.95,3.85][Math.max(0, Math.min(8, order - 1))] ?? 4.15; }
function smoothedRate(events: number, opps: number, prior: number, weight: number) { return (Math.max(0, events) + prior * weight) / (Math.max(0, opps) + weight); }
function pct(v: number) { return `${(v * 100).toFixed(1)}%`; }
function factorText(label: string, factor: number) { const d = (factor - 1) * 100; return `${label} ${d >= 0 ? '+' : ''}${d.toFixed(1)}%`; }

function buildCandidate(args: { game: ScheduleGame; player: PlayerInput; team: string; opponent: string; pitcher?: PitcherRef; hitter?: StatLine; recent?: StatLine; pitcherStat?: StatLine; venue: string | null; weather: HrWeatherSnapshot }): MlbHomeRunCandidate | null {
  const { game, player, team, opponent, pitcher, hitter, recent, pitcherStat, venue, weather } = args; if (!hitter || hitter.plateAppearances < 35) return null;
  const seasonRate = smoothedRate(hitter.homeRuns, hitter.plateAppearances, LEAGUE_HR_PER_PA, 90);
  const recentRate = recent && recent.plateAppearances >= 12 ? smoothedRate(recent.homeRuns, recent.plateAppearances, seasonRate, 35) : seasonRate;
  const hitterFactor = Math.max(0.55, Math.min(2.3, (seasonRate * 0.82 + recentRate * 0.18) / LEAGUE_HR_PER_PA));
  const pitcherRate = pitcherStat && pitcherStat.battersFaced >= 40 ? smoothedRate(pitcherStat.homeRuns, pitcherStat.battersFaced, LEAGUE_HR_PER_PA, 160) : LEAGUE_HR_PER_PA;
  const pitcherFactor = Math.max(0.75, Math.min(1.45, pitcherRate / LEAGUE_HR_PER_PA));
  const park = parkFactor(venue), wf = weatherFactor(weather), pa = expectedPlateAppearances(player.order);
  const perPa = Math.max(0.008, Math.min(0.12, LEAGUE_HR_PER_PA * hitterFactor * Math.sqrt(pitcherFactor) * park * wf.factor));
  const probability = Math.max(0.03, Math.min(0.45, 1 - Math.pow(1 - perPa, pa)));
  let confidence = player.lineupConfirmed ? 58 : 48; confidence += Math.min(14, hitter.plateAppearances / 45); if (recent && recent.plateAppearances >= 20) confidence += 5; if (pitcherStat && pitcherStat.battersFaced >= 150) confidence += 7; if (weather.source !== 'unavailable') confidence += 3; confidence = Math.round(Math.max(player.lineupConfirmed ? 55 : 48, Math.min(player.lineupConfirmed ? 92 : 76, confidence)));
  const tier: MlbHomeRunCandidate['tier'] = player.lineupConfirmed
    ? (probability >= 0.24 && confidence >= 78 ? 'POWER_PLAY' : probability >= 0.19 && confidence >= 70 ? 'STRONG' : 'WATCH')
    : (probability >= 0.20 && confidence >= 74 ? 'STRONG' : 'WATCH');
  const sourceText = player.lineupConfirmed ? `Official MLB ${player.source === 'boxscore' ? 'boxscore' : 'live feed'} batting order confirmed` : 'Official MLB pregame player pool';
  const factors = [
    `Season HR rate ${hitter.homeRuns}/${hitter.plateAppearances} PA (${pct(hitter.homeRuns / Math.max(1, hitter.plateAppearances))})`,
    recent && recent.plateAppearances >= 12 ? `Recent 14-day HR rate ${recent.homeRuns}/${recent.plateAppearances} PA (${pct(recent.homeRuns / Math.max(1, recent.plateAppearances))})` : 'Recent sample too small; season baseline carries more weight',
    pitcherStat && pitcherStat.battersFaced >= 40 ? `Probable pitcher HR allowed ${pitcherStat.homeRuns}/${pitcherStat.battersFaced} BF (${pct(pitcherStat.homeRuns / Math.max(1, pitcherStat.battersFaced))})` : 'Probable pitcher HR sample unavailable; league-average pitcher prior used',
    player.lineupConfirmed && player.order !== null ? `${sourceText} · batting #${player.order} · projected ${pa.toFixed(2)} PA` : `Pregame watchlist · neutral ${pa.toFixed(2)} PA assumption until order posts`,
    factorText('Park carry', park), factorText('Weather carry', wf.factor),
    weather.source === 'Open-Meteo' ? 'Game-time weather forecast filled from Open-Meteo because MLB pregame weather was incomplete' : weather.source === 'MLB' ? 'Official MLB game weather available' : 'Game weather unavailable; neutral weather assumption used',
  ];
  return {
    gamePk: game.gamePk, gameTime: game.gameDate, playerId: player.id, player: player.name, team, opponent,
    headshot: `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_100/v1/people/${player.id}/headshot/67/current`, battingOrder: player.order,
    lineupConfirmed: player.lineupConfirmed, probablePitcher: pitcher?.fullName ?? null, venue,
    probability: Math.round(probability * 1000) / 10, confidence, tier,
    season: { plateAppearances: hitter.plateAppearances, homeRuns: hitter.homeRuns, homeRunRate: Math.round((hitter.homeRuns / Math.max(1, hitter.plateAppearances)) * 1000) / 10, slugging: hitter.slugging, ops: hitter.ops },
    recent: { plateAppearances: recent?.plateAppearances ?? 0, homeRuns: recent?.homeRuns ?? 0, homeRunRate: recent && recent.plateAppearances > 0 ? Math.round((recent.homeRuns / recent.plateAppearances) * 1000) / 10 : null },
    pitcher: { battersFaced: pitcherStat?.battersFaced ?? 0, homeRunsAllowed: pitcherStat?.homeRuns ?? 0, homeRunRateAllowed: pitcherStat && pitcherStat.battersFaced > 0 ? Math.round((pitcherStat.homeRuns / pitcherStat.battersFaced) * 1000) / 10 : null },
    environment: { parkFactor: Math.round(park * 1000) / 1000, temperatureF: weather.tempF, windMph: wf.windMph, windDirection: wf.direction, windDegrees: weather.windDegrees, precipitationProbability: weather.precipitationProbability, condition: weather.condition, weatherSource: weather.source, weatherFactor: Math.round(wf.factor * 1000) / 1000 },
    factors, market: null, homepageEligible: false,
  };
}
function decimalOdds(americanOdds: number): number { return americanOdds > 0 ? 1 + americanOdds / 100 : 1 + 100 / Math.abs(americanOdds); }
function attachMarket(candidate: MlbHomeRunCandidate, market: HomeRunMarket | undefined): MlbHomeRunCandidate {
  if (!market) return candidate; const modelProbability = candidate.probability / 100; const edge = modelProbability - market.consensusImpliedProbability;
  const ev = modelProbability * (decimalOdds(market.bestOdds) - 1) - (1 - modelProbability); const canQualify = market.priceVerified && market.trustedQuoteCount >= 2;
  const valueTier: MlbHomeRunMarket['valueTier'] = canQualify && candidate.lineupConfirmed && candidate.confidence >= 72 && edge >= 0.04 && ev >= 0.12 ? 'BEST_VALUE' : canQualify && candidate.lineupConfirmed && candidate.confidence >= 68 && edge >= 0.025 && ev >= 0.05 ? 'VALUE' : 'NONE';
  return { ...candidate, market: { source: 'PropLine', bestOdds: market.bestOdds, bestBook: market.bestBook, impliedProbability: Math.round(market.impliedProbability * 1000) / 10, consensusImpliedProbability: Math.round(market.consensusImpliedProbability * 1000) / 10, quoteCount: market.quoteCount, trustedQuoteCount: market.trustedQuoteCount, outlierQuoteCount: market.outlierQuoteCount, priceVerified: market.priceVerified, modelEdge: Math.round(edge * 1000) / 10, expectedValue: Math.round(ev * 1000) / 10, valueTier, quotes: market.quotes, capturedAt: market.capturedAt }, homepageEligible: valueTier !== 'NONE' };
}
function cacheTtl(games: ScheduleGame[]): number {
  const now = Date.now(); const near = games.some(g => { const t = new Date(g.gameDate).getTime(); return Number.isFinite(t) && t >= now - 30 * 60_000 && t <= now + 4 * 60 * 60_000; });
  return near ? NEAR_GAME_CACHE_TTL_MS : DEFAULT_CACHE_TTL_MS;
}

async function fetchHomeRunData(date: string): Promise<MlbHomeRunResponse> {
  const cached = cache.get(date); if (cached && cached.expiresAt > Date.now()) return cached.value;
  const season = Number(date.slice(0, 4)); const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 14); const recentStart = d.toISOString().slice(0, 10);
  const schedule = await fetchJson<ScheduleResponse>(`${MLB_BASE}/schedule?sportId=1&date=${date}&hydrate=team,venue,probablePitcher`); const games = schedule.dates?.flatMap(day => day.games ?? []) ?? [];
  const marketGames = games.map(game => ({ gamePk: game.gamePk, gameTime: game.gameDate, awayName: game.teams?.away?.team?.name ?? '', homeName: game.teams?.home?.team?.name ?? '' }));
  const [hitting, pitching, recentHitting, gameSources, marketFeed] = await Promise.all([
    fetchStats(season, 'hitting'), fetchStats(season, 'pitching'), fetchStats(season, 'hitting', 'byDateRange', recentStart, date).catch(() => new Map<number, StatLine>()),
    Promise.all(games.map(async game => {
      const [feed, boxscore] = await Promise.all([fetchJson<FeedResponse>(`${MLB_BASE}/game/${game.gamePk}/feed/live`, 6500).catch(() => null), fetchJson<BoxscoreResponse>(`${MLB_BASE}/game/${game.gamePk}/boxscore`, 6500).catch(() => null)]);
      const venue = feed?.gameData?.venue?.name ?? game.venue?.name ?? null;
      const weather = await fetchGameHrWeather(game.gameDate, venue, feed?.gameData?.weather ?? null);
      return { game, feed, boxscore, weather };
    })),
    fetchHomeRunMarkets(marketGames),
  ]);

  const rawCandidates: MlbHomeRunCandidate[] = []; let gamesWithConfirmedLineups = 0, teamsWithConfirmedLineups = 0, feedConfirmedTeams = 0, boxscoreConfirmedTeams = 0, fallbackTeams = 0;
  for (const { game, feed, boxscore, weather } of gameSources) {
    const away = game.teams?.away, home = game.teams?.home; const awayAbbr = away?.team?.abbreviation ?? away?.team?.name ?? 'AWAY', homeAbbr = home?.team?.abbreviation ?? home?.team?.name ?? 'HOME';
    const venue = feed?.gameData?.venue?.name ?? game.venue?.name ?? null;
    const feedAway = feed?.liveData?.boxscore?.teams?.away, feedHome = feed?.liveData?.boxscore?.teams?.home, boxAway = boxscore?.teams?.away, boxHome = boxscore?.teams?.home;
    const awayFeedLineup = parseLineup(feedAway, 'feed'), homeFeedLineup = parseLineup(feedHome, 'feed');
    const awayBoxLineup = awayFeedLineup.length ? [] : parseLineup(boxAway, 'boxscore'), homeBoxLineup = homeFeedLineup.length ? [] : parseLineup(boxHome, 'boxscore');
    const awayConfirmed = awayFeedLineup.length ? awayFeedLineup : awayBoxLineup, homeConfirmed = homeFeedLineup.length ? homeFeedLineup : homeBoxLineup;
    if (awayFeedLineup.length) feedConfirmedTeams++; if (homeFeedLineup.length) feedConfirmedTeams++; if (awayBoxLineup.length) boxscoreConfirmedTeams++; if (homeBoxLineup.length) boxscoreConfirmedTeams++;
    if (awayConfirmed.length) teamsWithConfirmedLineups++; if (homeConfirmed.length) teamsWithConfirmedLineups++; if (awayConfirmed.length && homeConfirmed.length) gamesWithConfirmedLineups++;
    const awayPool = awayConfirmed.length ? [] : (parseFeedHitters(feedAway).length ? parseFeedHitters(feedAway) : parseFeedHitters(boxAway));
    const homePool = homeConfirmed.length ? [] : (parseFeedHitters(feedHome).length ? parseFeedHitters(feedHome) : parseFeedHitters(boxHome));
    const [awayRoster, homeRoster] = await Promise.all([awayConfirmed.length || awayPool.length ? Promise.resolve([] as PlayerInput[]) : fetchActiveHitters(away?.team?.id, date), homeConfirmed.length || homePool.length ? Promise.resolve([] as PlayerInput[]) : fetchActiveHitters(home?.team?.id, date)]);
    if (!awayConfirmed.length) fallbackTeams++; if (!homeConfirmed.length) fallbackTeams++;
    const awayPlayers = awayConfirmed.length ? awayConfirmed : awayPool.length ? awayPool : awayRoster; const homePlayers = homeConfirmed.length ? homeConfirmed : homePool.length ? homePool : homeRoster;
    for (const p of awayPlayers) { const c = buildCandidate({ game, player: p, team: awayAbbr, opponent: homeAbbr, pitcher: home?.probablePitcher, hitter: hitting.get(p.id), recent: recentHitting.get(p.id), pitcherStat: home?.probablePitcher?.id ? pitching.get(home.probablePitcher.id) : undefined, venue, weather }); if (c) rawCandidates.push(c); }
    for (const p of homePlayers) { const c = buildCandidate({ game, player: p, team: homeAbbr, opponent: awayAbbr, pitcher: away?.probablePitcher, hitter: hitting.get(p.id), recent: recentHitting.get(p.id), pitcherStat: away?.probablePitcher?.id ? pitching.get(away.probablePitcher.id) : undefined, venue, weather }); if (c) rawCandidates.push(c); }
  }

  const candidates = rawCandidates.map(candidate => attachMarket(candidate, marketFeed.markets.get(candidate.gamePk)?.get(normalizeHomeRunPlayer(candidate.player)))); candidates.sort((a,b) => b.probability - a.probability || b.confidence - a.confidence);
  const strongest = candidates.filter(c => c.tier !== 'WATCH').slice(0,10);
  const valuePlays = candidates.filter(c => c.market?.valueTier !== 'NONE' && c.lineupConfirmed).sort((a,b) => (b.market?.expectedValue ?? -999) - (a.market?.expectedValue ?? -999) || (b.market?.modelEdge ?? -999) - (a.market?.modelEdge ?? -999)).slice(0,12);
  const watchlist = candidates.filter(c => !c.lineupConfirmed).slice(0,12);
  console.log(`[MLB Home Runs] ${date}: games=${games.length}, candidates=${candidates.length}, strongest=${strongest.length}, value=${valuePlays.length}, priced=${marketFeed.playersPriced}, marketGames=${marketFeed.gamesMatched}, confirmedTeams=${teamsWithConfirmedLineups}, feedConfirmed=${feedConfirmedTeams}, boxscoreConfirmed=${boxscoreConfirmedTeams}, fallbackTeams=${fallbackTeams}`);
  const value: MlbHomeRunResponse = { date, modelVersion: 'hr-v2-value', updatedAt: new Date().toISOString(), candidates, strongest, valuePlays, watchlist, gamesWithConfirmedLineups, teamsWithConfirmedLineups, totalGames: games.length, marketStatus: marketFeed.status, marketGamesMatched: marketFeed.gamesMatched, marketPlayersPriced: marketFeed.playersPriced, homepageReady: valuePlays.length > 0, methodology: 'PreziTools estimates home-run probability independently from official MLB season/recent hitting, probable-pitcher HR allowance, park carry, game-time weather and plate-appearance opportunity. MLB weather is preferred; Open-Meteo fills missing pregame temperature, wind, precipitation and conditions. PropLine supplies the separate sportsbook market layer.', note: marketFeed.status === 'available' ? (valuePlays.length ? `${valuePlays.length} confirmed-lineup HR value play${valuePlays.length === 1 ? '' : 's'} currently clear the verified multi-book price thresholds.` : 'PropLine HR prices are connected, but no confirmed hitter currently clears the verified multi-book value thresholds. Most-likely HR rankings remain available separately.') : marketFeed.status === 'disabled' ? 'PropLine is not enabled on this server. Add PROPLINE_API_KEY to enable price-aware HR value.' : 'PropLine is connected but live HR prices are temporarily unavailable. The independent baseball probability model remains available without inventing market value.' };
  cache.set(date, { expiresAt: Date.now() + cacheTtl(games), value }); return value;
}

export function registerMlbHomeRunRoutes(app: Express): void {
  app.get('/api/mlb/home-runs', async (req, res) => {
    try { const requested = typeof req.query.date === 'string' ? req.query.date.trim() : ''; if (requested && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) return res.status(400).json({ error: 'date must use YYYY-MM-DD format' }); const data = await fetchHomeRunData(requested || etDateISO()); res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60'); return res.json(data); }
    catch (error) { console.error('[MLB Home Runs] Error:', error); return res.status(502).json({ error: 'Unable to load MLB home-run model data' }); }
  });
}
