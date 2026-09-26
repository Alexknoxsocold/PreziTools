import { canonicalTeamKey, officialRows, type League } from "./internationalBaseballOfficial.js";

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

export function parseBullpen(html:string,league:League){
  const raw:Raw[]=[];
  const labels=league==="KBO"?{team:"TEAM",era:"ERA",games:"G",saves:"SV",holds:"HLD"}:{team:"チーム",era:"防御率",games:"試合",saves:"セーブ",holds:"ホールド"};
  for(const r of officialRows(html,Object.values(labels))){
    const key=canonicalTeamKey(league,r[labels.team]);
    const era=num(r[labels.era]),games=num(r[labels.games]),saves=num(r[labels.saves]),holds=num(r[labels.holds]);
    if(!key||era==null||era<0||games==null||!Number.isInteger(games)||games<20||saves==null||holds==null||saves<0||holds<0)continue;
    raw.push({teamKey:key,teamEra:era,games,saves,holds});
  }
  return finalize(raw);
}
async function fetchKbo(){return parseBullpen(await getHtml("https://eng.koreabaseball.com/Stats/TeamStats.aspx"),"KBO")}
async function fetchNpb(){
  const pages=await Promise.all([getHtml(`https://npb.jp/bis/${YEAR}/stats/tmp_c.html`),getHtml(`https://npb.jp/bis/${YEAR}/stats/tmp_p.html`)]);
  // Preserve the existing league-wide normalization across both divisions.
  return parseBullpen(pages.join("\n"),"NPB");
}

export async function getOfficialBullpenContext() {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const [KBO, NPB] = await Promise.all([fetchKbo(), fetchNpb()]);
  const value = { KBO, NPB };
  cache = { expiresAt: Date.now() + 30 * 60_000, value };
  return value;
}
