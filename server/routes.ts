import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { InjurySync } from "./injurySync";
import { LineupSync } from "./lineupSync";
import { createDailySyncService } from "./dailySync";
import { signup, login, logout, getSession, inviteAccess, requireAuth, requireAdmin } from "./auth";
import { seedFbHistoryFromBestOdds } from "./seedFbHistory";
import { runFirstBasketTracker } from "./autoTracker";
import cron from "node-cron";
import { freezeAndMergeNbaPlayers } from "./frozenDisplayAdapters";

const injurySync = new InjurySync(storage);
const lineupSync = new LineupSync(storage);
const dailySyncService = createDailySyncService(storage);

// Helper: get current date in Eastern Time as YYYY-MM-DD
// Keep the completed slate visible through the overnight postgame window.
function getActiveDateISO(): string {
  const now = new Date();
  const etHour = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false
  }).format(now));
  const targetDate = etHour < 4 ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(targetDate);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

// Helper: get the current calendar date in Eastern Time as YYYY-MM-DD (not advance-adjusted)
function getTodayETISO(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

// Helper: check if a game belongs to a given dateISO (YYYY-MM-DD, ET)
// gameDate is the authoritative NBA "game date" and always wins when it's a specific date.
// Only fall back to converting gameTime to ET if gameDate is missing.
function gameIsOnDate(gameTime: string | null | undefined, gameDate: string | null | undefined, dateISO: string): boolean {
  if (gameDate && gameDate !== 'Today') return gameDate === dateISO;
  if (gameDate === 'Today') return dateISO === getTodayETISO();
  if (gameTime) {
    const etDate = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(gameTime));
    const y = etDate.find(p => p.type === 'year')?.value;
    const m = etDate.find(p => p.type === 'month')?.value;
    const d = etDate.find(p => p.type === 'day')?.value;
    return `${y}-${m}-${d}` === dateISO;
  }
  return false;
}

// Helper: ensure games for a given date exist in storage, loading from ESPN if needed
async function ensureGamesForDate(dateISO: string): Promise<void> {
  const all = await storage.getGames();
  const existing = all.filter(g => gameIsOnDate(g.gameTime, g.gameDate, dateISO));
  if (existing.length > 0) return;

  try {
    const dateStr = dateISO.replace(/-/g, '');
    const resp = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) return;
    const data = await resp.json();
    const events: any[] = data?.events || [];
    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp?.competitors) continue;
      const home = comp.competitors.find((c: any) => c.homeAway === 'home');
      const away = comp.competitors.find((c: any) => c.homeAway === 'away');
      if (!home || !away) continue;
      const alreadyExists = all.find(g =>
        (g.espnGameId && g.espnGameId === event.id) ||
        (g.homeTeam === home.team.abbreviation && g.awayTeam === away.team.abbreviation &&
          gameIsOnDate(g.gameTime, g.gameDate, dateISO))
      );
      if (alreadyExists) continue;
      await storage.createGame({
        awayTeam: away.team.abbreviation, awayPlayer: 'TBD',
        awayTipCount: 0, awayTipPercent: 50, awayScorePercent: 50, awayStarters: [],
        homeTeam: home.team.abbreviation, homePlayer: 'TBD',
        homeTipCount: 0, homeTipPercent: 50, homeScorePercent: 50, homeStarters: [],
        h2h: 'N/A', gameDate: dateISO, gameTime: event.date,
        status: 'scheduled', espnGameId: event.id, lastSynced: new Date().toISOString()
      });
      console.log(`[AutoSync] Created game: ${away.team.abbreviation} @ ${home.team.abbreviation} for ${dateISO}`);
    }
  } catch (err) {
    console.warn('[AutoSync] Could not load games for date:', dateISO, err);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  seedFbHistoryFromBestOdds().catch(err => console.warn('[FBSeed] Startup seed failed:', err));
  injurySync.start();

  app.post("/api/auth/signup", signup);
  app.post("/api/auth/login", login);
  app.post("/api/auth/logout", logout);
  app.post("/api/auth/invite", inviteAccess);
  app.get("/api/auth/session", getSession);

  const adminVerifyAttempts = new Map<string, { count: number; resetAt: number }>();
  const ADMIN_RATE_LIMIT = 10;
  const ADMIN_RATE_WINDOW = 15 * 60 * 1000;

  app.post("/api/admin/verify", async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = adminVerifyAttempts.get(ip);
    if (entry && now < entry.resetAt) {
      if (entry.count >= ADMIN_RATE_LIMIT) return res.status(429).json({ error: "Too many attempts. Please try again later." });
      entry.count++;
    } else {
      adminVerifyAttempts.set(ip, { count: 1, resetAt: now + ADMIN_RATE_WINDOW });
    }
    try {
      const { password } = req.body;
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (!adminPassword) return res.status(500).json({ error: "Admin password not configured" });
      if (password !== adminPassword) return res.status(401).json({ error: "Incorrect password" });
      req.session.isAdminVerified = true;
      await new Promise<void>((resolve, reject) => req.session.save((err) => err ? reject(err) : resolve()));
      adminVerifyAttempts.delete(ip);
      return res.json({ success: true });
    } catch (err) {
      console.error('[Admin] Verify error:', err);
      return res.status(500).json({ error: "Failed to verify admin password" });
    }
  });

  app.get("/api/admin/session", (req, res) => res.json({ isAdmin: !!req.session?.isAdminVerified }));

  app.get("/api/games", async (_req, res) => {
    try {
      const games = await storage.getGames();
      const sortedGames = games.sort((a, b) => {
        if (a.gameTime && b.gameTime) return new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime();
        return 0;
      });
      res.json(sortedGames);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch games" });
    }
  });

  app.get("/api/games/:date", async (req, res) => {
    try {
      const games = await storage.getGamesByDate(req.params.date);
      res.json(games);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch games" });
    }
  });

  app.put("/api/games/:id/lineups", requireAdmin, async (req, res) => {
    try {
      const { awayStarters, homeStarters } = req.body;
      if (!awayStarters || !homeStarters) return res.status(400).json({ error: "Both awayStarters and homeStarters are required" });
      if (!Array.isArray(awayStarters) || !Array.isArray(homeStarters)) return res.status(400).json({ error: "Both awayStarters and homeStarters must be arrays" });
      if (awayStarters.length !== 5 || homeStarters.length !== 5) return res.status(400).json({ error: "Each team must have exactly 5 starters" });
      const allUntrimmed = [...awayStarters, ...homeStarters];
      if (allUntrimmed.some(name => typeof name !== 'string')) return res.status(400).json({ error: "All starter slots must contain string values" });
      const trimmedAway = awayStarters.map((name: string) => name.trim());
      const trimmedHome = homeStarters.map((name: string) => name.trim());
      const allStarters = [...trimmedAway, ...trimmedHome];
      if (allStarters.some(name => !name || name === '')) return res.status(400).json({ error: "All starter slots must have valid player names" });
      if (trimmedAway.length !== new Set(trimmedAway).size || trimmedHome.length !== new Set(trimmedHome).size) return res.status(400).json({ error: "Each player can only start once per team" });
      const updatedGame = await storage.updateGame(req.params.id, { awayStarters: trimmedAway, homeStarters: trimmedHome });
      if (!updatedGame) return res.status(404).json({ error: "Game not found" });
      res.json({ message: "Lineups updated successfully", game: updatedGame });
    } catch (error) {
      console.error('[API] Failed to update lineups:', error);
      res.status(500).json({ error: "Failed to update lineups" });
    }
  });

  app.get("/api/player-stats", async (req, res) => {
    try {
      const team = req.query.team as string | undefined;
      res.json(team ? await storage.getPlayerStatsByTeam(team) : await storage.getPlayerStats());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch player stats" });
    }
  });

  app.get("/api/player-stats/:id", async (req, res) => {
    try {
      const stat = await storage.getPlayerStatById(req.params.id);
      if (!stat) return res.status(404).json({ error: "Player stat not found" });
      res.json(stat);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch player stat" });
    }
  });

  app.get("/api/today-starters", async (_req, res) => {
    try { res.json(await storage.getTodayStarters()); }
    catch { res.status(500).json({ error: "Failed to fetch today's starters" }); }
  });

  let espnStatsCache: { data: any[]; timestamp: number; teams: string } | null = null;
  const ESPN_CACHE_TTL = 5 * 60 * 1000;

  app.get("/api/espn-player-stats", async (_req, res) => {
    try {
      const activeDateISO = getActiveDateISO();
      await ensureGamesForDate(activeDateISO);
      const games = await storage.getGames();
      const todayGames = games.filter(g => gameIsOnDate(g.gameTime, g.gameDate, activeDateISO));
      if (todayGames.length === 0) return res.json([]);
      const allTeams = [...new Set(todayGames.flatMap(g => [g.awayTeam, g.homeTeam]))].sort();
      const teamsKey = allTeams.join(',');
      if (espnStatsCache && espnStatsCache.teams === teamsKey && (Date.now() - espnStatsCache.timestamp) < ESPN_CACHE_TTL) {
        res.setHeader('Cache-Control','no-store, max-age=0');
        return res.json(await freezeAndMergeNbaPlayers(espnStatsCache.data,todayGames,activeDateISO));
      }
      const starterMap: Record<string, string[]> = {};
      for (const game of todayGames) {
        if (game.awayStarters?.length) starterMap[game.awayTeam] = game.awayStarters;
        if (game.homeStarters?.length) starterMap[game.homeTeam] = game.homeStarters;
      }
      const { fetchEspnTeamStats, fetchFirstBasketOdds, getTodayEspnEventIds } = await import('./espnPlayerStats.js');
      let firstBasketOddsMap: Record<string, string> = {};
      try {
        const eventIds = await getTodayEspnEventIds(activeDateISO);
        firstBasketOddsMap = await fetchFirstBasketOdds(eventIds);
      } catch (err) {
        console.warn('[ESPN Stats] Could not fetch live odds:', err);
      }
      const espnStats = await fetchEspnTeamStats(allTeams, starterMap, firstBasketOddsMap);
      espnStatsCache = { data: espnStats, timestamp: Date.now(), teams: teamsKey };
      res.setHeader('Cache-Control','no-store, max-age=0');
      res.json(await freezeAndMergeNbaPlayers(espnStats,todayGames,activeDateISO));
    } catch (error) {
      console.error('[ESPN Stats] Error:', error);
      res.status(500).json({ error: "Failed to fetch ESPN player stats" });
    }
  });

  // MLB NRFI data — predictions are also persisted as a pregame ledger so the
  // model can be graded later without replacing saved probabilities.
  app.get("/api/mlb/nrfi", async (req, res) => {
    try {
      const requestedDate = typeof req.query.date === "string" ? req.query.date : undefined;
      if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return res.status(400).json({ error: "date must use YYYY-MM-DD format" });
      const { fetchNrfiData } = await import("./mlbNrfi.js");
      const data = await fetchNrfiData(requestedDate);
      // Fire-and-forget: never make the public prediction request wait for DB logging.
      import("./mlbCalibration.js").then(({ recordPredictionSnapshot }) => {
        void recordPredictionSnapshot(data).catch(err => console.warn('[MLB Calibration] Ledger write failed:', err));
      });
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      res.json(data);
    } catch (error) {
      console.error("[MLB NRFI] Error:", error);
      res.status(502).json({ error: "Unable to load MLB NRFI data from ESPN" });
    }
  });

  app.get("/api/mlb/nrfi/upcoming", async (req, res) => {
    try {
      const requestedDays = typeof req.query.days === "string" ? Number(req.query.days) : 3;
      if (!Number.isFinite(requestedDays) || requestedDays < 1 || requestedDays > 3) return res.status(400).json({ error: "days must be a number from 1 to 3" });
      const { fetchUpcomingNrfiData } = await import("./mlbNrfi.js");
      const data = await fetchUpcomingNrfiData(requestedDays);
      import("./mlbCalibration.js").then(({ recordPredictionSnapshot }) => {
        void Promise.all(data.days.map(day => recordPredictionSnapshot(day))).catch(err => console.warn('[MLB Calibration] Upcoming ledger write failed:', err));
      });
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      res.json(data);
    } catch (error) {
      console.error("[MLB NRFI] Upcoming error:", error);
      res.status(502).json({ error: "Unable to load upcoming MLB NRFI data from ESPN" });
    }
  });

  // Public diagnostics: calibration is observational and does not claim profitability.
  app.get("/api/mlb/nrfi/calibration", async (req, res) => {
    try {
      const days = typeof req.query.days === "string" ? Number(req.query.days) : 30;
      if (!Number.isFinite(days) || days < 1 || days > 90) return res.status(400).json({ error: "days must be between 1 and 90" });
      const { getCalibrationSummary } = await import("./mlbCalibration.js");
      res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=900");
      res.json(await getCalibrationSummary(days));
    } catch (error) {
      console.error('[MLB Calibration] Summary error:', error);
      res.status(500).json({ error: "Unable to load calibration summary" });
    }
  });

  // Admin-only walk-forward backtest. Each historical date is predicted using
  // only information available before that date, then graded against the final result.
  app.post("/api/admin/mlb/nrfi/backtest", requireAdmin, async (req, res) => {
    try {
      const requestedDays = Number(req.body?.days ?? 7);
      if (!Number.isFinite(requestedDays) || requestedDays < 1 || requestedDays > 30) return res.status(400).json({ error: "days must be between 1 and 30" });
      const { fetchNrfiData } = await import("./mlbNrfi.js");
      const { backfillWalkForward, getCalibrationSummary } = await import("./mlbCalibration.js");
      const result = await backfillWalkForward(requestedDays, fetchNrfiData);
      const calibration = await getCalibrationSummary(Math.max(requestedDays, 30));
      res.json({ ...result, calibration });
    } catch (error) {
      console.error('[MLB Calibration] Backtest error:', error);
      res.status(502).json({ error: "Walk-forward backtest failed" });
    }
  });

  app.get("/api/fb-tracking", async (_req, res) => {
    try { res.json(await storage.getAllFbTracking()); }
    catch { res.status(500).json({ error: "Failed to fetch FB tracking data" }); }
  });

  app.post("/api/admin/fb-tracking", requireAdmin, async (req, res) => {
    try {
      const { playerName, team, fbScored, gamesTracked } = req.body;
      if (!playerName || !team || typeof fbScored !== 'number') return res.status(400).json({ error: "playerName, team, and fbScored (number) are required" });
      const gamesArg = typeof gamesTracked === 'number' ? Math.max(1, Math.round(gamesTracked)) : undefined;
      const record = await storage.upsertFbTracking(playerName.trim(), team.trim().toUpperCase(), Math.max(0, Math.round(fbScored)), "2025/26", gamesArg);
      espnStatsCache = null;
      res.json(record);
    } catch (error) {
      console.error('[FBTracker] Upsert error:', error);
      res.status(500).json({ error: "Failed to update FB tracking" });
    }
  });

  app.get("/api/admin/fb-tracking/processed-games", requireAdmin, async (_req, res) => {
    try { res.json(await storage.getProcessedGames()); }
    catch { res.status(500).json({ error: "Failed to fetch processed games" }); }
  });

  app.post("/api/admin/run-auto-tracker", requireAdmin, async (_req, res) => {
    try {
      const result = await runFirstBasketTracker();
      espnStatsCache = null;
      res.json({ message: `Auto-tracker complete: ${result.processed} new game(s) processed, ${result.skipped} already done`, ...result });
    } catch (error: any) {
      console.error("[API] Auto-tracker error:", error);
      res.status(500).json({ error: "Auto-tracker failed", detail: error?.message });
    }
  });

  app.get("/api/team-stats", async (_req, res) => {
    try { res.json(await storage.getTeamStats()); }
    catch { res.status(500).json({ error: "Failed to fetch team stats" }); }
  });

  app.get("/api/team-stats/:team", async (req, res) => {
    try {
      const stat = await storage.getTeamStatByTeam(req.params.team);
      if (!stat) return res.status(404).json({ error: "Team stat not found" });
      res.json(stat);
    } catch { res.status(500).json({ error: "Failed to fetch team stat" }); }
  });

  app.post("/api/sync-injuries", async (_req, res) => {
    try { await injurySync.syncInjuries(); res.json({ message: "Injury sync completed successfully" }); }
    catch { res.status(500).json({ error: "Failed to sync injuries" }); }
  });

  app.post("/api/sync-espn-lineups", async (_req, res) => {
    try {
      const games = await storage.getGames();
      const todayGames = games.filter(g => g.gameDate === 'Today');
      if (todayGames.length === 0) return res.json({ message: "No games today", updated: 0 });
      const { syncEspnLineups } = await import('./syncEspnLineups.js');
      const allTeams = new Set<string>();
      todayGames.forEach(g => { allTeams.add(g.awayTeam); allTeams.add(g.homeTeam); });
      const lineups = await syncEspnLineups([...allTeams]);
      const lineupMap: Record<string, string[]> = {};
      lineups.forEach(l => { lineupMap[l.team] = l.starters; });
      let updated = 0;
      for (const game of todayGames) {
        await storage.updateGame(game.id, { awayStarters: lineupMap[game.awayTeam] || game.awayStarters, homeStarters: lineupMap[game.homeTeam] || game.homeStarters });
        updated++;
      }
      const { populateTodayStarters } = await import('./populate-player-stats.js');
      await populateTodayStarters(storage);
      espnStatsCache = null;
      res.json({ message: `Updated lineups for ${updated} games`, updated, lineupMap });
    } catch (error) {
      console.error('[API] ESPN lineup sync failed:', error);
      res.status(500).json({ error: "Failed to sync ESPN lineups" });
    }
  });

  app.post("/api/sync-lineups", async (_req, res) => {
    try { await lineupSync.syncStartingLineups(); res.json({ message: "Lineup sync completed successfully" }); }
    catch (error) { console.error('[API] Lineup sync failed:', error); res.status(500).json({ error: "Failed to sync lineups" }); }
  });

  app.post("/api/sync/daily", async (_req, res) => {
    try { await dailySyncService.runDailySync(); res.json({ message: "Daily sync completed successfully" }); }
    catch (error) { console.error('[API] Daily sync failed:', error); res.status(500).json({ error: "Failed to run daily sync" }); }
  });

  app.post("/api/populate-player-stats", async (_req, res) => {
    try {
      const { populateTodayStarters } = await import('./populate-player-stats.js');
      await populateTodayStarters(storage);
      res.json({ message: "Player stats populated successfully" });
    } catch (error) {
      console.error('[API] Player stats population failed:', error);
      res.status(500).json({ error: "Failed to populate player stats" });
    }
  });

  cron.schedule('30 0 * * *', async () => {
    try { await dailySyncService.runDailySync(); console.log('[Cron] ✓ Daily sync completed successfully'); }
    catch (error) { console.error('[Cron] Daily sync failed:', error); }
  }, { timezone: 'America/New_York' });

  cron.schedule('*/30 9-23 * * *', async () => {
    try { await lineupSync.syncStartingLineups(); console.log('[Cron] ✓ Lineup sync completed successfully'); }
    catch (error) { console.error('[Cron] Lineup sync failed:', error); }
  }, { timezone: 'America/New_York' });

  cron.schedule('*/30 18-23 * * *', async () => {
    try {
      const result = await runFirstBasketTracker();
      if (result.processed > 0) { espnStatsCache = null; console.log(`[Cron] ✓ Auto-tracker: ${result.processed} game(s) processed`); }
    } catch (error) { console.error('[Cron] Auto-tracker failed:', error); }
  }, { timezone: 'America/New_York' });

  cron.schedule('*/30 0-2 * * *', async () => {
    try {
      const result = await runFirstBasketTracker();
      if (result.processed > 0) { espnStatsCache = null; console.log(`[Cron] ✓ Auto-tracker: ${result.processed} game(s) processed`); }
    } catch (error) { console.error('[Cron] Auto-tracker failed:', error); }
  }, { timezone: 'America/New_York' });

  // Backfill a small rolling window nightly. This builds the calibration ledger
  // over the season without adding work to normal prediction requests.
  cron.schedule('15 3 * * *', async () => {
    try {
      const { fetchNrfiData } = await import('./mlbNrfi.js');
      const { backfillWalkForward } = await import('./mlbCalibration.js');
      const result = await backfillWalkForward(3, fetchNrfiData);
      console.log(`[Cron] MLB calibration backfill: ${result.gamesGraded} graded games, ${result.predictionsWritten} ledger rows`);
    } catch (error) {
      console.error('[Cron] MLB calibration backfill failed:', error);
    }
  }, { timezone: 'America/New_York' });

  console.log('[Cron] Daily sync scheduled for 12:30 AM ET every day');
  console.log('[Cron] Lineup sync scheduled every 30 minutes (9 AM - 11 PM ET)');
  console.log('[Cron] First-basket auto-tracker scheduled every 30 min (6 PM – 2 AM ET)');
  console.log('[Cron] MLB calibration backfill scheduled nightly at 3:15 AM ET');

  return createServer(app);
}
