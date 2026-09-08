export type HrPitchArsenalRow = {
  playerId: number;
  pitchType: string;
  pitchName: string;
  pitches: number;
  usagePct: number;
  plateAppearances: number;
  xSlg: number | null;
  xWoba: number | null;
  hardHitPct: number | null;
  whiffPct: number | null;
};

export type HrPitchMatchup = {
  score: number;
  multiplier: number;
  samplePitches: number;
  matchedUsagePct: number;
  topPitch: string | null;
  topPitchUsagePct: number | null;
  topPitchHitterXSlg: number | null;
  explanation: string;
};

const SAVANT_ARSENAL = 'https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: Map<number, HrPitchArsenalRow[]> }>();

function num(v: string | undefined): number | null {
  if (v == null || v.trim() === '') return null;
  const n = Number(v.replace(/%/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

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

function first(row: Record<string, string>, names: string[]): string | undefined {
  for (const n of names) if (row[n] != null && row[n] !== '') return row[n];
  return undefined;
}

function normalizePitch(v: string): string {
  const s = v.trim().toUpperCase();
  const aliases: Record<string, string> = {
    '4-SEAM': 'FF', '4-SEAM FASTBALL': 'FF', 'FOUR-SEAM': 'FF', 'FOUR-SEAM FASTBALL': 'FF',
    'SINKER': 'SI', '2-SEAM': 'SI', '2-SEAM FASTBALL': 'SI', 'CUTTER': 'FC', 'SLIDER': 'SL',
    'SWEEPER': 'ST', 'CURVEBALL': 'CU', 'CURVE': 'CU', 'KNUCKLE CURVE': 'KC', 'CHANGEUP': 'CH',
    'CHANGE': 'CH', 'SPLITTER': 'FS', 'SPLIT-FINGER': 'FS', 'FORKBALL': 'FO', 'KNUCKLEBALL': 'KN'
  };
  return aliases[s] ?? s;
}

function parse(text: string): Map<number, HrPitchArsenalRow[]> {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const out = new Map<number, HrPitchArsenalRow[]>();
  if (lines.length < 2) return out;
  const headers = csvLine(lines[0]).map(h => h.trim());
  for (const line of lines.slice(1)) {
    const vals = csvLine(line); const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    const playerId = Number(first(row, ['player_id', 'playerid', 'id']));
    const rawPitch = first(row, ['pitch_type', 'pitchType', 'pitch_name', 'pitch']) ?? '';
    if (!Number.isFinite(playerId) || !rawPitch) continue;
    const item: HrPitchArsenalRow = {
      playerId,
      pitchType: normalizePitch(rawPitch),
      pitchName: first(row, ['pitch_name', 'pitch', 'pitch_type']) ?? rawPitch,
      pitches: num(first(row, ['pitches', 'pitch_count'])) ?? 0,
      usagePct: num(first(row, ['pitch_usage', 'usage', 'percent', 'pitch_percent', 'pct'])) ?? 0,
      plateAppearances: num(first(row, ['pa', 'plate_appearances'])) ?? 0,
      xSlg: num(first(row, ['xslg', 'xSLG', 'est_slg'])) ,
      xWoba: num(first(row, ['xwoba', 'xwOBA', 'est_woba'])) ,
      hardHitPct: num(first(row, ['hard_hit_percent', 'hard_hit_pct', 'hardhit_percent'])) ,
      whiffPct: num(first(row, ['whiff_percent', 'whiff_pct']))
    };
    const arr = out.get(playerId) ?? []; arr.push(item); out.set(playerId, arr);
  }
  return out;
}

async function fetchRows(type: 'batter' | 'pitcher', season: number): Promise<Map<number, HrPitchArsenalRow[]>> {
  const key = `${type}:${season}`; const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const params = new URLSearchParams({ type, year: String(season), min: '1', minPitches: '1', csv: 'true' });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(`${SAVANT_ARSENAL}?${params}`, { signal: controller.signal, headers: { 'User-Agent': 'PreziTools/1.0' } });
    if (!r.ok) throw new Error(`Baseball Savant arsenal ${r.status}`);
    const value = parse(await r.text()); cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value }); return value;
  } finally { clearTimeout(timer); }
}

export async function fetchHrPitchArsenal(season: number): Promise<{ batters: Map<number, HrPitchArsenalRow[]>; pitchers: Map<number, HrPitchArsenalRow[]>; available: boolean }> {
  try {
    const [batters, pitchers] = await Promise.all([fetchRows('batter', season), fetchRows('pitcher', season)]);
    return { batters, pitchers, available: batters.size > 0 && pitchers.size > 0 };
  } catch (e) {
    console.warn('[MLB HR Arsenal] unavailable; using neutral matchup:', e);
    return { batters: new Map(), pitchers: new Map(), available: false };
  }
}

function metricScore(row: HrPitchArsenalRow): number {
  let total = 0, weight = 0;
  if (row.xSlg != null) { total += Math.max(0, Math.min(100, (row.xSlg - .250) / .500 * 100)) * .55; weight += .55; }
  if (row.xWoba != null) { total += Math.max(0, Math.min(100, (row.xWoba - .220) / .260 * 100)) * .25; weight += .25; }
  if (row.hardHitPct != null) { total += Math.max(0, Math.min(100, (row.hardHitPct - 20) / 45 * 100)) * .20; weight += .20; }
  return weight ? total / weight : 50;
}

export function pitchArsenalMatchup(hitter: HrPitchArsenalRow[] | undefined, pitcher: HrPitchArsenalRow[] | undefined): HrPitchMatchup {
  if (!hitter?.length || !pitcher?.length) return { score: 50, multiplier: 1, samplePitches: 0, matchedUsagePct: 0, topPitch: null, topPitchUsagePct: null, topPitchHitterXSlg: null, explanation: 'Pitch-arsenal sample unavailable; neutral matchup used' };
  const hitterByPitch = new Map(hitter.map(r => [r.pitchType, r]));
  const arsenal = pitcher.filter(r => r.pitches >= 15 || r.usagePct >= 5).sort((a,b) => b.usagePct - a.usagePct);
  let weighted = 0, used = 0, samplePitches = 0; let top: { p: HrPitchArsenalRow; h: HrPitchArsenalRow; contribution: number } | null = null;
  for (const p of arsenal) {
    const h = hitterByPitch.get(p.pitchType); if (!h || h.plateAppearances < 8) continue;
    const usage = p.usagePct > 1 ? p.usagePct / 100 : p.usagePct;
    const reliability = Math.max(.35, Math.min(1, h.plateAppearances / 45));
    const raw = metricScore(h); const regressed = 50 + (raw - 50) * reliability;
    weighted += regressed * usage; used += usage; samplePitches += h.pitches;
    const contribution = Math.abs(regressed - 50) * usage;
    if (!top || contribution > top.contribution) top = { p, h, contribution };
  }
  if (used < .15) return { score: 50, multiplier: 1, samplePitches, matchedUsagePct: Math.round(used*1000)/10, topPitch: null, topPitchUsagePct: null, topPitchHitterXSlg: null, explanation: 'Too little matched pitch-type usage; neutral matchup used' };
  const score = Math.round(Math.max(0, Math.min(100, weighted / used)));
  const multiplier = Math.max(.90, Math.min(1.12, 1 + (score - 50) * .0024));
  const topName = top?.p.pitchName ?? top?.p.pitchType ?? null;
  return {
    score, multiplier: Math.round(multiplier*1000)/1000, samplePitches, matchedUsagePct: Math.round(used*1000)/10,
    topPitch: topName, topPitchUsagePct: top ? Math.round(top.p.usagePct*10)/10 : null,
    topPitchHitterXSlg: top?.h.xSlg ?? null,
    explanation: top ? `${topName} drives the matchup: hitter xSLG ${top.h.xSlg?.toFixed(3) ?? 'N/A'} vs a pitch used ${top.p.usagePct.toFixed(1)}% by the probable pitcher` : `Matched ${Math.round(used*100)}% of the probable pitcher's arsenal`
  };
}
