import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from '@neondatabase/serverless';
import { finalNrfiMarketValue } from '../server/mlbFinalMarket';
import type { FirstInningMarket } from '../server/mlbFirstInningMarkets';

// No external database or sports feed is used by these regression fixtures.
process.env.DATABASE_URL = 'postgresql://fixture:fixture@localhost/fixture';
process.env.NODE_ENV = 'test';
const { getHrCalibration } = await import('../server/mlbHrCalibration');
const { captureBestPlaySelections } = await import('../server/bestPlaysLedger');
const { lockV3 } = await import('../server/internationalBaseballV3');

const quote: FirstInningMarket = {
  selection:'YRFI',price:110,book:'Fixture',impliedProbability:47.619,
  noVigProbability:50,edge:-99,ev:-99,quotes:[],quoteCount:1,capturedAt:new Date().toISOString(),
};

test('MLB prices final V4 direction/probability, including positive edge with negative EV', () => {
  const market = finalNrfiMarketValue({recommendation:'YRFI',nrfiProbability:44},quote)!;
  assert.ok(Math.abs(market.edge! - 6) < 1e-9);
  assert.ok(Math.abs(market.ev! - 17.6) < 1e-9);
  assert.equal(market.valuePlay,true);
  assert.equal(finalNrfiMarketValue({recommendation:'NRFI',nrfiProbability:56},quote),null);
  assert.equal(finalNrfiMarketValue({recommendation:'YRFI',nrfiProbability:44},undefined),null);
  assert.equal(finalNrfiMarketValue({recommendation:'YRFI',nrfiProbability:44},{...quote,price:-200})!.valuePlay,false);
});

test('HR component diagnostics use the actual graded sample', async () => {
  const original = Pool.prototype.query;
  Pool.prototype.query = (async (sql: string) => ({rows:sql.startsWith('SELECT probability')
    ? Array.from({length:10},(_,i)=>({probability:0.2,outcome:i>=7?1:0,model_version:'fixture',components:{power:i},market:null})) : []})) as any;
  try {
    const report = await getHrCalibration();
    const power = report.components.find((row:any)=>row.key==='power');
    assert.equal(power.n,10);
    assert.equal(power.lowHitRate,0);
    assert.equal(power.highHitRate,100);
  } finally { Pool.prototype.query = original; }
});

function pick(id:string, overrides:any={}) {
  return {id,sport:'MLB',market:'NRFI',matchup:'A @ B',pick:'No Run 1st Inning',
    probability:60,tier:'STRONG PLAY',time:new Date(Date.now()+3600000).toISOString(),href:'/mlb',...overrides};
}
function request(plays:any[]) {
  const date = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return {body:{date,plays},get:(key:string)=>key==='origin'?'https://fixture.test':key==='host'?'fixture.test':undefined} as any;
}

test('Best Plays enforces cumulative cap and transaction, even on repeated submissions', async () => {
  const oldQuery=Pool.prototype.query,oldConnect=Pool.prototype.connect;
  const rows:any[]=[]; const statements:string[]=[];
  Pool.prototype.query=(async()=>({rows:[]})) as any;
  Pool.prototype.connect=(async()=>({release(){},async query(sql:string,args:any[]=[]){
    statements.push(sql);
    if(sql.startsWith('SELECT selection_key'))return {rows:[...rows]};
    if(sql.includes('INSERT INTO best_plays_selection_ledger')){
      rows.push({selection_key:args[1],play_id:args[2],sport:args[3],market:args[4],pick:args[6],tier:args[8]});
      return {rowCount:1,rows:[]};
    }
    return {rows:[]};
  }})) as any;
  try {
    assert.equal((await captureBestPlaySelections(request(Array.from({length:9},(_,i)=>pick(`mlb-${i}`))))).captured,9);
    assert.equal((await captureBestPlaySelections(request([pick('mlb-0'),pick('mlb-9'),pick('mlb-10')]))).captured,1);
    assert.equal(rows.length,10);
    assert.ok(statements.some(sql=>sql.includes('pg_advisory_xact_lock')));
    assert.equal(statements.at(-1),'COMMIT');
    rows.length=0;
    const wnba=(id:string,name:string)=>pick(id,{sport:'WNBA',market:'First Basket',pick:name});
    assert.equal((await captureBestPlaySelections(request([wnba('wnba-123-1','Player A')]))).captured,1);
    assert.equal((await captureBestPlaySelections(request([wnba('wnba-123-player-a','Player A'),wnba('wnba-123-player-b','Player B'),wnba('wnba-123-player-c','Player C')]))).captured,1);
    assert.equal(rows.length,2); // Existing specialty cap, plus legacy-rank deduplication.
    rows.length=0;
    assert.equal((await captureBestPlaySelections(request([pick('mlb-invalid',{time:''})]))).captured,0);
  } finally {Pool.prototype.query=oldQuery;Pool.prototype.connect=oldConnect;}
});

test('International refresh updates market observations without overwriting locked evidence', async () => {
  const oldQuery=Pool.prototype.query,oldConnect=Pool.prototype.connect;
  let isNew=true;const statements:string[]=[];
  Pool.prototype.query=(async()=>({rows:[]})) as any;
  Pool.prototype.connect=(async()=>({release(){},async query(sql:string){
    statements.push(sql);
    if(sql.startsWith('INSERT INTO international_baseball_predictions'))return {rowCount:isNew?1:0,rows:[]};
    if(sql.startsWith('SELECT selection'))return {rows:[{selection:'Home',line:null,american_odds:110}]};
    return {rows:[]};
  }})) as any;
  const game:any={id:'fixture',league:'NPB',startTime:new Date(Date.now()+3600000).toISOString(),homeTeam:'Home',awayTeam:'Away',modelReady:true,
    moneyline:{pick:'Home',status:'PLAY',price:110,probability:60,marketProbability:48,edge:12},total:null,
    marketSnapshot:{moneyline:{homePrice:105,awayPrice:-115,bookCount:2}},modelContext:{starterDataAvailable:true}};
  try {
    await lockV3([game]);
    assert.ok(statements.some(sql=>sql.startsWith('INSERT INTO international_baseball_prediction_context')));
    assert.equal(statements.at(-1),'COMMIT');
    statements.length=0;isNew=false;game.modelContext.starterDataAvailable=false;
    await lockV3([game]);
    assert.ok(!statements.some(sql=>sql.startsWith('INSERT INTO international_baseball_prediction_context')));
    const update=statements.find(sql=>sql.startsWith('UPDATE international_baseball_prediction_context'))!;
    assert.ok(update.includes('latest_pregame_price'));
    assert.ok(!update.includes('starter_data_used'));
  } finally {Pool.prototype.query=oldQuery;Pool.prototype.connect=oldConnect;}
});
