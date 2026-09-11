import { getOfficialResults, type League } from "./internationalBaseballOfficial.js";

export type TeamFormContext = {
  games: number;
  wins: number;
  winPct: number;
  runsForPerGame: number;
  runsAllowedPerGame: number;
  runDiffPerGame: number;
  restDays: number;
};

const cache = new Map<string, { expiresAt: number; value: Map<string, TeamFormContext> }>();

function shiftIso(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getRecentTeamForm(league: League, targetDate: string, lookbackDays = 10) {
  const cacheKey = `${league}:${targetDate}:${lookbackDays}`;
  const existing = cache.get(cacheKey);
  if (existing && existing.expiresAt > Date.now()) return existing.value;

  const dates = Array.from({ length: lookbackDays }, (_, i) => shiftIso(targetDate, -(i + 1)));
  const settled = await Promise.allSettled(dates.map(date => getOfficialResults(league, date)));
  const games = settled.flatMap(result => result.status === "fulfilled" ? result.value : []);
  const byTeam = new Map<string, { games: number; wins: number; runsFor: number; runsAllowed: number; lastDate: string | null }>();

  for (const game of games) {
    const rows = [
      { key: game.awayKey, scored: game.awayScore, allowed: game.homeScore },
      { key: game.homeKey, scored: game.homeScore, allowed: game.awayScore },
    ];
    for (const row of rows) {
      const current = byTeam.get(row.key) ?? { games: 0, wins: 0, runsFor: 0, runsAllowed: 0, lastDate: null };
      current.games += 1;
      current.wins += row.scored > row.allowed ? 1 : 0;
      current.runsFor += row.scored;
      current.runsAllowed += row.allowed;
      if (!current.lastDate || game.date > current.lastDate) current.lastDate = game.date;
      byTeam.set(row.key, current);
    }
  }

  const out = new Map<string, TeamFormContext>();
  for (const [key, value] of byTeam) {
    const last = value.lastDate ? new Date(`${value.lastDate}T12:00:00Z`).getTime() : NaN;
    const target = new Date(`${targetDate}T12:00:00Z`).getTime();
    const restDays = Number.isFinite(last) ? Math.max(0, Math.round((target - last) / 86400000) - 1) : lookbackDays;
    const runsForPerGame = value.games ? value.runsFor / value.games : 0;
    const runsAllowedPerGame = value.games ? value.runsAllowed / value.games : 0;
    out.set(key, {
      games: value.games,
      wins: value.wins,
      winPct: value.games ? value.wins / value.games : 0.5,
      runsForPerGame,
      runsAllowedPerGame,
      runDiffPerGame: runsForPerGame - runsAllowedPerGame,
      restDays,
    });
  }

  cache.set(cacheKey, { expiresAt: Date.now() + 15 * 60_000, value: out });
  return out;
}
