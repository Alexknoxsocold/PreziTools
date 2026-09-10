import { fetchNrfiDataV4Live } from "./mlbNrfiLiveV4.js";
import { persistAndGradeNrfiGames } from "./mlbPredictionGrader.js";
import { fetchMlbRfiMarkets } from "./mlbOdds.js";
import { getPredictionHistory } from "./mlbPredictionSnapshots.js";
import { getMlbPassedDiagnostics } from "./mlbPassedDiagnostics.js";
import { getMlbAdaptiveDecisionPolicy } from "./mlbAdaptiveDecision.js";
import { recoverVerifiablePregameDraftLocks } from "./mlbLedgerRecovery.js";

const inflight = new Map<string, Promise<{ date: string; games: number }>>();
const DEFAULT_AUTO_GRADE_INTERVAL_MS = 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;
let lastRunAt: string | null = null;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;
let lastResult: { date: string; games: number } | null = null;

function requestKey(date?: string): string {
  return date ?? "today";
}

function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayEt(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}-${parts.find(p => p.type === "day")?.value}`;
}

async function logProductionLearningAudit(): Promise<void> {
  try {
    const [history, passed, policy] = await Promise.all([
      getPredictionHistory(30),
      getMlbPassedDiagnostics(30),
      getMlbAdaptiveDecisionPolicy(90),
    ]);
    const locked = history.filter(row => row.lockedAt);
    const graded = locked.filter(row => row.outcome);
    const wins = graded.filter(row => row.recommendation === row.outcome).length;
    const losses = graded.filter(row => row.recommendation !== row.outcome).length;
    const nrfi = policy.evidence.find(item => item.side === "NRFI");
    const yrfi = policy.evidence.find(item => item.side === "YRFI");
    console.log(
      `[MLB Audit] 30d ledger snapshots=${history.length} locked=${locked.length} graded=${graded.length} wins=${wins} losses=${losses}; ` +
      `passed50-53=${passed.borderlinePassed.correct}/${passed.borderlinePassed.sampleSize}; passed53-56=${passed.subPlayLeans.correct}/${passed.subPlayLeans.sampleSize}; ` +
      `adaptiveNRFI=${nrfi?.correct ?? 0}/${nrfi?.sampleSize ?? 0}${nrfi?.activated ? " active" : ""}; ` +
      `adaptiveYRFI=${yrfi?.correct ?? 0}/${yrfi?.sampleSize ?? 0}${yrfi?.activated ? " active" : ""}.`
    );
  } catch (error) {
    console.warn("[MLB Audit] Production learning audit unavailable:", error);
  }
}

/**
 * Fetches the same V4-live response served to users and persists immutable
 * predictions plus authoritative first-inning results. Keeping the public
 * route and grader on the same model version prevents provenance drift.
 */
export async function refreshAndGradeMlbPredictions(date?: string): Promise<void> {
  await runMlbAutoGrade(date);
}

export function getMlbAutoGradeStatus() {
  return {
    running: inflight.size > 0,
    inFlightKeys: [...inflight.keys()],
    lastRunAt,
    lastSuccessAt,
    lastError,
    lastResult,
    intervalMs: DEFAULT_AUTO_GRADE_INTERVAL_MS,
  };
}

export function runMlbAutoGrade(date?: string): Promise<{ date: string; games: number }> {
  const key = requestKey(date);
  const existing = inflight.get(key);
  if (existing) return existing;

  const request = (async () => {
    lastRunAt = new Date().toISOString();
    try {
      const response = await fetchNrfiDataV4Live(date);
      try {
        await fetchMlbRfiMarkets();
      } catch (error) {
        console.warn("[MLB AutoGrade] Verified market warm failed; continuing model-only:", error);
      }
      await persistAndGradeNrfiGames(response.games, "v4-live");
      const result = { date: response.date, games: response.games.length };
      lastSuccessAt = new Date().toISOString();
      lastError = null;
      lastResult = result;
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  })();

  inflight.set(key, request);
  return request.finally(() => {
    if (inflight.get(key) === request) inflight.delete(key);
  });
}

/**
 * Reconcile recent scoreboards against predictions that were already captured
 * before first pitch. This never retroactively creates a verified pregame lock:
 * games without a real lock remain excluded from the verified historical record.
 */
export async function reconcileRecentMlbResults(daysBack = 2): Promise<Array<{ date: string; games: number }>> {
  const safeDays = Math.min(Math.max(Math.round(daysBack), 0), 7);
  const today = todayEt();
  const dates = Array.from({ length: safeDays + 1 }, (_, index) => addDays(today, index - safeDays));
  const results: Array<{ date: string; games: number }>[] = [] as Array<Array<{ date: string; games: number }>>;
  const flatResults: Array<{ date: string; games: number }> = [];
  for (const date of dates) {
    try {
      flatResults.push(await runMlbAutoGrade(date));
    } catch (error) {
      console.error(`[MLB AutoGrade] Reconciliation failed for ${date}:`, error);
    }
  }
  void results;
  return flatResults;
}

/**
 * Production scheduler. Runs once per minute so a settled first inning is
 * reflected quickly, while the date-scoped single-flight guard prevents overlap.
 */
export function startMlbAutoGradeScheduler(intervalMs = DEFAULT_AUTO_GRADE_INTERVAL_MS): () => void {
  if (timer) return () => stopMlbAutoGradeScheduler();

  const run = () => {
    void runMlbAutoGrade()
      .then(result => console.log(`[MLB AutoGrade] ${result.games} V4-live games checked for ${result.date}.`))
      .catch(error => console.error("[MLB AutoGrade] Scheduled run failed:", error));
  };

  timer = setInterval(run, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  void (async () => {
    try {
      const recovery = await recoverVerifiablePregameDraftLocks(30);
      console.log(`[MLB AutoGrade] Recovered ${recovery.recovered} verifiable pregame draft lock(s) from ${recovery.checkedDays} day(s).`);
      const results = await reconcileRecentMlbResults(2);
      console.log(`[MLB AutoGrade] Startup reconciliation checked ${results.length} day(s).`);
      await logProductionLearningAudit();
    } catch (error) {
      console.error("[MLB AutoGrade] Startup recovery/reconciliation failed:", error);
    }
  })();

  run();
  console.log(`[MLB AutoGrade] V4-live scheduler started (${Math.round(intervalMs / 1000)}s interval).`);
  return () => stopMlbAutoGradeScheduler();
}

export function stopMlbAutoGradeScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  console.log("[MLB AutoGrade] Scheduler stopped.");
}
