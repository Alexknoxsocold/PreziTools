import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import type { NflMarketGame, NflPlayerMarket } from './nflMarkets.js';
import { getNflTdGameResult } from './nflTdCalibration.js';

neonConfig.webSocketConstructor=ws;
const MODEL_VERSION='nfl-td-v3';
let pool:Pool|null=null;
let ready:Promise<void>|null=null;
function db(){if(!process.env.DATABASE_URL)return null;if(!pool)pool=new Pool({connectionString:process.env.DATABASE_URL});return pool;}
async function ensure(){
  if(ready)return ready;
  const c=db();if(!c)return;
  ready=c.query(`CREATE TABLE IF NOT EXISTS nfl_td_display_history(
    id text PRIMARY KEY,game_id text NOT NULL,game_start_at timestamptz NOT NULL,
    market text NOT NULL,player text NOT NULL,payload jsonb NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT now(),outcome boolean,
    grade_status text NOT NULL DEFAULT 'pending',first_td_player text,graded_at timestamptz
  );CREATE INDEX IF NOT EXISTS nfl_td_display_game_idx ON nfl_td_display_history(game_id,market);
  CREATE INDEX IF NOT EXISTS nfl_td_display_grade_idx ON nfl_td_display_history(grade_status,game_start_at DESC);\n  CREATE TABLE IF NOT EXISTS nfl_td_official_lock(\n    game_id text NOT NULL,market text NOT NULL,game_start_at timestamptz NOT NULL,\n    payload jsonb NOT NULL,locked_at timestamptz NOT NULL DEFAULT now(),\n    PRIMARY KEY(game_id,market)\n  );\n  CREATE INDEX IF NOT EXISTS nfl_td_official_lock_start_idx ON nfl_td_official_lock(game_start_at DESC);`).then(()=>{}).catch(error=>{ready=null;throw error;});
  return ready;
}
function norm(value:string){return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');}

export type HeldTdPlay={
  market:'anytime'|'first';player:string;bestOdds:number;bestBook:string;
  impliedProbability:number;quoteCount:number;quotes:[];modelProbability:number;
  edgePoints?:number;expectedValue?:number;confidence?:'watch'|'strong'|'elite';
  qualifies:boolean;reasons:string[];team?:string;position?:string;
  result:'won'|'lost'|'pending';
};

export const NFL_TD_OFFICIAL_LOCK_MINUTES=35;
const NFL_TD_OFFICIAL_LOCK_MS=NFL_TD_OFFICIAL_LOCK_MINUTES*60*1000;

export type NflTdOfficialLock={
  anytime:NflPlayerMarket[];
  first:NflPlayerMarket[];
  anytimeLockedAt:string|null;
  firstLockedAt:string|null;
};

/** Freeze the model board once it enters the 35-minute pre-kickoff lock window.
 * Before this point candidates are previews and may move as the model/market updates.
 * DATA NOT READY rows are never converted into locked model picks.
 */
export async function captureNflTdOfficialLock(game:NflMarketGame){
  const c=db();if(!c)return;
  const start=new Date(game.date),startsIn=start.getTime()-Date.now();
  if(!Number.isFinite(start.getTime())||startsIn<=0||startsIn>NFL_TD_OFFICIAL_LOCK_MS)return;
  await ensure();
  const markets:Array<{market:'anytime'|'first';rows:NflPlayerMarket[]}>= [
    {market:'anytime',rows:game.anytimeTd},
    {market:'first',rows:game.firstTd},
  ];
  for(const {market,rows} of markets){
    const modeled=rows.filter(row=>row.modelProbability!=null&&row.dataStatus!=='not-ready').slice(0,3);
    if(!modeled.length)continue;
    await c.query(`INSERT INTO nfl_td_official_lock(game_id,market,game_start_at,payload) VALUES($1,$2,$3,$4) ON CONFLICT(game_id,market) DO NOTHING`,[game.id,market,start,JSON.stringify(modeled)]);
  }
}

export async function getNflTdOfficialLock(gameId:string):Promise<NflTdOfficialLock>{
  const c=db();
  const empty:NflTdOfficialLock={anytime:[],first:[],anytimeLockedAt:null,firstLockedAt:null};
  if(!c)return empty;
  try{
    await ensure();
    const r=await c.query(`SELECT market,payload,locked_at FROM nfl_td_official_lock WHERE game_id=$1`,[gameId]);
    const out:NflTdOfficialLock={...empty};
    for(const row of r.rows){
      if(row.market==='anytime'){
        out.anytime=Array.isArray(row.payload)?row.payload:[];
        out.anytimeLockedAt=row.locked_at?new Date(row.locked_at).toISOString():null;
      }else if(row.market==='first'){
        out.first=Array.isArray(row.payload)?row.payload:[];
        out.firstLockedAt=row.locked_at?new Date(row.locked_at).toISOString():null;
      }
    }
    return out;
  }catch(error){console.warn('[NFL TD] official lock unavailable:',error);return empty;}
}
/** Freeze every player card shown before kickoff, including model leans. */
export async function captureNflTdDisplayPlays(game:NflMarketGame){
  const c=db();if(!c)return;
  const start=new Date(game.date);if(!Number.isFinite(start.getTime())||start.getTime()<=Date.now())return;
  await ensure();
  const rows:Array<{market:'anytime'|'first';play:NflPlayerMarket}>=[];
  game.anytimeTd.slice(0,3).forEach(play=>rows.push({market:'anytime',play}));
  game.firstTd.slice(0,3).forEach(play=>rows.push({market:'first',play}));
  for(const {market,play} of rows){
    if(!play.player)continue;
    const id=`${game.id}:${market}:${norm(play.player)}:display-v1`;
    await c.query(`INSERT INTO nfl_td_display_history(id,game_id,game_start_at,market,player,payload)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,captured_at=now()
      WHERE nfl_td_display_history.graded_at IS NULL`,[id,game.id,start,market,play.player,JSON.stringify(play)]);
  }
}

export async function gradePendingNflTdDisplayPlays(limit=12){
  const c=db();if(!c)return 0;await ensure();
  const games=await c.query(`SELECT DISTINCT game_id FROM nfl_td_display_history
    WHERE graded_at IS NULL AND game_start_at<now()-interval '3 hours' ORDER BY game_id LIMIT $1`,[Math.max(1,Math.min(limit,50))]);
  let graded=0;
  for(const game of games.rows){
    const result=await getNflTdGameResult(String(game.game_id));if(!result)continue;
    const rows=await c.query(`SELECT id,market,player FROM nfl_td_display_history WHERE game_id=$1 AND graded_at IS NULL`,[game.game_id]);
    for(const row of rows.rows){
      if(row.market==='first'&&result.firstStatus==='ambiguous'){
        await c.query(`UPDATE nfl_td_display_history SET grade_status='ambiguous',first_td_player=$2,graded_at=now() WHERE id=$1`,[row.id,result.first]);
        continue;
      }
      const hit=row.market==='first'
        ? result.firstStatus==='scorer'&&norm(String(row.player))===norm(String(result.first))
        : result.scorers.has(norm(String(row.player)));
      await c.query(`UPDATE nfl_td_display_history SET outcome=$2,grade_status=$3,first_td_player=$4,graded_at=now() WHERE id=$1`,[row.id,hit,hit?'win':'loss',result.first]);
    }
    graded++;
  }
  return graded;
}

/** Returns frozen pregame TD candidates through the 12:30 AM Eastern slate cutoff.
 * Prefer the current model version. If a game was captured before the current
 * model version was rolled out, fall back to its newest stored pregame version
 * so the game does not disappear at kickoff. Legacy rows remain MODEL LEANs;
 * they are never promoted to Official Plays by the display fallback.
 */
export async function getHeldNflTdPlays(gameId:string):Promise<{anytime:HeldTdPlay[];first:HeldTdPlay[]}>{
  const c=db();
  if(!c)return{anytime:[],first:[]};
  try{
    await ensure();
    const display=await c.query(`SELECT market,payload,grade_status,outcome FROM nfl_td_display_history WHERE game_id=$1 ORDER BY market,(payload->>'modelProbability')::numeric DESC NULLS LAST,captured_at DESC`,[gameId]);
    if(display.rows.length){
      const out:{anytime:HeldTdPlay[];first:HeldTdPlay[]}={anytime:[],first:[]};
      for(const row of display.rows){
        if(row.market!=='anytime'&&row.market!=='first'||out[row.market as 'anytime'|'first'].length>=3)continue;
        const result:HeldTdPlay['result']=row.grade_status==='win'&&row.outcome===true?'won':row.grade_status==='loss'&&row.outcome===false?'lost':'pending';
        out[row.market as 'anytime'|'first'].push({...row.payload,result});
      }
      return out;
    }
    const versions=await c.query(`SELECT model_version,max(captured_at) last_capture FROM nfl_td_prediction_history WHERE game_id=$1 GROUP BY model_version ORDER BY (model_version=$2) DESC,last_capture DESC LIMIT 1`,[gameId,MODEL_VERSION]);
    const version=versions.rows[0]?.model_version;
    if(!version)return{anytime:[],first:[]};
    const r=await c.query(`SELECT market,player,model_version,model_probability,market_probability,best_odds,best_book,edge_points,expected_value,confidence,quote_count,feature_snapshot,grade_status,outcome FROM nfl_td_prediction_history WHERE game_id=$1 AND model_version=$2 ORDER BY market,model_probability DESC,captured_at DESC`,[gameId,version]);
    const out:{anytime:HeldTdPlay[];first:HeldTdPlay[]}={anytime:[],first:[]};
    const currentVersion=version===MODEL_VERSION;
    for(const x of r.rows){
      if(x.market!=='anytime'&&x.market!=='first')continue;
      const market=x.market as 'anytime'|'first';
      if(out[market].length>=3)continue;
      const snap=x.feature_snapshot??{};
      const result:HeldTdPlay['result']=x.grade_status==='win'&&x.outcome===true?'won':x.grade_status==='loss'&&x.outcome===false?'lost':'pending';
      const p:HeldTdPlay={market,player:String(x.player),bestOdds:Number(x.best_odds??0),bestBook:String(x.best_book??'Pregame'),impliedProbability:Number(x.market_probability??0),quoteCount:Number(x.quote_count??0),quotes:[],modelProbability:Number(x.model_probability),edgePoints:x.edge_points==null?undefined:Number(x.edge_points),expectedValue:x.expected_value==null?undefined:Number(x.expected_value),confidence:(x.confidence??'watch') as HeldTdPlay['confidence'],qualifies:currentVersion,reasons:Array.isArray(snap.reasons)?snap.reasons:[currentVersion?'Locked pregame Official Play':'Locked pregame model candidate'],team:snap.team??undefined,position:snap.position??undefined,result};
      out[market].push(p);
    }
    return out;
  }catch(error){console.warn('[NFL TD] post-kickoff display hold unavailable:',error);return{anytime:[],first:[]};}
}
