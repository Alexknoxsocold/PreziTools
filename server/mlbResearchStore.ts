import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function db(): Pool | null {
  const url = process.env.MLB_RESEARCH_DATABASE_URL;
  if (!url) return null;
  if (process.env.DATABASE_URL && url === process.env.DATABASE_URL) {
    throw new Error("MLB_RESEARCH_DATABASE_URL must point to a separate research database branch");
  }
  if (!pool) pool = new Pool({ connectionString: url });
  return pool;
}

export type ResearchPrediction = {
  researchVersion: string;
  targetDate: string;
  gameId: string;
  matchup: string;
  recommendation: "NRFI" | "YRFI";
  probability: number;
  actualOutcome: "NRFI" | "YRFI" | null;
  firstInningScore: string | null;
  trainingGames: number;
  source: string;
  featureCutoffAt: Date;
};

async function ensureSchema(connection: Pool): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = connection.query(`
    CREATE SCHEMA IF NOT EXISTS mlb_research;
    CREATE TABLE IF NOT EXISTS mlb_research.replay_predictions (
      id bigserial PRIMARY KEY,
      research_version text NOT NULL,
      target_date date NOT NULL,
      game_id text NOT NULL,
      matchup text NOT NULL,
      recommendation text NOT NULL CHECK (recommendation IN ('NRFI','YRFI')),
      probability numeric(6,5) NOT NULL CHECK (probability >= 0 AND probability <= 1),
      actual_outcome text CHECK (actual_outcome IN ('NRFI','YRFI')),
      first_inning_score text,
      training_games integer NOT NULL DEFAULT 0,
      source text NOT NULL,
      feature_cutoff_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (research_version, target_date, game_id)
    );
    CREATE INDEX IF NOT EXISTS replay_predictions_date_idx
      ON mlb_research.replay_predictions(target_date DESC);
    CREATE INDEX IF NOT EXISTS replay_predictions_version_idx
      ON mlb_research.replay_predictions(research_version, target_date DESC);
    CREATE TABLE IF NOT EXISTS mlb_research.research_runs (
      id bigserial PRIMARY KEY,
      research_version text NOT NULL,
      date_from date NOT NULL,
      date_to date NOT NULL,
      source text NOT NULL,
      status text NOT NULL DEFAULT 'started',
      predictions integer NOT NULL DEFAULT 0,
      graded integer NOT NULL DEFAULT 0,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    );
  `).then(() => undefined).catch(error => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

/**
 * Historical research writes are deliberately disabled unless a separate
 * MLB_RESEARCH_DATABASE_URL is configured. DATABASE_URL is never used here.
 * An explicit equality guard also rejects accidental reuse of production.
 */
export async function saveResearchPrediction(row: ResearchPrediction): Promise<boolean> {
  const connection = db();
  if (!connection) {
    console.warn("[MLB Research] MLB_RESEARCH_DATABASE_URL is not configured; replay row not persisted.");
    return false;
  }
  await ensureSchema(connection);
  await connection.query(`
    INSERT INTO mlb_research.replay_predictions(
      research_version,target_date,game_id,matchup,recommendation,probability,
      actual_outcome,first_inning_score,training_games,source,feature_cutoff_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT(research_version,target_date,game_id) DO UPDATE SET
      matchup=EXCLUDED.matchup,
      recommendation=EXCLUDED.recommendation,
      probability=EXCLUDED.probability,
      actual_outcome=EXCLUDED.actual_outcome,
      first_inning_score=EXCLUDED.first_inning_score,
      training_games=EXCLUDED.training_games,
      source=EXCLUDED.source,
      feature_cutoff_at=EXCLUDED.feature_cutoff_at
  `, [
    row.researchVersion,
    row.targetDate,
    row.gameId,
    row.matchup,
    row.recommendation,
    row.probability,
    row.actualOutcome,
    row.firstInningScore,
    row.trainingGames,
    row.source,
    row.featureCutoffAt,
  ]);
  return true;
}

export async function beginResearchRun(researchVersion: string, dateFrom: string, dateTo: string, source: string): Promise<number | null> {
  const connection = db();
  if (!connection) return null;
  await ensureSchema(connection);
  const result = await connection.query<{ id: string }>(
    `INSERT INTO mlb_research.research_runs(research_version,date_from,date_to,source)
     VALUES($1,$2,$3,$4) RETURNING id::text`,
    [researchVersion, dateFrom, dateTo, source],
  );
  return Number(result.rows[0]?.id ?? 0) || null;
}

export async function finishResearchRun(
  runId: number | null,
  predictions: number,
  graded: number,
  status = "completed",
): Promise<void> {
  if (!runId) return;
  const connection = db();
  if (!connection) return;
  await connection.query(
    `UPDATE mlb_research.research_runs
        SET status=$2,predictions=$3,graded=$4,finished_at=now()
      WHERE id=$1`,
    [runId, status, predictions, graded],
  );
}
