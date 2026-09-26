import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from '@neondatabase/serverless';
import {summarizeWnbaLedger} from '../server/wnbaLedgerDiagnostics';
process.env.DATABASE_URL='postgresql://fixture:fixture@localhost/fixture';
process.env.NODE_ENV='test';
const {persistWnbaSnapshot}=await import('../server/wnbaFirstBasket');
const {recordVerifiedNbaGame}=await import('../server/fbSeasonStore');
const {parseNbaGameEvidence}=await import('../server/autoTracker');
const candidates=Array.from({length:10},(_,i)=>({name:`Player ${i}`,team:i<5?'A':'B',rank:i+1,probability:10}));
const event={id:'game',date:'2099-01-01T20:00:00Z'};
const rows=(id:string,source='confirmed')=>candidates.map(x=>({espn_game_id:id,player_name:x.name,team:x.team,model_version:source==='projected'?'v1-PROJECTED':'v1',lineup_status:source,model_probability:10,is_top_pick:x.rank===1,locked_at:'2026-09-01T19:00:00Z',game_start_at:'2026-09-01T20:00:00Z',graded_at:'2026-09-01T21:00:00Z',won:x.rank===1}));

test('WNBA excludes incomplete, late, and partially graded games and splits lineup evidence',()=>{
 const late=rows('late').map(x=>({...x,locked_at:x.game_start_at}));
 const partial=rows('partial');partial[0].graded_at=null as any;
 const result=summarizeWnbaLedger([...rows('confirmed'),...rows('projected','projected'),...rows('short').slice(0,9),...late,...partial]);
 assert.equal(result.rawLockedGames,5);assert.equal(result.lockedGames,2);assert.equal(result.excludedGames,3);assert.equal(result.byLineup.confirmed.gradedGames,1);assert.equal(result.byLineup.projected.expectedTopPickWins,.1);assert.equal(result.topPickWins,2);
});

test('WNBA rolls back the entire snapshot when tipoff arrives during recording',async()=>{
 const original=Pool.prototype.connect;const calls:string[]=[];let checks=0;
 Pool.prototype.connect=(async()=>({release(){},async query(sql:string){calls.push(sql);if(sql.includes('AS eligible'))return{rows:[{eligible:++checks===1}]};return{rows:[]};}})) as any;
 try{assert.equal(await persistWnbaSnapshot(event,candidates as any,'v1',async c=>{await c.query('CONTEXT');}),'skipped');assert.equal(calls.filter(x=>x.startsWith('INSERT')).length,10);assert.equal(calls.at(-1),'ROLLBACK');assert.ok(!calls.includes('COMMIT'));}finally{Pool.prototype.connect=original;}
});

test('WNBA archives projected evidence before an atomic confirmed upgrade',async()=>{
 const original=Pool.prototype.connect;const calls:string[]=[];
 Pool.prototype.connect=(async()=>({release(){},async query(sql:string){calls.push(sql);if(sql.includes('AS eligible'))return{rows:[{eligible:true}]};if(sql.startsWith('SELECT model_version'))return{rows:[{model_version:'v1-PROJECTED',graded_at:null}]};return{rows:[]};}})) as any;
 try{assert.equal(await persistWnbaSnapshot(event,candidates as any,'v1',async c=>{await c.query('CONTEXT');}),'upgraded');assert.ok(calls.findIndex(x=>x.includes('INSERT INTO wnba_prediction_snapshot_archive'))<calls.findIndex(x=>x.startsWith('DELETE')));assert.equal(calls.at(-1),'COMMIT');}finally{Pool.prototype.connect=original;}
});

test('NBA legacy result repair does not count the same game again in player totals',async()=>{
 const original=Pool.prototype.connect;const calls:string[]=[];
 Pool.prototype.connect=(async()=>({release(){},async query(sql:string){calls.push(sql);return{rows:sql.startsWith('SELECT first_scorer')?[{first_scorer:null,first_scorer_team:null}]:[]};}})) as any;
 try{await recordVerifiedNbaGame('old',candidates.map(x=>({playerName:x.name,team:x.team})),{playerName:'Player 0',team:'A'},new Date('2026-04-01'));assert.ok(!calls.some(x=>x.includes('UPDATE fb_tracking')||x.includes('INSERT INTO fb_tracking')));assert.ok(calls.some(x=>x.includes('INSERT INTO fb_processed_games')));assert.equal(calls.at(-1),'COMMIT');}finally{Pool.prototype.connect=original;}
});

test('NBA new-game totals roll back if recording the result fails',async()=>{
 const original=Pool.prototype.connect;const calls:string[]=[];
 Pool.prototype.connect=(async()=>({release(){},async query(sql:string){calls.push(sql);if(sql.includes('INSERT INTO fb_processed_games'))throw Error('write failed');return{rows:[]};}})) as any;
 try{await assert.rejects(recordVerifiedNbaGame('new',candidates.map(x=>({playerName:x.name,team:x.team})),{playerName:'Player 0',team:'A'},new Date('2026-04-01')),/write failed/);assert.equal(calls.at(-1),'ROLLBACK');assert.ok(!calls.includes('COMMIT'));}finally{Pool.prototype.connect=original;}
});

test('NBA evidence orders opening plays and excludes free throws and truncated feeds',()=>{
 const data:any={header:{competitions:[{date:'2026-04-01T20:00:00Z'}]},boxscore:{players:['A','B'].map((team,j)=>({team:{abbreviation:team},statistics:[{athletes:Array.from({length:5},(_,i)=>({starter:true,athlete:{displayName:`Player ${i+j*5}`}}))}]}))},plays:[{period:{number:1},clock:{displayValue:'11:20'},scoringPlay:true,scoreValue:2,text:'Player 5 makes jumper',team:{abbreviation:'B'}},{period:{number:1},clock:{displayValue:'11:40'},scoringPlay:true,scoreValue:2,text:'Player 0 makes layup',team:{abbreviation:'A'}},{period:{number:1},clock:{displayValue:'11:55'},scoringPlay:true,scoreValue:1,text:'Player 1 makes free throw',team:{abbreviation:'A'}}]};
 assert.equal(parseNbaGameEvidence(data)?.scorer.playerName,'Player 0');
 data.plays=data.plays.map((p:any)=>({...p,clock:{displayValue:'8:30'}}));assert.equal(parseNbaGameEvidence(data),null);
});
