import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor=ws;
const MODEL_VERSION='nfl-td-v3';
let pool:Pool|null=null;
function db(){if(!process.env.DATABASE_URL)return null;if(!pool)pool=new Pool({connectionString:process.env.DATABASE_URL});return pool;}

export type HeldTdPlay={
  market:'anytime'|'first';player:string;bestOdds:number;bestBook:string;
  impliedProbability:number;quoteCount:number;quotes:[];modelProbability:number;
  edgePoints?:number;expectedValue?:number;confidence?:'watch'|'strong'|'elite';
  qualifies:boolean;reasons:string[];team?:string;position?:string;
  result:'won'|'lost'|'pending';
};

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
