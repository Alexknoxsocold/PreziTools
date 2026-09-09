const NHL_WEB = 'https://api-web.nhle.com/v1';
const NHL_STATS = 'https://api.nhle.com/stats/rest/en';
const CACHE_MS = 6 * 60 * 60 * 1000;

export const NHL_MODEL_VERSION = 'nhl-v1-foundation';
export type NhlConfidence = 'watch' | 'strong' | 'elite';
export type NhlModelResult = { modelProbability:number; edgePoints:number; expectedValue:number; confidence:NhlConfidence; qualifies:boolean; reasons:string[] };
export type NhlPlayerBaseline = { playerId:number; name:string; team:string; position:string; games:number; goals:number; shots:number; shootingPct:number; goalsPerGame:number; shotsPerGame:number; powerPlayGoals:number; powerPlayPoints:number; avgToiSeconds:number; source:string };

type CacheRow = { expires:number; value:unknown };
const cache = new Map<string, CacheRow>();
function clamp(v:number,min:number,max:number){ return Math.max(min,Math.min(max,v)); }
function norm(v:string){ return v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,''); }
function implied(o:number){ return o>0 ? 100/(o+100) : Math.abs(o)/(Math.abs(o)+100); }
function profit(o:number){ return o>0 ? o/100 : 100/Math.abs(o); }
function ev(pct:number,o:number){ const p=pct/100; return p*profit(o)-(1-p); }
async function getJson<T>(url:string,ttl=CACHE_MS):Promise<T>{ const hit=cache.get(url); if(hit&&hit.expires>Date.now()) return hit.value as T; const c=new AbortController(),t=setTimeout(()=>c.abort(),9000); try{ const r=await fetch(url,{signal:c.signal,headers:{'User-Agent':'PreziTools/1.0','Accept':'application/json'}}); if(!r.ok) throw new Error(`HTTP ${r.status}`); const value=await r.json() as T; cache.set(url,{expires:Date.now()+ttl,value}); return value; } finally { clearTimeout(t); } }
function seasonId(d=new Date()){ const y=d.getUTCFullYear(),m=d.getUTCMonth()+1; return m>=7 ? Number(`${y}${y+1}`) : Number(`${y-1}${y}`); }
function previousSeason(s:number){ const a=Math.floor(s/10000)-1; return Number(`${a}${a+1}`); }
function n(v:unknown){ const x=Number(v); return Number.isFinite(x)?x:0; }
function seconds(v:unknown){ if(typeof v==='number') return v; const s=String(v??''); const m=s.match(/^(\d+):(\d+)$/); return m ? Number(m[1])*60+Number(m[2]) : n(v); }

async function skaterRows(season:number):Promise<any[]>{ const url=`${NHL_STATS}/skater/summary?isAggregate=false&isGame=false&sort=[{%22property%22:%22points%22,%22direction%22:%22DESC%22}]&start=0&limit=-1&cayenneExp=seasonId=${season}%20and%20gameTypeId=2`; const p=await getJson<any>(url); return Array.isArray(p?.data)?p.data:[]; }
export async function playerBaseline(player:string,team?:string):Promise<NhlPlayerBaseline|null>{ const current=seasonId(), seasons=[current,previousSeason(current)]; for(const season of seasons){ try{ const rows=await skaterRows(season); const target=norm(player); const matches=rows.filter((r:any)=>norm(String(r.skaterFullName??r.playerName??''))===target && (!team || !r.teamAbbrevs || String(r.teamAbbrevs).split(',').some((x:string)=>norm(x)===norm(team)))); if(matches.length!==1) continue; const r=matches[0],games=n(r.gamesPlayed),goals=n(r.goals),shots=n(r.shots),ppg=n(r.ppGoals),ppp=n(r.ppPoints),toi=seconds(r.timeOnIcePerGame); if(games<=0||shots<=0) continue; return {playerId:n(r.playerId),name:String(r.skaterFullName??player),team:String(r.teamAbbrevs??team??''),position:String(r.positionCode??''),games,goals,shots,shootingPct:shots?goals/shots*100:0,goalsPerGame:goals/games,shotsPerGame:shots/games,powerPlayGoals:ppg,powerPlayPoints:ppp,avgToiSeconds:toi,source:`NHL Stats ${season}`}; }catch{} } return null; }

export async function modelGoalScorer(player:string,team:string|undefined,bestOdds:number,market:'anytime'|'first'):Promise<(NhlModelResult&{baseline:NhlPlayerBaseline})|null>{ const b=await playerBaseline(player,team); if(!b||!Number.isFinite(bestOdds)||bestOdds===0) return null; const marketPct=implied(bestOdds)*100; const goalRate=clamp(b.goalsPerGame,0,1.2),shotRate=clamp(b.shotsPerGame,0,6.5),shooting=clamp(b.shootingPct/100,.03,.25),ppRole=clamp((b.powerPlayGoals+b.powerPlayPoints*.35)/Math.max(1,b.games),0,.65),toi=clamp(b.avgToiSeconds/1200,.55,1.25); const rawAny=clamp((1-Math.exp(-(goalRate*.58+shotRate*shooting*.42)))*100,3,58); const independent=market==='first'?clamp(rawAny*.19,0.7,14):rawAny; const trust=b.games>=25?.72:b.games>=10?.58:.42; const modelPct=clamp(marketPct*(1-trust)+independent*trust,market==='first'?0.5:2,market==='first'?18:62); const edge=modelPct-marketPct,e=ev(modelPct,bestOdds); const evidence=b.games>=20&&b.shotsPerGame>=1.6&&b.avgToiSeconds>=720; const role=b.shotsPerGame>=2.2||ppRole>=.12; const minBooksEvidence=evidence&&role; const qualifies=minBooksEvidence && (market==='first' ? edge>=2.5&&e>=.12&&modelPct>=2.5 : edge>=3&&e>=.08&&modelPct>=12); const confidence:NhlConfidence=qualifies&&edge>=5&&e>=.15?'elite':qualifies?'strong':'watch'; return {modelProbability:+modelPct.toFixed(1),edgePoints:+edge.toFixed(1),expectedValue:+e.toFixed(3),confidence,qualifies,reasons:[`${b.goalsPerGame.toFixed(2)} goals/game over ${b.games} games`,`${b.shotsPerGame.toFixed(1)} shots/game`,`${b.shootingPct.toFixed(1)}% shooting`,b.powerPlayPoints>0?'power-play scoring role':'even-strength scoring profile',market==='first'?'first-goal probability is conservatively scaled from independent scoring rate':'market-anchored independent goal-rate model'],baseline:b}; }

export async function fetchNhlSchedule(date='now'){ return getJson<any>(`${NHL_WEB}/schedule/${encodeURIComponent(date)}`,15*60*1000); }
export async function fetchNhlScore(date='now'){ return getJson<any>(`${NHL_WEB}/score/${encodeURIComponent(date)}`,2*60*1000); }
