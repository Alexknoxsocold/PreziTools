import type { Express } from "express";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { canonicalTeamKey, dateInLeagueZone, getOfficialTeamMetrics, type League, type OfficialTeamMetric } from "./internationalBaseballOfficial.js";
import { getRecentTeamForm, type TeamFormContext } from "./internationalBaseballForm.js";
import { getNpbAnnouncedStarters, type NpbStarterContext } from "./internationalBaseballNpbStarters.js";

neonConfig.webSocketConstructor = ws;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
export const INTERNATIONAL_BASEBALL_V3_VERSION = "intl-baseball-v3.1-form-rest-starter";

type Status = "BEST_PLAY" | "PLAY" | "LEAN" | "NO_PLAY";
type Pick = { pick:string; probability:number; marketProbability:number; edge:number; status:Status; price:number|null; line?:number; expected?:number };
type Game = { id:string; league:League; startTime:string; awayTeam:string; homeTeam:string; bookCount:number; modelReady:boolean; source:string; moneyline:Pick; total:Pick|null; [key:string]:unknown };

function clamp(v:number,min:number,max:number){return Math.max(min,Math.min(max,v))}
function logistic(v:number){return 1/(1+Math.exp(-v))}
function statusFor(edge:number,books:number):Status{if(books<2||edge<0.025)return "NO_PLAY";if(edge>=0.06)return "BEST_PLAY";if(edge>=0.04)return "PLAY";return "LEAN"}
function metricFor(league:League,team:string,metrics:Record<League,Map<string,OfficialTeamMetric>>){const key=canonicalTeamKey(league,team);return key?metrics[league].get(key)??null:null}
function venuePct(metric:OfficialTeamMetric,home:boolean){return home?(metric.homePct??metric.winPct):(metric.awayPct??metric.winPct)}
function contextFor(league:League,team:string,form:Map<string,TeamFormContext>){const key=canonicalTeamKey(league,team);return key?form.get(key)??null:null}
function starterFor(league:League,team:string,starters:Map<string,NpbStarterContext>){if(league!=="NPB")return null;const key=canonicalTeamKey(league,team);return key?starters.get(key)??null:null}
function starterStrength(p:NpbStarterContext|null){if(!p||p.era==null||p.innings==null||p.innings<15)return 0;const eraPart=clamp((3.35-p.era)/2.5,-0.5,0.5);const kPart=p.kPer9==null?0:clamp((p.kPer9-7.2)/12,-0.12,0.12);return clamp(eraPart+kPart,-0.55,0.55)}
function starterRunSuppression(p:NpbStarterContext|null){const s=starterStrength(p);return s*0.75}

function modelOne(game:Game,metrics:Record<League,Map<string,OfficialTeamMetric>>,form:Map<string,TeamFormContext>,starters:Map<string,NpbStarterContext>):Game{
  const home=metricFor(game.league,game.homeTeam,metrics),away=metricFor(game.league,game.awayTeam,metrics);
  const homeForm=contextFor(game.league,game.homeTeam,form),awayForm=contextFor(game.league,game.awayTeam,form);
  const homeStarter=starterFor(game.league,game.homeTeam,starters),awayStarter=starterFor(game.league,game.awayTeam,starters);
  const homeStarterStrength=starterStrength(homeStarter),awayStarterStrength=starterStrength(awayStarter);
  const starterReady=Boolean(game.league==="NPB"&&homeStarter&&awayStarter&&homeStarter.era!=null&&awayStarter.era!=null);
  const seasonReady=Boolean(home&&away&&home.games>=20&&away.games>=20);
  const formReady=Boolean(homeForm&&awayForm&&homeForm.games>=3&&awayForm.games>=3);
  const moneylineReady=seasonReady;

  let homeModel=game.moneyline.marketProbability/100;
  if(moneylineReady&&home&&away){
    const season=(home.winPct-away.winPct)*2.05;
    const venue=(venuePct(home,true)-venuePct(away,false))*0.85;
    const recent=formReady&&homeForm&&awayForm?(homeForm.winPct-awayForm.winPct)*0.9:0;
    const recentRuns=formReady&&homeForm&&awayForm?(homeForm.runDiffPerGame-awayForm.runDiffPerGame)*0.12:0;
    const rest=formReady&&homeForm&&awayForm?clamp(homeForm.restDays-awayForm.restDays,-2,2)*0.04:0;
    const starter=starterReady?(homeStarterStrength-awayStarterStrength)*0.5:0;
    homeModel=clamp(logistic(season+venue+recent+recentRuns+rest+starter+0.07),0.23,0.77);
  }
  const marketHome=game.moneyline.pick===game.homeTeam?game.moneyline.marketProbability/100:1-game.moneyline.marketProbability/100;
  const homeEdge=homeModel-marketHome,awayEdge=(1-homeModel)-(1-marketHome);
  const pickHome=homeEdge>=awayEdge,edge=Math.max(homeEdge,awayEdge);
  const ml:Pick={...game.moneyline,pick:pickHome?game.homeTeam:game.awayTeam,probability:+((pickHome?homeModel:1-homeModel)*100).toFixed(1),marketProbability:+((pickHome?marketHome:1-marketHome)*100).toFixed(1),edge:+(Math.max(0,edge)*100).toFixed(1),status:moneylineReady?statusFor(edge,game.bookCount):"NO_PLAY"};

  let total=game.total?{...game.total}:null;
  if(total&&total.line!=null){
    let expected:number|null=null;
    if(home&&away){
      const seasonScoring=home.runsPerGame>0&&away.runsPerGame>0&&home.runsAllowedPerGame>0&&away.runsAllowedPerGame>0;
      if(seasonScoring){
        const sh=(home.runsPerGame+away.runsAllowedPerGame)/2,sa=(away.runsPerGame+home.runsAllowedPerGame)/2;
        expected=sh+sa+(game.league==="KBO"?0.16:0.12);
      }
      if(formReady&&homeForm&&awayForm){
        const rh=(homeForm.runsForPerGame+awayForm.runsAllowedPerGame)/2,ra=(awayForm.runsForPerGame+homeForm.runsAllowedPerGame)/2;
        const recentExpected=rh+ra+(game.league==="KBO"?0.16:0.12);
        expected=expected==null?recentExpected:expected*0.65+recentExpected*0.35;
      }
      if(expected!=null&&starterReady){
        expected-=starterRunSuppression(homeStarter)+starterRunSuppression(awayStarter);
      }
    }
    if(expected!=null&&Number.isFinite(expected)){
      const overModel=clamp(logistic((expected-total.line)/1.65),0.23,0.77);
      const marketOver=total.pick==="Over"?total.marketProbability/100:1-total.marketProbability/100;
      const overEdge=overModel-marketOver,underEdge=(1-overModel)-(1-marketOver),pickOver=overEdge>=underEdge,totalEdge=Math.max(overEdge,underEdge);
      total={...total,pick:pickOver?"Over":"Under",expected:+expected.toFixed(2),probability:+((pickOver?overModel:1-overModel)*100).toFixed(1),marketProbability:+((pickOver?marketOver:1-marketOver)*100).toFixed(1),edge:+(Math.max(0,totalEdge)*100).toFixed(1),status:statusFor(totalEdge,game.bookCount)};
    }else total={...total,status:"NO_PLAY",edge:0};
  }

  const source=starterReady?"official-free-v3.1-form-rest-starter":formReady?"official-free-v3-form-rest":"official-free-v3-season";
  return {...game,modelReady:moneylineReady,source,moneyline:ml,total,modelContext:{recentFormAvailable:formReady,starterDataAvailable:starterReady,homeStarter:homeStarter?{name:homeStarter.name,era:homeStarter.era,kPer9:homeStarter.kPer9==null?null:+homeStarter.kPer9.toFixed(2),innings:homeStarter.innings}:null,awayStarter:awayStarter?{name:awayStarter.name,era:awayStarter.era,kPer9:awayStarter.kPer9==null?null:+awayStarter.kPer9.toFixed(2),innings:awayStarter.innings}:null,homeRecent:homeForm?{games:homeForm.games,winPct:+(homeForm.winPct*100).toFixed(1),runDiff:+homeForm.runDiffPerGame.toFixed(2),restDays:homeForm.restDays}:null,awayRecent:awayForm?{games:awayForm.games,winPct:+(awayForm.winPct*100).toFixed(1),runDiff:+awayForm.runDiffPerGame.toFixed(2),restDays:awayForm.restDays}:null}};
}

async function ensureTable(){if(!pool)return;await pool.query(`CREATE TABLE IF NOT EXISTS international_baseball_predictions(id varchar(220) PRIMARY KEY,league text NOT NULL,event_id text NOT NULL,game_start_at timestamptz NOT NULL,home_team text NOT NULL,away_team text NOT NULL,market text NOT NULL,selection text NOT NULL,line real,american_odds integer,model_probability real NOT NULL,market_probability real NOT NULL,edge real NOT NULL,status text NOT NULL,model_version text NOT NULL,locked_at timestamptz NOT NULL DEFAULT now(),result text,actual_score text,created_at timestamptz NOT NULL DEFAULT now(),graded_at timestamptz)`)}
async function lockV3(games:Game[]){if(!pool)return;await ensureTable();for(const g of games){if(new Date(g.startTime).getTime()<=Date.now()||!g.modelReady)continue;for(const [market,pick] of [["moneyline",g.moneyline],["total",g.total]] as const){if(!pick||pick.status==="NO_PLAY")continue;const id=`${g.league}:${g.id}:${market}:${INTERNATIONAL_BASEBALL_V3_VERSION}`;await pool.query(`INSERT INTO international_baseball_predictions(id,league,event_id,game_start_at,home_team,away_team,market,selection,line,american_odds,model_probability,market_probability,edge,status,model_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(id) DO NOTHING`,[id,g.league,g.id,g.startTime,g.homeTeam,g.awayTeam,market,pick.pick,pick.line??null,pick.price,pick.probability/100,pick.marketProbability/100,pick.edge/100,pick.status,INTERNATIONAL_BASEBALL_V3_VERSION])}}}

async function enhance(body:any){
  if(!body||!Array.isArray(body.games))return body;
  const metrics=await getOfficialTeamMetrics();
  const formGroups=new Map<string,Promise<Map<string,TeamFormContext>>>();
  const starterGroups=new Map<string,Promise<Map<string,NpbStarterContext>>>();
  const getForm=(league:League,date:string)=>{const k=`${league}:${date}`;let p=formGroups.get(k);if(!p){p=getRecentTeamForm(league,date,10);formGroups.set(k,p)}return p};
  const getStarters=(date:string)=>{let p=starterGroups.get(date);if(!p){p=getNpbAnnouncedStarters(date);starterGroups.set(date,p)}return p};
  const games:Game[]=[];
  for(const raw of body.games as Game[]){
    const date=dateInLeagueZone(new Date(raw.startTime),raw.league);
    let form=new Map<string,TeamFormContext>();
    let starters=new Map<string,NpbStarterContext>();
    try{form=await getForm(raw.league,date)}catch(error){console.warn(`[Intl Baseball V3] recent form unavailable for ${raw.league} ${date}`,error)}
    if(raw.league==="NPB")try{starters=await getStarters(date)}catch(error){console.warn(`[Intl Baseball V3] NPB starters unavailable for ${date}`,error)}
    games.push(modelOne(raw,metrics,form,starters));
  }
  void lockV3(games).catch(error=>console.warn("[Intl Baseball V3] lock failed",error));
  return {...body,modelVersion:INTERNATIONAL_BASEBALL_V3_VERSION,modelReady:games.some(g=>g.modelReady),modelInputs:["season win strength","home/away splits","recent official results","recent run differential","rest days","official NPB announced starters","official NPB starter ERA and K/9 when available","official scoring data when available"],games};
}

export function registerInternationalBaseballV3(app:Express){
  app.use((req,res,next)=>{if(req.method!=="GET"||req.path!=="/api/international-baseball")return next();const original=res.json.bind(res);res.json=((body:any)=>{void enhance(body).then(v=>original(v)).catch(error=>{console.error("[Intl Baseball V3] enhance failed",error);original(body)});return res}) as typeof res.json;next()});
  app.get("/api/international-baseball/performance",async(_req,res)=>{if(!pool)return res.json({graded:0,wins:0,losses:0,pushes:0,winRate:null,units:0,roi:null,modelVersion:INTERNATIONAL_BASEBALL_V3_VERSION});try{await ensureTable();const q=await pool.query(`SELECT count(*) FILTER(WHERE result IN ('won','lost'))::int graded,count(*) FILTER(WHERE result='won')::int wins,count(*) FILTER(WHERE result='lost')::int losses,count(*) FILTER(WHERE result='push')::int pushes,coalesce(sum(CASE WHEN result='won' THEN CASE WHEN american_odds>0 THEN american_odds/100.0 ELSE 100.0/abs(american_odds) END WHEN result='lost' THEN -1 ELSE 0 END),0)::real units FROM international_baseball_predictions WHERE model_version=$1`,[INTERNATIONAL_BASEBALL_V3_VERSION]);const r=q.rows[0]??{},graded=Number(r.graded??0),wins=Number(r.wins??0),units=Number(r.units??0);return res.json({graded,wins,losses:Number(r.losses??0),pushes:Number(r.pushes??0),winRate:graded?wins/graded:null,units,roi:graded?units/graded:null,modelVersion:INTERNATIONAL_BASEBALL_V3_VERSION,gradingSource:"official KBO / NPB results"})}catch(error){console.error("[Intl Baseball V3] performance failed",error);return res.status(500).json({error:"Unable to load performance"})}})
}
