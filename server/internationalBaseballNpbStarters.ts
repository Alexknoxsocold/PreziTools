import { canonicalTeamKey } from "./internationalBaseballOfficial.js";

export type NpbStarterContext = {
  teamKey: string;
  name: string;
  playerUrl: string;
  era: number | null;
  games: number | null;
  wins: number | null;
  losses: number | null;
  innings: number | null;
  strikeouts: number | null;
  kPer9: number | null;
};

const UA = "PreziTools/1.0 (+https://prezitools.com)";
const YEAR = new Date().getUTCFullYear();
const cache = new Map<string, { expiresAt: number; value: Map<string, NpbStarterContext> }>();

function decode(v: string) {
  return v
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function plain(v: string) {
  return decode(v.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function tableRows(html: string) {
  const rows: string[][] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m => plain(m[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function num(v: string | undefined) {
  if (!v) return null;
  const n = Number(v.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function inningsToDecimal(v: string | undefined) {
  if (!v) return null;
  const m = v.trim().match(/^(\d+)(?:\.(\d))?$/);
  if (!m) return null;
  const whole = Number(m[1]);
  const outs = Number(m[2] ?? 0);
  if (!Number.isFinite(whole) || ![0, 1, 2].includes(outs)) return null;
  return whole + outs / 3;
}

async function getHtml(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } });
  if (!r.ok) throw new Error(`NPB starter source returned ${r.status}: ${url}`);
  return r.text();
}

async function pitcherStats(playerUrl: string) {
  const html = await getHtml(playerUrl);
  for (const c of tableRows(html)) {
    if ((c[0] ?? "").trim() !== String(YEAR) || c.length < 20) continue;
    const games = num(c[2]);
    const wins = num(c[3]);
    const losses = num(c[4]);
    const innings = inningsToDecimal(c[13]);
    const strikeouts = num(c[18]);
    const era = num(c[23] ?? c[c.length - 1]);
    const kPer9 = innings && innings > 0 && strikeouts != null ? strikeouts * 9 / innings : null;
    return { era, games, wins, losses, innings, strikeouts, kPer9 };
  }
  return { era: null, games: null, wins: null, losses: null, innings: null, strikeouts: null, kPer9: null };
}

const TEAMS = [
  "読売ジャイアンツ", "阪神タイガース", "横浜DeNAベイスターズ", "東京ヤクルトスワローズ", "中日ドラゴンズ", "広島東洋カープ",
  "福岡ソフトバンクホークス", "北海道日本ハムファイターズ", "オリックス・バファローズ", "東北楽天ゴールデンイーグルス", "埼玉西武ライオンズ", "千葉ロッテマリーンズ",
];

export async function getNpbAnnouncedStarters(date: string) {
  const existing = cache.get(date);
  if (existing && existing.expiresAt > Date.now()) return existing.value;

  const html = await getHtml("https://npb.jp/announcement/starter/");
  const dateParts = date.split("-");
  const month = Number(dateParts[1]);
  const day = Number(dateParts[2]);
  const pageText = plain(html);
  if (!pageText.includes(`${month}月${day}日の予告先発投手`)) {
    const empty = new Map<string, NpbStarterContext>();
    cache.set(date, { expiresAt: Date.now() + 10 * 60_000, value: empty });
    return empty;
  }

  const out = new Map<string, NpbStarterContext>();
  for (const team of TEAMS) {
    const escaped = team.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`alt=["']${escaped}["'][\\s\\S]{0,1200}?href=["']([^"']*\\/bis\\/players\\/\\d+\\.html)["'][^>]*>([\\s\\S]*?)<\\/a>`, "i");
    const m = html.match(re);
    if (!m) continue;
    const teamKey = canonicalTeamKey("NPB", team);
    if (!teamKey) continue;
    const playerUrl = m[1].startsWith("http") ? m[1] : `https://npb.jp${m[1].startsWith("/") ? "" : "/"}${m[1]}`;
    const name = plain(m[2]);
    if (!name) continue;
    let stats = { era: null as number | null, games: null as number | null, wins: null as number | null, losses: null as number | null, innings: null as number | null, strikeouts: null as number | null, kPer9: null as number | null };
    try { stats = await pitcherStats(playerUrl); } catch (error) { console.warn(`[NPB starters] stats unavailable for ${name}`, error); }
    out.set(teamKey, { teamKey, name, playerUrl, ...stats });
  }

  cache.set(date, { expiresAt: Date.now() + 30 * 60_000, value: out });
  return out;
}
