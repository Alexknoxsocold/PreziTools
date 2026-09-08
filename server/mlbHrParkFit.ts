export type BatterSide = 'L' | 'R' | 'S' | null;

export type HrParkFit = {
  factor: number;
  score: number;
  handedness: BatterSide;
  source: 'Baseball Savant' | 'fallback';
  explanation: string;
};

const SAVANT_PARKS = 'https://baseballsavant.mlb.com/leaderboard/statcast-park-factors';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: Map<string, number> }>();

function csvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}

function norm(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function numeric(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseParkCsv(text: string, season: number): Map<string, number> {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const out = new Map<string, number>();
  if (lines.length < 2) return out;
  const headers = csvLine(lines[0]).map(h => h.trim());
  for (const line of lines.slice(1)) {
    const vals = csvLine(line); const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    const venue = row.Venue || row.venue || row.Name || row.name || '';
    if (!venue) continue;
    const raw = row[String(season)] || row.HR || row.hr || row.ParkFactor || row.park_factor || row.index_HR;
    const index = numeric(raw);
    if (index != null && index > 40 && index < 180) out.set(norm(venue), index / 100);
  }
  return out;
}

async function fetchSide(season: number, side: 'L' | 'R'): Promise<Map<string, number>> {
  const key = `${season}:${side}`; const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const params = new URLSearchParams({ type: 'venue', year: String(season), batSide: side, condition: 'All', stat: 'index_HR', rolling: '3', parks: 'mlb', csv: 'true' });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const r = await fetch(`${SAVANT_PARKS}?${params}`, { signal: controller.signal, headers: { 'User-Agent': 'PreziTools/1.0' } });
    if (!r.ok) throw new Error(`Baseball Savant park factors ${r.status}`);
    const value = parseParkCsv(await r.text(), season);
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  } finally { clearTimeout(timer); }
}

export async function fetchHrParkFactors(season: number): Promise<{ left: Map<string, number>; right: Map<string, number>; available: boolean }> {
  try {
    const [left, right] = await Promise.all([fetchSide(season, 'L'), fetchSide(season, 'R')]);
    return { left, right, available: left.size > 5 && right.size > 5 };
  } catch (e) {
    console.warn('[MLB HR Park Fit] unavailable; using existing neutral park layer:', e);
    return { left: new Map(), right: new Map(), available: false };
  }
}

function lookup(map: Map<string, number>, venue: string | null): number | null {
  if (!venue) return null;
  const key = norm(venue);
  if (map.has(key)) return map.get(key)!;
  for (const [name, factor] of map) if (name.includes(key) || key.includes(name)) return factor;
  return null;
}

export function handedParkFit(venue: string | null, side: BatterSide, left: Map<string, number>, right: Map<string, number>, fallbackFactor: number): HrParkFit {
  const l = lookup(left, venue), r = lookup(right, venue);
  let raw: number | null = null;
  if (side === 'L') raw = l;
  else if (side === 'R') raw = r;
  else if (side === 'S' && l != null && r != null) raw = (l + r) / 2;
  if (raw == null) return { factor: fallbackFactor, score: Math.round(Math.max(0, Math.min(100, 50 + (fallbackFactor - 1) * 250))), handedness: side, source: 'fallback', explanation: `${side ?? 'Unknown'}-handed park split unavailable; base park carry used` };
  // Three-year Savant HR park factors can be noisy. Shrink toward neutral and cap impact.
  const shrunk = 1 + (raw - 1) * 0.65;
  const factor = Math.max(.88, Math.min(1.14, shrunk));
  const score = Math.round(Math.max(0, Math.min(100, 50 + (factor - 1) * 300)));
  return { factor: Math.round(factor * 1000) / 1000, score, handedness: side, source: 'Baseball Savant', explanation: `${side ?? 'Unknown'}-handed HR park fit ${(factor * 100).toFixed(1)}% of neutral after regression` };
}
