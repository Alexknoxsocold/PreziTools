import type { Express } from "express";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

export function registerWnbaTipResultRoutes(app: Express): void {
  app.get("/api/wnba/tip-result/:gameId", async (req, res) => {
    if (!pool) return res.status(503).json({ error: "WNBA evidence unavailable" });
    const gameId = String(req.params.gameId || "").trim();
    if (!/^\d+$/.test(gameId)) return res.status(400).json({ error: "Invalid game id" });
    try {
      const result = await pool.query(
        `SELECT tip_winner_team, tip_player_a, tip_player_b, confidence, verified_at
         FROM wnba_opening_evidence
         WHERE espn_game_id=$1 AND confidence='verified' AND tip_winner_team IS NOT NULL
         LIMIT 1`,
        [gameId],
      );
      res.setHeader("Cache-Control", "no-store, max-age=0");
      const row = result.rows[0];
      if (!row) return res.json({ gameId, verified: false, winnerTeam: null });
      return res.json({
        gameId,
        verified: true,
        winnerTeam: String(row.tip_winner_team || "").toUpperCase(),
        tipPlayerA: row.tip_player_a ? String(row.tip_player_a) : null,
        tipPlayerB: row.tip_player_b ? String(row.tip_player_b) : null,
        verifiedAt: row.verified_at || null,
      });
    } catch (error) {
      console.error("[WNBA Tip Result] lookup failed:", error);
      return res.status(500).json({ error: "Unable to load verified opening-tip result" });
    }
  });
}
