import { snapshotPrediction } from "./mlbPredictionSnapshots.js";
import { getCachedMlbRfiQuotes, valueFromCachedQuotesForTeams } from "./mlbOdds.js";
import { recordMlbDecisionContext } from "./mlbDecisionContext.js";
import { gradeExistingLockedPrediction } from "./mlbLedgerGrade.js";

export type GraderGame = {
  id: string;
  date: string;
  gameStartAt?: string | null;
  shortName: string;
  away: { abbreviation: string; name?: string; pitcher?: unknown };
  home: { abbreviation: string; name?: string; pitcher?: unknown };
  recommendation: "NRFI" | "YRFI";
  nrfiProbability: number;
  confidence: "High" | "Medium" | "Low";
  playStatus: "BEST_PLAY" | "PLAY" | "LEAN" | "NO_PLAY";
  sampleSize?: number;
  factors?: string[];
  v4Shadow?: unknown;
  status?: string | null;
  outcome: "won" | "lost" | "pending";
  firstInningScore: string | null;
};

const OFFICIAL_LOCK_WINDOW_MS = 2 * 60 * 60 * 1000;

function parseFirstInningScore(value: string | null): { away: number; home: number; normalized: string } | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;
  const away = Number(match[1]);
  const home = Number(match[2]);
  if (!Number.isSafeInteger(away) || !Number.isSafeInteger(home) || away < 0 || home < 0) return null;
  return { away, home, normalized: `${away}-${home}` };
}

/** Grade a locked NRFI/YRFI prediction as soon as ESPN has a settled first-inning result. */
export async function persistAndGradeNrfiGames(games: GraderGame[], modelVersion = "v4-live"): Promise<void> {
  const quotes = getCachedMlbRfiQuotes();
  for (const game of games) {
    const parsedScore = parseFirstInningScore(game.firstInningScore);
    const actualOutcome = parsedScore ? (parsedScore.away === 0 && parsedScore.home === 0 ? "NRFI" : "YRFI") : null;
    const rawProbability = game.recommendation === "NRFI" ? game.nrfiProbability : 100 - game.nrfiProbability;
    const modelProbability = Number.isFinite(rawProbability) ? Math.min(1, Math.max(0, rawProbability / 100)) : 0.5;
    const away = game.away?.name ?? game.away?.abbreviation ?? "";
    const home = game.home?.name ?? game.home?.abbreviation ?? "";
    const gameStartAt = game.gameStartAt ?? game.date;
    const predictionDate = game.date.slice(0, 10);
    const start = new Date(gameStartAt);
    const now = Date.now();
    const startMs = start.getTime();

    // The base MLB feed only changes outcome away from "pending" once both
    // first-inning line scores are available and the game is no longer pregame.
    // At that point the NRFI/YRFI market is permanently settled, so there is no
    // reason to wait for the ninth inning/full-game final status.
    if (actualOutcome && parsedScore && game.outcome !== "pending") {
      await gradeExistingLockedPrediction({
        date: predictionDate,
        gameId: game.id,
        modelVersion,
        outcome: actualOutcome,
        firstInningScore: parsedScore.normalized,
      });
      continue;
    }

    if (!Number.isFinite(startMs)) continue;
    const timeUntilStart = startMs - now;

    // Official public tracking locks two hours before first pitch. Before this
    // window the displayed forecast remains live and may improve as starters,
    // lineups, environment and market data settle. After first pitch, a missing
    // lock stays missing rather than being fabricated retrospectively.
    if (timeUntilStart <= 0 || timeUntilStart > OFFICIAL_LOCK_WINDOW_MS) continue;

    const marketValue = quotes.length ? valueFromCachedQuotesForTeams(away, home, game.recommendation, modelProbability) : null;
    const lockedAt = new Date();

    await recordMlbDecisionContext({
      date: predictionDate,
      gameId: game.id,
      modelVersion,
      gameStartAt,
      recommendation: game.recommendation,
      nrfiProbability: game.nrfiProbability,
      playStatus: game.playStatus,
      confidence: game.confidence,
      sampleSize: game.sampleSize ?? 0,
      factors: game.factors ?? [],
      awayPitcher: game.away?.pitcher ?? null,
      homePitcher: game.home?.pitcher ?? null,
      v4: game.v4Shadow ?? null,
    }).catch(error => console.warn("[MLB Context] Decision context capture failed:", error));

    await snapshotPrediction({
      date: predictionDate,
      gameId: game.id,
      matchup: game.shortName,
      recommendation: game.recommendation,
      probability: modelProbability,
      confidence: game.confidence,
      modelVersion,
      gameStartAt,
      lockedAt,
      outcome: null,
      firstInningScore: null,
      marketValue: marketValue ? {
        available: marketValue.available,
        side: marketValue.selection,
        sportsbook: marketValue.book,
        market: "NRFI/YRFI",
        americanOdds: marketValue.price,
        capturedAt: marketValue.updatedAt,
        ageSeconds: marketValue.ageSeconds ?? null,
        impliedProbability: marketValue.impliedProbability,
        noVigProbability: marketValue.noVigProbability,
        modelProbability,
        edge: marketValue.edge,
        expectedValue: marketValue.ev,
        valuePlay: (marketValue.edge ?? -1) >= 0.02 && (marketValue.ev ?? -1) > 0,
        reason: "Verified market snapshot at official two-hour prediction lock",
      } : null,
    });
  }
}
