import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;
let pool:Pool|null=null;
let ready:Promise<void>|null=null;
let schedulerStarted=false;
function db(){if(!process.env.DATABASE_URL)return null;if(!pool)pool=new Pool({connectionString:process.env.DATABASE_URL});return pool;}
async function ensure(){if(ready)return ready;const c=db();if(!c)return;ready=c.query(`
  CREATE TABLE IF NOT EXISTS mlb_hr_best_play_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_pk bigint NOT NULL,
    game_start_at timestamptz NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT now(),
    model_version text NOT NULL,
    player_id bigint NOT NULL,
    player_name text NOT NULL,
    team text NOT NULL,
    opponent text NOT NULL,
    model_probability real NOT NULL,
    confidence integer NOT NULL,
    tier text NOT NULL,
    lineup_confirmed boolean NOT NULL,
    hr_count integer,
    won boolean,
    graded_at timestamptz,
    UNIQUE(game_pk,player_id)
  );
  CREATE INDEX IF NOT EXISTS mlb_hr_best_play_start_idx ON mlb_hr_best_play_ledger(game_start_at DESC);
  CREATE INDEX IF NOT EXISTS mlb_hr_best_play_graded_idx ON mlb_hr_best_play_ledger(graded_at,game_start_at DESC);
`).then(()=>undefined).catch(e=>{ready=null;throw e});return ready;}

type Candidate={gamePk:number;gameTime:string;playerId:number;player:string;team:string;opponent:string;probability:number;confidence:number;tier:string;lineupConfirmed:boolean;preziHrScore?:number;season?:{plateAppearances?:number};market?:{priceVerified?:boolean;modelEdge?:number;expectedValue?:number;valueTier?:string}|null};
type Feed={modelVersion?:string;strongest?:Candidate[];watchlist?:Candidate[];valuePlays?:Candidate[]};
// Public grading must mirror the strict HR lane used by BestPlays.tsx. Do not
// track the broader HR-page recommendation pool as if every candidate appeared
// in Best Plays.
function eligible(p:Candidate){
  const pa=Number(p.season?.plateAppearances??0);
  return pa>=100&&p.lineupConfirmed&&(p.tier==='POWER_PLAY'||p.tier==='STRONG');
}
function bestPlayStrength(p:Candidate){
  const market=p.market;
  const valueBonus=market?.priceVerified&&market.valueTier==='BEST_VALUE'?5:market?.priceVerified&&market.valueTier==='VALUE'?2:0;
  const edgeBonus=market?.priceVerified?Math.max(0,Math.min(8,Number(market.modelEdge??0)))*.5:0;
  const evBonus=market?.priceVerified?Math.max(0,Math.min(30,Number(market.expectedValue??0)))*.1:0;
  return Number(p.preziHrScore??0)+valueBonus+edgeBonus+evBonus;
}
export async function captureMlbHrBestPlays(feed:Feed){const c=db();if(!c)return 0;await ensure();const unique=[...new Map([...(feed.strongest??[]),...(feed.watchlist??[]),...(feed.valuePlays??[])].map(p=>[`${p.gamePk}-${p.playerId}`,p])).values()];const core=unique.filter(eligible).sort((a,b)=>bestPlayStrength(b)-bestPlayStrength(a)||Number(b.preziHrScore??0)-Number(a.preziHrScore??0)||b.confidence-a.confidence||b.probability-a.probability).slice(0,3);const coreIds=new Set(core.map(p=>`${p.gamePk}-${p.playerId}`));const bonus=unique.filter(p=>{const pa=Number(p.season?.plateAppearances??0);return pa>=100&&p.lineupConfirmed&&(p.tier==='POWER_PLAY'||p.tier==='STRONG')&&p.market?.priceVerified===true&&p.market?.valueTier==='BEST_VALUE'&&!coreIds.has(`${p.gamePk}-${p.playerId}`)}).sort((a,b)=>Number(b.market?.expectedValue??0)-Number(a.market?.expectedValue??0)||Number(b.market?.modelEdge??0)-Number(a.market?.modelEdge??0)).slice(0,1);const selected=[...core,...bonus];let written=0;for(const p of selected){const start=new Date(p.gameTime);if(!Number.isFinite(start.getTime())||start.getTime()<=Date.now())continue;const r=await c.query(`INSERT INTO mlb_hr_best_play_ledger(game_pk,game_start_at,model_version,player_id,player_name,team,opponent,model_probability,confidence,tier,lineup_confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(game_pk,player_id) DO NOTHING RETURNING id`,[p.gamePk,start,String(feed.modelVersion||'hr-v4-direction'),p.playerId,p.player,p.team,p.opponent,p.probability,p.confidence,p.tier,p.lineupConfirmed]);written+=r.rowCount??0;}return written;}

type LiveGameSnapshot={final:boolean;homeRuns:Map<string,number>};
const liveGameCache=new Map<string,{at:number,value:LiveGameSnapshot|null}>();
async function liveGameSnapshot(gamePk:string):Promise<LiveGameSnapshot|null>{const cached=liveGameCache.get(gamePk);if(cached&&Date.now()-cached.at<15_000)return cached.value;const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000);try{const r=await fetch(`https://statsapi.mlb.com/api/v1.1/game/${encodeURIComponent(gamePk)}/feed/live`,{signal:ctl.signal,headers:{'User-Agent':'PreziTools/1.0'}});if(!r.ok){liveGameCache.set(gamePk,{at:Date.now(),value:null});return null}const d:any=await r.json();const state=String(d?.gameData?.status?.abstractGameState??d?.gameData?.status?.detailedState??'').toLowerCase();const final=state==='final'||state.includes('game over')||state.includes('completed');const homeRuns=new Map<string,number>();for(const side of ['away','home'] as const){const players=d?.liveData?.boxscore?.teams?.[side]?.players??{};for(const [key,p] of Object.entries(players) as [string,any][]){const id=key.replace(/^ID/,'');const hrs=Number(p?.stats?.batting?.homeRuns??0);homeRuns.set(id,Number.isFinite(hrs)?hrs:0)}}const value={final,homeRuns};liveGameCache.set(gamePk,{at:Date.now(),value});return value}catch{liveGameCache.set(gamePk,{at:Date.now(),value:null});return null}finally{clearTimeout(timer)}}
async function gameResult(gamePk:string,playerId:string):Promise<{final:boolean;homeRuns:number}|null>{const game=await liveGameSnapshot(gamePk);if(!game)return null;return{final:game.final,homeRuns:game.homeRuns.get(String(playerId))??0}}
export async function getMlbHrLiveResults(entries:{gamePk:string;playerId:string}[]){const clean=entries.filter(x=>/^\d+$/.test(x.gamePk)&&/^\d+$/.test(x.playerId)).slice(0,8);const grouped=new Map<string,string[]>();for(const x of clean){const ids=grouped.get(x.gamePk)??[];if(!ids.includes(x.playerId))ids.push(x.playerId);grouped.set(x.gamePk,ids)}const rows:{gamePk:string;playerId:string;final:boolean;homeRuns:number}[]=[];await Promise.all([...grouped].map(async([gamePk,playerIds])=>{const game=await liveGameSnapshot(gamePk);if(!game)return;for(const playerId of playerIds)rows.push({gamePk,playerId,final:game.final,homeRuns:game.homeRuns.get(playerId)??0})}));return rows}
export async function gradePendingMlbHrBestPlays(limit=100){const c=db();if(!c)return{checked:0,graded:0};await ensure();const r=await c.query(`SELECT id,game_pk,player_id,graded_at,won,hr_count FROM mlb_hr_best_play_ledger WHERE game_start_at<now()-interval '5 minutes' AND (graded_at IS NULL OR (won IS TRUE AND game_start_at>now()-interval '8 hours')) ORDER BY game_start_at ASC LIMIT $1`,[Math.max(1,Math.min(limit,250))]);let graded=0;for(const row of r.rows){const result=await gameResult(String(row.game_pk),String(row.player_id));if(!result)continue;if(result.homeRuns>0){await c.query(`UPDATE mlb_hr_best_play_ledger SET hr_count=$2,won=true,graded_at=COALESCE(graded_at,now()) WHERE id=$1`,[row.id,result.homeRuns]);graded++;continue;}if(!result.final||row.graded_at)continue;await c.query(`UPDATE mlb_hr_best_play_ledger SET hr_count=0,won=false,graded_at=now() WHERE id=$1 AND graded_at IS NULL`,[row.id]);graded++;}return{checked:r.rows.length,graded};}

async function captureFromPublicFeed(){if(process.env.NODE_ENV!=='production')return;const base=(process.env.RENDER_EXTERNAL_URL||process.env.PUBLIC_BASE_URL||'https://prezitools.com').replace(/\/$/,'');const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),15000);try{const r=await fetch(`${base}/api/mlb/home-runs`,{signal:ctl.signal,headers:{'User-Agent':'PreziTools-HR-Tracker/1.0'}});if(!r.ok)return;await captureMlbHrBestPlays(await r.json() as Feed);}catch(e){console.warn('[MLB HR Tracking] capture failed',e)}finally{clearTimeout(timer)}}
export function startMlbHrBestPlayTracker(){if(schedulerStarted||process.env.NODE_ENV!=='production')return;schedulerStarted=true;const run=async()=>{try{await captureFromPublicFeed();await gradePendingMlbHrBestPlays(120)}catch(e){console.warn('[MLB HR Tracking] cycle failed',e)}};setTimeout(()=>void run(),60_000);setInterval(()=>void run(),5*60_000);}
startMlbHrBestPlayTracker();
