import type { Express } from "express";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { runFirstBasketTracker } from "./autoTracker";
import { runWnbaTracker } from "./wnbaFirstBasket";

neonConfig.webSocketConstructor = ws;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

type LedgerRow = { selection_date:string; selection_key:string; play_id:string; sport:string; market:string; matchup:string; pick:string; probability:number; game_start_at:string|null; href:string };
type Graded = { id:string; sport:string; market:string; matchup:string; pick:string; probability:number; result:"won"|"lost"; actual:string; gradedAt:string|null; href:string };

function etDate(offsetDays=0){const d=new Date(Date.now()+offsetDays*86400000);const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);const v=(t:string)=>p.find(x=>x.type===t)?.value;return `${v("year")}-${v("month")}-${v("day")}`;}
function requestedDate(raw:unknown){if(raw==="yesterday")return etDate(-1);if(typeof raw==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;return etDate(0);}
function norm(v:unknown){return String(v||"").toLowerCase().replace(/[^a-z0-9]/g,"");}
function surname(v:unknown){const bits=String(v||"").trim().split(/\s+/);return norm(bits[bits.length-1]);}
function mlbGamePk(playId:string){let m=playId.match(/^mlb-(\d+)$/i);if(m)return Number(m[1]);m=playId.match(/^mlb-hr(?:-value)?-(\d+)-/i);return m?Number(m[1]):null;}
async function json(url:string){const r=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{"User-Agent":"PreziTools/1.0"}});if(!r.ok)return null;return r.json();}
function base(row:LedgerRow,result:"won"|"lost",actual:string):Graded{return{id:row.selection_key,sport:row.sport,market:row.market,matchup:row.matchup,pick:row.pick,probability:Number(row.probability),result,actual,gradedAt:new Date().toISOString(),href:row.href};}

export async function gradeMlbFirstInning(row:LedgerRow):Promise<Graded|null> {
  const eventId = row.play_id.match(/^mlb-(\d+)$/i)?.[1];
  const market = row.market.toUpperCase();
  if (!pool || !eventId || !["NRFI", "YRFI"].includes(market) || !row.game_start_at) return null;
  // These selections carry ESPN event IDs. Read the already verified first-
  // inning ledger, rather than treating that ID as an MLB StatsAPI gamePk.
  try {
    const result = await pool.query(`SELECT outcome,first_inning_score,graded_at
      FROM mlb_prediction_snapshots WHERE game_id=$1
      AND locked_at IS NOT NULL AND locked_at < game_start_at
      AND game_start_at=($2::timestamptz AT TIME ZONE 'UTC')
      AND outcome IN ('NRFI','YRFI') AND graded_at IS NOT NULL
      ORDER BY locked_at ASC`, [eventId,row.game_start_at]);
    const verified = result.rows.map(snapshot => {
      const score = String(snapshot.first_inning_score ?? '').match(/^(\d+)\s*-\s*(\d+)$/);
      if (!score) return null;
      const away = Number(score[1]), home = Number(score[2]);
      if (!Number.isSafeInteger(away) || !Number.isSafeInteger(home)) return null;
      const outcome = away + home === 0 ? 'NRFI' : 'YRFI';
      return outcome === snapshot.outcome ? {outcome,away,home,gradedAt:snapshot.graded_at} : null;
    }).filter((value):value is NonNullable<typeof value> => value !== null);
    if (!verified.length || verified.some(value => value.outcome !== verified[0].outcome)) return null;
    const actual = verified[0];
    return {...base(row,actual.outcome===market?'won':'lost',`${actual.outcome} · 1st inning ${actual.away}-${actual.home}`),gradedAt:actual.gradedAt};
  } catch { return null; }
}
async function gradeMlbHomeRun(row:LedgerRow):Promise<Graded|null>{const gamePk=mlbGamePk(row.play_id);if(!gamePk)return null;try{const body:any=await json(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);if(String(body?.gameData?.status?.abstractGameState||"").toLowerCase()!=="final")return null;const picked=row.pick.replace(/\s+Home Run\s*$/i,"").trim();const allPlays=body?.liveData?.plays?.allPlays||[];const homers=allPlays.filter((p:any)=>String(p?.result?.eventType||"").toLowerCase()==="home_run"||String(p?.result?.event||"").toLowerCase()==="home run");const hitters=homers.map((p:any)=>String(p?.matchup?.batter?.fullName||p?.matchup?.batter?.name||"")).filter(Boolean);const hit=hitters.find((n:string)=>norm(n)===norm(picked)||(surname(n)&&surname(n)===surname(picked)));return base(row,hit?"won":"lost",hit?`${hit} homered`:`${picked} did not homer`);}catch{return null;}}

function nflEventId(row:LedgerRow){const parts=row.play_id.split("-");if(row.play_id.startsWith("nfl-td-")&&parts.length>=5)return parts[3];return null;}
async function nflSummary(row:LedgerRow){const id=nflEventId(row);return id?json(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(id)}`):null;}
function scoringPlayer(play:any){const athletes=[...(play?.participants||[]),...(play?.athletes||[])];for(const a of athletes){const athlete=a?.athlete||a;const name=athlete?.displayName||athlete?.fullName||athlete?.shortName;if(name)return String(name);}const text=String(play?.text||"");const m=text.match(/^([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)+)/);return m?.[1]||null;}
function isTouchdown(play:any){return /touchdown/i.test(String(play?.text||play?.type?.text||""));}
async function gradeNflTd(row:LedgerRow):Promise<Graded|null>{if(row.sport!=="NFL"||!(row.market==="First TD"||row.market==="Anytime TD"))return null;try{const body:any=await nflSummary(row);const comp=body?.header?.competitions?.[0];if(!comp?.status?.type?.completed)return null;const plays=(body?.drives?.previous||[]).flatMap((d:any)=>d?.plays||[]).filter(isTouchdown);const scorers=plays.map(scoringPlayer).filter(Boolean) as string[];if(!scorers.length)return base(row,"lost","No offensive touchdown scorer matched");const match=(n:string)=>norm(n)===norm(row.pick)||(surname(n)&&surname(n)===surname(row.pick));if(row.market==="First TD"){const first=scorers[0];return base(row,match(first)?"won":"lost",`First TD: ${first}`);}const hit=scorers.find(match);return base(row,hit?"won":"lost",hit?`${hit} scored a TD`:`${row.pick} did not score a TD`);}catch{return null;}}

function nbaEventId(row:LedgerRow){const m=row.play_id.match(/^nba-([^-]+)-/i);return m?.[1]||null;}
async function gradeNbaFirstBasket(row:LedgerRow):Promise<Graded|null>{if(!pool||row.sport!=="NBA"||!row.market.toLowerCase().includes("first basket"))return null;const id=nbaEventId(row);if(!id)return null;try{const r=await pool.query("SELECT first_scorer,first_scorer_team FROM fb_processed_games WHERE espn_game_id=$1 LIMIT 1",[id]);if(!r.rows.length)return null;const scorer=String(r.rows[0]?.first_scorer||"");if(!scorer)return null;const hit=norm(scorer)===norm(row.pick)||(surname(scorer)&&surname(scorer)===surname(row.pick));return base(row,hit?"won":"lost",`First basket: ${scorer}`);}catch{return null;}}
async function gradeWnbaFirstBasket(row:LedgerRow):Promise<Graded|null>{if(!pool||row.sport!=="WNBA"||!row.market.toLowerCase().includes("first basket"))return null;const m=row.play_id.match(/^wnba-([^-]+)-/i);const gameId=m?.[1];if(!gameId)return null;try{const r=await pool.query("SELECT first_scorer,first_scorer_team FROM wnba_processed_games WHERE espn_game_id=$1 LIMIT 1",[gameId]);if(!r.rows.length)return null;const scorer=String(r.rows[0]?.first_scorer||"");if(!scorer)return null;const hit=norm(scorer)===norm(row.pick)||(surname(scorer)&&surname(scorer)===surname(row.pick));return base(row,hit?"won":"lost",`First basket: ${scorer}`);}catch{return null;}}

async function gradeRow(row:LedgerRow):Promise<Graded|null>{const market=row.market.toLowerCase();if(row.sport==="MLB"&&(market.includes("home run")||market.includes("hr power")||market.includes("hr value")))return gradeMlbHomeRun(row);if(row.sport==="WNBA"&&market.includes("first basket"))return gradeWnbaFirstBasket(row);if(row.sport==="MLB")return gradeMlbFirstInning(row);if(row.sport==="NFL"&&(row.market==="First TD"||row.market==="Anytime TD"))return gradeNflTd(row);if(row.sport==="NBA"&&market.includes("first basket"))return gradeNbaFirstBasket(row);return null;}

export function registerBestPlaysOutcomeRoutes(app:Express){app.get("/api/best-plays/outcomes",async(req,res)=>{const date=requestedDate(req.query.date);if(!pool)return res.status(503).json({error:"Best Plays ledger unavailable"});try{if(date===etDate(0))await Promise.allSettled([runFirstBasketTracker(),runWnbaTracker()]);const result=await pool.query(`SELECT selection_date::text,selection_key,play_id,sport,market,matchup,pick,probability,game_start_at::text,href FROM best_plays_selection_ledger WHERE selection_date=$1::date ORDER BY captured_at ASC`,[date]);const rows=result.rows as LedgerRow[];const settled=(await Promise.all(rows.map(gradeRow))).filter((x):x is Graded=>x!==null);settled.sort((a,b)=>String(b.gradedAt||"").localeCompare(String(a.gradedAt||"")));const wins=settled.filter(x=>x.result==="won").length,losses=settled.filter(x=>x.result==="lost").length;res.setHeader("Cache-Control","no-store, max-age=0");return res.json({date,resetTimeZone:"America/New_York",resetAt:"00:00",total:settled.length,wins,losses,outcomes:settled});}catch(error){console.error("[Best Plays] outcome grading failed:",error);return res.status(500).json({error:"Unable to grade Best Plays outcomes"});}});}
