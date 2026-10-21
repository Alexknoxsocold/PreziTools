import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
let officialScheduleCache:{at:number,data:any}|null=null;

export type WnbaStarter={name:string;team:string};
export type WnbaOpeningEvidence={gameId:string;gameDate:string;teamA:string;teamB:string;tipWinnerTeam:string|null;tipPlayerA:string|null;tipPlayerB:string|null;firstShotPlayer:string;firstShotTeam:string;firstShotMade:boolean;firstMadePlayer:string;firstMadeTeam:string;confidence:'verified'};
const normName=(v:string)=>v.toLowerCase().replace(/[.'’\-]/g,'').replace(/\s+/g,' ').trim();
const normTeam=(v:string)=>v.toUpperCase().trim();
const canonicalTeam=(v:string)=>({GS:'GS',GSV:'GS',LV:'LV',LVA:'LV',LA:'LA',LAS:'LA',NY:'NY',NYL:'NY',WSH:'WSH',WAS:'WSH',PHX:'PHX',PHO:'PHX'} as Record<string,string>)[normTeam(v)]||normTeam(v);
async function getJson(url:string,headers:Record<string,string>={}){try{const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0',...headers},signal:AbortSignal.timeout(9000)});return r.ok?await r.json():null}catch{return null}}
function periodNumber(p:any){return Number(p?.period?.number??p?.period??99)}
function clockSeconds(p:any){const raw=String(p?.clock?.displayValue??p?.clock??'0:00');const x=raw.split(':').map(Number);return x.length===2&&!x.some(Number.isNaN)?x[0]*60+x[1]:-1}
function seq(p:any){const n=Number(p?.sequenceNumber??p?.id??0);return Number.isFinite(n)?n:0}
export function chronologicalPlays(summary:any){return[...(summary?.plays||[])].sort((a,b)=>periodNumber(a)-periodNumber(b)||clockSeconds(b)-clockSeconds(a)||seq(a)-seq(b))}
function participantName(p:any){const q=(p?.participants||[]).find((x:any)=>!['assist','block'].includes(String(x?.type||'').toLowerCase()))||p?.participants?.[0];return String(q?.athlete?.displayName||p?.athlete?.displayName||'').trim()}
function playTeam(p:any){return normTeam(String(p?.team?.abbreviation||p?.team?.shortDisplayName||''))}
function isFga(p:any){const t=String(p?.text||'').toLowerCase();if(t.includes('free throw')||!/( makes | misses )/.test(` ${t} `))return false;return /(layup|dunk|jumper|jump shot|three point|3-point|hook shot|shot)/i.test(t)||[2,3].includes(Number(p?.scoreValue??0))}
function isMade(p:any){const t=String(p?.text||'').toLowerCase();return isFga(p)&&(p?.scoringPlay===true||t.includes(' makes '))}
function inferName(p:any){const m=String(p?.text||'').match(/^(.+?)\s+(?:makes|misses)\s+/i);return m?.[1]?.trim()||''}
function starterFor(name:string,team:string,starters:WnbaStarter[]){const n=normName(name),t=canonicalTeam(team);return starters.find(s=>normName(s.name)===n&&(!t||canonicalTeam(s.team)===t))||null}
function shotIdentity(p:any,starters:WnbaStarter[]){const n=participantName(p)||inferName(p);return n?starterFor(n,playTeam(p),starters):null}
function parseJumpText(text:string,starters:WnbaStarter[],fallbackTeam=''){if(!/jump ball/i.test(text))return null;const vs=text.match(/jump ball\s+(.+?)\s+vs\.?\s+(.+?)(?:\s*\(|$)/i),a=vs?.[1]?.trim()||null,b=vs?.[2]?.trim()||null;let winner=canonicalTeam(fallbackTeam);const teams=[...new Set(starters.map(s=>canonicalTeam(s.team)))];if(!teams.includes(winner))winner='';if(!winner){const possession=text.match(/\((.+?)\s+(?:gains|controls|gets)\s+possession\)/i)||text.match(/(?:controlled by|possession to)\s+(.+?)(?:\.|$)/i);const poss=possession?.[1]?.trim()||'',s=poss?starterFor(poss,'',starters):null;if(s)winner=canonicalTeam(s.team)}return{winnerTeam:winner||null,a,b}}
function parseEspnJump(p:any,starters:WnbaStarter[]){const text=String(p?.text||'');if(!/jump ball/i.test(text))return null;const parsed=parseJumpText(text,starters,playTeam(p));if(!parsed)return null;const names=(p?.participants||[]).map((x:any)=>String(x?.athlete?.displayName||'').trim()).filter(Boolean);return{winnerTeam:parsed.winnerTeam,a:names[0]||parsed.a,b:names[1]||parsed.b}}

export function verifyOpeningEvidence(gameId:string,gameDate:string,summary:any,starters:WnbaStarter[]):WnbaOpeningEvidence|null{if(starters.length!==10)return null;const teams=[...new Set(starters.map(s=>canonicalTeam(s.team)))];if(teams.length!==2)return null;const plays=chronologicalPlays(summary).filter(p=>periodNumber(p)===1);if(!plays.length)return null;const shots=plays.filter(isFga),firstShot=shots[0],firstMade=shots.find(isMade);if(!firstShot||!firstMade)return null;const a=shotIdentity(firstShot,starters),m=shotIdentity(firstMade,starters);if(!a||!m)return null;const i1=plays.indexOf(firstShot),i2=plays.indexOf(firstMade);if(i1<0||i2<i1)return null;const jump=plays.map(p=>parseEspnJump(p,starters)).find(Boolean) as any;const winner=jump?.winnerTeam&&teams.includes(canonicalTeam(jump.winnerTeam))?canonicalTeam(jump.winnerTeam):null;return{gameId,gameDate,teamA:teams[0],teamB:teams[1],tipWinnerTeam:winner,tipPlayerA:jump?.a||null,tipPlayerB:jump?.b||null,firstShotPlayer:a.name,firstShotTeam:canonicalTeam(a.team),firstShotMade:isMade(firstShot),firstMadePlayer:m.name,firstMadeTeam:canonicalTeam(m.team),confidence:'verified'}}

async function officialSchedule(){if(officialScheduleCache&&Date.now()-officialScheduleCache.at<6*60*60*1000)return officialScheduleCache.data;const data=await getJson('https://cdn.wnba.com/static/json/staticData/scheduleLeagueV2.json');if(data)officialScheduleCache={at:Date.now(),data};return data}
function scheduleDate(v:any){const raw=String(v||'');const m=raw.match(/(\d{4})-(\d{2})-(\d{2})/)||raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);if(!m)return'';return m[1].length===4?`${m[1]}-${m[2]}-${m[3]}`:`${m[3]}-${m[1]}-${m[2]}`}
async function findOfficialGameId(e:WnbaOpeningEvidence){const data=await officialSchedule(),dates=data?.leagueSchedule?.gameDates||data?.gameDates||[];for(const d of dates){const date=scheduleDate(d?.gameDate||d?.date);if(date&&date!==e.gameDate)continue;for(const g of d?.games||[]){const away=canonicalTeam(String(g?.awayTeam?.teamTricode||g?.awayTeam?.teamCode||'')),home=canonicalTeam(String(g?.homeTeam?.teamTricode||g?.homeTeam?.teamCode||'')),set=new Set([away,home]);if(set.has(canonicalTeam(e.teamA))&&set.has(canonicalTeam(e.teamB)))return String(g?.gameId||g?.gameID||'')}}return''}
export async function enrichTipFromOfficialWnba(e:WnbaOpeningEvidence,starters:WnbaStarter[]):Promise<WnbaOpeningEvidence>{if(e.tipWinnerTeam)return e;const id=await findOfficialGameId(e);if(!id)return e;const data=await getJson(`https://stats.wnba.com/stats/playbyplayv3?GameID=${encodeURIComponent(id)}&StartPeriod=0&EndPeriod=0`,{'Referer':'https://www.wnba.com/','Origin':'https://www.wnba.com','x-nba-stats-origin':'stats','x-nba-stats-token':'true'});const actions=data?.game?.actions||data?.actions||[];const jump=actions.find((a:any)=>Number(a?.period)===1&&(String(a?.actionType||'').toLowerCase()==='jumpball'||/jump ball/i.test(String(a?.description||''))));if(!jump)return e;const text=String(jump?.description||''),parsed=parseJumpText(text,starters,String(jump?.teamTricode||''));if(!parsed)return e;const teams=[canonicalTeam(e.teamA),canonicalTeam(e.teamB)],winner=parsed.winnerTeam&&teams.includes(canonicalTeam(parsed.winnerTeam))?canonicalTeam(parsed.winnerTeam):null;return{...e,tipWinnerTeam:winner,tipPlayerA:parsed.a||e.tipPlayerA,tipPlayerB:parsed.b||e.tipPlayerB}}

let wnbaEvidenceSchemaInit: Promise<void> | null = null;
export async function ensureWnbaEvidenceSchema() {
  if (!pool) return;
  if (wnbaEvidenceSchemaInit) return wnbaEvidenceSchemaInit;
  wnbaEvidenceSchemaInit = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Share the same lock as the main WNBA schema initializer.
      await client.query("SELECT pg_advisory_xact_lock(712026, 1)");
      await client.query(`CREATE TABLE IF NOT EXISTS wnba_opening_evidence(espn_game_id text PRIMARY KEY,game_date date NOT NULL,team_a text,team_b text,tip_winner_team text,tip_player_a text,tip_player_b text,first_shot_player text NOT NULL,first_shot_team text NOT NULL,first_shot_made boolean NOT NULL,first_made_player text NOT NULL,first_made_team text NOT NULL,confidence text NOT NULL DEFAULT 'verified',verified_at timestamptz NOT NULL DEFAULT now());ALTER TABLE wnba_opening_evidence ADD COLUMN IF NOT EXISTS team_a text;ALTER TABLE wnba_opening_evidence ADD COLUMN IF NOT EXISTS team_b text;CREATE INDEX IF NOT EXISTS wnba_opening_evidence_date_idx ON wnba_opening_evidence(game_date DESC);`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    wnbaEvidenceSchemaInit = null;
    throw error;
  });
  return wnbaEvidenceSchemaInit;
}
export async function saveOpeningEvidence(e:WnbaOpeningEvidence){if(!pool)return;await ensureWnbaEvidenceSchema();await pool.query(`INSERT INTO wnba_opening_evidence(espn_game_id,game_date,team_a,team_b,tip_winner_team,tip_player_a,tip_player_b,first_shot_player,first_shot_team,first_shot_made,first_made_player,first_made_team,confidence,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'verified',now()) ON CONFLICT(espn_game_id) DO UPDATE SET game_date=EXCLUDED.game_date,team_a=EXCLUDED.team_a,team_b=EXCLUDED.team_b,tip_winner_team=EXCLUDED.tip_winner_team,tip_player_a=EXCLUDED.tip_player_a,tip_player_b=EXCLUDED.tip_player_b,first_shot_player=EXCLUDED.first_shot_player,first_shot_team=EXCLUDED.first_shot_team,first_shot_made=EXCLUDED.first_shot_made,first_made_player=EXCLUDED.first_made_player,first_made_team=EXCLUDED.first_made_team,confidence='verified',verified_at=now()`,[e.gameId,e.gameDate,e.teamA,e.teamB,e.tipWinnerTeam,e.tipPlayerA,e.tipPlayerB,e.firstShotPlayer,e.firstShotTeam,e.firstShotMade,e.firstMadePlayer,e.firstMadeTeam])}
export async function getOpeningPlayerStats(season:number){const out=new Map<string,{firstShots:number;firstMakes:number;firstBaskets:number}>();if(!pool)return out;await ensureWnbaEvidenceSchema();const rows=await pool.query(`SELECT * FROM wnba_opening_evidence WHERE extract(year from game_date)=$1 AND confidence='verified'`,[season]);const add=(name:string,f:'firstShots'|'firstMakes'|'firstBaskets')=>{if(!name)return;const k=normName(name),v=out.get(k)||{firstShots:0,firstMakes:0,firstBaskets:0};v[f]++;out.set(k,v)};for(const r of rows.rows){add(r.first_shot_player,'firstShots');if(r.first_shot_made)add(r.first_shot_player,'firstMakes');add(r.first_made_player,'firstBaskets')}return out}
export async function getTeamTipStats(season:number){const out=new Map<string,{wins:number;events:number}>();if(!pool)return out;await ensureWnbaEvidenceSchema();const rows=await pool.query(`SELECT team_a,team_b,tip_winner_team FROM wnba_opening_evidence WHERE extract(year from game_date)=$1 AND confidence='verified' AND tip_winner_team IS NOT NULL`,[season]);for(const r of rows.rows){for(const t of[r.team_a,r.team_b]){if(!t)continue;const k=canonicalTeam(t),v=out.get(k)||{wins:0,events:0};v.events++;if(canonicalTeam(r.tip_winner_team)===k)v.wins++;out.set(k,v)}}return out}
