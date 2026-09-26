import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from '@neondatabase/serverless';
import {parseKboMetrics,parseNpbStandings,parseNpbBatting,parseNpbPitching,canonicalTeamKey} from '../server/internationalBaseballOfficial';
import {parseBullpen} from '../server/internationalBaseballBullpen';
import {parseNpbPitcherStats} from '../server/internationalBaseballNpbStarters';
process.env.DATABASE_URL='postgresql://fixture:fixture@localhost/fixture';
process.env.NODE_ENV='test';
const {gradeMlbFirstInning}=await import('../server/bestPlaysOutcomes');
const {recordHrSnapshot,gradeHrPredictions}=await import('../server/mlbHrCalibration');
const {modelOne,lockV3}=await import('../server/internationalBaseballV3');
const table=(rows:string[][])=>'<table>'+rows.map(row=>'<tr>'+row.map(x=>`<td>${x}</td>`).join('')+'</tr>').join('')+'</table>';

test('KBO season records survive unrelated tables and bullpen uses pitching headers',()=>{
 const html=table([['RK','TEAM','GAMES','W','L','D','PCT','GB','STREAK','HOME','AWAY'],['1','KT','132','80','48','4','0.625','0','W1','42-23-1','38-25-3']])+table([['RK','TEAM','AVG','ERA','RUNS','RUNS ALLOWED','HR'],['1','KT','.281','4.24','743','610','105']]);
 const metric=parseKboMetrics(html).get('kbo:kt')!;
 assert.equal(metric.games,132);assert.equal(metric.winPct,.625);
 const pitching=table([['TEAM','AVG','G','PA','AB','R','H','2B','3B'],['KT','.281','132','5315','4598','743','1294','216','18']])+table([['TEAM','ERA','G','CG','SHO','W','L','SV','HLD'],['KT','4.24','132','0','8','80','48','30','52']]);
 const bullpen=parseBullpen(pitching,'KBO').get('kbo:kt')!;
 assert.equal(bullpen.teamEra,4.24);assert.equal(bullpen.saves,30);assert.equal(bullpen.holds,52);
 assert.equal(canonicalTeamKey('NPB',''),null);
});

test('NPB keeps full-season records and exact runs, not interleague or earned runs',()=>{
 const metrics=new Map();
 parseNpbStandings(table([['Team','G','W','L','T','PCT','GB','Home','Road'],['Hanshin Tigers','135','75','59','1','.560','--','34-32 (1)','41-27']])+table([['Team','G','W','L','T','PCT','Home','Road'],['Hanshin Tigers','18','6','12','0','.333','3-6','3-6']]),metrics);
 parseNpbBatting(table([['チーム','打率','試合','得点','安打'],['阪神','.246','135','494','1101']]),metrics);
 parseNpbPitching(table([['チーム','防御率','試合','失点','自責点'],['阪神','2.84','135','420','380']]),metrics);
 const metric=metrics.get('npb:hanshin');assert.equal(metric.games,135);assert.equal(metric.winPct,.56);
 assert.equal(metric.runsPerGame,494/135);assert.equal(metric.runsAllowedPerGame,420/135);
});

test('NPB starter uses the pitching row and flattens the nested innings table',()=>{
 const html=table([['年度','所属球団','登板','勝利','敗北','投球回','三振','防御率'],['2026','東京ヤクルト','13','6','2','<table class="table_inning"><tr><th>74</th><td>.1</td></tr></table>','65','2.54']])+table([['年度','所属球団','試合','打率'],['2026','東京ヤクルト','13','.174']]);
 const pitcher=parseNpbPitcherStats(html,2026);
 assert.equal(pitcher.era,2.54);assert.equal(pitcher.innings,74+1/3);assert.equal(pitcher.strikeouts,65);
 assert.equal(parseNpbPitcherStats(table([['年度','試合','打率'],['2026','13','.174']]),2026).era,null);
});

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

test('A qualified total can lock when moneyline lacks a season sample',async()=>{
 const game:any={id:'fixture',league:'KBO',startTime:new Date(Date.now()+3600000).toISOString(),awayTeam:'LG Twins',homeTeam:'KT Wiz',modelReady:false,bookCount:2,moneyline:{pick:'KT Wiz',price:100,probability:50,marketProbability:50,edge:0,status:'NO_PLAY'},total:{pick:'Over',line:8,price:100,probability:50,marketProbability:50,edge:0,status:'NO_PLAY'},marketSnapshot:{moneyline:{homePrice:100,awayPrice:100,bookCount:2},total:{line:8,overPrice:100,underPrice:100,bookCount:2}}};
 const metric=(key:string)=>({key,games:10,winPct:.5,homePct:null,awayPct:null,runsPerGame:5,runsAllowedPerGame:5});
 const modeled=modelOne(game,{KBO:new Map([['kbo:kt',metric('kbo:kt')],['kbo:lg',metric('kbo:lg')]]),NPB:new Map()},new Map(),new Map(),{KBO:new Map(),NPB:new Map()});
 assert.equal(modeled.moneyline.status,'NO_PLAY');assert.equal(modeled.total?.status,'BEST_PLAY');assert.equal(modeled.modelReady,true);
 const oldQuery=Pool.prototype.query,oldConnect=Pool.prototype.connect;let savedMarkets:string[]=[];
 Pool.prototype.query=(async()=>({rows:[]})) as any;
 Pool.prototype.connect=(async()=>({release(){},async query(sql:string,args:any[]=[]){if(sql.startsWith('INSERT INTO international_baseball_predictions')){savedMarkets.push(args[6]);return {rowCount:1,rows:[]};}if(sql.startsWith('SELECT selection'))return {rows:[{selection:'Over',line:8,american_odds:100}]};return {rows:[]};}})) as any;
 try{await lockV3([modeled]);assert.deepEqual(savedMarkets,['total']);}finally{Pool.prototype.query=oldQuery;Pool.prototype.connect=oldConnect;}
});
