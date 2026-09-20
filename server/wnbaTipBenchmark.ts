import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

export const DEFAULT_WNBA_TIP_COMPETITOR = 'TPB_FirstBasketBets';

export type CompetitorTipProjection = {
  source:string;
  gameDate:string;
  awayTeam:string;
  homeTeam:string;
  awayJumper:string|null;
  homeJumper:string|null;
  awayPct:number;
  homePct:number;
  capturedAt?:string;
};

export type CompetitorCalibration = {
  source:string;
  gradedGames:number;
  brier:number|null;
  accuracy:number|null;
  calibrationWeight:number;
};

type TipSignalLike={
  awayTipPct:number|null;
  homeTipPct:number|null;
  projectedFirstPossessionTeam:string|null;
  confidence:'insufficient'|'emerging'|'usable';
};

type SlateGameLike={date:string;awayTeam:string;homeTeam:string;tipSignal:TipSignalLike};
type SlateLike={games:SlateGameLike[]};

function team(v:string){const k=String(v||'').toUpperCase().trim();return({WAS:'WSH',WSH:'WSH',PHO:'PHX',PHX:'PHX',NYL:'NY',NY:'NY',GSV:'GS',GS:'GS',LVA:'LV',LV:'LV',LAS:'LA',LA:'LA'} as Record<string,string>)[k]||k}
function pct(v:number){return Math.max(1,Math.min(99,Number(v)||50))}
function isoDate(v:string){const raw=String(v||'');const m=raw.match(/^(\d{4}-\d{2}-\d{2})/);return m?.[1]||raw}

export async function ensureWnbaTipBenchmarkSchema(){
  if(!pool)return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wnba_tip_competitor_predictions(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source text NOT NULL,
      game_date date NOT NULL,
      away_team text NOT NULL,
      home_team text NOT NULL,
      away_jumper text,
      home_jumper text,
      away_pct numeric(5,2) NOT NULL,
      home_pct numeric(5,2) NOT NULL,
      captured_at timestamptz NOT NULL DEFAULT now(),
      actual_winner_team text,
      graded_at timestamptz,
      CONSTRAINT wnba_tip_comp_pct CHECK(away_pct>=0 AND away_pct<=100 AND home_pct>=0 AND home_pct<=100)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS wnba_tip_comp_unique
      ON wnba_tip_competitor_predictions(source,game_date,upper(away_team),upper(home_team));
    CREATE INDEX IF NOT EXISTS wnba_tip_comp_graded_idx
      ON wnba_tip_competitor_predictions(source,graded_at DESC);
    CREATE INDEX IF NOT EXISTS wnba_tip_comp_date_idx
      ON wnba_tip_competitor_predictions(game_date DESC);
  `);
}

export async function saveCompetitorTipProjection(p:CompetitorTipProjection){
  if(!pool)return false;
  await ensureWnbaTipBenchmarkSchema();
  const a=pct(p.awayPct),h=pct(p.homePct),sum=a+h;
  const away=Math.round((a/sum*100)*10)/10,home=Math.round((100-away)*10)/10;
  await pool.query(`
    INSERT INTO wnba_tip_competitor_predictions(source,game_date,away_team,home_team,away_jumper,home_jumper,away_pct,home_pct,captured_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,now()))
    ON CONFLICT(source,game_date,upper(away_team),upper(home_team)) DO UPDATE SET
      away_jumper=EXCLUDED.away_jumper,home_jumper=EXCLUDED.home_jumper,
      away_pct=EXCLUDED.away_pct,home_pct=EXCLUDED.home_pct,captured_at=EXCLUDED.captured_at
    WHERE wnba_tip_competitor_predictions.graded_at IS NULL
  `,[p.source.trim()||DEFAULT_WNBA_TIP_COMPETITOR,isoDate(p.gameDate),team(p.awayTeam),team(p.homeTeam),p.awayJumper,p.homeJumper,away,home,p.capturedAt||null]);
  return true;
}

export async function saveCompetitorTipProjections(items:CompetitorTipProjection[]){let saved=0;for(const item of items)if(await saveCompetitorTipProjection(item))saved++;return{saved};}

export async function gradeCompetitorTipProjections(gameDate:string,awayTeam:string,homeTeam:string,winnerTeam:string){
  if(!pool)return 0;
  await ensureWnbaTipBenchmarkSchema();
  const r=await pool.query(`UPDATE wnba_tip_competitor_predictions SET actual_winner_team=$4,graded_at=now() WHERE game_date=$1 AND upper(away_team)=upper($2) AND upper(home_team)=upper($3) AND graded_at IS NULL RETURNING id`,[isoDate(gameDate),team(awayTeam),team(homeTeam),team(winnerTeam)]);
  return r.rowCount||0;
}

export async function gradePendingCompetitorTipProjections(){
  if(!pool)return{graded:0};
  await ensureWnbaTipBenchmarkSchema();
  const r=await pool.query(`
    UPDATE wnba_tip_competitor_predictions c
    SET actual_winner_team=upper(e.tip_winner_team),graded_at=now()
    FROM wnba_opening_evidence e
    WHERE c.graded_at IS NULL
      AND e.confidence='verified'
      AND e.tip_winner_team IS NOT NULL
      AND c.game_date=e.game_date
      AND ((upper(c.away_team)=upper(e.team_a) AND upper(c.home_team)=upper(e.team_b)) OR (upper(c.away_team)=upper(e.team_b) AND upper(c.home_team)=upper(e.team_a)))
    RETURNING c.id
  `);
  return{graded:r.rowCount||0};
}

export async function getCompetitorCalibration(source:string):Promise<CompetitorCalibration>{
  if(!pool)return{source,gradedGames:0,brier:null,accuracy:null,calibrationWeight:0};
  await ensureWnbaTipBenchmarkSchema();
  const r=await pool.query(`SELECT away_team,home_team,away_pct,actual_winner_team FROM wnba_tip_competitor_predictions WHERE source=$1 AND graded_at IS NOT NULL ORDER BY graded_at DESC LIMIT 250`,[source]);
  const rows=r.rows;
  if(!rows.length)return{source,gradedGames:0,brier:null,accuracy:null,calibrationWeight:0};
  let brier=0,correct=0;
  for(const x of rows){const p=pct(Number(x.away_pct))/100,y=team(String(x.actual_winner_team))===team(String(x.away_team))?1:0;brier+=(p-y)**2;if((p>=0.5&&y===1)||(p<0.5&&y===0))correct++}
  brier/=rows.length;
  const accuracy=correct/rows.length;
  const sampleCap=rows.length>=100?0.12:rows.length>=60?0.07:rows.length>=30?0.03:0;
  const quality=Math.max(0,Math.min(1,(0.25-brier)/0.12));
  const calibrationWeight=Math.round(sampleCap*quality*1000)/1000;
  return{source,gradedGames:rows.length,brier:Math.round(brier*10000)/10000,accuracy:Math.round(accuracy*1000)/10,calibrationWeight};
}

export async function getCompetitorProjection(gameDate:string,awayTeam:string,homeTeam:string,source=DEFAULT_WNBA_TIP_COMPETITOR){
  if(!pool)return null;
  await ensureWnbaTipBenchmarkSchema();
  const r=await pool.query(`SELECT source,away_jumper,home_jumper,away_pct,home_pct,captured_at FROM wnba_tip_competitor_predictions WHERE source=$1 AND game_date=$2 AND upper(away_team)=upper($3) AND upper(home_team)=upper($4) ORDER BY captured_at DESC LIMIT 1`,[source,isoDate(gameDate),team(awayTeam),team(homeTeam)]);
  if(!r.rows.length)return null;
  const x=r.rows[0];return{source:x.source,awayJumper:x.away_jumper,homeJumper:x.home_jumper,awayPct:Number(x.away_pct),homePct:Number(x.home_pct),capturedAt:x.captured_at};
}

export async function calibratedCompetitorBlend(ourAwayPct:number,gameDate:string,awayTeam:string,homeTeam:string,source=DEFAULT_WNBA_TIP_COMPETITOR){
  const [projection,calibration]=await Promise.all([getCompetitorProjection(gameDate,awayTeam,homeTeam,source),getCompetitorCalibration(source)]);
  if(!projection||calibration.calibrationWeight<=0)return{awayPct:ourAwayPct,homePct:100-ourAwayPct,weight:0,calibration,projection};
  const w=calibration.calibrationWeight;
  const away=Math.max(15,Math.min(85,ourAwayPct*(1-w)+projection.awayPct*w));
  return{awayPct:Math.round(away*10)/10,homePct:Math.round((100-away)*10)/10,weight:w,calibration,projection};
}

async function verifiedTipWinner(gameDate:string,awayTeam:string,homeTeam:string){
  if(!pool)return null;
  try{
    const r=await pool.query(`SELECT upper(tip_winner_team) AS winner FROM wnba_opening_evidence WHERE confidence='verified' AND tip_winner_team IS NOT NULL AND game_date=$1::date AND ((upper(team_a)=upper($2) AND upper(team_b)=upper($3)) OR (upper(team_a)=upper($3) AND upper(team_b)=upper($2))) ORDER BY verified_at DESC LIMIT 1`,[isoDate(gameDate),team(awayTeam),team(homeTeam)]);
    return r.rows[0]?.winner?team(String(r.rows[0].winner)):null;
  }catch{return null;}
}

export async function applyCompetitorCalibrationToSlate<T extends SlateLike>(slate:T,source=DEFAULT_WNBA_TIP_COMPETITOR):Promise<T>{
  const games=await Promise.all(slate.games.map(async game=>{
    const signal=game.tipSignal;
    const winner=await verifiedTipWinner(game.date,game.awayTeam,game.homeTeam);
    const projected=signal.projectedFirstPossessionTeam?team(signal.projectedFirstPossessionTeam):null;
    const grade={verifiedTipWinnerTeam:winner,tipPredictionWon:winner&&projected?winner===projected:null};
    if(signal.awayTipPct===null||signal.homeTipPct===null)return{...game,...grade};
    const blended=await calibratedCompetitorBlend(signal.awayTipPct,isoDate(game.date),game.awayTeam,game.homeTeam,source);
    if(blended.weight<=0)return{...game,...grade};
    const edge=Math.abs(blended.awayPct-blended.homePct);
    const blendedProjected=signal.confidence!=='insufficient'&&edge>=3?(blended.awayPct>blended.homePct?game.awayTeam:game.homeTeam):null;
    const blendedGrade={verifiedTipWinnerTeam:winner,tipPredictionWon:winner&&blendedProjected?winner===team(blendedProjected):null};
    console.log('[WNBA Competitor Calibration]',`${game.awayTeam}@${game.homeTeam}`,{source,gradedGames:blended.calibration.gradedGames,weight:blended.weight,ourAway:signal.awayTipPct,competitorAway:blended.projection?.awayPct??null,finalAway:blended.awayPct});
    return{...game,...blendedGrade,tipSignal:{...signal,awayTipPct:blended.awayPct,homeTipPct:blended.homePct,projectedFirstPossessionTeam:blendedProjected}};
  }));
  return{...slate,games};
}

export async function getCompetitorBenchmarkSummary(source=DEFAULT_WNBA_TIP_COMPETITOR,days=180){
  const calibration=await getCompetitorCalibration(source);
  if(!pool)return{source,calibration,predictions:[]};
  await ensureWnbaTipBenchmarkSchema();
  const safeDays=Math.max(1,Math.min(730,Math.round(days)||180));
  const r=await pool.query(`SELECT game_date,away_team,home_team,away_jumper,home_jumper,away_pct,home_pct,captured_at,actual_winner_team,graded_at FROM wnba_tip_competitor_predictions WHERE source=$1 AND game_date>=current_date-$2::int ORDER BY game_date DESC,captured_at DESC LIMIT 500`,[source,safeDays]);
  return{source,calibration,predictions:r.rows.map(x=>({gameDate:String(x.game_date).slice(0,10),awayTeam:x.away_team,homeTeam:x.home_team,awayJumper:x.away_jumper,homeJumper:x.home_jumper,awayPct:Number(x.away_pct),homePct:Number(x.home_pct),capturedAt:x.captured_at,actualWinnerTeam:x.actual_winner_team,gradedAt:x.graded_at}))};
}

export async function seedInitialCompetitorTipObservations(){
  return saveCompetitorTipProjections([
    {source:DEFAULT_WNBA_TIP_COMPETITOR,gameDate:'2026-08-25',awayTeam:'CHI',homeTeam:'CON',awayJumper:'K. Cardoso',homeJumper:'O. Nelson-Ododa',awayPct:49,homePct:51,capturedAt:'2026-08-25T13:01:00Z'},
    {source:DEFAULT_WNBA_TIP_COMPETITOR,gameDate:'2026-08-25',awayTeam:'POR',homeTeam:'DAL',awayJumper:'M. Dileo',homeJumper:'A. Smith',awayPct:44,homePct:56,capturedAt:'2026-08-25T13:01:00Z'},
    {source:DEFAULT_WNBA_TIP_COMPETITOR,gameDate:'2026-08-25',awayTeam:'WSH',homeTeam:'PHX',awayJumper:'S. Austin',homeJumper:'N. Mack',awayPct:41,homePct:59,capturedAt:'2026-08-25T13:01:00Z'},
  ]);
}