export type League = "KBO" | "NPB";

export type OfficialTeamMetric = {
  key: string;
  games: number;
  winPct: number;
  homePct: number | null;
  awayPct: number | null;
  runsPerGame: number;
  runsAllowedPerGame: number;
};

export type OfficialGameResult = {
  league: League;
  date: string;
  awayKey: string;
  homeKey: string;
  awayScore: number;
  homeScore: number;
};

const UA = "PreziTools/1.0 (+https://prezitools.com)";
const YEAR = new Date().getUTCFullYear();
let metricCache: { expiresAt: number; value: Record<League, Map<string, OfficialTeamMetric>> } | null = null;
const resultCache = new Map<string, { expiresAt: number; value: OfficialGameResult[] }>();

function htmlDecode(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function text(value: string) {
  return htmlDecode(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function tableRows(html: string): string[][] {
  const out: string[][] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m => text(m[1]));
    if (cells.length) out.push(cells);
  }
  return out;
}

async function getHtml(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } });
  if (!response.ok) throw new Error(`Official baseball source returned ${response.status}: ${url}`);
  return response.text();
}

function pctFromRecord(value: string): number | null {
  const match = value.match(/(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);
  if (!match) return null;
  const wins = Number(match[1]);
  const losses = Number(match[2]);
  return wins + losses > 0 ? wins / (wins + losses) : null;
}

function norm(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9가-힣一-龯ァ-ヶ]/g, "");
}

const aliases: Array<[string, string[]]> = [
  ["kbo:lg", ["lg", "lg twins"]],
  ["kbo:kt", ["kt", "kt wiz", "kt wiz suwon"]],
  ["kbo:samsung", ["samsung", "samsung lions"]],
  ["kbo:kia", ["kia", "kia tigers"]],
  ["kbo:doosan", ["doosan", "doosan bears"]],
  ["kbo:nc", ["nc", "nc dinos"]],
  ["kbo:hanwha", ["hanwha", "hanwha eagles"]],
  ["kbo:lotte", ["lotte", "lotte giants"]],
  ["kbo:ssg", ["ssg", "ssg landers"]],
  ["kbo:kiwoom", ["kiwoom", "kiwoom heroes"]],
  ["npb:hanshin", ["hanshin", "hanshin tigers", "阪神", "阪神タイガース"]],
  ["npb:yomiuri", ["yomiuri", "yomiuri giants", "読売", "読売ジャイアンツ", "巨人"]],
  ["npb:dena", ["dena", "yokohama dena baystars", "yokohama dena", "横浜dena", "横浜denaベイスターズ", "deNA"]],
  ["npb:yakult", ["yakult", "tokyo yakult swallows", "東京ヤクルト", "東京ヤクルトスワローズ", "ヤクルト"]],
  ["npb:chunichi", ["chunichi", "chunichi dragons", "中日", "中日ドラゴンズ"]],
  ["npb:hiroshima", ["hiroshima", "hiroshima toyo carp", "広島", "広島東洋", "広島東洋カープ"]],
  ["npb:softbank", ["softbank", "fukuoka softbank hawks", "福岡ソフトバンク", "福岡ソフトバンクホークス", "ソフトバンク"]],
  ["npb:nipponham", ["nippon-ham", "nippon ham", "hokkaido nippon-ham fighters", "北海道日本ハム", "北海道日本ハムファイターズ", "日本ハム"]],
  ["npb:orix", ["orix", "orix buffaloes", "オリックス", "オリックス・バファローズ"]],
  ["npb:rakuten", ["rakuten", "tohoku rakuten golden eagles", "東北楽天", "東北楽天ゴールデンイーグルス", "楽天"]],
  ["npb:seibu", ["seibu", "saitama seibu lions", "埼玉西武", "埼玉西武ライオンズ", "西武"]],
  ["npb:lotte", ["lotte", "chiba lotte marines", "千葉ロッテ", "千葉ロッテマリーンズ", "ロッテ"]],
];

const aliasMap = new Map<string, string>();
for (const [key, values] of aliases) for (const value of values) aliasMap.set(norm(value), key);

export function canonicalTeamKey(league: League, value: string): string | null {
  const n = norm(value);
  const direct = aliasMap.get(n);
  if (direct?.startsWith(`${league.toLowerCase()}:`)) return direct;
  for (const [alias, key] of aliasMap) if (key.startsWith(`${league.toLowerCase()}:`) && (n.includes(alias) || alias.includes(n))) return key;
  return null;
}

async function fetchKboMetrics(): Promise<Map<string, OfficialTeamMetric>> {
  const html = await getHtml("https://eng.koreabaseball.com/Standings/TeamStandings.aspx");
  const rows = tableRows(html);
  const out = new Map<string, OfficialTeamMetric>();
  for (const cells of rows) {
    if (!/^\d+$/.test(cells[0] ?? "") || cells.length < 7) continue;
    const key = canonicalTeamKey("KBO", cells[1] ?? "");
    const games = Number(cells[2]);
    const winPct = Number(cells[6]);
    if (!key || !Number.isFinite(games) || !Number.isFinite(winPct)) continue;
    out.set(key, { key, games, winPct, homePct: pctFromRecord(cells[9] ?? ""), awayPct: pctFromRecord(cells[10] ?? ""), runsPerGame: 0, runsAllowedPerGame: 0 });
  }
  for (const cells of rows) {
    if (!/^\d+$/.test(cells[0] ?? "") || cells.length < 7) continue;
    const key = canonicalTeamKey("KBO", cells[1] ?? "");
    const existing = key ? out.get(key) : null;
    const runs = Number(cells[4]);
    const allowed = Number(cells[5]);
    if (!existing || !Number.isFinite(runs) || !Number.isFinite(allowed) || existing.games <= 0) continue;
    existing.runsPerGame = runs / existing.games;
    existing.runsAllowedPerGame = allowed / existing.games;
  }
  return out;
}

function parseNpbStandings(html: string, out: Map<string, OfficialTeamMetric>) {
  for (const cells of tableRows(html)) {
    if (cells.length < 7) continue;
    const key = canonicalTeamKey("NPB", cells[0] ?? "");
    const games = Number(cells[1]);
    const winPct = Number(cells[5]);
    if (!key || !Number.isFinite(games) || !Number.isFinite(winPct)) continue;
    out.set(key, { key, games, winPct, homePct: pctFromRecord(cells[7] ?? ""), awayPct: pctFromRecord(cells[8] ?? ""), runsPerGame: 0, runsAllowedPerGame: 0 });
  }
}

function parseNpbBatting(html: string, out: Map<string, OfficialTeamMetric>) {
  for (const cells of tableRows(html)) {
    if (cells.length < 7) continue;
    const key = canonicalTeamKey("NPB", cells[0] ?? "");
    const games = Number(cells[2]);
    const runs = Number(cells[5]);
    const existing = key ? out.get(key) : null;
    if (existing && Number.isFinite(games) && games > 0 && Number.isFinite(runs)) existing.runsPerGame = runs / games;
  }
}

function parseNpbPitching(html: string, out: Map<string, OfficialTeamMetric>) {
  for (const cells of tableRows(html)) {
    if (cells.length < 23) continue;
    const key = canonicalTeamKey("NPB", cells[0] ?? "");
    const games = Number(cells[2]);
    const runsAllowed = Number(cells[22]);
    const existing = key ? out.get(key) : null;
    if (existing && Number.isFinite(games) && games > 0 && Number.isFinite(runsAllowed)) existing.runsAllowedPerGame = runsAllowed / games;
  }
}

async function fetchNpbMetrics(): Promise<Map<string, OfficialTeamMetric>> {
  const urls = [
    `https://npb.jp/bis/eng/${YEAR}/stats/std_c.html`,
    `https://npb.jp/bis/eng/${YEAR}/stats/std_p.html`,
    `https://npb.jp/bis/${YEAR}/stats/tmb_c.html`,
    `https://npb.jp/bis/${YEAR}/stats/tmb_p.html`,
    `https://npb.jp/bis/${YEAR}/stats/tmp_c.html`,
    `https://npb.jp/bis/${YEAR}/stats/tmp_p.html`,
  ];
  const html = await Promise.all(urls.map(getHtml));
  const out = new Map<string, OfficialTeamMetric>();
  parseNpbStandings(html[0], out);
  parseNpbStandings(html[1], out);
  parseNpbBatting(html[2], out);
  parseNpbBatting(html[3], out);
  parseNpbPitching(html[4], out);
  parseNpbPitching(html[5], out);
  return out;
}

export async function getOfficialTeamMetrics(): Promise<Record<League, Map<string, OfficialTeamMetric>>> {
  if (metricCache && metricCache.expiresAt > Date.now()) return metricCache.value;
  const [kbo, npb] = await Promise.all([fetchKboMetrics(), fetchNpbMetrics()]);
  const value = { KBO: kbo, NPB: npb };
  metricCache = { value, expiresAt: Date.now() + 15 * 60_000 };
  return value;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function fetchKboResults(date: string): Promise<OfficialGameResult[]> {
  const html = await getHtml(`https://eng.koreabaseball.com/Schedule/Scoreboard.aspx?searchDate=${encodeURIComponent(date)}`);
  const plain = text(html);
  const token = "(LG|KT|SAMSUNG|KIA|DOOSAN|NC|HANWHA|LOTTE|SSG|KIWOOM)";
  const re = new RegExp(`${token}\\s+(\\d+)\\s+FINAL\\s+(\\d+)\\s+${token}`, "gi");
  const out: OfficialGameResult[] = [];
  for (const match of plain.matchAll(re)) {
    const awayKey = canonicalTeamKey("KBO", match[1]);
    const homeKey = canonicalTeamKey("KBO", match[4]);
    if (!awayKey || !homeKey) continue;
    out.push({ league: "KBO", date, awayKey, homeKey, awayScore: Number(match[2]), homeScore: Number(match[3]) });
  }
  return out;
}

async function fetchNpbResults(date: string): Promise<OfficialGameResult[]> {
  const d = new Date(`${date}T12:00:00Z`);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = d.getUTCDate();
  const html = await getHtml(`https://npb.jp/games/${d.getUTCFullYear()}/schedule_${month}_detail.html`);
  const rows = tableRows(html);
  const out: OfficialGameResult[] = [];
  let currentDay: number | null = null;
  const teamPattern = "(阪神|巨人|DeNA|ヤクルト|中日|広島|ソフトバンク|日本ハム|オリックス|楽天|西武|ロッテ)";
  const gameRe = new RegExp(`${teamPattern}\\s+(\\d+)\\s*-\\s*(\\d+)\\s+${teamPattern}`);
  for (const cells of rows) {
    const dayMatch = (cells[0] ?? "").match(/^(\d{1,2})\/(\d{1,2})/);
    if (dayMatch) currentDay = Number(dayMatch[2]);
    if (currentDay !== day) continue;
    const candidate = cells.join(" ");
    const match = candidate.match(gameRe);
    if (!match) continue;
    const awayKey = canonicalTeamKey("NPB", match[1]);
    const homeKey = canonicalTeamKey("NPB", match[4]);
    if (!awayKey || !homeKey) continue;
    out.push({ league: "NPB", date, awayKey, homeKey, awayScore: Number(match[2]), homeScore: Number(match[3]) });
  }
  return out;
}

export async function getOfficialResults(league: League, date: string): Promise<OfficialGameResult[]> {
  const cacheKey = `${league}:${date}`;
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = league === "KBO" ? await fetchKboResults(date) : await fetchNpbResults(date);
  resultCache.set(cacheKey, { value, expiresAt: Date.now() + 10 * 60_000 });
  return value;
}

export function dateInLeagueZone(date: Date, league: League): string {
  const timeZone = league === "KBO" ? "Asia/Seoul" : "Asia/Tokyo";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = parts.find(p => p.type === "year")?.value ?? String(date.getUTCFullYear());
  const month = parts.find(p => p.type === "month")?.value ?? String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = parts.find(p => p.type === "day")?.value ?? String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
