import { canonicalTeamKey, type League } from "./internationalBaseballOfficial.js";

export type BullpenContext = {
  teamKey: string;
  teamEra: number;
  games: number;
  saves: number;
  holds: number;
  leveragePerGame: number;
  strength: number;
};

const UA = "PreziTools/1.0 (+https://prezitools.com)";
const YEAR = new Date().getUTCFullYear();
let cache: { expiresAt: number; value: Record<League, Map<string, BullpenContext>> } | null = null;

function decode(v: string) {
  return v.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}
function plain(v: string) {
  return decode(v.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function rows(html: string) {
  const out: string[][] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m => plain(m[1]));
    if (cells.length) out.push(cells);
  }
  return out;
}
function num(v: string | undefined) {
  if (!v) return null;
  const n = Number(v.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
async function getHtml(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } });
  if (!r.ok) throw new Error(`Official bullpen source returned ${r.status}: ${url}`);
  return r.text();
}

type Raw = { teamKey: string; teamEra: number; games: number; saves: number; holds: number };
function finalize(raw: Raw[]) {
  const out = new Map<string, BullpenContext>();
  if (!raw.length) return out;
  const avgEra = raw.reduce((s, r) => s + r.teamEra, 0) / raw.length;
  const avgLev = raw.reduce((s, r) => s + (r.saves + r.holds) / r.games, 0) / raw.length;
  for (const r of raw) {
    const leveragePerGame = (r.saves + r.holds) / r.games;
    // Team ERA includes starters, so it is deliberately a smaller piece of this relief proxy.
    // Saves + holds per game are official relief/leverage outcomes and carry more weight.
    const eraComponent = clamp((avgEra - r.teamEra) / 2.5, -0.45, 0.45);
    const leverageComponent = clamp((leveragePerGame - avgLev) / 1.2, -0.30, 0.30);
    const strength = clamp(eraComponent * 0.4 + leverageComponent * 0.6, -0.40, 0.40);
    out.set(r.teamKey, { ...r, leveragePerGame, strength });
  }
  return out;
}

async function fetchKbo() {
  const html = await getHtml("https://eng.koreabaseball.com/Stats/TeamStats.aspx");
  const raw: Raw[] = [];
  for (const c of rows(html)) {
    const key = canonicalTeamKey("KBO", c[0] ?? "");
    const era = num(c[1]), games = num(c[2]), saves = num(c[7]), holds = num(c[8]);
    if (!key || era == null || games == null || games < 20 || saves == null || holds == null) continue;
    raw.push({ teamKey: key, teamEra: era, games, saves, holds });
  }
  return finalize(raw);
}

async function fetchNpb() {
  const pages = await Promise.all([
    getHtml(`https://npb.jp/bis/${YEAR}/stats/tmp_c.html`),
    getHtml(`https://npb.jp/bis/${YEAR}/stats/tmp_p.html`),
  ]);
  const raw: Raw[] = [];
  for (const html of pages) {
    for (const c of rows(html)) {
      const key = canonicalTeamKey("NPB", c[0] ?? "");
      const era = num(c[1]), games = num(c[2]), saves = num(c[5]), holds = num(c[6]);
      if (!key || era == null || games == null || games < 20 || saves == null || holds == null) continue;
      raw.push({ teamKey: key, teamEra: era, games, saves, holds });
    }
  }
  return finalize(raw);
}

export async function getOfficialBullpenContext() {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const [KBO, NPB] = await Promise.all([fetchKbo(), fetchNpb()]);
  const value = { KBO, NPB };
  cache = { expiresAt: Date.now() + 30 * 60_000, value };
  return value;
}
