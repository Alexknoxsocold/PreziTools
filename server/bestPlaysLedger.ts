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

function specialtyGroup(play: {id: string; sport: string; market: string; tier: string}) {
  if (play.id.startsWith("mlb-hr-")) return "MLB:HR";
  if (play.sport === "MLB" && play.tier === "VALUE") return "MLB:Value Lean";
  if (play.market.includes("First Basket")) return `${play.sport}:First Basket`;
  if (play.market === "First TD" || play.market === "Anytime TD") return `NFL:${play.market}`;
  return "";
}
// Same existing specialty limits as the board, applied across the saved day.
const SPECIALTY_CAPS: Record<string, number> = {
  "MLB:HR": 4, "MLB:Value Lean": 1, "NBA:First Basket": 3,
  "WNBA:First Basket": 2, "NFL:First TD": 2, "NFL:Anytime TD": 2,
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
  const client = await pool.connect();
  try {
  await client.query("BEGIN");
  // Serialize admissions for a date, including simultaneous browser requests.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`best-plays:${date}`]);
  const existing = await client.query(
    "SELECT selection_key,play_id,sport,market,pick,tier FROM best_plays_selection_ledger WHERE selection_date=$1::date", [date]);
  const admitted = existing.rows;
  for (const play of plays) {
    if (admitted.length >= 10) break;
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
    if (!startValue || startValue.getTime() <= Date.now()) continue;
    const fields = [play.market, play.matchup, play.pick, play.href];
    if (fields.some((value) => typeof value !== "string" || !value.trim())) continue;
    const group = specialtyGroup({id,sport,market:String(play.market),tier});
    if (SPECIALTY_CAPS[group] && admitted.filter(row => specialtyGroup({
      id:row.play_id,sport:row.sport,market:row.market,tier:row.tier,
    }) === group).length >= SPECIALTY_CAPS[group]) continue;
    const key = bestPlaySelectionKey(id);
    if (admitted.some(row => row.selection_key === key || (
      sport === "WNBA" && row.sport === sport &&
      row.play_id.split("-")[1] === id.split("-")[1] &&
      row.pick.toLowerCase() === String(play.pick).toLowerCase()
    ))) continue;
    const result = await client.query(
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
    if (result.rowCount) admitted.push({selection_key:key,play_id:id,sport,market:play.market,pick:play.pick,tier});
  }
  await client.query("COMMIT");
  return { captured, available: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
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


export async function getBestPlaySelections(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid_date");
  if (!pool) return { available: false, date, plays: [] };
  await ensureLedger();
  const result = await pool.query(`SELECT play_id AS id,sport,market,matchup,pick,
    probability,tier,game_start_at AS time,href FROM best_plays_selection_ledger
    WHERE selection_date=$1::date ORDER BY captured_at,selection_key`, [date]);
  return { available: true, date, plays: result.rows.map(row => ({...row, note: ""})) };
}
