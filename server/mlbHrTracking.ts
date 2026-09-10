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

type Candidate={gamePk:number;gameTime:string;playerId:number;player:string;team:string;opponent:string;probability:number;confidence:number;tier:string;lineupConfirmed:boolean;season?:{plateAppearances?:number}};
type Feed={modelVersion?:string;strongest?:Candidate[];watchlist?:Candidate[]};
function eligible(p:Candidate){const pa=Number(p.season?.plateAppearances??0);return pa>=100&&(p.lineupConfirmed?(p.tier==='POWER_PLAY'||(p.tier==='STRONG'&&p.confidence>=76&&p.probability>=20)):(p.probability>=17&&p.confidence>=58));}
export async function captureMlbHrBestPlays(feed:Feed){const c=db();if(!c)return 0;await ensure();const unique=[...new Map([...(feed.strongest??[]),...(feed.watchlist??[])].map(p=>[`${p.gamePk}-${p.playerId}`,p])).values()];let written=0;for(const p of unique.filter(eligible)){const start=new Date(p.gameTime);if(!Number.isFinite(start.getTime())||start.getTime()<=Date.now())continue;const r=await c.query(`INSERT INTO mlb_hr_best_play_ledger(game_pk,game_start_at,model_version,player_id,player_name,team,opponent,model_probability,confidence,tier,lineup_confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(game_pk,player_id) DO NOTHING RETURNING id`,[p.gamePk,start,String(feed.modelVersion||'hr-v4-direction'),p.playerId,p.player,p.team,p.opponent,p.probability,p.confidence,p.tier,p.lineupConfirmed]);written+=r.rowCount??0;}return written;}

async function gameResult(gamePk:string,playerId:string):Promise<{final:boolean;homeRuns:number}|null>{const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000);try{const r=await fetch(`https://statsapi.mlb.com/api/v1.1/game/${encodeURIComponent(gamePk)}/feed/live`,{signal:ctl.signal,headers:{'User-Agent':'PreziTools/1.0'}});if(!r.ok)return null;const d:any=await r.json();const state=String(d?.gameData?.status?.abstractGameState??d?.gameData?.status?.detailedState??'').toLowerCase();const final=state==='final'||state.includes('game over')||state.includes('completed');if(!final)return{final:false,homeRuns:0};const key=`ID${playerId}`;const p=d?.liveData?.boxscore?.teams?.away?.players?.[key]??d?.liveData?.boxscore?.teams?.home?.players?.[key];const hrs=Number(p?.stats?.batting?.homeRuns??0);return{final:true,homeRuns:Number.isFinite(hrs)?hrs:0};}catch{return null}finally{clearTimeout(timer)}}
export async function gradePendingMlbHrBestPlays(limit=100){const c=db();if(!c)return{checked:0,graded:0};await ensure();const r=await c.query(`SELECT id,game_pk,player_id FROM mlb_hr_best_play_ledger WHERE graded_at IS NULL AND game_start_at<now()-interval '2 hours' ORDER BY game_start_at ASC LIMIT $1`,[Math.max(1,Math.min(limit,250))]);let graded=0;for(const row of r.rows){const result=await gameResult(String(row.game_pk),String(row.player_id));if(!result?.final)continue;await c.query(`UPDATE mlb_hr_best_play_ledger SET hr_count=$2,won=$3,graded_at=now() WHERE id=$1 AND graded_at IS NULL`,[row.id,result.homeRuns,result.homeRuns>0]);graded++;}return{checked:r.rows.length,graded};}

async function captureFromPublicFeed(){if(process.env.NODE_ENV!=='production')return;const base=(process.env.RENDER_EXTERNAL_URL||process.env.PUBLIC_BASE_URL||'https://prezitools.com').replace(/\/$/,'');const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),15000);try{const r=await fetch(`${base}/api/mlb/home-runs`,{signal:ctl.signal,headers:{'User-Agent':'PreziTools-HR-Tracker/1.0'}});if(!r.ok)return;await captureMlbHrBestPlays(await r.json() as Feed);}catch(e){console.warn('[MLB HR Tracking] capture failed',e)}finally{clearTimeout(timer)}}
export function startMlbHrBestPlayTracker(){if(schedulerStarted||process.env.NODE_ENV!=='production')return;schedulerStarted=true;const run=async()=>{try{await captureFromPublicFeed();await gradePendingMlbHrBestPlays(120)}catch(e){console.warn('[MLB HR Tracking] cycle failed',e)}};setTimeout(()=>void run(),60_000);setInterval(()=>void run(),5*60_000);}
startMlbHrBestPlayTracker();
