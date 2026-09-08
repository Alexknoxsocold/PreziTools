import type { Express } from "express";
import { fetchNrfiDataV4Live, fetchUpcomingNrfiDataV4Live } from "./mlbNrfiLiveV4.js";
import { enrichMlbResponseWithEvidence, getMlbEvidenceShadowSummary } from "./mlbEvidenceShadow.js";
import { recordPredictionSnapshot } from "./mlbCalibration.js";
import { registerMlbHrCalibration } from "./mlbHrCalibration.js";
import type { NrfiGame } from "./mlbNrfi.js";

function canonicalMarketValue(game: NrfiGame): any {
  const market = game.marketValue;
  if (!market?.available || !market.selection || market.price === null || !market.updatedAt) return null;
  const sideProbability = game.recommendation === "NRFI" ? game.nrfiProbability / 100 : 1 - game.nrfiProbability / 100;
  const edge = market.edge === null ? null : market.edge / 100;
  const expectedValue = market.ev === null ? null : market.ev / 100;
  return { available:true, side:market.selection, sportsbook:market.book, market:"NRFI/YRFI", americanOdds:market.price, capturedAt:market.updatedAt, ageSeconds:null, impliedProbability:market.impliedProbability===null?null:market.impliedProbability/100, noVigProbability:market.noVigProbability===null?null:market.noVigProbability/100, modelProbability:sideProbability, edge, expectedValue, valuePlay:edge!==null&&expectedValue!==null&&edge>=0.02&&expectedValue>0, reason:edge!==null&&expectedValue!==null&&edge>=0.02&&expectedValue>0?"Verified PropLine first-inning value captured with live V4 prediction":"Verified PropLine first-inning price captured; edge below value threshold" };
}
function persistLiveV4(date:string,games:NrfiGame[]):void{const ledger={date,games:games.map(game=>({...game,modelVersion:"v4-live",marketValue:canonicalMarketValue(game)}))};void recordPredictionSnapshot(ledger).catch(error=>console.warn("[MLB V4 Ledger] Prediction/market snapshot write failed:",error))}

export function registerMlbV4PublicRoutes(app:Express):void{
  // Install the HR prediction ledger before registerRoutes() mounts /api/mlb/home-runs.
  registerMlbHrCalibration(app);
  app.get("/api/mlb/nrfi",async(req,res)=>{try{const requestedDate=typeof req.query.date==="string"?req.query.date:undefined;if(requestedDate&&!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate))return res.status(400).json({error:"date must use YYYY-MM-DD format"});const raw=await fetchNrfiDataV4Live(requestedDate),data=await enrichMlbResponseWithEvidence(raw);persistLiveV4(data.date,data.games);res.setHeader("Cache-Control","public, max-age=60, stale-while-revalidate=300");res.setHeader("X-MLB-Model-Version","v4-live");return res.json({...data,modelVersion:"v4-live",evidenceModel:"top-order-weather-shadow-v1"})}catch(error){console.error("[MLB V4 Public] Error:",error);return res.status(502).json({error:"Unable to load MLB V4 NRFI data"})}});
  app.get("/api/mlb/nrfi/upcoming",async(req,res)=>{try{const requestedDays=typeof req.query.days==="string"?Number(req.query.days):3;if(!Number.isFinite(requestedDays)||requestedDays<1||requestedDays>3)return res.status(400).json({error:"days must be a number from 1 to 3"});const raw=await fetchUpcomingNrfiDataV4Live(requestedDays),days=await Promise.all(raw.days.map(day=>enrichMlbResponseWithEvidence(day)));for(const day of days)persistLiveV4(day.date,day.games);const games=days.flatMap(day=>day.games),topPick=raw.topPick?games.find(game=>game.id===raw.topPick?.id)??null:null,data={...raw,days,games,topPick};res.setHeader("Cache-Control","public, max-age=60, stale-while-revalidate=300");res.setHeader("X-MLB-Model-Version","v4-live");return res.json({...data,modelVersion:"v4-live",evidenceModel:"top-order-weather-shadow-v1"})}catch(error){console.error("[MLB V4 Public] Upcoming error:",error);return res.status(502).json({error:"Unable to load upcoming MLB V4 NRFI data"})}});
  app.get("/api/mlb/evidence-research",async(req,res)=>{try{const requestedDays=typeof req.query.days==="string"?Number(req.query.days):30;if(!Number.isFinite(requestedDays)||requestedDays<7||requestedDays>365)return res.status(400).json({error:"days must be a number from 7 to 365"});const summary=await getMlbEvidenceShadowSummary(requestedDays);res.setHeader("Cache-Control","public, max-age=300, stale-while-revalidate=900");return res.json({model:"top-order-weather-shadow-v1",liveModel:"v4-live",windowDays:Math.round(requestedDays),...summary,promotionRule:"Research remains shadow-only until at least 100 graded games and Brier score improves by at least 0.005 versus live V4."})}catch(error){console.error("[MLB Evidence Research] Error:",error);return res.status(500).json({error:"Unable to load MLB evidence research summary"})}})
}
