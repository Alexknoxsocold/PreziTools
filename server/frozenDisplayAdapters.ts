import { activeNflSlateDateKey, easternDateKey } from '../shared/nflDisplayWindow.js';
import { freezeDisplaySnapshot, listFrozenDisplaySnapshots } from './frozenDisplayLedger.js';

function addDays(key:string,days:number){const d=new Date(`${key}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function easternClock(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const get=(type:Intl.DateTimeFormatPartTypes)=>parts.find(x=>x.type===type)?.value??'';
  return{date:`${get('year')}-${get('month')}-${get('day')}`,minutes:Number(get('hour'))*60+Number(get('minute'))};
}
/** Non-NFL slates remain on their game date through the overnight postgame window. */
export function activeOvernightSlateDateKey(now=new Date()){
  const p=easternClock(now);return p.minutes<4*60?addDays(p.date,-1):p.date;
}
function future(date:string){const t=new Date(date).getTime();return Number.isFinite(t)&&t>Date.now()}
function frozenMeta(snapshot:{capturedAt:string;sourceUpdatedAt:string|null}){return{status:'frozen-pregame',capturedAt:snapshot.capturedAt,sourceUpdatedAt:snapshot.sourceUpdatedAt}}

export async function freezeAndMergeNflFeed<T extends {games:any[];modelVersion?:string;updatedAt?:string}>(feed:T):Promise<T>{
  const slateDate=activeNflSlateDateKey(),version=feed.modelVersion??'nfl-board-v1';
  await Promise.all(feed.games.filter(game=>future(game.date)&&(game.moneyline||game.anytimeTd?.length||game.firstTd?.length)).map(game=>freezeDisplaySnapshot({sport:'NFL',slateDate:easternDateKey(game.date),eventId:String(game.id),gameStartAt:game.date,market:'board',modelVersion:version,payload:game,sourceUpdatedAt:feed.updatedAt??null})));
  const saved=await listFrozenDisplaySnapshots<any>('NFL',slateDate,'board'),byId=new Map(saved.map(x=>[x.eventId,x]));
  const games=feed.games.map(game=>{
    const snapshot=byId.get(String(game.id));if(!snapshot||future(game.date))return game;
    const frozen=snapshot.payload;
    return{...frozen,...game,moneyline:game.moneyline??frozen.moneyline,anytimeTd:game.anytimeTd?.length?game.anytimeTd:frozen.anytimeTd??[],firstTd:game.firstTd?.length?game.firstTd:frozen.firstTd??[],displaySnapshot:frozenMeta(snapshot)};
  });
  return{...feed,games};
}

export async function freezeAndMergeNhlFeed<T extends {games:any[];modelVersion?:string;updatedAt?:string}>(feed:T):Promise<T>{
  const active=activeOvernightSlateDateKey(),version=feed.modelVersion??'nhl-board-v1';
  await Promise.all(feed.games.filter(game=>future(game.date)&&(game.moneyline||game.anytimeGoal?.length||game.firstGoal?.length)).map(game=>freezeDisplaySnapshot({sport:'NHL',slateDate:easternDateKey(game.date),eventId:String(game.id),gameStartAt:game.date,market:'board',modelVersion:version,payload:game,sourceUpdatedAt:feed.updatedAt??null})));
  const saved=await listFrozenDisplaySnapshots<any>('NHL',active,'board'),byId=new Map(saved.map(x=>[x.eventId,x]));
  const current=new Map(feed.games.map(game=>[String(game.id),game])),ids=new Set([...current.keys(),...byId.keys()]),games:any[]=[];
  for(const id of ids){
    const live=current.get(id),snapshot=byId.get(id);
    if(live&&easternDateKey(live.date)!==active&&!snapshot)continue;
    if(!snapshot){if(live)games.push(live);continue}
    const frozen=snapshot.payload;if(!live){games.push({...frozen,displaySnapshot:frozenMeta(snapshot)});continue}
    games.push({...frozen,...live,moneyline:live.moneyline??frozen.moneyline,anytimeGoal:live.anytimeGoal?.length?live.anytimeGoal:frozen.anytimeGoal??[],firstGoal:live.firstGoal?.length?live.firstGoal:frozen.firstGoal??[],displaySnapshot:future(live.date)?undefined:frozenMeta(snapshot)});
  }
  games.sort((a,b)=>+new Date(a.date)-+new Date(b.date));return{...feed,games};
}

export async function freezeAndMergeWnbaSlate<T extends {games:any[];modelVersion?:string;updatedAt?:string}>(slate:T):Promise<T>{
  const active=activeOvernightSlateDateKey(),version=slate.modelVersion??'wnba-board-v1';
  await Promise.all(slate.games.filter(game=>future(game.date)&&game.candidates?.length).map(game=>freezeDisplaySnapshot({sport:'WNBA',slateDate:easternDateKey(game.date),eventId:String(game.id),gameStartAt:game.date,market:'first-basket',modelVersion:version,payload:game,sourceUpdatedAt:slate.updatedAt??null})));
  const saved=await listFrozenDisplaySnapshots<any>('WNBA',active,'first-basket'),byId=new Map(saved.map(x=>[x.eventId,x]));
  const current=new Map(slate.games.map(game=>[String(game.id),game])),ids=new Set([...current.keys(),...byId.keys()]),games:any[]=[];
  for(const id of ids){const live=current.get(id),snapshot=byId.get(id);if(!snapshot){if(live)games.push(live);continue}const frozen=snapshot.payload;if(!live){games.push({...frozen,displaySnapshot:frozenMeta(snapshot)});continue}games.push({...frozen,...live,candidates:future(live.date)?live.candidates:frozen.candidates,topPick:future(live.date)?live.topPick:frozen.topPick,tipSignal:frozen.tipSignal??live.tipSignal,verifiedFirstScorer:live.verifiedFirstScorer,verifiedFirstScorerTeam:live.verifiedFirstScorerTeam,displaySnapshot:future(live.date)?undefined:frozenMeta(snapshot)})}
  games.sort((a,b)=>+new Date(a.date)-+new Date(b.date));return{...slate,games};
}

export async function freezeAndMergeMlbNrfi<T extends {date:string;games:any[];modelVersion?:string}>(feed:T):Promise<T>{
  const version=feed.modelVersion??'mlb-nrfi-board-v1';
  await Promise.all(feed.games.filter(game=>future(game.gameStartAt??game.date)&&Number.isFinite(Number(game.marketValue?.price))).map(game=>freezeDisplaySnapshot({sport:'MLB',slateDate:feed.date,eventId:String(game.id),gameStartAt:game.gameStartAt??game.date,market:'nrfi-yrfi',modelVersion:version,payload:game,sourceUpdatedAt:game.marketValue?.capturedAt??null})));
  const saved=await listFrozenDisplaySnapshots<any>('MLB',feed.date,'nrfi-yrfi'),byId=new Map(saved.map(x=>[x.eventId,x]));
  const games=feed.games.map(game=>{const snapshot=byId.get(String(game.id)),start=game.gameStartAt??game.date;if(!snapshot||future(start))return game;const market=snapshot.payload?.marketValue;return market?{...game,marketValue:{...market,frozen:true,displayStatus:'frozen-pregame',frozenAt:snapshot.capturedAt}}:game});
  return{...feed,games};
}

export async function freezeAndMergeMlbHr<T extends {date:string;modelVersion:string;candidates:any[];strongest:any[];valuePlays:any[];watchlist:any[];marketStatus:string}>(feed:T):Promise<T>{
  const byGame=new Map<string,any[]>();for(const candidate of feed.candidates){const key=String(candidate.gamePk),rows=byGame.get(key)??[];rows.push(candidate);byGame.set(key,rows)}
  await Promise.all([...byGame.entries()].map(([gamePk,rows])=>{const start=rows[0]?.gameTime,priced=rows.some(row=>Number.isFinite(Number(row.market?.bestOdds)));return future(start)&&priced?freezeDisplaySnapshot({sport:'MLB',slateDate:feed.date,eventId:gamePk,gameStartAt:start,market:'home-run',modelVersion:feed.modelVersion,payload:{candidates:rows},sourceUpdatedAt:rows.find(row=>row.market?.capturedAt)?.market?.capturedAt??null}):Promise.resolve(false)}));
  const saved=await listFrozenDisplaySnapshots<any>('MLB',feed.date,'home-run'),savedPlayers=new Map<string,{candidate:any;snapshot:any}>();
  for(const snapshot of saved)for(const candidate of snapshot.payload?.candidates??[])savedPlayers.set(`${candidate.gamePk}:${candidate.playerId}`,{candidate,snapshot});
  const candidates=feed.candidates.map(candidate=>{const saved=savedPlayers.get(`${candidate.gamePk}:${candidate.playerId}`);if(!saved||future(candidate.gameTime)||candidate.market)return candidate;return{...candidate,market:{...saved.candidate.market,frozen:true,displayStatus:'frozen-pregame',frozenAt:saved.snapshot.capturedAt},homepageEligible:saved.candidate.homepageEligible}}),map=new Map(candidates.map(candidate=>[`${candidate.gamePk}:${candidate.playerId}`,candidate]));
  const hydrate=(rows:any[])=>rows.map(row=>map.get(`${row.gamePk}:${row.playerId}`)??row);
  const valuePlays=hydrate(feed.valuePlays);for(const candidate of candidates)if(candidate.market?.valueTier&&candidate.market.valueTier!=='NONE'&&candidate.lineupConfirmed&&!valuePlays.some(row=>row.gamePk===candidate.gamePk&&row.playerId===candidate.playerId))valuePlays.push(candidate);
  const marketPlayersPriced=candidates.filter(candidate=>Number.isFinite(Number(candidate.market?.bestOdds))).length;
  const marketGamesMatched=new Set(candidates.filter(candidate=>candidate.market).map(candidate=>candidate.gamePk)).size;
  return{...feed,candidates,strongest:hydrate(feed.strongest),valuePlays:valuePlays.sort((a,b)=>(b.market?.expectedValue??-Infinity)-(a.market?.expectedValue??-Infinity)).slice(0,12),watchlist:hydrate(feed.watchlist),marketPlayersPriced,marketGamesMatched,marketStatus:marketPlayersPriced?'available':feed.marketStatus};
}

export async function freezeAndMergeNbaPlayers(players:any[],games:any[],slateDate:string,modelVersion='nba-first-basket-board-v1'){
  await Promise.all(games.filter(game=>future(game.gameTime)).map(game=>{const teams=new Set([game.awayTeam,game.homeTeam]),rows=players.filter(player=>teams.has(player.team)&&player.liveOdds);if(!rows.length||!game.espnGameId)return Promise.resolve(false);return freezeDisplaySnapshot({sport:'NBA',slateDate,eventId:String(game.espnGameId),gameStartAt:game.gameTime,market:'first-basket',modelVersion,payload:{players:rows,awayTeam:game.awayTeam,homeTeam:game.homeTeam},sourceUpdatedAt:null})}));
  const saved=await listFrozenDisplaySnapshots<any>('NBA',slateDate,'first-basket'),byPlayer=new Map<string,{player:any;snapshot:any}>();for(const snapshot of saved)for(const player of snapshot.payload?.players??[])byPlayer.set(String(player.espnId),{player,snapshot});
  return players.map(player=>{
    const saved=byPlayer.get(String(player.espnId));
    if(!saved)return player;
    if(player.liveOdds&&future(saved.snapshot.gameStartAt))return player;
    return{...player,liveOdds:saved.player.liveOdds,liveOddsSource:saved.player.liveOddsSource,liveOddsSportsbook:saved.player.liveOddsSportsbook,liveOddsFrozen:!future(saved.snapshot.gameStartAt),liveOddsCapturedAt:saved.snapshot.capturedAt};
  });
}
