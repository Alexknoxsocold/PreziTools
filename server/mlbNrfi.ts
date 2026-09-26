import { calibrateRecommendedProbability } from "./mlbCalibration.js";
import { predictNrfiV4, type V4Prediction } from "./mlbNrfiV4.js";
import { recordNrfiShadowPrediction } from "./mlbNrfiShadowStore.js";
import { fetchFirstInningMarkets } from "./mlbFirstInningMarkets.js";

type EspnEvent = {
  id: string;
  date?: string;
  shortName?: string;
  competitions?: EspnCompetition[];
};

type EspnCompetition = {
  venue?: { fullName?: string; indoor?: boolean };
  status?: { type?: { state?: string; completed?: boolean; detail?: string } };
  competitors?: EspnCompetitor[];
};

type EspnCompetitor = {
  homeAway?: "home" | "away";
  team?: { id?: string; abbreviation?: string; displayName?: string; shortDisplayName?: string; logos?: { href?: string }[] };
  score?: string | number;
  linescores?: { period?: number; value?: number }[];
  probables?: {
    name?: string;
    athlete?: { id?: string; fullName?: string; displayName?: string; headshot?: string };
    statistics?: { name?: string; displayValue?: string }[];
  }[];
};

type TeamForm = {
  games: number;
  scorelessPct: number;
  runsPerFirstInning: number;
  allowedPerFirstInning: number;
  allowedScorelessPct: number;
};

export type NrfiPitcher = {
  name: string | null;
  era: number | null;
  whip: number | null;
  headshot: string | null;
  source?: "ESPN" | "MLB" | "pending";
};

export type NrfiMarketValue = {
  available: boolean;
  valuePlay?: boolean;
  book: string | null;
  selection: "NRFI" | "YRFI" | null;
  price: number | null;
  impliedProbability: number | null;
  noVigProbability: number | null;
  edge: number | null;
  ev: number | null;
  updatedAt: string | null;
  quotes?: Array<{
    bookmaker: string;
    bookmakerKey: string;
    americanOdds: number;
    updatedAt: string | null;
  }>;
  quoteCount?: number;
};

export type NrfiGame = {
  id: string;
  /** ESPN's authoritative scheduled/actual first-pitch timestamp. */
  date: string;
  /** Explicit alias used by the prediction ledger and integrity layer. */
  gameStartAt: string;
  shortName: string;
  away: { abbreviation: string; name: string; logo: string | null; pitcher: NrfiPitcher };
  home: { abbreviation: string; name: string; logo: string | null; pitcher: NrfiPitcher };
  venue: string | null;
  status: string;
  nrfiProbability: number;
  recommendation: "NRFI" | "YRFI";
  playStatus: "BEST_PLAY" | "PLAY" | "LEAN" | "NO_PLAY";
  modelEdge: number;
  confidence: "High" | "Medium" | "Low";
  sampleSize: number;
  factors: string[];
  outcome: "won" | "lost" | "pending";
  firstInningScore: string | null;
  v4Shadow?: V4Prediction;
  marketValue?: NrfiMarketValue | null;
};

export type NrfiResponse = {
  date: string;
  games: NrfiGame[];
  averageNrfiProbability: number | null;
  topPick: NrfiGame | null;
  updatedAt: string;
  source: string;
  methodology: string;
  marketStatus?: "live" | "unavailable";
};

export type NrfiWindowResponse = {
  startDate: string;
  endDate: string;
  days: NrfiResponse[];
  games: NrfiGame[];
  averageNrfiProbability: number | null;
  topPick: NrfiGame | null;
  updatedAt: string;
};

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb";
const MLB_BASE = "https://statsapi.mlb.com/api/v1";
const CACHE_TTL = 5 * 60 * 1000;
const STALE_TTL = 2 * 60 * 60 * 1000;
const WINDOW_CACHE_TTL = 5 * 60 * 1000;
const HISTORY_CACHE_TTL = 30 * 60 * 1000;
const PITCHER_CACHE_TTL = 6 * 60 * 60 * 1000;
const HISTORY_DAYS = 30;
const HISTORY_GAMES = 15;
const PRIOR_WEIGHT = 7;
const RECENCY_DECAY = 0.92;
const BEST_PLAY_EDGE = 0.10;
const PLAY_EDGE = 0.06;
const LEAN_EDGE = 0.03;
const MIN_LEAN_SAMPLE = 3;
const MIN_PLAY_SAMPLE = 4;

let cachedResponse: NrfiResponse | null = null;
let cachedDate: string | null = null;
let cachedAt = 0;
const refreshInFlight = new Map<string, Promise<NrfiResponse>>();
const dailyScoreboardCache = new Map<string, { events: EspnEvent[]; expiresAt: number }>();
const historyInFlight = new Map<string, Promise<EspnEvent[]>>();
const teamFormCache = new Map<string, { value: TeamForm; expiresAt: number }>();
const pitcherCache = new Map<string, { value: { era: number | null; whip: number | null }; expiresAt: number }>();
let cachedWindow: NrfiWindowResponse | null = null;
let cachedWindowStart: string | null = null;
let cachedWindowDays = 0;
let cachedWindowAt = 0;
let windowRefreshInFlight: Promise<NrfiWindowResponse> | null = null;

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "First-Basket-Pro/1.0" } });
    if (!response.ok) throw new Error(`Remote API returned ${response.status}`);
    return (await response.json()) as T;
  } finally { clearTimeout(timer); }
}

function getTodayET(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}-${parts.find(p => p.type === "day")?.value}`;
}
function addDays(dateISO: string, days: number): string { const d = new Date(`${dateISO}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function getFirstInningRuns(competitor: EspnCompetitor): number | null { const first = competitor.linescores?.find(line => line.period === 1); return typeof first?.value === "number" ? first.value : null; }
function parsePitcherStat(probable: NonNullable<EspnCompetitor["probables"]>[number] | undefined, name: string): number | null { const text = probable?.statistics?.find(stat => stat.name?.toUpperCase() === name)?.displayValue; if (!text) return null; const value = Number.parseFloat(text); return Number.isFinite(value) ? value : null; }

async function fetchMlbPitcherStats(name: string): Promise<{ era: number | null; whip: number | null }> {
  const key = name.trim().toLowerCase(); if (!key) return { era: null, whip: null };
  const cached = pitcherCache.get(key); if (cached && cached.expiresAt > Date.now()) return cached.value;
  const empty = { era: null, whip: null };
  try {
    const search = await fetchJson<{ people?: { id?: number; fullName?: string }[] }>(`${MLB_BASE}/people/search?names=${encodeURIComponent(name)}&active=true&sportIds=1`, 5000);
    const candidates = search.people ?? []; const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = candidates.find(p => (p.fullName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") === normalized) ?? candidates[0];
    if (!match?.id) { pitcherCache.set(key, { value: empty, expiresAt: Date.now() + PITCHER_CACHE_TTL }); return empty; }
    const season = new Date().getUTCFullYear();
    const stats = await fetchJson<{ stats?: { splits?: { stat?: { era?: string | number; whip?: string | number } }[] }[] }>(`${MLB_BASE}/people/${match.id}/stats?stats=season&group=pitching&season=${season}`, 5000);
    const stat = stats.stats?.[0]?.splits?.[0]?.stat; const era = stat?.era !== undefined ? Number(stat.era) : null; const whip = stat?.whip !== undefined ? Number(stat.whip) : null;
    const value = { era: Number.isFinite(era as number) ? era : null, whip: Number.isFinite(whip as number) ? whip : null };
    pitcherCache.set(key, { value, expiresAt: Date.now() + PITCHER_CACHE_TTL }); return value;
  } catch { pitcherCache.set(key, { value: empty, expiresAt: Date.now() + 15 * 60 * 1000 }); return empty; }
}

async function getPitcher(competitor: EspnCompetitor): Promise<NrfiPitcher> {
  const probable = competitor.probables?.find(item => item.name === "probableStartingPitcher") ?? competitor.probables?.[0];
  const name = probable?.athlete?.displayName ?? probable?.athlete?.fullName ?? null;
  let era = parsePitcherStat(probable, "ERA"); let whip = parsePitcherStat(probable, "WHIP"); let source: NrfiPitcher["source"] = era !== null || whip !== null ? "ESPN" : "pending";
  if (name && (era === null || whip === null)) { const fallback = await fetchMlbPitcherStats(name); if (era === null) era = fallback.era; if (whip === null) whip = fallback.whip; if (era !== null || whip !== null) source = "MLB"; }
  return { name, era, whip, headshot: probable?.athlete?.headshot ?? null, source: era !== null || whip !== null ? source : "pending" };
}

function getOutcome(recommendation: "NRFI" | "YRFI", competition: EspnCompetition): Pick<NrfiGame, "outcome" | "firstInningScore"> {
  const competitors = competition.competitors ?? []; const away = competitors.find(c => c.homeAway === "away"); const home = competitors.find(c => c.homeAway === "home");
  const awayRuns = away ? getFirstInningRuns(away) : null; const homeRuns = home ? getFirstInningRuns(home) : null; const firstInningScore = awayRuns !== null && homeRuns !== null ? `${awayRuns}-${homeRuns}` : null; const state = competition.status?.type?.state;
  if (!(state === "post" || (awayRuns !== null && homeRuns !== null && state !== "pre")) || awayRuns === null || homeRuns === null) return { outcome: "pending", firstInningScore };
  const wasNrfi = awayRuns === 0 && homeRuns === 0; return { outcome: recommendation === (wasNrfi ? "NRFI" : "YRFI") ? "won" : "lost", firstInningScore };
}

async function withConcurrency<T, R>(values: T[], worker: (value: T) => Promise<R>, limit = 6): Promise<R[]> { if (!values.length) return []; const results: R[] = new Array(values.length); let next = 0; async function run() { while (next < values.length) { const index = next++; results[index] = await worker(values[index]); } } await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => run())); return results; }

async function fetchDailyScoreboard(date: string): Promise<EspnEvent[]> {
  const cached = dailyScoreboardCache.get(date); if (cached && cached.expiresAt > Date.now()) return cached.events; const key = `day:${date}`; const existing = historyInFlight.get(key); if (existing) return existing;
  const request = (async () => { try { const data = await fetchJson<{ events?: EspnEvent[] }>(`${ESPN_BASE}/scoreboard?dates=${date.replace(/-/g, "")}`); const events = data.events ?? []; dailyScoreboardCache.set(date, { events, expiresAt: Date.now() + HISTORY_CACHE_TTL }); return events; } catch { return []; } finally { historyInFlight.delete(key); } })();
  historyInFlight.set(key, request); return request;
}
async function fetchRecentHistory(beforeDate: string): Promise<EspnEvent[]> { const key = `history:${beforeDate}`; const existing = historyInFlight.get(key); if (existing) return existing; const request = (async () => { const dates = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(beforeDate, -(i + 1))); const batches = await withConcurrency(dates, date => fetchDailyScoreboard(date), 8); return batches.flat(); })(); historyInFlight.set(key, request); try { return await request; } finally { historyInFlight.delete(key); } }

function calculateLeagueBaseline(allRecentGames: EspnEvent[]) {
  let completedGames = 0, nrfiGames = 0, totalWeight = 0, weightedRuns = 0, weightedScoreless = 0;
  const completed = allRecentGames.map(event => ({ event, competition: event.competitions?.[0] })).filter(item => { const state = item.competition?.status?.type?.state; return state === "post" || item.competition?.status?.type?.completed === true; }).sort((a, b) => (b.event.date ?? "").localeCompare(a.event.date ?? ""));
  for (const [index, item] of completed.entries()) { const competitors = item.competition?.competitors ?? []; const away = competitors.find(c => c.homeAway === "away"); const home = competitors.find(c => c.homeAway === "home"); const awayRuns = away ? getFirstInningRuns(away) : null; const homeRuns = home ? getFirstInningRuns(home) : null; const weight = Math.pow(RECENCY_DECAY, index); if (awayRuns !== null && homeRuns !== null) { completedGames++; if (awayRuns === 0 && homeRuns === 0) nrfiGames++; weightedRuns += (awayRuns + homeRuns) / 2 * weight; weightedScoreless += ((awayRuns === 0 ? 1 : 0) + (homeRuns === 0 ? 1 : 0)) / 2 * weight; totalWeight += weight; } }
  if (!totalWeight) return { games: 0, runsPerInning: 0.50, scorelessPct: 0.60, gameNrfiPct: 0.49 };
  return { games: completedGames, runsPerInning: clamp(weightedRuns / totalWeight, 0.20, 1.20), scorelessPct: clamp(weightedScoreless / totalWeight, 0.40, 0.80), gameNrfiPct: clamp(completedGames ? nrfiGames / completedGames : 0.49, 0.35, 0.65) };
}

function calculateTeamForm(teamId: string, allRecentGames: EspnEvent[]): TeamForm {
  const league = calculateLeagueBaseline(allRecentGames); const fallback: TeamForm = { games: 0, scorelessPct: league.scorelessPct, runsPerFirstInning: league.runsPerInning, allowedPerFirstInning: league.runsPerInning, allowedScorelessPct: league.scorelessPct };
  const teamGames = allRecentGames.filter(event => { const competition = event.competitions?.[0]; const state = competition?.status?.type?.state; return (state === "post" || competition?.status?.type?.completed === true) && competition?.competitors?.some(c => c.team?.id === teamId); }).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, HISTORY_GAMES);
  const valid: { teamRuns: number; opponentRuns: number }[] = [];
  for (const event of teamGames) { const competitors = event.competitions?.[0]?.competitors ?? []; const away = competitors.find(c => c.homeAway === "away"); const home = competitors.find(c => c.homeAway === "home"); if (!away?.team?.id || !home?.team?.id) continue; const awayRuns = getFirstInningRuns(away); const homeRuns = getFirstInningRuns(home); if (awayRuns === null || homeRuns === null) continue; const teamIsAway = away.team.id === teamId; valid.push({ teamRuns: teamIsAway ? awayRuns : homeRuns, opponentRuns: teamIsAway ? homeRuns : awayRuns }); }
  if (!valid.length) return fallback;
  let weightTotal = 0, weightedScored = 0, weightedAllowed = 0, weightedScoreless = 0, weightedAllowedScoreless = 0;
  valid.forEach((x, index) => { const weight = Math.pow(RECENCY_DECAY, index); weightTotal += weight; weightedScored += x.teamRuns * weight; weightedAllowed += x.opponentRuns * weight; weightedScoreless += (x.teamRuns === 0 ? 1 : 0) * weight; weightedAllowedScoreless += (x.opponentRuns === 0 ? 1 : 0) * weight; });
  return { games: valid.length, scorelessPct: (weightedScoreless + league.scorelessPct * PRIOR_WEIGHT) / (weightTotal + PRIOR_WEIGHT), runsPerFirstInning: (weightedScored + league.runsPerInning * PRIOR_WEIGHT) / (weightTotal + PRIOR_WEIGHT), allowedPerFirstInning: (weightedAllowed + league.runsPerInning * PRIOR_WEIGHT) / (weightTotal + PRIOR_WEIGHT), allowedScorelessPct: (weightedAllowedScoreless + league.scorelessPct * PRIOR_WEIGHT) / (weightTotal + PRIOR_WEIGHT) };
}

async function fetchTeamForm(teamId: string, beforeDate: string, sharedHistory: EspnEvent[]): Promise<TeamForm> { const cacheKey = `${teamId}:${beforeDate}`; const cached = teamFormCache.get(cacheKey); if (cached && cached.expiresAt > Date.now()) return cached.value; const value = calculateTeamForm(teamId, sharedHistory); teamFormCache.set(cacheKey, { value, expiresAt: Date.now() + HISTORY_CACHE_TTL }); return value; }
function pitcherRunAdjustment(pitcher: NrfiPitcher): number { const eraAdjustment = pitcher.era === null ? 1 : clamp(0.88 + (pitcher.era / 4.25) * 0.12, 0.88, 1.15); const whipAdjustment = pitcher.whip === null ? 1 : clamp(0.93 + (pitcher.whip / 1.30) * 0.07, 0.93, 1.10); return 0.58 * eraAdjustment + 0.42 * whipAdjustment; }
function poissonNoRunProbability(expectedRuns: number): number { return Math.exp(-Math.max(0.01, expectedRuns)); }
function classifyPlay(nrfiProbability: number, confidence: "High" | "Medium" | "Low", sampleSize: number): NrfiGame["playStatus"] { const edge = Math.abs(nrfiProbability / 100 - 0.50); if (sampleSize < MIN_LEAN_SAMPLE) return "NO_PLAY"; if (edge >= BEST_PLAY_EDGE && confidence === "High") return "BEST_PLAY"; if (edge >= PLAY_EDGE && confidence !== "Low" && sampleSize >= MIN_PLAY_SAMPLE) return "PLAY"; if (edge >= LEAN_EDGE) return "LEAN"; return "NO_PLAY"; }

async function buildPrediction(awayForm: TeamForm, homeForm: TeamForm, awayPitcher: NrfiPitcher, homePitcher: NrfiPitcher, homeIndoor: boolean, leagueNrfiProbability: number): Promise<Pick<NrfiGame, "nrfiProbability" | "recommendation" | "playStatus" | "modelEdge" | "confidence" | "sampleSize" | "factors">> {
  const awayLambdaMean = ((awayForm.runsPerFirstInning + homeForm.allowedPerFirstInning) / 2) * pitcherRunAdjustment(homePitcher);
  const homeLambdaMean = ((homeForm.runsPerFirstInning + awayForm.allowedPerFirstInning) / 2) * pitcherRunAdjustment(awayPitcher);
  const awayLambdaBinary = -Math.log(clamp((awayForm.scorelessPct + homeForm.allowedScorelessPct) / 2, 0.25, 0.90));
  const homeLambdaBinary = -Math.log(clamp((homeForm.scorelessPct + awayForm.allowedScorelessPct) / 2, 0.25, 0.90));
  const expectedRuns = Math.max(0.05, (0.65 * awayLambdaMean + 0.35 * awayLambdaBinary + 0.65 * homeLambdaMean + 0.35 * homeLambdaBinary) * (homeIndoor ? 0.98 : 1));
  const poissonNrfi = poissonNoRunProbability(expectedRuns);
  const matchupEmpiricalNrfi = clamp(((awayForm.scorelessPct + homeForm.allowedScorelessPct) / 2) * ((homeForm.scorelessPct + awayForm.allowedScorelessPct) / 2), 0.25, 0.75);
  const calibratedPoisson = 0.60 * poissonNrfi + 0.40 * leagueNrfiProbability;
  const rawProbability = 0.30 * leagueNrfiProbability + 0.40 * matchupEmpiricalNrfi + 0.30 * calibratedPoisson;
  const calibratedProbability = await calibrateRecommendedProbability(rawProbability);
  const nrfiProbability = Math.round(clamp(calibratedProbability * 100, 25, 75) * 10) / 10;
  const recommendation = nrfiProbability >= 50 ? "NRFI" : "YRFI";
  const sampleSize = Math.min(awayForm.games, homeForm.games);
  const pitcherMetricsKnown = awayPitcher.era !== null || awayPitcher.whip !== null || homePitcher.era !== null || homePitcher.whip !== null;
  const bothPitcherMetricsKnown = awayPitcher.era !== null && awayPitcher.whip !== null && homePitcher.era !== null && homePitcher.whip !== null;
  const confidence: NrfiGame["confidence"] = sampleSize >= 10 && bothPitcherMetricsKnown ? "High" : sampleSize >= 5 && pitcherMetricsKnown ? "Medium" : "Low";
  const modelEdge = Math.round(Math.abs(nrfiProbability - 50) * 10) / 10;
  const playStatus = classifyPlay(nrfiProbability, confidence, sampleSize);
  const factors: string[] = [];
  if (playStatus === "BEST_PLAY") factors.push(`Best model separation: ${recommendation} at ${recommendation === "NRFI" ? nrfiProbability : 100 - nrfiProbability}%`); else if (playStatus === "PLAY") factors.push(`Qualifying model edge: ${recommendation} at ${recommendation === "NRFI" ? nrfiProbability : 100 - nrfiProbability}%`); else if (playStatus === "LEAN") factors.push(`Model lean: ${recommendation} at ${recommendation === "NRFI" ? nrfiProbability : 100 - nrfiProbability}% with ${modelEdge}% separation from 50/50`);
  if (awayPitcher.era !== null || homePitcher.era !== null) factors.push(`Probable starter ERAs included (${awayPitcher.era !== null ? awayPitcher.era.toFixed(2) : "pending"} and ${homePitcher.era !== null ? homePitcher.era.toFixed(2) : "pending"})`); else factors.push("Probable starter ERAs are unconfirmed");
  if (awayPitcher.whip !== null || homePitcher.whip !== null) factors.push(`WHIP signal included (${awayPitcher.whip !== null ? awayPitcher.whip.toFixed(2) : "pending"} and ${homePitcher.whip !== null ? homePitcher.whip.toFixed(2) : "pending"})`); else factors.push("Probable starter WHIPs are unconfirmed");
  if (awayPitcher.source === "MLB" || homePitcher.source === "MLB") factors.push("Missing ESPN pitcher metrics filled from MLB Stats API");
  factors.push(`Recent sample: ${sampleSize || "limited"} verified games per team with recency weighting and Bayesian shrinkage`);
  factors.push(`Recent league NRFI baseline: ${Math.round(leagueNrfiProbability * 100)}%`);
  factors.push("Model v3: recency-weighted first-inning rates + Poisson + ESPN/MLB starter ERA/WHIP + league prior + walk-forward calibration");
  return { nrfiProbability, recommendation, playStatus, modelEdge, confidence, sampleSize, factors };
}

async function buildNrfiData(date: string): Promise<NrfiResponse> {
  const scoreboard = await fetchJson<{ events?: EspnEvent[] }>(`${ESPN_BASE}/scoreboard?dates=${date.replace(/-/g, "")}`);
  const rawGames = (scoreboard.events ?? []).map(event => ({ event, competition: event.competitions?.[0] })).filter((item): item is { event: EspnEvent; competition: EspnCompetition } => Boolean(item.competition?.competitors?.length === 2));
  const teamIds = Array.from(new Set(rawGames.flatMap(({ competition }) => competition.competitors?.map(c => c.team?.id).filter((id): id is string => Boolean(id)) ?? [])));
  const sharedHistory = await fetchRecentHistory(date); const leagueBaseline = calculateLeagueBaseline(sharedHistory);
  const forms = await withConcurrency(teamIds, async teamId => [teamId, await fetchTeamForm(teamId, date, sharedHistory)] as const, 12); const formMap = new Map(forms);
  const fallback: TeamForm = { games: 0, scorelessPct: leagueBaseline.scorelessPct, runsPerFirstInning: leagueBaseline.runsPerInning, allowedPerFirstInning: leagueBaseline.runsPerInning, allowedScorelessPct: leagueBaseline.scorelessPct };
  const baseGames = await withConcurrency(rawGames, async ({ event, competition }) => {
    const away = competition.competitors!.find(c => c.homeAway === "away")!; const home = competition.competitors!.find(c => c.homeAway === "home")!;
    const [awayPitcher, homePitcher] = await Promise.all([getPitcher(away), getPitcher(home)]);
    const awayForm = formMap.get(away.team?.id ?? "") ?? fallback; const homeForm = formMap.get(home.team?.id ?? "") ?? fallback;
    const prediction = await buildPrediction(awayForm, homeForm, awayPitcher, homePitcher, competition.venue?.indoor === true, leagueBaseline.gameNrfiPct);
    const sampleSize = Math.min(awayForm.games, homeForm.games);
    const teamNrfiProbability = clamp(((awayForm.scorelessPct + homeForm.allowedScorelessPct) / 2) * ((homeForm.scorelessPct + awayForm.allowedScorelessPct) / 2), 0.25, 0.75);
    const averagePitcherRunAdjustment = (pitcherRunAdjustment(awayPitcher) + pitcherRunAdjustment(homePitcher)) / 2;
    const v4Shadow = predictNrfiV4({ leagueNrfiProbability: leagueBaseline.gameNrfiPct, teamNrfiProbability, pitcherAdjustment: 1 - averagePitcherRunAdjustment, dataQuality: { lineupConfirmed: false, pitcherConfirmed: awayPitcher.name !== null && homePitcher.name !== null, pitcherMetricsComplete: awayPitcher.era !== null && awayPitcher.whip !== null && homePitcher.era !== null && homePitcher.whip !== null, sampleSize, weatherAvailable: competition.venue?.indoor === true } });
    const outcome = getOutcome(prediction.recommendation, competition);
    recordNrfiShadowPrediction({ gameId: event.id, createdAt: new Date().toISOString(), v3Probability: prediction.nrfiProbability / 100, v4: v4Shadow, outcome: outcome.outcome === "pending" ? undefined : outcome.firstInningScore === "0-0" ? "NRFI" : "YRFI" });
    const gameStartAt = event.date ?? `${date}T00:00:00Z`;
    return { id: event.id, date: gameStartAt, gameStartAt, shortName: event.shortName ?? `${away.team?.abbreviation ?? "Away"} @ ${home.team?.abbreviation ?? "Home"}`, away: { abbreviation: away.team?.abbreviation ?? "AWAY", name: away.team?.displayName ?? away.team?.shortDisplayName ?? "Away", logo: away.team?.logos?.[0]?.href ?? null, pitcher: awayPitcher }, home: { abbreviation: home.team?.abbreviation ?? "HOME", name: home.team?.displayName ?? home.team?.shortDisplayName ?? "Home", logo: home.team?.logos?.[0]?.href ?? null, pitcher: homePitcher }, venue: competition.venue?.fullName ?? null, status: competition.status?.type?.detail ?? competition.status?.type?.state ?? "scheduled", ...prediction, ...outcome, v4Shadow, marketValue: null } satisfies NrfiGame;
  }, 8);

  const marketFeed = await fetchFirstInningMarkets(baseGames.map(game => ({ id: game.id, gameTime: game.gameStartAt, awayName: game.away.name, homeName: game.home.name, nrfiProbability: game.nrfiProbability })));
  const games = baseGames.map(game => {
    const side = marketFeed.markets.get(game.id)?.[game.recommendation];
    if (!side) return game;
    return {
      ...game,
      marketValue: {
        available: true,
        book: side.book,
        selection: side.selection,
        price: side.price,
        impliedProbability: side.impliedProbability,
        noVigProbability: side.noVigProbability,
        edge: side.edge,
        ev: side.ev,
        updatedAt: side.capturedAt,
        quotes: side.quotes.map(q => ({ bookmaker: q.bookmaker, bookmakerKey: q.bookmakerKey, americanOdds: q.americanOdds, updatedAt: q.updatedAt })),
        quoteCount: side.quoteCount,
      },
    } satisfies NrfiGame;
  });

  const promoted = games.filter(game => game.playStatus === "BEST_PLAY" || game.playStatus === "PLAY");
  const ranked = [...promoted].sort((a, b) => {
    const aMarket = a.marketValue?.available ? a.marketValue.edge ?? -Infinity : a.modelEdge;
    const bMarket = b.marketValue?.available ? b.marketValue.edge ?? -Infinity : b.modelEdge;
    return bMarket - aMarket || (b.confidence === "High" ? 1 : 0) - (a.confidence === "High" ? 1 : 0);
  });
  const averageNrfiProbability = games.length ? Math.round(games.reduce((sum, g) => sum + g.nrfiProbability, 0) / games.length * 10) / 10 : null;
  return {
    date,
    games,
    averageNrfiProbability,
    topPick: ranked[0] ?? null,
    updatedAt: new Date().toISOString(),
    source: "ESPN MLB scoreboard + MLB Stats API pitcher fallback + verified recent game summaries + PropLine 1st-inning totals",
    methodology: "The baseball model remains independent. PropLine first-inning totals (period i1, total 0.5) are attached as a market layer for no-vig consensus, best price, model edge and EV. Sportsbook prices do not change the model probability or promote a model NO PLAY.",
    marketStatus: marketFeed.status === "live" ? "live" : "unavailable",
  };
}

export async function fetchNrfiData(date = getTodayET()): Promise<NrfiResponse> { const now = Date.now(); if (cachedResponse && cachedDate === date && now - cachedAt < CACHE_TTL) return cachedResponse; const existing = refreshInFlight.get(date); if (existing) return existing; const refresh = (async () => { try { const data = await buildNrfiData(date); cachedResponse = data; cachedDate = date; cachedAt = Date.now(); return data; } catch (error) { if (cachedResponse && cachedDate === date && now - cachedAt < STALE_TTL) return cachedResponse; throw error; } finally { refreshInFlight.delete(date); } })(); refreshInFlight.set(date, refresh); return refresh; }
export async function fetchUpcomingNrfiData(days = 3, startDate = getTodayET()): Promise<NrfiWindowResponse> { const safeDays = Math.min(Math.max(days, 1), 3); if (cachedWindow && cachedWindowStart === startDate && cachedWindowDays === safeDays && Date.now() - cachedWindowAt < WINDOW_CACHE_TTL) return cachedWindow; if (windowRefreshInFlight) return windowRefreshInFlight; windowRefreshInFlight = (async () => { const dates = Array.from({ length: safeDays }, (_, i) => addDays(startDate, i)); const responses = await withConcurrency(dates, date => fetchNrfiData(date), 3); const games = responses.flatMap(r => r.games); const promoted = games.filter(g => g.playStatus === "BEST_PLAY" || g.playStatus === "PLAY"); const topPick = [...promoted].sort((a, b) => b.modelEdge - a.modelEdge)[0] ?? null; const result: NrfiWindowResponse = { startDate, endDate: dates[dates.length - 1], days: responses, games, averageNrfiProbability: games.length ? Math.round(games.reduce((sum, g) => sum + g.nrfiProbability, 0) / games.length * 10) / 10 : null, topPick, updatedAt: new Date().toISOString() }; cachedWindow = result; cachedWindowStart = startDate; cachedWindowDays = safeDays; cachedWindowAt = Date.now(); return result; })(); try { return await windowRefreshInFlight; } finally { windowRefreshInFlight = null; } }
export async function warmMlbCache(): Promise<NrfiResponse> { return fetchNrfiData(); }