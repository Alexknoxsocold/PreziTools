export type League = "KBO" | "NPB";

export type OfficialTeamMetric = { key:string; games:number; winPct:number; homePct:number|null; awayPct:number|null; runsPerGame:number; runsAllowedPerGame:number };
export type OfficialGameResult = { league:League; date:string; awayKey:string; homeKey:string; awayScore:number; homeScore:number };
const UA="PreziTools/1.0 (+https://prezitools.com)"; const YEAR=new Date().getUTCFullYear();
let metricCache:{expiresAt:number;value:Record<League,Map<string,OfficialTeamMetric>>}|null=null;
const resultCache=new Map<string,{expiresAt:number;value:OfficialGameResult[]}>();
function htmlDecode(v:string){return v.replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">")}
function text(v:string){return htmlDecode(v.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim()}
function tableRows(html:string){const out:string[][]=[];for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const cells=[...row[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m=>text(m[1]));if(cells.length)out.push(cells)}return out}
async function getHtml(url:string){const r=await fetch(url,{headers:{"User-Agent":UA,Accept:"text/html,application/xhtml+xml"}});if(!r.ok)throw new Error(`Official baseball source returned ${r.status}: ${url}`);return r.text()}
function pctFromRecord(v:string){const m=v.match(/(\d+)\s*-\s*(\d+)/);if(!m)return null;const w=+m[1],l=+m[2];return w+l?w/(w+l):null}
function norm(v:string){return v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9가-힣一-龯ァ-ヶ]/g,"")}
const aliases:Array<[string,string[]]>=[
["kbo:lg",["lg","lg twins"]],["kbo:kt",["kt","kt wiz","kt wiz suwon"]],["kbo:samsung",["samsung","samsung lions"]],["kbo:kia",["kia","kia tigers"]],["kbo:doosan",["doosan","doosan bears"]],["kbo:nc",["nc","nc dinos"]],["kbo:hanwha",["hanwha","hanwha eagles"]],["kbo:lotte",["lotte","lotte giants"]],["kbo:ssg",["ssg","ssg landers"]],["kbo:kiwoom",["kiwoom","kiwoom heroes"]],
["npb:hanshin",["hanshin","hanshin tigers","阪神","阪神タイガース"]],["npb:yomiuri",["yomiuri","yomiuri giants","読売","読売ジャイアンツ","巨人"]],["npb:dena",["dena","yokohama dena baystars","yokohama dena","横浜dena","横浜denaベイスターズ"]],["npb:yakult",["yakult","tokyo yakult swallows","東京ヤクルト","東京ヤクルトスワローズ","ヤクルト"]],["npb:chunichi",["chunichi","chunichi dragons","中日","中日ドラゴンズ"]],["npb:hiroshima",["hiroshima","hiroshima toyo carp","広島","広島東洋","広島東洋カープ"]],["npb:softbank",["softbank","fukuoka softbank hawks","福岡ソフトバンク","福岡ソフトバンクホークス","ソフトバンク"]],["npb:nipponham",["nippon-ham","nippon ham","hokkaido nippon-ham fighters","北海道日本ハム","北海道日本ハムファイターズ","日本ハム"]],["npb:orix",["orix","orix buffaloes","オリックス","オリックス・バファローズ"]],["npb:rakuten",["rakuten","tohoku rakuten golden eagles","東北楽天","東北楽天ゴールデンイーグルス","楽天"]],["npb:seibu",["seibu","saitama seibu lions","埼玉西武","埼玉西武ライオンズ","西武"]],["npb:lotte",["lotte","chiba lotte marines","千葉ロッテ","千葉ロッテマリーンズ","ロッテ"]]];
const aliasMap=new Map<string,string>();for(const [key,vals] of aliases)for(const v of vals)aliasMap.set(norm(v),key);
export function canonicalTeamKey(league:League,value:string){const n=norm(value);if(!n)return null;const direct=aliasMap.get(n);if(direct?.startsWith(`${league.toLowerCase()}:`))return direct;let best:string|null=null,bestLen=0;for(const [a,k] of aliasMap){if(!k.startsWith(`${league.toLowerCase()}:`)||a.length<2)continue;if((n.includes(a)||a.includes(n))&&a.length>bestLen){best=k;bestLen=a.length}}return best}
function numeric(v:string){if(!v.trim())return null;const n=Number(v.replace(/,/g,""));return Number.isFinite(n)?n:null}

// Bind values to a recognized table header. Other tables on the same page must
// never overwrite season records with batting averages or interleague splits.
export function officialRows(html:string, required:string[]):Record<string,string>[] {
  let header:string[]=[];
  const out:Record<string,string>[]=[];
  for(const cells of tableRows(html)){
    if(cells.some(cell=>["TEAM","Team","チーム","年度"].includes(cell))){
      header=required.every(label=>cells.includes(label))?cells:[];
      continue;
    }
    if(header.length && cells.length===header.length)
      out.push(Object.fromEntries(header.map((label,index)=>[label,cells[index]])));
  }
  return out;
}
export function parseKboMetrics(html:string){
  const out=new Map<string,OfficialTeamMetric>();
  for(const r of officialRows(html,["RK","TEAM","GAMES","W","L","D","PCT","HOME","AWAY"])){
    const key=canonicalTeamKey("KBO",r.TEAM),g=numeric(r.GAMES),w=numeric(r.W),l=numeric(r.L),d=numeric(r.D),wp=numeric(r.PCT);
    if(!key||g==null||!Number.isInteger(g)||g<=0||w==null||l==null||d==null||w+l+d!==g||wp==null||wp<0||wp>1)continue;
    out.set(key,{key,games:g,winPct:wp,homePct:pctFromRecord(r.HOME),awayPct:pctFromRecord(r.AWAY),runsPerGame:0,runsAllowedPerGame:0});
  }
  return out;
}
async function fetchKboMetrics(){return parseKboMetrics(await getHtml("https://eng.koreabaseball.com/Standings/TeamStandings.aspx"))}
export function parseNpbStandings(html:string,out:Map<string,OfficialTeamMetric>){
  for(const r of officialRows(html,["Team","G","W","L","T","PCT","GB","Home","Road"])){
    const key=canonicalTeamKey("NPB",r.Team),g=numeric(r.G),w=numeric(r.W),l=numeric(r.L),t=numeric(r.T),wp=numeric(r.PCT);
    if(!key||g==null||!Number.isInteger(g)||g<=0||w==null||l==null||t==null||w+l+t!==g||wp==null||wp<0||wp>1)continue;
    out.set(key,{key,games:g,winPct:wp,homePct:pctFromRecord(r.Home),awayPct:pctFromRecord(r.Road),runsPerGame:0,runsAllowedPerGame:0});
  }
}
export function parseNpbBatting(html:string,out:Map<string,OfficialTeamMetric>){
  for(const r of officialRows(html,["チーム","試合","得点","打率"])){
    const key=canonicalTeamKey("NPB",r["チーム"]),existing=key?out.get(key):null,g=numeric(r["試合"]),runs=numeric(r["得点"]);
    if(existing&&g!=null&&g>0&&runs!=null&&runs>=0)existing.runsPerGame=runs/g;
  }
}
export function parseNpbPitching(html:string,out:Map<string,OfficialTeamMetric>){
  for(const r of officialRows(html,["チーム","試合","失点","防御率"])){
    const key=canonicalTeamKey("NPB",r["チーム"]),existing=key?out.get(key):null,g=numeric(r["試合"]),runs=numeric(r["失点"]);
    if(existing&&g!=null&&g>0&&runs!=null&&runs>=0)existing.runsAllowedPerGame=runs/g;
  }
}
async function fetchNpbMetrics(){const urls=[`https://npb.jp/bis/eng/${YEAR}/stats/std_c.html`,`https://npb.jp/bis/eng/${YEAR}/stats/std_p.html`,`https://npb.jp/bis/${YEAR}/stats/tmb_c.html`,`https://npb.jp/bis/${YEAR}/stats/tmb_p.html`,`https://npb.jp/bis/${YEAR}/stats/tmp_c.html`,`https://npb.jp/bis/${YEAR}/stats/tmp_p.html`];const html=await Promise.all(urls.map(getHtml));const out=new Map<string,OfficialTeamMetric>();parseNpbStandings(html[0],out);parseNpbStandings(html[1],out);parseNpbBatting(html[2],out);parseNpbBatting(html[3],out);parseNpbPitching(html[4],out);parseNpbPitching(html[5],out);return out}
export async function getOfficialTeamMetrics(){if(metricCache&&metricCache.expiresAt>Date.now())return metricCache.value;const [kbo,npb]=await Promise.all([fetchKboMetrics(),fetchNpbMetrics()]);const value={KBO:kbo,NPB:npb};metricCache={value,expiresAt:Date.now()+15*60_000};return value}
async function fetchKboResults(date:string){const html=await getHtml(`https://eng.koreabaseball.com/Schedule/Scoreboard.aspx?searchDate=${encodeURIComponent(date)}`);const plain=text(html);const token="(LG|KT|SAMSUNG|KIA|DOOSAN|NC|HANWHA|LOTTE|SSG|KIWOOM)";const re=new RegExp(`${token}\\s+(\\d+)\\s+FINAL\\s+(\\d+)\\s+${token}`,"gi");const out:OfficialGameResult[]=[];for(const m of plain.matchAll(re)){const awayKey=canonicalTeamKey("KBO",m[1]),homeKey=canonicalTeamKey("KBO",m[4]);if(awayKey&&homeKey)out.push({league:"KBO",date,awayKey,homeKey,awayScore:+m[2],homeScore:+m[3]})}return out}
async function fetchNpbResults(date:string){const d=new Date(`${date}T12:00:00Z`),month=String(d.getUTCMonth()+1).padStart(2,"0"),day=d.getUTCDate();const html=await getHtml(`https://npb.jp/games/${d.getUTCFullYear()}/schedule_${month}_detail.html`);const out:OfficialGameResult[]=[];let currentDay:number|null=null;const team="(阪神|巨人|DeNA|ヤクルト|中日|広島|ソフトバンク|日本ハム|オリックス|楽天|西武|ロッテ)",re=new RegExp(`${team}\\s+(\\d+)\\s*-\\s*(\\d+)\\s+${team}`);for(const c of tableRows(html)){const dm=(c[0]??"").match(/^(\d{1,2})\/(\d{1,2})/);if(dm)currentDay=+dm[2];if(currentDay!==day)continue;const m=c.join(" ").match(re);if(!m)continue;const awayKey=canonicalTeamKey("NPB",m[1]),homeKey=canonicalTeamKey("NPB",m[4]);if(awayKey&&homeKey)out.push({league:"NPB",date,awayKey,homeKey,awayScore:+m[2],homeScore:+m[3]})}return out}
export async function getOfficialResults(league:League,date:string){const ck=`${league}:${date}`,cached=resultCache.get(ck);if(cached&&cached.expiresAt>Date.now())return cached.value;const value=league==="KBO"?await fetchKboResults(date):await fetchNpbResults(date);resultCache.set(ck,{value,expiresAt:Date.now()+10*60_000});return value}
export function dateInLeagueZone(date:Date,league:League){const timeZone=league==="KBO"?"Asia/Seoul":"Asia/Tokyo";const p=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);const get=(t:string)=>p.find(x=>x.type===t)?.value??"";return `${get("year")}-${get("month")}-${get("day")}`}
