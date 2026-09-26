/** Automatically records a verified first made field goal as soon as an NBA game exposes it. */
import {
  getVerifiedNbaResult,
  recordVerifiedNbaGame,
  unresolvedNbaGameIds,
  type FirstBasketStarter,
} from './fbSeasonStore';
import {
  gradeFirstBasketPredictionGame,
  lockUpcomingFirstBasketPredictions,
} from './fbPredictionLedger';

function etDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  return `${p.find(x=>x.type==='year')?.value}${p.find(x=>x.type==='month')?.value}${p.find(x=>x.type==='day')?.value}`;
}

type ESPNGame = { id: string; status: { type: { completed?: boolean; state?: string; description?: string; detail?: string } } };
function gameCanGrade(game: ESPNGame): boolean {
  const type = game?.status?.type;
  const state = String(type?.state || '').toLowerCase();
  const description = String(type?.description || type?.detail || '').toLowerCase();
  return type?.completed === true || state === 'in' || description.includes('in progress') || description.includes('halftime');
}
async function trackableGames(date: string): Promise<ESPNGame[]> {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.events || []).filter(gameCanGrade);
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[.'’\-]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeTeam(raw: string): string {
  const value = raw.toUpperCase();
  const map: Record<string,string> = {
    GSW:'GS', GS:'GS', NOP:'NO', NO:'NO', NYK:'NY', NY:'NY', SAS:'SA', SA:'SA',
    PHO:'PHX', PHX:'PHX', UTA:'UTAH', UTAH:'UTAH', WAS:'WAS', WSH:'WAS',
  };
  return map[value] || value;
}

function isMadeFieldGoal(p: any): boolean {
  if (!p?.scoringPlay) return false;
  const text = String(p.text || '').toLowerCase();
  if (!text.includes(' makes ') || text.includes('free throw')) return false;
  const v = Number(p.scoreValue ?? 0);
  return v === 2 || v === 3 || text.includes('layup') || text.includes('dunk') || text.includes('jumper') || text.includes('shot');
}

function extractStarters(data: any): FirstBasketStarter[] {
  const starters: FirstBasketStarter[] = [];
  for (const teamBlock of data?.boxscore?.players || []) {
    const team = normalizeTeam(String(teamBlock?.team?.abbreviation || ''));
    if (!team) continue;
    for (const group of teamBlock?.statistics || []) {
      for (const row of group?.athletes || []) {
        if (row?.starter !== true || row?.didNotPlay === true) continue;
        const playerName = String(row?.athlete?.displayName || '').trim();
        if (playerName) starters.push({ playerName, team });
      }
    }
  }
  return [...new Map(starters.map(s => [`${normalizeName(s.playerName)}|${s.team}`, s])).values()];
}

async function getGameEvidence(gameId: string): Promise<{ scorer: FirstBasketStarter; starters: FirstBasketStarter[]; gameDate: Date } | null> {
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gameId}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (String(data.header?.id || '') !== gameId) return null;
    return parseNbaGameEvidence(data);
  } catch {
    return null;
  }
}

export function parseNbaGameEvidence(data: any): {scorer:FirstBasketStarter;starters:FirstBasketStarter[];gameDate:Date}|null {
    const starters = extractStarters(data);
    const teamCounts = new Map<string,number>();
    for (const starter of starters) teamCounts.set(starter.team,(teamCounts.get(starter.team)||0)+1);
    if (starters.length !== 10 || teamCounts.size !== 2 || [...teamCounts.values()].some(n=>n!==5)) return null;
    const gameDate = new Date(data.header?.competitions?.[0]?.date || data.header?.date);
    if (!Number.isFinite(gameDate.getTime()) || gameDate.getTime() >= Date.now()) return null;

    const firstPeriod = (data.plays || []).filter((p:any) => Number(p.period?.number) === 1).sort((a:any,b:any) => {
      const seconds = (p:any) => { const [m,s] = String(p.clock?.displayValue || '').split(':').map(Number); return m*60+s; };
      return seconds(b)-seconds(a) || Number(a.sequenceNumber || 0)-Number(b.sequenceNumber || 0);
    });
    // A truncated feed cannot establish the first made field goal.
    if (!firstPeriod.length || !/^1[12]:/.test(String(firstPeriod[0].clock?.displayValue || ''))) return null;
    const play = firstPeriod.find(isMadeFieldGoal);
    if (!play) return null;
    const participant = (play.participants || []).find((p:any) => p.type !== 'assist' && p.type !== 'block') || play.participants?.[0];
    let playerName = participant?.athlete?.displayName || play.athlete?.displayName;
    if (!playerName) {
      const text = String(play.text || '');
      const idx = text.indexOf(' makes ');
      playerName = idx > 0 ? text.slice(0, idx).trim() : null;
    }
    if (!playerName) return null;

    let team = normalizeTeam(String(play.team?.abbreviation || ''));
    if (!team) {
      team = starters.find(s => normalizeName(s.playerName) === normalizeName(playerName))?.team || '';
    }
    if (!team) return null;

    return { scorer: { playerName, team }, starters, gameDate };
}

type TrackerResult = { processed: number; skipped: number; errors: string[] };
let trackerInFlight: Promise<TrackerResult> | null = null;

async function runFirstBasketTrackerPass(): Promise<TrackerResult> {
  const result = { processed: 0, skipped: 0, errors: [] as string[] };
  try {
    // The same cron loop that grades completed games also owns the pregame lock.
    // This keeps official predictions independent from user page refreshes.
    await lockUpcomingFirstBasketPredictions().catch(error => {
      console.warn('[FB Ledger] Pregame lock pass failed:', error);
    });

    const games = [...await trackableGames(etDate()), ...await trackableGames(etDate(-1))];
    const legacyIds = await unresolvedNbaGameIds();
    const unique = [...new Map([...games, ...legacyIds.map(id => ({id}))].map(g => [g.id, g])).values()];
    for (const game of unique) {
      const verified = await getVerifiedNbaResult(game.id);
      if (verified) {
        await gradeFirstBasketPredictionGame(game.id, verified.playerName, verified.team);
        result.skipped++; continue;
      }
      const evidence = await getGameEvidence(game.id);
      if (!evidence) {
        result.errors.push(`Game ${game.id}: scorer/starters unresolved; will retry`);
        continue;
      }
      await recordVerifiedNbaGame(game.id, evidence.starters, evidence.scorer, evidence.gameDate);
      await gradeFirstBasketPredictionGame(game.id, evidence.scorer.playerName, evidence.scorer.team).catch(error => {
        console.warn(`[FB Ledger] Grading failed for ${game.id}:`, error);
      });
      result.processed++;
    }
  } catch (err:any) {
    result.errors.push(err?.message || String(err));
  }
  return result;
}

export async function runFirstBasketTracker(): Promise<TrackerResult> {
  if (trackerInFlight) return trackerInFlight;
  trackerInFlight = runFirstBasketTrackerPass().finally(() => {
    trackerInFlight = null;
  });
  return trackerInFlight;
}
