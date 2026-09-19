import { Pool, neonConfig } from "@neondatabase/serverless";
import type { Request } from "express";
import ws from "ws";

neonConfig.webSocketConstructor = ws;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
let ready: Promise<void> | null = null;

const SPORTS = new Set(["MLB", "NBA", "WNBA", "NFL"]);
const ID_PREFIX: Record<string, string> = {
  MLB: "mlb-",
  NBA: "nba-",
  WNBA: "wnba-",
  NFL: "nfl-",
};

function ensureLedger() {
  if (!pool) return Promise.resolve();
  if (ready) return ready;
  ready = pool
    .query(`
      CREATE TABLE IF NOT EXISTS best_plays_selection_ledger (
        selection_date date NOT NULL,
        selection_key text NOT NULL,
        play_id text NOT NULL,
        sport text NOT NULL CHECK (sport IN ('MLB','NBA','WNBA','NFL')),
        market text NOT NULL,
        matchup text NOT NULL,
        pick text NOT NULL,
        probability real NOT NULL CHECK (probability >= 0 AND probability <= 100),
        tier text NOT NULL CHECK (tier IN ('BEST PLAY','STRONG PLAY','VALUE')),
        game_start_at timestamptz,
        href text NOT NULL,
        captured_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (selection_date, selection_key)
      );
      CREATE INDEX IF NOT EXISTS best_plays_selection_date_idx
        ON best_plays_selection_ledger(selection_date, captured_at DESC);
      CREATE OR REPLACE FUNCTION protect_best_plays_selection_ledger()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Best Plays selection snapshots are immutable';
      END;
      $$;
      DROP TRIGGER IF EXISTS best_plays_selection_update_guard ON best_plays_selection_ledger;
      CREATE TRIGGER best_plays_selection_update_guard
        BEFORE UPDATE OR DELETE ON best_plays_selection_ledger
        FOR EACH ROW EXECUTE FUNCTION protect_best_plays_selection_ledger();
    `)
    .then(() => undefined)
    .catch((error) => {
      ready = null;
      throw error;
    });
  return ready;
}

export function bestPlaySelectionKey(id: string) {
  return id
    .trim()
    .toLowerCase()
    .replace(/^mlb-hr-value-/, "mlb-hr-")
    .replace(/-value$/, "");
}

function etDate(offset = 0) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + offset * 86_400_000));
  const value = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function sameOrigin(req: Request) {
  const source = req.get("origin") || req.get("referer");
  if (!source) return process.env.NODE_ENV !== "production";
  try {
    return new URL(source).host === req.get("host");
  } catch {
    return false;
  }
}

type Selection = {
  id?: unknown;
  sport?: unknown;
  market?: unknown;
  matchup?: unknown;
  pick?: unknown;
  probability?: unknown;
  tier?: unknown;
  time?: unknown;
  href?: unknown;
};

export async function captureBestPlaySelections(req: Request) {
  if (!pool) return { captured: 0, available: false };
  if (!sameOrigin(req)) throw new Error("origin_not_allowed");
  const date = typeof req.body?.date === "string" ? req.body.date : "";
  if (![etDate(0), etDate(1)].includes(date)) throw new Error("invalid_date");
  const plays: Selection[] = Array.isArray(req.body?.plays) ? req.body.plays : [];
  if (!plays.length || plays.length > 10) throw new Error("invalid_slate_size");
  await ensureLedger();
  let captured = 0;
  for (const play of plays) {
    const id = typeof play.id === "string" ? play.id.trim() : "";
    const sport = typeof play.sport === "string" ? play.sport.toUpperCase() : "";
    const probability = Number(play.probability);
    const tier = typeof play.tier === "string" ? play.tier : "";
    if (
      !SPORTS.has(sport) ||
      !id.startsWith(ID_PREFIX[sport]) ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 100 ||
      !["BEST PLAY", "STRONG PLAY", "VALUE"].includes(tier)
    ) continue;
    const start = typeof play.time === "string" ? new Date(play.time) : null;
    const startValue = start && Number.isFinite(start.getTime()) ? start : null;
    if (startValue && startValue.getTime() <= Date.now()) continue;
    const fields = [play.market, play.matchup, play.pick, play.href];
    if (fields.some((value) => typeof value !== "string" || !value.trim())) continue;
    const result = await pool.query(
      `INSERT INTO best_plays_selection_ledger
       (selection_date,selection_key,play_id,sport,market,matchup,pick,probability,tier,game_start_at,href)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(selection_date,selection_key) DO NOTHING`,
      [
        date,
        bestPlaySelectionKey(id),
        id,
        sport,
        String(play.market).slice(0, 80),
        String(play.matchup).slice(0, 160),
        String(play.pick).slice(0, 160),
        probability,
        tier,
        startValue,
        String(play.href).slice(0, 120),
      ],
    );
    captured += result.rowCount ?? 0;
  }
  return { captured, available: true };
}

export async function getBestPlaySelectionKeys(date: string) {
  if (!pool) return new Set<string>();
  await ensureLedger();
  const result = await pool.query(
    `SELECT selection_key FROM best_plays_selection_ledger WHERE selection_date=$1::date`,
    [date],
  );
  return new Set(result.rows.map((row) => String(row.selection_key)));
}
