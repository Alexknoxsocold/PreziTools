import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import GamesTable from "@/components/GamesTable";
import StatsCard from "@/components/StatsCard";
import { Target, TrendingUp, Zap, Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Game } from "@shared/schema";

interface EspnPlayerStat {
  player: string;
  team: string;
  espnId: string;
  headshot?: string;
  firstBasketPct: number;
  avgPoints: number;
  odds: string;
  liveOdds?: string;
  isStarter?: boolean;
  position?: string;
}

interface JumpBallPlayer {
  player: string;
  headshot?: string;
  position: string;
}

interface GamePickSummary {
  game: Game;
  topPlayer: EspnPlayerStat | null;
  awayTop: EspnPlayerStat | null;
  homeTop: EspnPlayerStat | null;
  awayJumpBall: JumpBallPlayer | null;
  homeJumpBall: JumpBallPlayer | null;
}

interface VerifiedFirstBasketResult {
  espnGameId: string;
  playerName: string;
  team: string;
  verifiedAt: string;
}

interface VerifiedFirstBasketPayload {
  updatedAt: string;
  results: VerifiedFirstBasketResult[];
}

const EMPTY_STATS = {
  avgFbPct: "0.0",
  highestFbPct: 0,
  highestFbMatchup: "",
  topPlayer: "",
  topJumpBallPct: 0,
  topJumpBallPlayer: "",
  topJumpBallTeam: "",
  topTeam: "",
  topTeamPct: 0,
};

const ET_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function getActiveDateISO(): string {
  const now = new Date();
  const etHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  const target = etHour < 4 ? new Date(now.getTime() - 86_400_000) : now;
  const parts = ET_DATE_FORMATTER.formatToParts(target);
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

function getGameDateInET(gameTime: string): string | null {
  const date = new Date(gameTime);
  if (Number.isNaN(date.getTime())) return null;
  const parts = ET_DATE_FORMATTER.formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

function findJumpBall(players: EspnPlayerStat[]): JumpBallPlayer | null {
  if (players.length === 0) return null;

  // Prefer announced starters. If ESPN has not marked starters yet, use the
  // available roster data so the card can still populate during pregame.
  const starters = players.filter((p) => p.isStarter);
  const pool = starters.length > 0 ? starters : players;

  let best: EspnPlayerStat | undefined;
  for (const player of pool) {
    if (player.position !== "C" && player.position !== "F") continue;
    if (!best) {
      best = player;
      continue;
    }
    // Centers win over forwards; within a position use FB% as the tiebreaker.
    const playerRank = player.position === "C" ? 2 : 1;
    const bestRank = best.position === "C" ? 2 : 1;
    if (
      playerRank > bestRank ||
      (playerRank === bestRank && player.firstBasketPct > best.firstBasketPct)
    ) {
      best = player;
    }
  }

  return best
    ? {
        player: best.player,
        headshot: best.headshot,
        position: best.position ?? "F",
      }
    : null;
}

export default function AllGames() {
  const { data: allGames, isLoading: gamesLoading } = useQuery<Game[]>({
    queryKey: ["/api/games"],
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const { data: espnStats } = useQuery<EspnPlayerStat[]>({
    queryKey: ["/api/espn-player-stats"],
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const { data: verifiedFirstBaskets } = useQuery<VerifiedFirstBasketPayload>({
    queryKey: ["/api/nba/first-basket-results"],
    staleTime: 5000,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const games = useMemo(() => {
    if (!allGames?.length) return [];

    const activeDateISO = getActiveDateISO();
    const etHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
    );

    return allGames.filter((game) => {
      if (game.gameDate && game.gameDate !== "Today") {
        return game.gameDate === activeDateISO;
      }
      if (game.gameDate === "Today" && etHour >= 4) return true;
      return game.gameTime ? getGameDateInET(game.gameTime) === activeDateISO : false;
    });
  }, [allGames]);

  // Index ESPN players once. The previous implementation filtered the full
  // stats array once per game, which gets unnecessarily expensive as the NBA
  // slate and player dataset grow.
  const playersByTeam = useMemo(() => {
    const map = new Map<string, EspnPlayerStat[]>();
    for (const player of espnStats ?? []) {
      const list = map.get(player.team);
      if (list) list.push(player);
      else map.set(player.team, [player]);
    }
    return map;
  }, [espnStats]);

  const headshotMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const stat of espnStats ?? []) {
      if (stat.headshot) map[stat.player] = stat.headshot;
    }
    return map;
  }, [espnStats]);

  const gamePicks = useMemo<GamePickSummary[]>(() => {
    if (!games.length || !espnStats?.length) {
      return games.map((game) => ({
        game,
        topPlayer: null,
        awayTop: null,
        homeTop: null,
        awayJumpBall: null,
        homeJumpBall: null,
      }));
    }

    return games.map((game) => {
      const awayPlayers = playersByTeam.get(game.awayTeam) ?? [];
      const homePlayers = playersByTeam.get(game.homeTeam) ?? [];

      let awayTop: EspnPlayerStat | null = null;
      let homeTop: EspnPlayerStat | null = null;
      for (const player of awayPlayers) {
        if (!awayTop || player.firstBasketPct > awayTop.firstBasketPct) awayTop = player;
      }
      for (const player of homePlayers) {
        if (!homeTop || player.firstBasketPct > homeTop.firstBasketPct) homeTop = player;
      }

      const topPlayer = !awayTop
        ? homeTop
        : !homeTop
          ? awayTop
          : awayTop.firstBasketPct >= homeTop.firstBasketPct
            ? awayTop
            : homeTop;

      return {
        game,
        topPlayer,
        awayTop,
        homeTop,
        awayJumpBall: findJumpBall(awayPlayers),
        homeJumpBall: findJumpBall(homePlayers),
      };
    });
  }, [games, espnStats, playersByTeam]);

  const stats = useMemo(() => {
    if (!games.length || !espnStats?.length) return EMPTY_STATS;

    let pctTotal = 0;
    for (const stat of espnStats) pctTotal += stat.firstBasketPct;

    let highestFbPct = 0;
    let highestFbMatchup = "";
    let topPlayer = "";
    let topTeam = "";
    let topTeamPct = 0;
    let topJumpBallPct = 0;
    let topJumpBallPlayer = "";
    let topJumpBallTeam = "";

    const statByPlayer = new Map(espnStats.map((stat) => [stat.player, stat]));

    for (const pick of gamePicks) {
      if (pick.topPlayer && pick.topPlayer.firstBasketPct > highestFbPct) {
        highestFbPct = pick.topPlayer.firstBasketPct;
        highestFbMatchup = `${pick.game.awayTeam} @ ${pick.game.homeTeam}`;
        topPlayer = pick.topPlayer.player;
      }

      for (const teamPick of [pick.awayTop, pick.homeTop]) {
        if (teamPick && teamPick.firstBasketPct > topTeamPct) {
          topTeamPct = teamPick.firstBasketPct;
          topTeam = teamPick.team;
        }
      }

      for (const jumpBall of [pick.awayJumpBall, pick.homeJumpBall]) {
        if (!jumpBall) continue;
        const stat = statByPlayer.get(jumpBall.player);
        if (stat && stat.firstBasketPct > topJumpBallPct) {
          topJumpBallPct = stat.firstBasketPct;
          topJumpBallPlayer = jumpBall.player;
          topJumpBallTeam = stat.team;
        }
      }
    }

    return {
      avgFbPct: (pctTotal / espnStats.length).toFixed(1),
      highestFbPct,
      highestFbMatchup,
      topPlayer,
      topJumpBallPct,
      topJumpBallPlayer,
      topJumpBallTeam,
      topTeam,
      topTeamPct,
    };
  }, [games, espnStats, gamePicks]);

  const awayPicks = useMemo(
    () => Object.fromEntries(gamePicks.map((pick) => [pick.game.id, pick.awayTop])),
    [gamePicks],
  );
  const homePicks = useMemo(
    () => Object.fromEntries(gamePicks.map((pick) => [pick.game.id, pick.homeTop])),
    [gamePicks],
  );
  const awayJumpBalls = useMemo(
    () => Object.fromEntries(gamePicks.map((pick) => [pick.game.id, pick.awayJumpBall])),
    [gamePicks],
  );
  const homeJumpBalls = useMemo(
    () => Object.fromEntries(gamePicks.map((pick) => [pick.game.id, pick.homeJumpBall])),
    [gamePicks],
  );
  const verifiedResultsByGame = useMemo(
    () => Object.fromEntries((verifiedFirstBaskets?.results ?? []).map((result) => [result.espnGameId, result])),
    [verifiedFirstBaskets],
  );

  if (gamesLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-44" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <StatsCard
          title="Today's Games"
          value={games.length}
          subtitle="NBA games scheduled"
          icon={Target}
        />
        <StatsCard
          title="Avg Scoring %"
          value={`${stats.avgFbPct}%`}
          subtitle={`Across ${espnStats?.length ?? 0} players today`}
          icon={TrendingUp}
        />
        <StatsCard
          title="Top Jump Ball"
          value={stats.topJumpBallPct > 0 ? `${Math.round(stats.topJumpBallPct)}%` : "Loading..."}
          subtitle={stats.topJumpBallPlayer ? `${stats.topJumpBallPlayer} — ${stats.topJumpBallTeam}` : "Fetching ESPN data..."}
          icon={Zap}
        />
        <StatsCard
          title="Top Team Today"
          value={stats.topTeam || "—"}
          subtitle={stats.topTeamPct > 0 ? `${Math.round(stats.topTeamPct)}% scoring probability` : "Fetching ESPN data..."}
          icon={Trophy}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">All Games — Opening Tips</h2>
          <span className="text-xs text-muted-foreground font-mono">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
        <GamesTable
          games={games}
          headshotMap={headshotMap}
          espnAwayPicks={awayPicks}
          espnHomePicks={homePicks}
          espnAwayJumpBall={awayJumpBalls}
          espnHomeJumpBall={homeJumpBalls}
          verifiedFirstBaskets={verifiedResultsByGame}
        />
      </div>
    </div>
  );
}
