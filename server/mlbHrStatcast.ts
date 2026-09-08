export type HrStatcastProfile = {
  playerId: number;
  bbe: number;
  avgLaunchAngle: number | null;
  sweetSpotPct: number | null;
  maxEv: number | null;
  avgEv: number | null;
  ev50: number | null;
  hardHitPct: number | null;
  barrels: number;
  barrelPct: number | null;
  barrelPaPct: number | null;
};

const SAVANT_BASE = 'https://baseballsavant.mlb.com/leaderboard/statcast';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: Map<number, HrStatcastProfile> }>();

function num(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(current); current = '';
    } else current += ch;
  }
  out.push(current);
  return out;
}

function parseCsv(text: string): Map<number, HrStatcastProfile> {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const result = new Map<number, HrStatcastProfile>();
  if (lines.length < 2) return result;
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    const playerId = Number(row.player_id);
    if (!Number.isFinite(playerId)) continue;
    result.set(playerId, {
      playerId,
      bbe: num(row.attempts) ?? 0,
      avgLaunchAngle: num(row.avg_hit_angle),
      sweetSpotPct: num(row.anglesweetspotpercent),
      maxEv: num(row.max_hit_speed),
      avgEv: num(row.avg_hit_speed),
      ev50: num(row.ev50),
      hardHitPct: num(row.ev95percent),
      barrels: num(row.barrels) ?? 0,
      barrelPct: num(row.brl_percent),
      barrelPaPct: num(row.brl_pa),
    });
  }
  return result;
}

async function fetchLeaderboard(type: 'batter' | 'pitcher', season: number): Promise<Map<number, HrStatcastProfile>> {
  const key = `${type}:${season}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const url = `${SAVANT_BASE}?type=${type}&year=${season}&csv=true`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'PreziTools/1.0' } });
    if (!response.ok) throw new Error(`Baseball Savant ${response.status}`);
    const value = parseCsv(await response.text());
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  } finally { clearTimeout(timer); }
}

export async function fetchHrStatcast(season: number): Promise<{ batters: Map<number, HrStatcastProfile>; pitchers: Map<number, HrStatcastProfile>; available: boolean }> {
  try {
    const [batters, pitchers] = await Promise.all([fetchLeaderboard('batter', season), fetchLeaderboard('pitcher', season)]);
    return { batters, pitchers, available: batters.size > 0 };
  } catch (error) {
    console.warn('[MLB HR Statcast] unavailable; using core model:', error);
    return { batters: new Map(), pitchers: new Map(), available: false };
  }
}

function score(value: number | null, low: number, high: number): number {
  if (value === null) return 50;
  return Math.round(Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100)));
}

export function statcastPowerScore(profile?: HrStatcastProfile): number {
  if (!profile || profile.bbe < 25) return 50;
  const barrel = score(profile.barrelPaPct, 1.5, 12);
  const hardHit = score(profile.hardHitPct, 25, 60);
  const ev50 = score(profile.ev50, 94, 108);
  const sweet = score(profile.sweetSpotPct, 20, 45);
  return Math.round(barrel * 0.40 + hardHit * 0.25 + ev50 * 0.25 + sweet * 0.10);
}

export function pitcherContactRiskScore(profile?: HrStatcastProfile): number {
  if (!profile || profile.bbe < 25) return 50;
  const barrel = score(profile.barrelPct, 3, 16);
  const hardHit = score(profile.hardHitPct, 25, 55);
  const avgEv = score(profile.avgEv, 84, 94);
  return Math.round(barrel * 0.45 + hardHit * 0.35 + avgEv * 0.20);
}

export function statcastHrMultiplier(powerScore: number, pitcherRiskScore: number): number {
  const combined = powerScore * 0.68 + pitcherRiskScore * 0.32;
  return Math.max(0.88, Math.min(1.18, 1 + (combined - 50) * 0.0036));
}
