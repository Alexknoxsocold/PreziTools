import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor=ws;
const MODEL_VERSION='nfl-td-v3';
let pool:Pool|null=null;
function db(){if(!process.env.DATABASE_URL)return null;if(!pool)pool=new Pool({connectionString:process.env.DATABASE_URL});return pool;}

export type HeldTdPlay={
  market:'anytime'|'first';player:string;bestOdds:number;bestBook:string;
  impliedProbability:number;quoteCount:number;modelProbability:number;
  edgePoints?:number;expectedValue?:number;confidence?:'watch'|'strong'|'elite';
  qualifies:true;reasons:string[];team?:string;position?:string;
};

/** Returns the exact pregame Official TD plays saved to the ledger.
 * Used only for the 90-minute post-kickoff display hold so live/in-game prices
 * never rewrite a pregame recommendation.
 */
export async function getHeldNflTdPlays(gameId:string):Promise<{anytime:HeldTdPlay[];first:HeldTdPlay[]}>{
  const c=db();
  if(!c)return{anytime:[],first:[]};
  try{
    const r=await c.query(`SELECT market,player,model_probability,market_probability,best_odds,best_book,edge_points,expected_value,confidence,quote_count,feature_snapshot FROM nfl_td_prediction_history WHERE game_id=$1 AND model_version=$2 ORDER BY captured_at ASC`,[gameId,MODEL_VERSION]);
    const out:{anytime:HeldTdPlay[];first:HeldTdPlay[]}={anytime:[],first:[]};
    for(const x of r.rows){
      if(x.market!=='anytime'&&x.market!=='first')continue;
      const snap=x.feature_snapshot??{};
      const p:HeldTdPlay={market:x.market,player:String(x.player),bestOdds:Number(x.best_odds??0),bestBook:String(x.best_book??'Pregame'),impliedProbability:Number(x.market_probability??0),quoteCount:Number(x.quote_count??0),modelProbability:Number(x.model_probability),edgePoints:x.edge_points==null?undefined:Number(x.edge_points),expectedValue:x.expected_value==null?undefined:Number(x.expected_value),confidence:(x.confidence??'strong') as HeldTdPlay['confidence'],qualifies:true,reasons:Array.isArray(snap.reasons)?snap.reasons:['Locked pregame Official Play'],team:snap.team??undefined,position:snap.position??undefined};
      out[x.market].push(p);
    }
    return out;
  }catch(error){console.warn('[NFL TD] post-kickoff display hold unavailable:',error);return{anytime:[],first:[]};}
}
