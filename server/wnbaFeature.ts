import type { Express } from "express";
import cron from "node-cron";
import { requireAdmin } from "./auth";
import {
  ensureWnbaSchema,
  getWnbaDiagnostics,
  getWnbaSlate,
  lockWnbaPredictions,
  runWnbaTracker,
  type WnbaSlate,
} from "./wnbaFirstBasket";
import { getWnbaHistory } from "./wnbaHistory";
import { backfillWnbaHistory, refreshRecentWnbaEvidence } from "./wnbaBackfill";
import { ensureWnbaEvidenceSchema } from "./wnbaEvidence";
import { applyWnbaSequenceModel } from "./wnbaSequenceModel";
import { freezeAndMergeWnbaSlate } from "./frozenDisplayAdapters";
import {
  DEFAULT_WNBA_TIP_COMPETITOR,
  applyCompetitorCalibrationToSlate,
  ensureWnbaTipBenchmarkSchema,
  getCompetitorBenchmarkSummary,
  gradePendingCompetitorTipProjections,
  saveCompetitorTipProjections,
  seedInitialCompetitorTipObservations,
  type CompetitorTipProjection,
} from "./wnbaTipBenchmark";

let started = false;
let lastNonEmptySlate: WnbaSlate | null = null;

function etCalendarDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  const hour=Number(parts.find((p)=>p.type==="hour")?.value??0);
  if(hour<4){const prior=new Date(value.getTime()-24*60*60*1000);return etCalendarDate(new Date(prior.setUTCHours(12,0,0,0)));}
  return `${y}-${m}-${d}`;
}

function slateEtDate(slate: WnbaSlate): string | null {
  const first = slate.games[0]?.date;
  if (!first) return null;
  const parsed = new Date(first);
  return Number.isNaN(parsed.getTime()) ? null : etCalendarDate(parsed);
}

async function getGameDaySlate(): Promise<WnbaSlate> {
  let slate = await getWnbaSlate();

  // ESPN can briefly return an empty scoreboard while live game data is changing.
  // Never let that transient response erase today's WNBA page. Retry once without
  // the internal slate cache, then fall back to the last known non-empty slate for
  // the same Eastern calendar day only.
  if (!slate.games.length) {
    const refreshed = await getWnbaSlate(true);
    if (refreshed.games.length) slate = refreshed;
  }

  const today = etCalendarDate();
  if (slate.games.length) {
    if (slateEtDate(slate) === today) lastNonEmptySlate = slate;
    return slate;
  }

  if (lastNonEmptySlate && slateEtDate(lastNonEmptySlate) === today) {
    console.warn(
      "[WNBA] ESPN returned an empty current-day slate; serving last non-empty ET game-day slate.",
    );
    return lastNonEmptySlate;
  }

  return slate;
}

export function registerWnbaFeature(app: Express): void {
  void Promise.all([
    ensureWnbaSchema(),
    ensureWnbaEvidenceSchema(),
    ensureWnbaTipBenchmarkSchema(),
  ]).catch((e) => console.error("[WNBA] Schema initialization failed:", e));

  app.get("/api/wnba/first-basket", async (_req, res) => {
    try {
      let rawSlate = await getGameDaySlate();
      const needsFinalGrade = rawSlate.games.some((game) =>
        game.status.toLowerCase().includes("final") && !game.verifiedFirstScorer
      );
      if (needsFinalGrade) {
        const grading = await runWnbaTracker();
        if (grading.processed > 0) rawSlate = await getWnbaSlate(true);
      }
      const slate = applyWnbaSequenceModel(rawSlate);
      const calibrated = await freezeAndMergeWnbaSlate(await applyCompetitorCalibrationToSlate(slate));
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.json(calibrated);
    } catch (e) {
      console.error("[WNBA] Slate error:", e);
      res.status(502).json({ error: "Unable to load WNBA First Basket data" });
    }
  });
  app.get("/api/wnba/history", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await getWnbaHistory());
    } catch (e) {
      console.error("[WNBA] History error:", e);
      res
        .status(500)
        .json({ error: "Unable to load WNBA First Basket history" });
    }
  });

  // Competitor projections are a research/calibration lane only. They are stored
  // pregame, graded from verified tip evidence, and cannot affect public output
  // until the source earns a non-zero calibration weight after 30+ graded games.
  app.post("/api/admin/wnba/tip-competitor", requireAdmin, async (req, res) => {
    try {
      const source =
        typeof req.body?.source === "string" && req.body.source.trim()
          ? req.body.source.trim()
          : DEFAULT_WNBA_TIP_COMPETITOR;
      const raw = Array.isArray(req.body?.projections)
        ? req.body.projections
        : [req.body];
      if (!raw.length)
        return res
          .status(400)
          .json({ error: "At least one projection is required" });
      const projections: CompetitorTipProjection[] = [];
      for (const item of raw) {
        const gameDate = String(item?.gameDate || "").trim(),
          awayTeam = String(item?.awayTeam || "")
            .trim()
            .toUpperCase(),
          homeTeam = String(item?.homeTeam || "")
            .trim()
            .toUpperCase(),
          awayPct = Number(item?.awayPct),
          homePct = Number(item?.homePct);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDate))
          return res
            .status(400)
            .json({ error: "Each gameDate must use YYYY-MM-DD" });
        if (!awayTeam || !homeTeam)
          return res
            .status(400)
            .json({ error: "Each projection requires awayTeam and homeTeam" });
        if (
          !Number.isFinite(awayPct) ||
          !Number.isFinite(homePct) ||
          awayPct <= 0 ||
          homePct <= 0 ||
          awayPct >= 100 ||
          homePct >= 100
        )
          return res
            .status(400)
            .json({
              error: "awayPct and homePct must be numbers between 0 and 100",
            });
        projections.push({
          source: String(item?.source || source),
          gameDate,
          awayTeam,
          homeTeam,
          awayJumper: item?.awayJumper ? String(item.awayJumper) : null,
          homeJumper: item?.homeJumper ? String(item.homeJumper) : null,
          awayPct,
          homePct,
          capturedAt: item?.capturedAt ? String(item.capturedAt) : undefined,
        });
      }
      const saved = await saveCompetitorTipProjections(projections);
      const grading = await gradePendingCompetitorTipProjections();
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        ...saved,
        grading,
        benchmark: await getCompetitorBenchmarkSummary(source, 180),
      });
    } catch (e) {
      console.error("[WNBA] Competitor projection save failed:", e);
      return res
        .status(500)
        .json({ error: "Unable to save competitor tip projections" });
    }
  });

  app.get("/api/admin/wnba/tip-competitor", requireAdmin, async (req, res) => {
    try {
      const source =
        typeof req.query.source === "string" && req.query.source.trim()
          ? req.query.source.trim()
          : DEFAULT_WNBA_TIP_COMPETITOR;
      const days =
        typeof req.query.days === "string" ? Number(req.query.days) : 180;
      await gradePendingCompetitorTipProjections();
      res.setHeader("Cache-Control", "no-store");
      res.json(
        await getCompetitorBenchmarkSummary(
          source,
          Number.isFinite(days) ? days : 180,
        ),
      );
    } catch (e) {
      console.error("[WNBA] Competitor benchmark summary failed:", e);
      res
        .status(500)
        .json({ error: "Unable to load competitor tip benchmark" });
    }
  });

  app.post("/api/admin/wnba/run", requireAdmin, async (_req, res) => {
    try {
      const [locks, tracking, evidence] = await Promise.all([
        lockWnbaPredictions(),
        runWnbaTracker(),
        refreshRecentWnbaEvidence(10),
      ]);
      const competitorGrading = await gradePendingCompetitorTipProjections();
      res.json({ locks, tracking, evidence, competitorGrading });
    } catch (e) {
      console.error("[WNBA] Manual WNBA run failed:", e);
      res.status(500).json({ error: "WNBA maintenance pass failed" });
    }
  });
  app.post("/api/admin/wnba/backfill", requireAdmin, async (req, res) => {
    try {
      const days = Math.max(1, Math.min(14, Number(req.body?.days ?? 7))),
        maxGames = Math.max(1, Math.min(40, Number(req.body?.maxGames ?? 24)));
      const result = await backfillWnbaHistory(days, maxGames);
      const competitorGrading = await gradePendingCompetitorTipProjections();
      res.json({ ...result, competitorGrading });
    } catch (e) {
      console.error("[WNBA] Strict backfill failed:", e);
      res.status(500).json({ error: "WNBA strict history rebuild failed" });
    }
  });
  app.get("/api/admin/wnba/diagnostics", requireAdmin, async (req, res) => {
    try {
      const days =
        typeof req.query.days === "string" ? Number(req.query.days) : 30;
      const [d, competitor] = await Promise.all([
        getWnbaDiagnostics(Number.isFinite(days) ? days : 30),
        getCompetitorBenchmarkSummary(DEFAULT_WNBA_TIP_COMPETITOR, 180),
      ]);
      res.json({
        ...d,
        historyStatus: "rebuilding-strict",
        trackerStatus: "active-strict",
        sequenceModel: "possession-first-seq-v1",
        competitorBenchmark: competitor.calibration,
      });
    } catch (e) {
      console.error("[WNBA] Diagnostics failed:", e);
      res.status(500).json({ error: "Unable to load WNBA diagnostics" });
    }
  });

  if (started) return;
  started = true;
  void seedInitialCompetitorTipObservations()
    .then((r) =>
      console.log(
        `[WNBA Benchmark] Preserved ${r.saved} initial competitor observations.`,
      ),
    )
    .then(() => gradePendingCompetitorTipProjections())
    .then((r) => {
      if (r.graded)
        console.log(
          `[WNBA Benchmark] Graded ${r.graded} preserved competitor observations.`,
        );
    })
    .catch((e) =>
      console.warn("[WNBA Benchmark] Initial observation seed failed:", e),
    );

  cron.schedule(
    "*/15 10-23 * * *",
    async () => {
      try {
        const r = await lockWnbaPredictions();
        if (r.eligible || r.locked)
          console.log(
            `[WNBA] Lock pass: ${r.locked} locked, ${r.waiting} waiting.`,
          );
      } catch (e) {
        console.warn("[WNBA] Lock pass failed:", e);
      }
    },
    { timezone: "America/New_York" },
  );
  cron.schedule(
    "*/30 12-23 * * *",
    async () => {
      try {
        const r = await runWnbaTracker();
        const g = await gradePendingCompetitorTipProjections();
        if (r.processed || r.unresolved)
          console.log(
            `[WNBA] Strict tracker: ${r.processed} processed, ${r.unresolved} unresolved.`,
          );
        if (g.graded)
          console.log(
            `[WNBA Benchmark] Graded ${g.graded} competitor tip projection(s).`,
          );
      } catch (e) {
        console.warn("[WNBA] Strict tracker failed:", e);
      }
    },
    { timezone: "America/New_York" },
  );
  cron.schedule(
    "*/30 0-3 * * *",
    async () => {
      try {
        const r = await runWnbaTracker();
        const g = await gradePendingCompetitorTipProjections();
        if (r.processed || r.unresolved)
          console.log(
            `[WNBA] Late strict tracker: ${r.processed} processed, ${r.unresolved} unresolved.`,
          );
        if (g.graded)
          console.log(
            `[WNBA Benchmark] Late grading: ${g.graded} competitor tip projection(s).`,
          );
      } catch (e) {
        console.warn("[WNBA] Late strict tracker failed:", e);
      }
    },
    { timezone: "America/New_York" },
  );
  cron.schedule(
    "23 * * * *",
    async () => {
      try {
        const [r, v] = await Promise.all([
          backfillWnbaHistory(7, 24),
          refreshRecentWnbaEvidence(10),
        ]);
        const g = await gradePendingCompetitorTipProjections();
        console.log(
          `[WNBA] Strict rebuild: ${r.gamesAdded} verified, ${r.unresolved} rejected; evidence refreshed ${v.updated}/${v.checked}${r.done ? " (season complete)" : ""}; competitor grading ${g.graded}.`,
        );
      } catch (e) {
        console.warn("[WNBA] Strict rebuild failed:", e);
      }
    },
    { timezone: "America/New_York" },
  );
  void getWnbaSlate(true)
    .then((s) => {
      if (s.games.length && slateEtDate(s) === etCalendarDate())
        lastNonEmptySlate = s;
      console.log(
        `[WNBA] Warmed ${s.games.length} games across ${s.teams.length} teams.`,
      );
    })
    .catch((e) => console.warn("[WNBA] Warm failed:", e));
  void Promise.all([
    runWnbaTracker(),
    backfillWnbaHistory(7, 24),
    refreshRecentWnbaEvidence(10),
  ])
    .then(async ([t, r, v]) => {
      const g = await gradePendingCompetitorTipProjections();
      console.log(
        `[WNBA] Startup strict tracker ${t.processed} processed/${t.unresolved} unresolved; rebuild added ${r.gamesAdded}; evidence ${v.updated}/${v.checked}; competitor grading ${g.graded}.`,
      );
    })
    .catch((e) => console.warn("[WNBA] Startup strict maintenance failed:", e));
  console.log(
    "[WNBA] First Basket initialized: projections, locks, strict grading, possession-sequence weighting, competitor calibration research, and hourly strict history rebuild active.",
  );
}
