import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from '@neondatabase/serverless';
process.env.DATABASE_URL='postgresql://fixture:fixture@localhost/fixture';
process.env.NODE_ENV='test';
const {gradeMlbFirstInning}=await import('../server/bestPlaysOutcomes');
const {recordHrSnapshot,gradeHrPredictions}=await import('../server/mlbHrCalibration');
test('MLB Best Plays grades saved ESPN events from consistent pregame evidence',async()=>{
 const oldQuery=Pool.prototype.query;const oldFetch=globalThis.fetch;
 let rows:any[]=[{outcome:'NRFI',first_inning_score:'0-0',graded_at:'2026-09-24T23:00:00Z'}];
 Pool.prototype.query=(async(sql:string,args:any[])=>{assert.equal(args[0],'401817066');assert.ok(sql.includes('locked_at < game_start_at'));return {rows};}) as any;
 globalThis.fetch=async()=>{throw new Error('Must not send ESPN ID to StatsAPI');};
 const row:any={selection_date:'2026-09-24',selection_key:'mlb-401817066',play_id:'mlb-401817066',sport:'MLB',market:'NRFI',matchup:'MIA @ CHC',pick:'No Run 1st Inning',probability:58,game_start_at:'2026-09-24T18:20:00Z',href:'/mlb'};
 try{
  assert.equal((await gradeMlbFirstInning(row))?.result,'won');
  assert.equal((await gradeMlbFirstInning({...row,market:'YRFI'}))?.result,'lost');
  rows=[{outcome:'YRFI',first_inning_score:'0-0'}];assert.equal(await gradeMlbFirstInning(row),null);
  rows=[{outcome:'NRFI',first_inning_score:null}];assert.equal(await gradeMlbFirstInning(row),null);
  rows=[{outcome:'NRFI',first_inning_score:'0-0'},{outcome:'YRFI',first_inning_score:'1-0'}];assert.equal(await gradeMlbFirstInning(row),null);
 }finally{Pool.prototype.query=oldQuery;globalThis.fetch=oldFetch;}
});

test('HR captures only confirmed pregame evidence and voids a hitter who never bats',async()=>{
 const oldQuery=Pool.prototype.query,oldFetch=globalThis.fetch;const inserts:any[]=[];let voided=false;
 Pool.prototype.query=(async(sql:string,args:any[]=[])=>{
  if(sql.includes('INSERT INTO mlb_hr_prediction_history')){assert.ok(sql.includes('$16::timestamptz>now()'));inserts.push(args);}
  if(sql.startsWith('SELECT id,game_pk'))return {rows:[{id:'fixture',game_pk:123,player_id:456}]};
  if(sql.includes('SET void_reason')){voided=true;assert.equal(args[1],'did_not_bat');}
  return {rows:[]};
 }) as any;
 globalThis.fetch=(async()=>new Response(JSON.stringify({gameData:{status:{abstractGameState:'Final'}},liveData:{boxscore:{teams:{home:{players:{ID456:{stats:{batting:{plateAppearances:0,homeRuns:0}}}}}}}}}),{status:200})) as any;
 try{
  const candidate={gamePk:123,playerId:456,player:'Fixture',team:'A',opponent:'B',probability:25,preziHrScore:80,confidence:90,tier:'STRONG',lineupConfirmed:true,gameTime:new Date(Date.now()+3600000).toISOString()};
  await recordHrSnapshot({date:'2026-09-26',modelVersion:'fixture',candidates:[candidate,{...candidate,playerId:457,lineupConfirmed:false},{...candidate,playerId:458,gameTime:new Date(Date.now()-1).toISOString()}]});
  assert.equal(inserts.length,1);assert.equal(inserts[0][8],.25);
  assert.equal((await gradeHrPredictions()).graded,0);assert.equal(voided,true);
 }finally{Pool.prototype.query=oldQuery;globalThis.fetch=oldFetch;}
});

