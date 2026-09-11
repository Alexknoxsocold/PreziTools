import type { Express } from "express";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { gradePendingInternationalBaseball } from "./internationalBaseball.js";

neonConfig.webSocketConstructor = ws;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

function etDateOffset(offsetDays=0){const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const y=Number(parts.find(p=>p.type==="year")?.value),m=Number(parts.find(p=>p.type==="month")?.value),d=Number(parts.find(p=>p.type==="day")?.value);return new Date(Date.UTC(y,m-1,d+offsetDays,12)).toISOString().slice(0,10)}
function requested(v:unknown){if(v==null||v===""||v==="today")return etDateOffset(0);if(v==="yesterday")return etDateOffset(-1);if(typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v))return v;return null}

export function registerInternationalBaseballOutcomeRoutes(app:Express){
  app.get("/api/international-baseball/outcomes",async(req,res)=>{
    const date=requested(req.query.date);if(!date)return res.status(400).json({error:"date must be today, yesterday, or YYYY-MM-DD"});
    if(!pool)return res.json({date,total:0,wins:0,losses:0,pushes:0,outcomes:[]});
    try{
      await gradePendingInternationalBaseball(100);
      const result=await pool.query(`SELECT id,league,home_team,away_team,market,selection,line,model_probability,result,actual_score,graded_at,status FROM international_baseball_predictions WHERE (game_start_at AT TIME ZONE 'America/New_York')::date=$1::date AND graded_at IS NOT NULL AND result IN ('won','lost','push') AND status IN ('BEST_PLAY','PLAY','LEAN') ORDER BY graded_at DESC`,[date]);
      const outcomes=result.rows.filter(r=>r.result!=="push").map(r=>({id:String(r.id),sport:String(r.league),market:r.market==="moneyline"?"Moneyline":"Over / Under",matchup:`${r.away_team} @ ${r.home_team}`,pick:r.market==="total"&&r.line!=null?`${r.selection} ${Number(r.line)}`:String(r.selection),probability:Number(r.model_probability)*100,result:r.result,actual:r.actual_score?`Final ${r.actual_score}`:"Official final verified",gradedAt:r.graded_at,href:"/kbo-npb"}));
      const wins=outcomes.filter(r=>r.result==="won").length,losses=outcomes.filter(r=>r.result==="lost").length,pushes=result.rows.filter(r=>r.result==="push").length;
      res.setHeader("Cache-Control","public, max-age=60, stale-while-revalidate=300");
      return res.json({date,total:outcomes.length,wins,losses,pushes,outcomes});
    }catch(error){console.error("[Intl Baseball Outcomes]",error);return res.status(500).json({error:"Unable to load KBO / NPB outcomes"})}
  });
}
