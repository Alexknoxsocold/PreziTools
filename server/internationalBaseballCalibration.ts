import type { Express } from "express";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { INTERNATIONAL_BASEBALL_V3_VERSION } from "./internationalBaseballV3.js";

neonConfig.webSocketConstructor = ws;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

const MIN_OVERALL_GRADED = 200;
const MIN_SEGMENT_GRADED = 50;

type SummaryRow = {
  graded: number;
  wins: number;
  losses: number;
  pushes: number;
  units: number;
  roi: number | null;
  winRate: number | null;
  avgModelProbability: number | null;
  avgMarketProbability: number | null;
  avgEdge: number | null;
  brierScore: number | null;
  logLoss: number | null;
  calibrationGap: number | null;
};

function n(v: unknown) {
  const value = Number(v);
  return Number.isFinite(value) ? value : 0;
}

function nullable(v: unknown) {
  if (v == null) return null;
  const value = Number(v);
  return Number.isFinite(value) ? value : null;
}

function mapSummary(row: any): SummaryRow {
  const graded = n(row?.graded);
  const wins = n(row?.wins);
  const losses = n(row?.losses);
  const pushes = n(row?.pushes);
  const units = n(row?.units);
  const avgModelProbability = nullable(row?.avg_model_probability);
  const avgMarketProbability = nullable(row?.avg_market_probability);
  const avgEdge = nullable(row?.avg_edge);
  const winRate = graded ? wins / graded : null;
  return {
    graded,
    wins,
    losses,
    pushes,
    units,
    roi: graded ? units / graded : null,
    winRate,
    avgModelProbability,
    avgMarketProbability,
    avgEdge,
    brierScore: nullable(row?.brier_score),
    logLoss: nullable(row?.log_loss),
    calibrationGap: winRate != null && avgModelProbability != null ? winRate - avgModelProbability : null,
  };
}

function readiness(graded: number) {
  if (graded >= MIN_OVERALL_GRADED) return { stage: "calibration_ready", canReweight: true, message: "Enough overall graded volume to begin evidence-based weight review; still require segment-level checks." };
  if (graded >= 100) return { stage: "directional", canReweight: false, message: `Directional signal only. Keep production weights fixed until at least ${MIN_OVERALL_GRADED} graded plays.` };
  if (graded >= 50) return { stage: "early", canReweight: false, message: `Early sample. Do not tune weights yet; target at least ${MIN_OVERALL_GRADED} graded plays.` };
  return { stage: "collecting", canReweight: false, message: `Collecting data. Do not tune weights yet; target at least ${MIN_OVERALL_GRADED} graded plays.` };
}

const metricSql = `
  count(*) FILTER (WHERE p.result IN ('won','lost'))::int graded,
  count(*) FILTER (WHERE p.result='won')::int wins,
  count(*) FILTER (WHERE p.result='lost')::int losses,
  count(*) FILTER (WHERE p.result='push')::int pushes,
  coalesce(sum(CASE WHEN p.result='won' THEN CASE WHEN p.american_odds>0 THEN p.american_odds/100.0 ELSE 100.0/abs(p.american_odds) END WHEN p.result='lost' THEN -1 ELSE 0 END),0)::real units,
  avg(p.model_probability) FILTER (WHERE p.result IN ('won','lost'))::real avg_model_probability,
  avg(p.market_probability) FILTER (WHERE p.result IN ('won','lost'))::real avg_market_probability,
  avg(p.edge) FILTER (WHERE p.result IN ('won','lost'))::real avg_edge,
  avg(power(p.model_probability - CASE WHEN p.result='won' THEN 1.0 ELSE 0.0 END,2)) FILTER (WHERE p.result IN ('won','lost'))::real brier_score,
  avg(-(CASE WHEN p.result='won' THEN ln(greatest(0.000001,p.model_probability)) ELSE ln(greatest(0.000001,1-p.model_probability)) END)) FILTER (WHERE p.result IN ('won','lost'))::real log_loss
`;

async function getReport() {
  if (!pool) return null;

  const [overall, byLeague, byMarket, byStatus, byEdge, pending] = await Promise.all([
    pool.query(`SELECT ${metricSql} FROM international_baseball_predictions p WHERE p.model_version=$1`, [INTERNATIONAL_BASEBALL_V3_VERSION]),
    pool.query(`SELECT p.league segment, ${metricSql} FROM international_baseball_predictions p WHERE p.model_version=$1 GROUP BY p.league ORDER BY p.league`, [INTERNATIONAL_BASEBALL_V3_VERSION]),
    pool.query(`SELECT p.market segment, ${metricSql} FROM international_baseball_predictions p WHERE p.model_version=$1 GROUP BY p.market ORDER BY p.market`, [INTERNATIONAL_BASEBALL_V3_VERSION]),
    pool.query(`SELECT p.status segment, ${metricSql} FROM international_baseball_predictions p WHERE p.model_version=$1 GROUP BY p.status ORDER BY CASE p.status WHEN 'BEST_PLAY' THEN 1 WHEN 'PLAY' THEN 2 WHEN 'LEAN' THEN 3 ELSE 4 END`, [INTERNATIONAL_BASEBALL_V3_VERSION]),
    pool.query(`SELECT CASE WHEN p.edge>=0.08 THEN '8%+' WHEN p.edge>=0.06 THEN '6-8%' WHEN p.edge>=0.04 THEN '4-6%' ELSE '2.5-4%' END segment, ${metricSql} FROM international_baseball_predictions p WHERE p.model_version=$1 GROUP BY 1 ORDER BY min(p.edge)`, [INTERNATIONAL_BASEBALL_V3_VERSION]),
    pool.query(`SELECT count(*)::int total_locked,count(*) FILTER(WHERE result IS NULL)::int ungraded,count(*) FILTER(WHERE result IN ('won','lost','push'))::int settled FROM international_baseball_predictions WHERE model_version=$1`, [INTERNATIONAL_BASEBALL_V3_VERSION]),
  ]);

  const overallSummary = mapSummary(overall.rows[0] ?? {});
  const convert = (rows: any[]) => rows.map(row => ({
    segment: String(row.segment),
    ...mapSummary(row),
    sampleReady: n(row.graded) >= MIN_SEGMENT_GRADED,
    minimumSegmentSample: MIN_SEGMENT_GRADED,
  }));
  const counts = pending.rows[0] ?? {};

  return {
    modelVersion: INTERNATIONAL_BASEBALL_V3_VERSION,
    generatedAt: new Date().toISOString(),
    thresholds: { overallGradedForWeightReview: MIN_OVERALL_GRADED, segmentGradedForWeightReview: MIN_SEGMENT_GRADED },
    readiness: readiness(overallSummary.graded),
    overall: overallSummary,
    ledger: { totalLocked: n(counts.total_locked), settled: n(counts.settled), ungraded: n(counts.ungraded) },
    splits: {
      league: convert(byLeague.rows),
      market: convert(byMarket.rows),
      status: convert(byStatus.rows),
      edgeBucket: convert(byEdge.rows),
    },
    guardrail: "This endpoint is diagnostic only. It does not change production model weights automatically.",
  };
}

export function registerInternationalBaseballCalibrationRoutes(app: Express) {
  app.get("/api/international-baseball/calibration", async (_req, res) => {
    if (!pool) return res.json({ modelVersion: INTERNATIONAL_BASEBALL_V3_VERSION, readiness: { stage: "unavailable", canReweight: false }, overall: null, splits: {}, guardrail: "Database unavailable; production weights unchanged." });
    try {
      return res.json(await getReport());
    } catch (error) {
      console.error("[Intl Baseball Calibration] failed", error);
      return res.status(500).json({ error: "Unable to load KBO / NPB calibration diagnostics" });
    }
  });
}
