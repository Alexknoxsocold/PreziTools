import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import {
  getOpeningPlayerStats,
  saveOpeningEvidence,
  verifyOpeningEvidence,
  type WnbaStarter,
} from "./wnbaEvidence";
import {
  attachWnbaFirstBasketMarkets,
  type WnbaFirstBasketMarket,
} from "./odds/parlayWnba";
import { fetchWnbaPlayerPropSignals } from "./wnbaPropMarkets";

neonConfig.webSocketConstructor = ws;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

const MODEL_VERSION = "WNBA-FB-SEASONAL-V1";
const LOCK_WINDOW_MS = 2 * 60 * 60 * 1000;
const CACHE_TTL_MS = 2 * 60 * 1000;
const PROJECTION_TTL_MS = 5 * 60 * 1000;
let slateCache: { at: number; value: WnbaSlate } | null = null;
const projectionCache = new Map<string, { at: number; starters: Starter[] }>();

type Starter = WnbaStarter;
type HistoryRow = { fbScored: number; gamesTracked: number };
export type WnbaCandidate = {
  name: string;
  team: string;
  position: string;
  headshot: string | null;
  seasonStarts: number;
  avgPoints: number;
  avgFga: number;
  fgPct: number;
  avgMinutes: number;
  currentFirstBaskets: number;
  currentGamesTracked: number;
  previousFirstBaskets: number;
  previousGamesTracked: number;
  openingFirstShots: number;
  openingFirstShotRate: number | null;
  openingShotFgPct: number | null;
  probability: number;
  rank: number;
  marketOdds?: WnbaFirstBasketMarket | null;
};
export type WnbaTipSignal = {
  awayJumper: string | null;
  homeJumper: string | null;
  awayTipWins: number;
  awayTipEvents: number;
  awayTipPct: number | null;
  homeTipWins: number;
  homeTipEvents: number;
  homeTipPct: number | null;
  projectedFirstPossessionTeam: string | null;
  confidence: "insufficient" | "emerging" | "usable";
};
export type WnbaGame = {
  id: string;
  date: string;
  shortName: string;
  awayTeam: string;
  homeTeam: string;
  awayName: string;
  homeName: string;
  status: string;
  lineupStatus: "confirmed" | "projected" | "waiting";
  starters: Starter[];
  candidates: WnbaCandidate[];
  topPick: WnbaCandidate | null;
  tipSignal: WnbaTipSignal;
  verifiedFirstScorer: string | null;
  verifiedFirstScorerTeam: string | null;
};
export type WnbaSlate = {
  season: number;
  updatedAt: string;
  teams: { abbreviation: string; name: string }[];
  games: WnbaGame[];
  source: string;
  modelVersion: string;
};

function normalizeName(v: string) {
  return v
    .toLowerCase()
    .replace(/[.'’\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function propSignalKey(v: string) {
  return v
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
function normalizeTeam(v: string) {
  return v.toUpperCase().trim();
}
function tipCanonicalTeam(v: string) {
  const k = normalizeTeam(v);
  return (
    (
      {
        WAS: "WSH",
        WSH: "WSH",
        PHO: "PHX",
        PHX: "PHX",
        NYL: "NY",
        NY: "NY",
        GSV: "GS",
        GS: "GS",
        LVA: "LV",
        LV: "LV",
        LAS: "LA",
        LA: "LA",
      } as Record<string, string>
    )[k] || k
  );
}
function currentSeason(date = new Date()) {
  return date.getUTCFullYear();
}
function etDate(date = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${p.find((x) => x.type === "year")?.value}${p.find((x) => x.type === "month")?.value}${p.find((x) => x.type === "day")?.value}`;
}
function compactDate(date: Date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}
function offsetCompactDate(date: string, days: number) {
  const y = Number(date.slice(0, 4)),
    m = Number(date.slice(4, 6)),
    d = Number(date.slice(6, 8));
  return compactDate(new Date(Date.UTC(y, m - 1, d + days, 12)));
}
async function fetchJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
async function fetchScoreboard(date = etDate()) {
  const buckets = [
    offsetCompactDate(date, -1),
    date,
    offsetCompactDate(date, 1),
  ];
  const payloads = await Promise.all(
    buckets.map((d) =>
      fetchJson(
        `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${d}`,
      ),
    ),
  );
  const merged = payloads.flatMap((d) => d?.events || []);
  const unique = [
    ...new Map(
      merged.map((event: any) => [
        String(event?.id || `${event?.date}-${event?.shortName}`),
        event,
      ]),
    ).values(),
  ];
  return unique
    .filter(
      (event: any) => event?.date && etDate(new Date(event.date)) === date,
    )
    .sort(
      (a: any, b: any) =>
        new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
}

export async function ensureWnbaSchema() {
  if (!pool) return;
  await pool.query(`
  CREATE TABLE IF NOT EXISTS wnba_fb_tracking(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),player_name text NOT NULL,team text NOT NULL,season integer NOT NULL,fb_scored integer NOT NULL DEFAULT 0,games_tracked integer NOT NULL DEFAULT 0,last_updated timestamptz NOT NULL DEFAULT now());
  CREATE UNIQUE INDEX IF NOT EXISTS wnba_fb_tracking_unique ON wnba_fb_tracking(lower(player_name),upper(team),season);
  CREATE INDEX IF NOT EXISTS wnba_fb_tracking_season_idx ON wnba_fb_tracking(season);
  CREATE TABLE IF NOT EXISTS wnba_processed_games(espn_game_id text PRIMARY KEY,game_date date,first_scorer text,first_scorer_team text,processed_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS wnba_prediction_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),espn_game_id text NOT NULL,season integer NOT NULL,game_start_at timestamptz NOT NULL,locked_at timestamptz NOT NULL,model_version text NOT NULL,player_name text NOT NULL,team text NOT NULL,model_probability numeric(5,2) NOT NULL,model_rank integer NOT NULL,is_top_pick boolean NOT NULL DEFAULT false,actual_first_scorer text,actual_first_scorer_team text,won boolean,graded_at timestamptz,CONSTRAINT wnba_fb_probability_check CHECK(model_probability>=0 AND model_probability<=100));
  CREATE UNIQUE INDEX IF NOT EXISTS wnba_prediction_game_player_unique ON wnba_prediction_ledger(espn_game_id,lower(player_name),upper(team),season);
  CREATE INDEX IF NOT EXISTS wnba_prediction_locked_idx ON wnba_prediction_ledger(locked_at DESC);
  ALTER TABLE wnba_prediction_ledger ADD COLUMN IF NOT EXISTS away_team text,ADD COLUMN IF NOT EXISTS home_team text,ADD COLUMN IF NOT EXISTS opponent text,ADD COLUMN IF NOT EXISTS is_home boolean,ADD COLUMN IF NOT EXISTS venue text,ADD COLUMN IF NOT EXISTS lineup_status text,ADD COLUMN IF NOT EXISTS context_snapshot jsonb;
`);
}
async function getHistory(season: number) {
  const out = new Map<string, HistoryRow>();
  if (!pool) return out;
  await ensureWnbaSchema();
  const r = await pool.query(
    "SELECT player_name,team,fb_scored,games_tracked FROM wnba_fb_tracking WHERE season=$1",
    [season],
  );
  for (const x of r.rows)
    out.set(`${normalizeName(x.player_name)}|${normalizeTeam(x.team)}`, {
      fbScored: Number(x.fb_scored),
      gamesTracked: Number(x.games_tracked),
    });
  return out;
}
async function fetchTeams() {
  const d = await fetchJson(
    "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams?limit=50",
  );
  return (d?.sports?.[0]?.leagues?.[0]?.teams || [])
    .map((e: any) => ({
      abbreviation: String(e?.team?.abbreviation || "").toUpperCase(),
      name: String(e?.team?.displayName || ""),
    }))
    .filter((t: any) => t.abbreviation && t.name);
}
async function fetchSummary(id: string) {
  return fetchJson(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${id}`,
  );
}
function extractStarters(summary: any): Starter[] {
  const out: Starter[] = [];
  for (const b of summary?.boxscore?.players || []) {
    const team = normalizeTeam(String(b?.team?.abbreviation || ""));
    for (const g of b?.statistics || [])
      for (const row of g?.athletes || []) {
        if (row?.starter !== true || row?.didNotPlay === true) continue;
        const name = String(row?.athlete?.displayName || "").trim();
        if (name && team) out.push({ name, team });
      }
  }
  return [
    ...new Map(
      out.map((s) => [`${normalizeName(s.name)}|${s.team}`, s]),
    ).values(),
  ];
}
async function fetchRoster(team: string) {
  const d = await fetchJson(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/${team}/roster`,
  );
  return d?.athletes || [];
}
function rosterStatusText(player: any) {
  const injuries = Array.isArray(player?.injuries) ? player.injuries : [];
  return [
    player?.status?.type,
    player?.status?.name,
    player?.status?.description,
    player?.status?.detail,
    ...injuries.flatMap((x: any) => [
      x?.status,
      x?.type,
      x?.details,
      x?.description,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
function isUnavailableRosterPlayer(player: any) {
  const text = rosterStatusText(player);
  return /\b(out|inactive|suspended|waived|injured reserve|season[- ]ending|not with team)\b/.test(
    text,
  );
}
function availabilityAdjustment(player: any) {
  const text = rosterStatusText(player);
  if (/\bdoubtful\b/.test(text)) return -30;
  if (/\bquestionable\b/.test(text)) return -12;
  if (/\bprobable\b/.test(text)) return 4;
  return 0;
}

async function fetchPlayerStats(id: string, season: number) {
  const d = await fetchJson(
    `https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/seasons/${season}/types/2/athletes/${id}/statistics/0`,
  );
  const cats = d?.splits?.categories;
  if (!cats) return null;
  const all = (cats || []).flatMap((c: any) => c?.stats || []);
  const n = (names: string[]) => {
    for (const name of names) {
      const s = all.find(
        (x: any) => String(x?.name || "").toLowerCase() === name.toLowerCase(),
      );
      if (s) {
        const v = Number.parseFloat(
          String(s?.value ?? s?.displayValue ?? "0").replace(/[^0-9.-]/g, ""),
        );
        if (Number.isFinite(v)) return v;
      }
    }
    return 0;
  };
  return {
    games: n(["gamesPlayed", "games"]),
    starts: n(["gamesStarted", "starts"]),
    points: n(["avgPoints", "pointsPerGame"]),
    fga: n(["avgFieldGoalsAttempted", "fieldGoalsAttemptedPerGame"]),
    fg: n(["fieldGoalPct", "fieldGoalPercentage"]),
    minutes: n(["avgMinutes", "minutesPerGame"]),
  };
}

async function latestProjectedStarters(team: string): Promise<Starter[]> {
  const key = normalizeTeam(team),
    cached = projectionCache.get(key);
  if (cached && Date.now() - cached.at < PROJECTION_TTL_MS)
    return cached.starters;
  const roster: any[] = await fetchRoster(key);
  if (!roster.length) {
    projectionCache.set(key, { at: Date.now(), starters: [] });
    return [];
  }

  const availableRoster: any[] = roster.filter(
    (x: any) =>
      !isUnavailableRosterPlayer(x) && String(x?.displayName || "").trim(),
  );
  if (availableRoster.length < 5) {
    projectionCache.set(key, { at: Date.now(), starters: [] });
    return [];
  }

  const availableByName = new Map<string, any>(
    availableRoster.map((x: any) => [normalizeName(String(x.displayName)), x]),
  );
  const recentFrequency = new Map<
    string,
    { name: string; count: number; recency: number }
  >();

  for (let day = 1; day <= 14; day++) {
    const date = new Date(Date.now() - day * 86400000);
    const events = await fetchScoreboard(compactDate(date));
    for (const e of events.filter(
      (x: any) => x?.status?.type?.completed === true,
    )) {
      const comp = e?.competitions?.[0];
      const has = (comp?.competitors || []).some(
        (c: any) => normalizeTeam(String(c?.team?.abbreviation || "")) === key,
      );
      if (!has) continue;
      const recent = extractStarters(await fetchSummary(String(e.id))).filter(
        (x) => x.team === key,
      );
      for (const s of recent) {
        const norm = normalizeName(s.name);
        if (!availableByName.has(norm)) continue;
        const prev = recentFrequency.get(norm);
        recentFrequency.set(norm, {
          name: s.name,
          count: (prev?.count || 0) + 1,
          recency: Math.min(prev?.recency ?? day, day),
        });
      }
    }
  }

  const season = currentSeason();
  const propSignals = await fetchWnbaPlayerPropSignals().catch(() => new Map());
  const ranked = await Promise.all(
    availableRoster.map(async (player: any) => {
      const name = String(player.displayName);
      const norm = normalizeName(name);
      const stats = player?.id
        ? await fetchPlayerStats(String(player.id), season)
        : null;
      const propSignal = propSignals.get(propSignalKey(name));
      const recent = recentFrequency.get(norm);
      const games = Math.max(0, Number(stats?.games || 0));
      const starts = Math.max(0, Number(stats?.starts || 0));
      const minutes = Math.max(0, Number(stats?.minutes || 0));
      const startRate = games > 0 ? Math.min(1, starts / games) : 0;
      const recentStarts = recent?.count || 0;
      const recencyBonus = recent ? Math.max(0, 14 - recent.recency) * 1.5 : 0;
      const propBoost = propSignal
        ? Math.min(
            22,
            propSignal.marketCount * 3 +
              Math.min(propSignal.bookCount, 4) * 1.5,
          )
        : 0;
      const score =
        startRate * 90 +
        recentStarts * 8 +
        starts * 0.5 +
        minutes * 1.2 +
        recencyBonus +
        propBoost +
        availabilityAdjustment(player);
      return {
        norm,
        name,
        score,
        startRate,
        recentStarts,
        starts,
        minutes,
        propMarkets: propSignal?.marketCount || 0,
        propBooks: propSignal?.bookCount || 0,
      };
    }),
  );

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      b.startRate - a.startRate ||
      b.recentStarts - a.recentStarts ||
      b.starts - a.starts ||
      b.minutes - a.minutes,
  );
  const starters: Starter[] = ranked
    .slice(0, 5)
    .map((x) => ({ name: x.name, team: key }));
  console.log(
    "[WNBA Projection]",
    key,
    ranked
      .slice(0, 8)
      .map((x) => ({
        name: x.name,
        score: Math.round(x.score * 10) / 10,
        startRate: Math.round(x.startRate * 100),
        recentStarts: x.recentStarts,
        propMarkets: x.propMarkets,
        propBooks: x.propBooks,
      })),
  );
  projectionCache.set(key, { at: Date.now(), starters });
  return starters;
}

function opportunityProbability(
  stats: any,
  position: string,
  openingRate: number | null,
) {
  if (!stats) return 4;
  let score =
    (stats.fga / 75) * 38 +
    (stats.points / 35) * 8 +
    ((stats.fg - 42) / 30) * 4 +
    (Math.min(stats.minutes, 36) / 36) * 3;
  if (position === "C") score *= 1.1;
  else if (position === "PG") score *= 1.04;
  if (openingRate !== null)
    score = score * 0.9 + Math.min(openingRate, 35) * 0.1;
  return Math.max(2, Math.min(32, score));
}
function blend(
  model: number,
  prev: HistoryRow | undefined,
  cur: HistoryRow | undefined,
) {
  let num = model * 12,
    den = 12;
  if (prev?.gamesTracked) {
    const n = Math.min(prev.gamesTracked, 12);
    num += (prev.fbScored / prev.gamesTracked) * 100 * n;
    den += n;
  }
  if (cur?.gamesTracked) {
    const n = Math.min(cur.gamesTracked, 20);
    num += (cur.fbScored / cur.gamesTracked) * 100 * n;
    den += n;
  }
  return Math.round(Math.max(1, Math.min(35, num / den)) * 10) / 10;
}

async function modelStarters(
  starters: Starter[],
  season: number,
): Promise<WnbaCandidate[]> {
  if (starters.length !== 10) return [];
  const [current, previous, opening] = await Promise.all([
    getHistory(season),
    getHistory(season - 1),
    getOpeningPlayerStats(season),
  ]);
  const teams = [...new Set(starters.map((s) => s.team))],
    rosters = new Map<string, any[]>();
  await Promise.all(
    teams.map(async (t) => rosters.set(t, await fetchRoster(t))),
  );
  const out: WnbaCandidate[] = [];
  for (const s of starters) {
    const roster = rosters.get(s.team) || [],
      norm = normalizeName(s.name);
    let p = roster.find(
      (x: any) => normalizeName(String(x?.displayName || "")) === norm,
    );
    if (!p) {
      const last = norm.split(" ").at(-1);
      p = roster.find(
        (x: any) =>
          normalizeName(String(x?.displayName || ""))
            .split(" ")
            .at(-1) === last,
      );
    }
    const stats = p?.id ? await fetchPlayerStats(String(p.id), season) : null,
      position = String(p?.position?.abbreviation || "G"),
      key = `${norm}|${s.team}`,
      cur = current.get(key),
      prev = previous.get(key),
      op = opening.get(norm),
      verifiedStarts = cur?.gamesTracked || 0,
      openingRate =
        verifiedStarts > 0
          ? Math.round(((op?.firstShots || 0) / verifiedStarts) * 1000) / 10
          : null,
      openingFg =
        (op?.firstShots || 0) > 0
          ? Math.round(((op?.firstMakes || 0) / (op?.firstShots || 1)) * 1000) /
            10
          : null;
    out.push({
      name: s.name,
      team: s.team,
      position,
      headshot: p?.headshot?.href || null,
      seasonStarts: Math.round(stats?.starts || 0),
      avgPoints: Math.round((stats?.points || 0) * 10) / 10,
      avgFga: Math.round((stats?.fga || 0) * 10) / 10,
      fgPct: Math.round((stats?.fg || 0) * 10) / 10,
      avgMinutes: Math.round((stats?.minutes || 0) * 10) / 10,
      currentFirstBaskets: cur?.fbScored || 0,
      currentGamesTracked: verifiedStarts,
      previousFirstBaskets: prev?.fbScored || 0,
      previousGamesTracked: prev?.gamesTracked || 0,
      openingFirstShots: op?.firstShots || 0,
      openingFirstShotRate: openingRate,
      openingShotFgPct: openingFg,
      probability: blend(
        opportunityProbability(stats, position, openingRate),
        prev,
        cur,
      ),
      rank: 0,
    });
  }
  out
    .sort((a, b) => b.probability - a.probability)
    .forEach((p, i) => (p.rank = i + 1));
  return out;
}

function eventTeams(event: any) {
  const c = event?.competitions?.[0];
  return {
    away: c?.competitors?.find((x: any) => x.homeAway === "away"),
    home: c?.competitors?.find((x: any) => x.homeAway === "home"),
  };
}
function frontcourtRank(position: string) {
  const p = position.toUpperCase();
  if (p === "C") return 4;
  if (p === "F-C" || p === "C-F") return 3;
  if (p === "PF" || p === "F") return 2;
  return 0;
}
function tipNameKey(v: string) {
  return normalizeName(String(v || "").split(":")[0]);
}
function sameTipPlayer(stored: string, fullName: string) {
  const a = tipNameKey(stored),
    b = normalizeName(fullName);
  if (!a || !b) return false;
  if (a === b) return true;
  const last = b.split(" ").at(-1) || b;
  return a === last;
}
type TipRow = {
  game_date: string | Date;
  team_a: string | null;
  team_b: string | null;
  tip_winner_team: string | null;
  tip_player_a: string | null;
  tip_player_b: string | null;
};
function tipSeasonWeight(gameDate: string | Date, season: number) {
  const y = new Date(gameDate).getUTCFullYear();
  return y === season
    ? 1
    : y === season - 1
      ? 0.55
      : y === season - 2
        ? 0.3
        : 0;
}
async function tipRowsForTeams(
  away: string,
  home: string,
  season: number,
): Promise<TipRow[]> {
  if (!pool) return [];
  await ensureWnbaSchema();
  const a = tipCanonicalTeam(away),
    h = tipCanonicalTeam(home);
  const r = await pool.query(
    `SELECT game_date,team_a,team_b,tip_winner_team,tip_player_a,tip_player_b FROM wnba_opening_evidence WHERE extract(year from game_date)::int BETWEEN ($3::int-2) AND $3::int AND confidence='verified' AND tip_winner_team IS NOT NULL AND ((upper(team_a) IN ($1,$2)) OR (upper(team_b) IN ($1,$2)))`,
    [a, h, season],
  );
  return r.rows as TipRow[];
}
function playerTipProfile(
  rows: TipRow[],
  name: string,
  team: string,
  season: number,
) {
  const t = tipCanonicalTeam(team);
  let wins = 0,
    events = 0,
    weightedWins = 0,
    weightedEvents = 0,
    appearWeight = 0,
    recentAppearWeight = 0;
  for (const row of rows) {
    const rowTeams = [
      tipCanonicalTeam(String(row.team_a || "")),
      tipCanonicalTeam(String(row.team_b || "")),
    ];
    if (!rowTeams.includes(t)) continue;
    const appears =
      sameTipPlayer(String(row.tip_player_a || ""), name) ||
      sameTipPlayer(String(row.tip_player_b || ""), name);
    if (!appears) continue;
    const w = tipSeasonWeight(row.game_date, season);
    if (w <= 0) continue;
    events++;
    appearWeight += w;
    if (new Date(row.game_date).getUTCFullYear() === season)
      recentAppearWeight += 1;
    const won = tipCanonicalTeam(String(row.tip_winner_team || "")) === t;
    if (won) {
      wins++;
      weightedWins += w;
    }
    weightedEvents += w;
  }
  const priorStrength = 8,
    smoothed =
      (weightedWins + priorStrength * 0.5) / (weightedEvents + priorStrength);
  return {
    wins,
    events,
    weightedWins,
    weightedEvents,
    appearWeight,
    recentAppearWeight,
    smoothedPct: smoothed * 100,
  };
}
function teamTipProfile(rows: TipRow[], team: string, season: number) {
  const t = tipCanonicalTeam(team);
  let weightedWins = 0,
    weightedEvents = 0;
  for (const row of rows) {
    const teams = [
      tipCanonicalTeam(String(row.team_a || "")),
      tipCanonicalTeam(String(row.team_b || "")),
    ];
    if (!teams.includes(t)) continue;
    const w = tipSeasonWeight(row.game_date, season);
    if (w <= 0) continue;
    weightedEvents += w;
    if (tipCanonicalTeam(String(row.tip_winner_team || "")) === t)
      weightedWins += w;
  }
  const prior = 10;
  return {
    events: weightedEvents,
    pct: ((weightedWins + prior * 0.5) / (weightedEvents + prior)) * 100,
  };
}
function headToHeadTipProfile(
  rows: TipRow[],
  awayName: string,
  homeName: string,
  awayTeam: string,
  season: number,
) {
  let weightedAwayWins = 0,
    weightedEvents = 0,
    rawEvents = 0;
  for (const row of rows) {
    const hasAway =
        sameTipPlayer(String(row.tip_player_a || ""), awayName) ||
        sameTipPlayer(String(row.tip_player_b || ""), awayName),
      hasHome =
        sameTipPlayer(String(row.tip_player_a || ""), homeName) ||
        sameTipPlayer(String(row.tip_player_b || ""), homeName);
    if (!hasAway || !hasHome) continue;
    const w = tipSeasonWeight(row.game_date, season);
    if (w <= 0) continue;
    weightedEvents += w;
    rawEvents++;
    if (
      tipCanonicalTeam(String(row.tip_winner_team || "")) ===
      tipCanonicalTeam(awayTeam)
    )
      weightedAwayWins += w;
  }
  const prior = 4;
  return {
    rawEvents,
    weightedEvents,
    awayPct:
      ((weightedAwayWins + prior * 0.5) / (weightedEvents + prior)) * 100,
  };
}
async function selectJumper(
  candidates: WnbaCandidate[],
  team: string,
  season: number,
  rows: TipRow[],
) {
  const teamPlayers = candidates.filter(
    (c) => tipCanonicalTeam(c.team) === tipCanonicalTeam(team),
  );
  if (!teamPlayers.length) return null;
  const enriched = teamPlayers.map((player) => ({
    player,
    profile: playerTipProfile(rows, player.name, team, season),
  }));
  enriched.sort((a, b) => {
    const aScore =
        a.profile.appearWeight * 12 +
        a.profile.recentAppearWeight * 5 +
        frontcourtRank(a.player.position) * 4 +
        Math.min(a.player.avgMinutes, 36) * 0.15,
      bScore =
        b.profile.appearWeight * 12 +
        b.profile.recentAppearWeight * 5 +
        frontcourtRank(b.player.position) * 4 +
        Math.min(b.player.avgMinutes, 36) * 0.15;
    return (
      bScore - aScore ||
      b.profile.events - a.profile.events ||
      frontcourtRank(b.player.position) - frontcourtRank(a.player.position) ||
      b.player.avgMinutes - a.player.avgMinutes
    );
  });
  return enriched[0] || null;
}
async function tipSignal(
  away: string,
  home: string,
  candidates: WnbaCandidate[],
): Promise<WnbaTipSignal> {
  const season = currentSeason(),
    rows = await tipRowsForTeams(away, home, season),
    [aj, hj] = await Promise.all([
      selectJumper(candidates, away, season, rows),
      selectJumper(candidates, home, season, rows),
    ]);
  if (!aj || !hj)
    return {
      awayJumper: aj?.player.name || null,
      homeJumper: hj?.player.name || null,
      awayTipWins: aj?.profile.wins || 0,
      awayTipEvents: aj?.profile.events || 0,
      awayTipPct: null,
      homeTipWins: hj?.profile.wins || 0,
      homeTipEvents: hj?.profile.events || 0,
      homeTipPct: null,
      projectedFirstPossessionTeam: null,
      confidence: "insufficient",
    };
  const a = aj.profile,
    h = hj.profile,
    aStrength = Math.max(0.05, a.smoothedPct / 100),
    hStrength = Math.max(0.05, h.smoothedPct / 100);
  let awayPct = (aStrength / (aStrength + hStrength)) * 100;
  const awayTeamProfile = teamTipProfile(rows, away, season),
    homeTeamProfile = teamTipProfile(rows, home, season),
    teamStrength =
      (Math.max(0.05, awayTeamProfile.pct / 100) /
        (Math.max(0.05, awayTeamProfile.pct / 100) +
          Math.max(0.05, homeTeamProfile.pct / 100))) *
      100;
  awayPct = awayPct * 0.82 + teamStrength * 0.18;
  const h2h = headToHeadTipProfile(
    rows,
    aj.player.name,
    hj.player.name,
    away,
    season,
  );
  if (h2h.weightedEvents >= 1.5) awayPct = awayPct * 0.72 + h2h.awayPct * 0.28;
  awayPct = Math.max(15, Math.min(85, awayPct));
  const homePct = 100 - awayPct,
    effective = a.weightedEvents + h.weightedEvents + h2h.weightedEvents,
    jumperEvidence = Math.min(a.appearWeight, h.appearWeight);
  const confidence: WnbaTipSignal["confidence"] =
    effective >= 22 && jumperEvidence >= 5
      ? "usable"
      : effective >= 8 && jumperEvidence >= 2
        ? "emerging"
        : "insufficient";
  const edge = Math.abs(awayPct - homePct),
    projected =
      confidence !== "insufficient" && edge >= 3
        ? awayPct > homePct
          ? away
          : home
        : null;
  console.log("[WNBA Tip Model]", `${away}@${home}`, {
    awayJumper: aj.player.name,
    homeJumper: hj.player.name,
    awayRaw: `${a.wins}/${a.events}`,
    homeRaw: `${h.wins}/${h.events}`,
    awaySmoothed: Math.round(a.smoothedPct * 10) / 10,
    homeSmoothed: Math.round(h.smoothedPct * 10) / 10,
    h2hEvents: h2h.rawEvents,
    awayMatchup: Math.round(awayPct * 10) / 10,
    homeMatchup: Math.round(homePct * 10) / 10,
    confidence,
  });
  return {
    awayJumper: aj.player.name,
    homeJumper: hj.player.name,
    awayTipWins: a.wins,
    awayTipEvents: a.events,
    awayTipPct: Math.round(awayPct * 10) / 10,
    homeTipWins: h.wins,
    homeTipEvents: h.events,
    homeTipPct: Math.round(homePct * 10) / 10,
    projectedFirstPossessionTeam: projected,
    confidence,
  };
}

export async function getWnbaSlate(force = false): Promise<WnbaSlate> {
  if (!force && slateCache && Date.now() - slateCache.at < CACHE_TTL_MS)
    return slateCache.value;
  await ensureWnbaSchema();
  const season = currentSeason(),
    [teams, events] = await Promise.all([fetchTeams(), fetchScoreboard()]),
    games: WnbaGame[] = [];
  for (const event of events) {
    const { away, home } = eventTeams(event);
    if (!away || !home) continue;
    const awayTeam = normalizeTeam(away.team.abbreviation),
      homeTeam = normalizeTeam(home.team.abbreviation),
      summary = await fetchSummary(String(event.id)),
      confirmed = summary ? extractStarters(summary) : [];
    let starters = confirmed,
      lineupStatus: WnbaGame["lineupStatus"] = "waiting";
    if (confirmed.length === 10) {
      lineupStatus = "confirmed";
    } else {
      const [a, h] = await Promise.all([
        latestProjectedStarters(awayTeam),
        latestProjectedStarters(homeTeam),
      ]);
      starters = [...a, ...h];
      if (starters.length === 10) lineupStatus = "projected";
    }
    let candidates =
      starters.length === 10 ? await modelStarters(starters, season) : [];
    if (candidates.length !== 10 && lineupStatus === "projected") {
      starters = [];
      lineupStatus = "waiting";
    }
    if (lineupStatus !== "waiting" && candidates.length) {
      candidates = await attachWnbaFirstBasketMarkets(candidates);
    }
    let verifiedFirstScorer: string | null = null, verifiedFirstScorerTeam: string | null = null;
    if (pool && event?.status?.type?.completed === true) {
      const graded = await pool.query(
        "SELECT first_scorer,first_scorer_team FROM wnba_processed_games WHERE espn_game_id=$1 LIMIT 1",
        [String(event.id)],
      );
      verifiedFirstScorer = graded.rows[0]?.first_scorer ? String(graded.rows[0].first_scorer) : null;
      verifiedFirstScorerTeam = graded.rows[0]?.first_scorer_team ? String(graded.rows[0].first_scorer_team) : null;
    }
    games.push({
      id: String(event.id),
      date: event.date,
      shortName: event.shortName || `${awayTeam} @ ${homeTeam}`,
      awayTeam,
      homeTeam,
      awayName: away.team.displayName,
      homeName: home.team.displayName,
      status:
        event?.status?.type?.description ||
        event?.status?.type?.state ||
        "Scheduled",
      lineupStatus,
      starters,
      candidates: lineupStatus === "waiting" ? [] : candidates,
      topPick: lineupStatus === "waiting" ? null : candidates[0] || null,
      tipSignal: await tipSignal(
        awayTeam,
        homeTeam,
        lineupStatus === "waiting" ? [] : candidates,
      ),
      verifiedFirstScorer,
      verifiedFirstScorerTeam,
    });
  }
  const value = {
    season,
    updatedAt: new Date().toISOString(),
    teams,
    games,
    source:
      "ESPN WNBA schedule/roster/boxscore/play-by-play + active roster/injury status + recent starter history + season usage + PropLine player-prop availability signal + optional first-basket market display + verified multi-season opening-tip evidence with sample-size smoothing, recency weighting, team context and jumper head-to-head",
    modelVersion: MODEL_VERSION,
  };
  slateCache = { at: Date.now(), value };
  return value;
}

async function recordVerifiedGame(
  gameId: string,
  gameDate: string,
  starters: Starter[],
  scorer: Starter,
  season: number,
) {
  if (!pool || starters.length !== 10) return;
  await ensureWnbaSchema();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const ex = await c.query(
      "SELECT 1 FROM wnba_processed_games WHERE espn_game_id=$1",
      [gameId],
    );
    if (ex.rows.length) {
      await c.query("ROLLBACK");
      return;
    }
    for (const s of starters) {
      const won =
        normalizeName(s.name) === normalizeName(scorer.name) &&
        normalizeTeam(s.team) === normalizeTeam(scorer.team);
      await c.query(
        `INSERT INTO wnba_fb_tracking(player_name,team,season,fb_scored,games_tracked,last_updated) VALUES($1,$2,$3,$4,1,now()) ON CONFLICT(lower(player_name),upper(team),season) DO UPDATE SET fb_scored=wnba_fb_tracking.fb_scored+EXCLUDED.fb_scored,games_tracked=wnba_fb_tracking.games_tracked+1,last_updated=now()`,
        [s.name, s.team, season, won ? 1 : 0],
      );
    }
    await c.query(
      "INSERT INTO wnba_processed_games(espn_game_id,game_date,first_scorer,first_scorer_team) VALUES($1,$2,$3,$4)",
      [gameId, gameDate, scorer.name, scorer.team],
    );
    await c.query(
      `UPDATE wnba_prediction_ledger SET actual_first_scorer=$2,actual_first_scorer_team=$3,won=(lower(player_name)=lower($2) AND upper(team)=upper($3)),graded_at=now() WHERE espn_game_id=$1 AND graded_at IS NULL`,
      [gameId, scorer.name, scorer.team],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  slateCache = null;
}

export async function runWnbaTracker() {
  await ensureWnbaSchema();
  let processed = 0,
    unresolved = 0;
  for (const offset of [0, -1]) {
    const events = await fetchScoreboard(
      etDate(new Date(Date.now() + offset * 86400000)),
    );
    for (const event of events.filter(
      (e: any) => e?.status?.type?.completed === true,
    )) {
      if (pool) {
        const done = await pool.query(
          "SELECT 1 FROM wnba_processed_games WHERE espn_game_id=$1",
          [String(event.id)],
        );
        if (done.rows.length) continue;
      }
      const summary = await fetchSummary(String(event.id)),
        starters = summary ? extractStarters(summary) : [],
        evidence = summary
          ? verifyOpeningEvidence(
              String(event.id),
              String(event.date).slice(0, 10),
              summary,
              starters,
            )
          : null;
      if (starters.length !== 10 || !evidence) {
        unresolved++;
        continue;
      }
      await saveOpeningEvidence(evidence);
      await recordVerifiedGame(
        String(event.id),
        String(event.date).slice(0, 10),
        starters,
        { name: evidence.firstMadePlayer, team: evidence.firstMadeTeam },
        currentSeason(new Date(event.date)),
      );
      processed++;
    }
  }
  return { processed, unresolved };
}

async function saveWnbaContext(
  event: any,
  awayTeam: string,
  homeTeam: string,
  candidates: WnbaCandidate[],
  lineupStatus: "confirmed" | "projected",
) {
  if (!pool) return;
  const signal = await tipSignal(awayTeam, homeTeam, candidates),
    venue = event?.competitions?.[0]?.venue?.fullName ?? null;
  for (const x of candidates) {
    const isHome = tipCanonicalTeam(x.team) === tipCanonicalTeam(homeTeam),
      opponent = isHome ? awayTeam : homeTeam,
      context = {
        contextVersion: "WNBA-FB-CONTEXT-SHADOW-V1",
        awayTeam,
        homeTeam,
        opponent,
        isHome,
        venue,
        lineupStatus,
        tipSignal: signal,
        position: x.position,
        seasonStarts: x.seasonStarts,
        avgPoints: x.avgPoints,
        avgFga: x.avgFga,
        avgMinutes: x.avgMinutes,
        currentFirstBaskets: x.currentFirstBaskets,
        currentGamesTracked: x.currentGamesTracked,
        previousFirstBaskets: x.previousFirstBaskets,
        previousGamesTracked: x.previousGamesTracked,
        openingFirstShots: x.openingFirstShots,
        openingFirstShotRate: x.openingFirstShotRate,
        openingShotFgPct: x.openingShotFgPct,
      };
    await pool.query(
      `UPDATE wnba_prediction_ledger SET away_team=$2,home_team=$3,opponent=$4,is_home=$5,venue=$6,lineup_status=$7,context_snapshot=$8 WHERE espn_game_id=$1 AND lower(player_name)=lower($9) AND upper(team)=upper($10)`,
      [
        String(event.id),
        awayTeam,
        homeTeam,
        opponent,
        isHome,
        venue,
        lineupStatus,
        JSON.stringify(context),
        x.name,
        x.team,
      ],
    );
  }
}

export async function lockWnbaPredictions() {
  if (!pool) return { eligible: 0, locked: 0, waiting: 0, upgraded: 0 };
  await ensureWnbaSchema();
  const now = Date.now(),
    events = await fetchScoreboard();
  let eligible = 0,
    locked = 0,
    waiting = 0,
    upgraded = 0;
  for (const event of events) {
    const start = new Date(event.date).getTime();
    if (!Number.isFinite(start) || start <= now || start - now > LOCK_WINDOW_MS)
      continue;
    eligible++;
    const { away, home } = eventTeams(event);
    if (!away || !home) {
      waiting++;
      continue;
    }
    const awayTeam = normalizeTeam(String(away?.team?.abbreviation || "")),
      homeTeam = normalizeTeam(String(home?.team?.abbreviation || ""));
    const existing = await pool.query(
        "SELECT model_version FROM wnba_prediction_ledger WHERE espn_game_id=$1 LIMIT 1",
        [String(event.id)],
      ),
      existingVersion = String(existing.rows[0]?.model_version || ""),
      existingProjected =
        existing.rows.length > 0 && existingVersion.endsWith("-PROJECTED");
    const summary = await fetchSummary(String(event.id));
    let starters = summary ? extractStarters(summary) : [];
    let snapshotVersion = MODEL_VERSION;
    if (starters.length === 10) {
      if (existing.rows.length && !existingProjected) continue;
    } else {
      if (existing.rows.length) continue;
      const [a, h] = await Promise.all([
        latestProjectedStarters(awayTeam),
        latestProjectedStarters(homeTeam),
      ]);
      starters = [...a, ...h];
      if (starters.length === 10)
        snapshotVersion = `${MODEL_VERSION}-PROJECTED`;
    }
    if (starters.length !== 10) {
      waiting++;
      continue;
    }
    const candidates = await modelStarters(
      starters,
      currentSeason(new Date(event.date)),
    );
    if (candidates.length !== 10) {
      waiting++;
      continue;
    }
    if (existingProjected && snapshotVersion === MODEL_VERSION) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(
          "DELETE FROM wnba_prediction_ledger WHERE espn_game_id=$1",
          [String(event.id)],
        );
        for (const x of candidates)
          await c.query(
            `INSERT INTO wnba_prediction_ledger(espn_game_id,season,game_start_at,locked_at,model_version,player_name,team,model_probability,model_rank,is_top_pick) VALUES($1,$2,$3,now(),$4,$5,$6,$7,$8,$9)`,
            [
              String(event.id),
              currentSeason(new Date(event.date)),
              event.date,
              snapshotVersion,
              x.name,
              x.team,
              x.probability,
              x.rank,
              x.rank === 1,
            ],
          );
        await c.query("COMMIT");
        await saveWnbaContext(
          event,
          awayTeam,
          homeTeam,
          candidates,
          "confirmed",
        ).catch((error) =>
          console.warn("[WNBA Context] confirmed snapshot failed:", error),
        );
        upgraded++;
        locked++;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
      continue;
    }
    for (const x of candidates)
      await pool.query(
        `INSERT INTO wnba_prediction_ledger(espn_game_id,season,game_start_at,locked_at,model_version,player_name,team,model_probability,model_rank,is_top_pick) VALUES($1,$2,$3,now(),$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [
          String(event.id),
          currentSeason(new Date(event.date)),
          event.date,
          snapshotVersion,
          x.name,
          x.team,
          x.probability,
          x.rank,
          x.rank === 1,
        ],
      );
    await saveWnbaContext(
      event,
      awayTeam,
      homeTeam,
      candidates,
      snapshotVersion.endsWith("-PROJECTED") ? "projected" : "confirmed",
    ).catch((error) =>
      console.warn("[WNBA Context] snapshot failed:", error),
    );
    locked++;
  }
  return { eligible, locked, waiting, upgraded };
}

export async function getWnbaDiagnostics(days = 30) {
  if (!pool)
    return {
      modelVersion: MODEL_VERSION,
      trackedPlayers: 0,
      processedGames: 0,
      openingEvidence: 0,
      lockedGames: 0,
      gradedGames: 0,
      topPickWins: 0,
      topPickAccuracy: null,
    };
  await ensureWnbaSchema();
  const r =
      (
        await pool.query(
          `SELECT (SELECT count(*) FROM wnba_fb_tracking WHERE season=$1) tracked_players,(SELECT count(*) FROM wnba_processed_games) processed_games,(SELECT count(*) FROM wnba_opening_evidence WHERE confidence='verified') opening_evidence,(SELECT count(DISTINCT espn_game_id) FROM wnba_prediction_ledger WHERE locked_at>=now()-($2::text||' days')::interval) locked_games,(SELECT count(DISTINCT espn_game_id) FROM wnba_prediction_ledger WHERE graded_at IS NOT NULL AND locked_at>=now()-($2::text||' days')::interval) graded_games,(SELECT count(*) FROM wnba_prediction_ledger WHERE is_top_pick AND won=true AND locked_at>=now()-($2::text||' days')::interval) top_wins,(SELECT count(*) FROM wnba_prediction_ledger WHERE is_top_pick AND graded_at IS NOT NULL AND locked_at>=now()-($2::text||' days')::interval) top_graded`,
          [currentSeason(), Math.max(1, Math.min(days, 365))],
        )
      ).rows[0] || {},
    g = Number(r.top_graded || 0),
    w = Number(r.top_wins || 0);
  return {
    modelVersion: MODEL_VERSION,
    trackedPlayers: Number(r.tracked_players || 0),
    processedGames: Number(r.processed_games || 0),
    openingEvidence: Number(r.opening_evidence || 0),
    lockedGames: Number(r.locked_games || 0),
    gradedGames: Number(r.graded_games || 0),
    topPickWins: w,
    topPickAccuracy: g ? Math.round((w / g) * 1000) / 10 : null,
  };
}
