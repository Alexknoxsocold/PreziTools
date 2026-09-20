import type { Express } from "express";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

type LedgerRow = {
  selection_date: string;
  selection_key: string;
  play_id: string;
  sport: string;
  market: string;
  matchup: string;
  pick: string;
  probability: number;
  game_start_at: string | null;
  href: string;
};

type Graded = {
  id: string;
  sport: string;
  market: string;
  matchup: string;
  pick: string;
  probability: number;
  result: "won" | "lost";
  actual: string;
  gradedAt: string | null;
  href: string;
};

function etDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const v = (type: string) => p.find((x) => x.type === type)?.value;
  return `${v("year")}-${v("month")}-${v("day")}`;
}

function requestedDate(raw: unknown) {
  if (raw === "yesterday") return etDate(-1);
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return etDate(0);
}

function mlbGamePk(playId: string) {
  const m = playId.match(/^mlb-(\d+)$/i);
  return m ? Number(m[1]) : null;
}

async function gradeMlbFirstInning(row: LedgerRow): Promise<Graded | null> {
  const gamePk = mlbGamePk(row.play_id);
  if (!gamePk) return null;
  const market = row.market.toUpperCase();
  if (market !== "NRFI" && market !== "YRFI") return null;
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "PreziTools/1.0" },
    });
    if (!r.ok) return null;
    const body: any = await r.json();
    const state = String(body?.gameData?.status?.abstractGameState || "").toLowerCase();
    if (state !== "final") return null;
    const first = body?.liveData?.linescore?.innings?.find((x: any) => Number(x?.num) === 1) ?? body?.liveData?.linescore?.innings?.[0];
    if (!first) return null;
    const awayRuns = Number(first?.away?.runs ?? 0);
    const homeRuns = Number(first?.home?.runs ?? 0);
    if (!Number.isFinite(awayRuns) || !Number.isFinite(homeRuns)) return null;
    const actualMarket = awayRuns + homeRuns === 0 ? "NRFI" : "YRFI";
    return {
      id: row.selection_key,
      sport: row.sport,
      market: row.market,
      matchup: row.matchup,
      pick: row.pick,
      probability: Number(row.probability),
      result: actualMarket === market ? "won" : "lost",
      actual: `${actualMarket} · 1st inning ${awayRuns}-${homeRuns}`,
      gradedAt: body?.gameData?.datetime?.officialDate ? new Date().toISOString() : null,
      href: row.href,
    };
  } catch {
    return null;
  }
}

async function gradeNflMoneyline(row: LedgerRow): Promise<Graded | null> {
  if (row.sport !== "NFL" || !row.market.toLowerCase().includes("moneyline")) return null;
  const eventId = row.play_id.match(/^nfl-ml-(.+)$/i)?.[1];
  if (!eventId) return null;
  try {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(eventId)}`, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "PreziTools/1.0" },
    });
    if (!r.ok) return null;
    const body: any = await r.json();
    const comp = body?.header?.competitions?.[0];
    if (!comp?.status?.type?.completed) return null;
    const winner = (comp?.competitors || []).find((x: any) => x?.winner === true);
    const abbr = String(winner?.team?.abbreviation || "").toUpperCase();
    if (!abbr) return null;
    const picked = row.pick.toUpperCase().replace(/\s+ML\s*$/, "").trim();
    return {
      id: row.selection_key,
      sport: row.sport,
      market: row.market,
      matchup: row.matchup,
      pick: row.pick,
      probability: Number(row.probability),
      result: picked === abbr ? "won" : "lost",
      actual: `${abbr} won`,
      gradedAt: new Date().toISOString(),
      href: row.href,
    };
  } catch {
    return null;
  }
}

async function gradeRow(row: LedgerRow): Promise<Graded | null> {
  // Public Best Plays W/L intentionally excludes HR and WNBA First Basket.
  const market = row.market.toLowerCase();
  if (row.sport === "MLB" && (market.includes("home run") || market.includes("hr power") || market.includes("hr value"))) return null;
  if (row.sport === "WNBA" && market.includes("first basket")) return null;
  if (row.sport === "MLB") return gradeMlbFirstInning(row);
  if (row.sport === "NFL") return gradeNflMoneyline(row);
  return null;
}

export function registerBestPlaysOutcomeRoutes(app: Express) {
  app.get("/api/best-plays/outcomes", async (req, res) => {
    const date = requestedDate(req.query.date);
    if (!pool) return res.status(503).json({ error: "Best Plays ledger unavailable" });
    try {
      const result = await pool.query(
        `SELECT selection_date::text,selection_key,play_id,sport,market,matchup,pick,probability,game_start_at::text,href
         FROM best_plays_selection_ledger
         WHERE selection_date=$1::date
         ORDER BY captured_at ASC`,
        [date],
      );
      const rows = result.rows as LedgerRow[];
      const settled = (await Promise.all(rows.map(gradeRow))).filter((x): x is Graded => x !== null);
      settled.sort((a, b) => String(b.gradedAt || "").localeCompare(String(a.gradedAt || "")));
      const wins = settled.filter((x) => x.result === "won").length;
      const losses = settled.filter((x) => x.result === "lost").length;
      res.setHeader("Cache-Control", "no-store, max-age=0");
      return res.json({
        date,
        resetTimeZone: "America/New_York",
        resetAt: "00:00",
        total: settled.length,
        wins,
        losses,
        outcomes: settled,
      });
    } catch (error) {
      console.error("[Best Plays] outcome grading failed:", error);
      return res.status(500).json({ error: "Unable to grade Best Plays outcomes" });
    }
  });
}
