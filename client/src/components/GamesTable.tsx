import GameRow from "./GameRow";
import NbaArenaBackdrop from "./NbaArenaBackdrop";
import type { Game } from "@shared/schema";

interface EspnPick {
  player: string;
  team: string;
  headshot?: string;
  firstBasketPct: number;
  avgPoints: number;
  odds: string;
  isStarter?: boolean;
}

interface JumpBallPlayer {
  player: string;
  headshot?: string;
  position: string;
}

interface VerifiedFirstBasketResult {
  espnGameId: string;
  playerName: string;
  team: string;
  verifiedAt: string;
}

interface GamesTableProps {
  games: Game[];
  headshotMap?: Record<string, string>;
  espnAwayPicks?: Record<string, EspnPick | null>;
  espnHomePicks?: Record<string, EspnPick | null>;
  espnAwayJumpBall?: Record<string, JumpBallPlayer | null>;
  espnHomeJumpBall?: Record<string, JumpBallPlayer | null>;
  verifiedFirstBaskets?: Record<string, VerifiedFirstBasketResult>;
}

export default function GamesTable({
  games,
  headshotMap = {},
  espnAwayPicks = {},
  espnHomePicks = {},
  espnAwayJumpBall = {},
  espnHomeJumpBall = {},
  verifiedFirstBaskets = {},
}: GamesTableProps) {
  if (games.length === 0) {
    return (
      <div
        className="border rounded-md bg-card flex items-center justify-center h-40 text-muted-foreground text-sm"
        data-testid="container-games-table"
      >
        No games scheduled for today.
      </div>
    );
  }

  return (
    <div className="border rounded-md bg-card overflow-hidden" data-testid="container-games-table">
      {games.map((game) => {
        const awayEspn = espnAwayPicks[game.id] ?? null;
        const homeEspn = espnHomePicks[game.id] ?? null;
        const verifiedFirstBasket = game.espnGameId ? verifiedFirstBaskets[game.espnGameId] ?? null : null;
        const normalizedScorer = verifiedFirstBasket?.playerName.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
        const verifiedHeadshot = verifiedFirstBasket
          ? Object.entries(headshotMap).find(([name]) => name.toLowerCase().replace(/[^a-z0-9]/g, "") === normalizedScorer)?.[1]
          : undefined;

        return (
          <div key={game.id} className={`relative isolate overflow-hidden ${verifiedFirstBasket ? "nba-first-basket-verified" : ""}`}>
            <NbaArenaBackdrop team={game.homeTeam} />
            <div className="relative z-10">
              <GameRow
                awayTeam={game.awayTeam}
                awayPlayer={game.awayPlayer}
                awayTipCount={game.awayTipCount}
                awayTipPercent={game.awayTipPercent}
                awayScorePercent={game.awayScorePercent}
                awayStarters={game.awayStarters ?? undefined}
                homeTeam={game.homeTeam}
                homePlayer={game.homePlayer}
                homeTipCount={game.homeTipCount}
                homeTipPercent={game.homeTipPercent}
                homeScorePercent={game.homeScorePercent}
                homeStarters={game.homeStarters ?? undefined}
                h2h={game.h2h}
                gameTime={game.gameTime ?? undefined}
                status={game.status}
                awayPlayerHeadshot={awayEspn?.headshot ?? headshotMap[game.awayPlayer]}
                homePlayerHeadshot={homeEspn?.headshot ?? headshotMap[game.homePlayer]}
                awayEspnPick={awayEspn}
                homeEspnPick={homeEspn}
                awayJumpBall={espnAwayJumpBall[game.id] ?? null}
                homeJumpBall={espnHomeJumpBall[game.id] ?? null}
                verifiedFirstBasket={verifiedFirstBasket}
                verifiedFirstBasketHeadshot={verifiedHeadshot}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
