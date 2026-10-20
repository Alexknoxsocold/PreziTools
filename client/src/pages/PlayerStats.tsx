import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, RefreshCw, TrendingUp,
  AlertCircle, AlertTriangle, Activity, Shield,
  Star, Zap, ArrowLeftRight, Clock, ChevronDown, ChevronUp
} from "lucide-react";

import type { Game } from "@shared/schema";
import { getTeamLogoUrl } from "@/components/GameRow";
import fdLogoImg from "@assets/Daniel+Frumhoff_FanDuel+9_1775294382033.jpg";

function TeamLogo({ team, size = "sm" }: { team: string; size?: "sm" | "md" }) {
  const logoUrl = getTeamLogoUrl(team);
  const sizeClass = size === "md" ? "w-8 h-8" : "w-6 h-6";
  return (
    <div className={`${sizeClass} rounded-md bg-muted/40 overflow-hidden flex items-center justify-center shrink-0`}>
      {logoUrl ? (
        <img src={logoUrl} alt={`${team} logo`} className="w-full h-full object-contain p-0.5"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      ) : (
        <span className="text-[9px] font-bold text-muted-foreground">{team.slice(0, 3)}</span>
      )}
    </div>
  );
}

function FdLogo({ className = "w-5 h-5", dimmed = false }: { className?: string; dimmed?: boolean }) {
  return (
    <img
      src={fdLogoImg}
      alt="FanDuel"
      className={`${className} rounded object-contain`}
      style={{ opacity: dimmed ? 0.4 : 1 }}
    />
  );
}

interface EspnPlayerStat {
  player: string;
  team: string;
  espnId: string;
  position: string;
  gamesPlayed: number;
  avgPoints: number;
  avgFGA: number;
  fgPct: number;
  avgMinutes: number;
  avgAssists: number;
  avgRebounds: number;
  firstBasketPct: number;
  firstBasketsScored?: number;
  currentSeasonFirstBaskets?: number;
  currentSeasonGamesTracked?: number;
  previousSeasonFirstBaskets?: number;
  previousSeasonGamesTracked?: number;
  q1FgaRate: number;
  odds: string;
  liveOdds?: string;
  liveOddsSource?: string;
  liveOddsSportsbook?: string;
  liveOddsFrozen?: boolean;
  liveOddsCapturedAt?: string;
  headshot?: string;
  injuryStatus?: string;
  isStarter?: boolean;
}

type MarketValueMetrics = {
  impliedPct: number;
  edgePoints: number;
  expectedValue: number;
  qualifies: boolean;
};

function liveOddsSourceLabel(stat: EspnPlayerStat): string {
  if (stat.liveOddsFrozen) return stat.liveOddsSportsbook ? `${stat.liveOddsSportsbook} · frozen pregame` : "Frozen pregame odds";
  if (stat.liveOddsSportsbook) return stat.liveOddsSportsbook;
  if (stat.liveOddsSource === "espn-core") return "ESPN market feed";
  return "Live market";
}

function parseAmericanOdds(odds?: string): number | null {
  const match = odds?.trim().match(/^([+-]?\d+)/);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) && num !== 0 ? num : null;
}

function marketValueMetrics(stat: EspnPlayerStat): MarketValueMetrics | null {
  // Real VALUE requires a live market price. Never fall back to model-estimated odds.
  const americanOdds = parseAmericanOdds(stat.liveOdds);
  if (americanOdds === null) return null;

  const impliedPct = americanOdds > 0
    ? (100 / (americanOdds + 100)) * 100
    : (Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)) * 100;
  const edgePoints = stat.firstBasketPct - impliedPct;
  const p = Math.max(0, Math.min(1, stat.firstBasketPct / 100));
  const profitPerDollar = americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
  const expectedValue = p * profitPerDollar - (1 - p);

  return {
    impliedPct,
    edgePoints,
    expectedValue,
    qualifies: edgePoints >= 2.5 && expectedValue >= 0.05,
  };
}

function checkMarketValue(stat: EspnPlayerStat, teamRank: number): boolean {
  if (teamRank !== 3) return false;
  if (!stat.isStarter) return false;
  const inj = stat.injuryStatus?.toLowerCase() || "";
  if (inj.includes("out") || inj.includes("suspend") || inj === "inactive") return false;
  return marketValueMetrics(stat)?.qualifies ?? false;
}

function InjuryBadge({ status }: { status?: string }) {
  if (!status) return null;
  const upper = status.toUpperCase();
  if (upper.includes("OUT")) return (
    <Badge className="text-[9px] h-4 px-1 gap-0.5 bg-red-500/15 text-red-500 border border-red-500/30 font-semibold no-default-active-elevate">
      <AlertCircle className="h-2.5 w-2.5" />OUT
    </Badge>
  );
  if (upper.includes("DAY") || upper.includes("DTD")) return (
    <Badge className="text-[9px] h-4 px-1 gap-0.5 bg-yellow-500/15 text-yellow-500 border border-yellow-500/30 font-semibold no-default-active-elevate">
      <Activity className="h-2.5 w-2.5" />DTD
    </Badge>
  );
  if (upper.includes("QUESTION")) return (
    <Badge className="text-[9px] h-4 px-1 gap-0.5 bg-orange-500/15 text-orange-500 border border-orange-500/30 font-semibold no-default-active-elevate">
      <AlertTriangle className="h-2.5 w-2.5" />Q
    </Badge>
  );
  if (upper.includes("PROB")) return (
    <Badge className="text-[9px] h-4 px-1 gap-0.5 bg-blue-500/15 text-blue-400 border border-blue-500/20 font-medium no-default-active-elevate">
      <Shield className="h-2.5 w-2.5" />P
    </Badge>
  );
  return null;
}

function FbCountBar({ count, isReal = false }: { count: number; isReal?: boolean }) {
  const MAX_COUNT = 20;
  const barWidth = Math.min(count / MAX_COUNT * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground shrink-0 w-20">
        FB Scored{isReal ? "" : " (est.)"}
      </span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isReal ? "bg-sky-400" : "bg-sky-500/50"}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <span className={`font-mono text-xs font-semibold w-12 text-right whitespace-nowrap ${isReal ? "text-sky-500 dark:text-sky-300" : "text-sky-600/70 dark:text-sky-400/60"}`}>
        {isReal ? count : `~${count}`}
      </span>
    </div>
  );
}

function FbBar({ pct, isTopPick = false, isSneakyValue = false, isDarkHorse = false }: { pct: number; isTopPick?: boolean; isSneakyValue?: boolean; isDarkHorse?: boolean }) {
  const maxPct = 35;
  const barWidth = Math.min(pct / maxPct * 100, 100);
  const isElite = pct >= 28;
  const isGood = pct >= 20;
  const barColor = isElite
    ? "bg-green-500"
    : isGood
      ? "bg-yellow-500"
      : isTopPick
        ? "bg-emerald-700"
        : isSneakyValue
          ? "bg-blue-700"
          : isDarkHorse
            ? "bg-amber-500"
            : "bg-red-500/70";
  const textColor = isElite
    ? "text-green-700 dark:text-green-400"
    : isGood
      ? "text-yellow-700 dark:text-yellow-400"
      : isTopPick
        ? "text-emerald-700 dark:text-emerald-500"
        : isSneakyValue
          ? "text-blue-700 dark:text-blue-400"
          : isDarkHorse
            ? "text-amber-700 dark:text-amber-400"
            : "text-red-600 dark:text-red-400";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground shrink-0 w-20">FB Rate</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${barWidth}%` }} />
      </div>
      <span className={`font-mono text-xs font-bold w-12 text-right ${textColor}`}>{Math.round(pct)}%</span>
    </div>
  );
}

function PlayerCard({
  stat,
  rank,
  teamRank,
  showLiveOdds = false,
  isTopPick = false,
  isSneakyValue = false,
  isDarkHorse = false,
}: {
  stat: EspnPlayerStat;
  rank: number;
  teamRank?: number;
  showLiveOdds?: boolean;
  isTopPick?: boolean;
  isSneakyValue?: boolean;
  isDarkHorse?: boolean;
}) {
  const effectiveTeamRank = teamRank ?? rank;
  const isElite = stat.firstBasketPct >= 28;
  const isGood = stat.firstBasketPct >= 20;
  const isLow = stat.firstBasketPct < 20 && !isTopPick && !isSneakyValue && !isDarkHorse;
  const initials = stat.player.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const displayOdds = stat.liveOdds || stat.odds;
  const hasMarketOdds = !!stat.liveOdds;
  const valueMetrics = hasMarketOdds ? marketValueMetrics(stat) : null;

  const cardBg = isTopPick
    ? "bg-emerald-100/90 dark:bg-emerald-500/15 ring-1 ring-emerald-400/70 shadow-[0_0_16px_rgba(16,185,129,0.28)]"
    : isElite || isGood || isSneakyValue || isDarkHorse
      ? "bg-amber-100/80 dark:bg-amber-400/10 ring-1 ring-amber-400/60 shadow-[0_0_13px_rgba(250,204,21,0.22)]"
      : isLow
        ? "bg-red-100/60 dark:bg-red-500/5"
        : "";

  const avatarRing = isTopPick
    ? "ring-2 ring-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.55)]"
    : isElite || isGood || isSneakyValue || isDarkHorse
      ? "ring-2 ring-amber-400 shadow-[0_0_10px_rgba(250,204,21,0.45)]"
      : "ring-border";

  const oddsColor = isTopPick
    ? "text-emerald-700 dark:text-emerald-300"
    : isElite || isGood || isSneakyValue || isDarkHorse
      ? "text-amber-700 dark:text-amber-300"
      : "text-red-600 dark:text-red-400";

  return (
    <div
      className={`flex gap-3 p-3 rounded-md transition-colors hover-elevate ${cardBg}`}
      data-testid={`card-player-${stat.player.replace(/\s/g, '-')}`}
    >
      <div className="flex items-start gap-2 shrink-0">
        <span className={`text-[10px] font-bold w-4 text-center pt-1 ${rank <= 3 ? "text-primary" : "text-muted-foreground/50"}`}>
          {rank}
        </span>
        <div className="relative">
          <Avatar className={`w-16 h-16 ring-1 ${avatarRing}`}>
            <AvatarImage src={stat.headshot} alt={stat.player} className="object-cover object-top" />
            <AvatarFallback className="text-sm font-bold bg-muted text-muted-foreground">{initials}</AvatarFallback>
          </Avatar>
          {(isElite || isTopPick || isSneakyValue || isDarkHorse) && (
            <span className={`absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full ${isElite ? "bg-green-500" : isTopPick ? "bg-emerald-700" : isSneakyValue ? "bg-blue-700" : "bg-amber-500"}`}>
              {isSneakyValue && !isTopPick && !isElite
                ? <Zap className="w-2.5 h-2.5 text-white" />
                : isDarkHorse && !isSneakyValue && !isTopPick && !isElite
                  ? <TrendingUp className="w-2.5 h-2.5 text-white" />
                  : <Star className="w-2.5 h-2.5 text-white fill-white" />
              }
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold leading-tight">{stat.player}</span>
          <InjuryBadge status={stat.injuryStatus} />
          {stat.isStarter && (
            <Badge className="text-[9px] h-4 px-1 bg-primary/15 text-primary border border-primary/20 font-medium no-default-active-elevate">S</Badge>
          )}
          {isTopPick && !isElite && effectiveTeamRank === 1 && (
            <Badge className="text-[9px] h-4 px-1.5 bg-emerald-900/60 text-emerald-400 border border-emerald-700/40 font-semibold no-default-active-elevate">
              Top Pick
            </Badge>
          )}
          {isTopPick && !isElite && effectiveTeamRank === 2 && (
            <Badge className="text-[9px] h-4 px-1.5 bg-emerald-900/40 text-emerald-500 border border-emerald-700/30 font-semibold no-default-active-elevate">
              2nd Pick
            </Badge>
          )}
          {isSneakyValue && !isTopPick && !isElite && (
            <Badge className="text-[9px] h-4 px-1.5 bg-blue-900/70 text-blue-300 border border-blue-700/40 font-semibold no-default-active-elevate">
              Market Value
            </Badge>
          )}
          {isDarkHorse && !isSneakyValue && !isTopPick && !isElite && (
            <Badge className="text-[9px] h-4 px-1.5 bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/40 font-semibold no-default-active-elevate">
              Dark Horse
            </Badge>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground mt-0.5">
          {stat.position} &bull; {stat.avgMinutes.toFixed(0)} MIN &bull; {stat.gamesPlayed} GP
        </p>

        <div className="mt-2 flex flex-col gap-1">
          <FbCountBar
            count={stat.currentSeasonGamesTracked
              ? (stat.currentSeasonFirstBaskets ?? stat.firstBasketsScored ?? 0)
              : Math.round(stat.firstBasketPct / 100 * stat.gamesPlayed)}
            isReal={Boolean(stat.currentSeasonGamesTracked && stat.currentSeasonGamesTracked > 0)}
          />
          <FbBar pct={stat.firstBasketPct} isTopPick={isTopPick} isSneakyValue={isSneakyValue} isDarkHorse={isDarkHorse} />
          {(Boolean(stat.currentSeasonGamesTracked && stat.currentSeasonGamesTracked > 0) || Boolean(stat.previousSeasonGamesTracked && stat.previousSeasonGamesTracked > 0)) && (
            <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
              Verified history: {stat.currentSeasonGamesTracked ? `${stat.currentSeasonFirstBaskets ?? 0}/${stat.currentSeasonGamesTracked} this season` : "current season sample pending"}
              {stat.previousSeasonGamesTracked ? ` · ${stat.previousSeasonFirstBaskets ?? 0}/${stat.previousSeasonGamesTracked} prior season` : ""}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className={`font-mono text-xs font-bold ${oddsColor}`}>
            {displayOdds}
          </span>
          {hasMarketOdds ? (
            <>
              <Badge variant="outline" className="text-[8px] h-4 px-1.5 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
                {liveOddsSourceLabel(stat)}
              </Badge>
              {valueMetrics && (
                <span className={`text-[9px] font-mono ${valueMetrics.edgePoints >= 0 ? "text-blue-600 dark:text-blue-300" : "text-muted-foreground"}`}>
                  Edge {valueMetrics.edgePoints >= 0 ? "+" : ""}{valueMetrics.edgePoints.toFixed(1)} pts · EV {valueMetrics.expectedValue >= 0 ? "+" : ""}{(valueMetrics.expectedValue * 100).toFixed(0)}%
                </span>
              )}
            </>
          ) : (
            <span className="text-[9px] text-muted-foreground/50 font-medium">Model estimate · not eligible for Value</span>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchupH2H({
  game,
  awayPlayers,
  homePlayers,
  showLiveOdds,
}: {
  game: Game;
  awayPlayers: EspnPlayerStat[];
  homePlayers: EspnPlayerStat[];
  showLiveOdds: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  const formatTime = (t?: string | null) => {
    if (!t) return null;
    try {
      const d = new Date(t);
      if (isNaN(d.getTime())) return t;
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
    } catch { return t; }
  };

  const time = formatTime(game.gameTime);
  const hasLive = awayPlayers.some(p => !!p.liveOdds) || homePlayers.some(p => !!p.liveOdds);
  const bestPick = [...awayPlayers, ...homePlayers].sort((a, b) => b.firstBasketPct - a.firstBasketPct)[0] ?? null;

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 border-b hover-elevate"
        onClick={() => setExpanded(e => !e)}
        data-testid={`button-matchup-${game.awayTeam}-${game.homeTeam}`}
      >
        <div className="flex items-center gap-3">
          <ArrowLeftRight className="w-4 h-4 text-primary shrink-0" />
          <span className="font-bold text-sm">
            {game.awayTeam} <span className="text-muted-foreground font-normal">@</span> {game.homeTeam}
          </span>
          {time && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              {time}
            </span>
          )}
          {hasLive && (
            <Badge className="text-[9px] h-4 px-1.5 bg-green-500/15 text-green-500 border border-green-500/20 font-semibold no-default-active-elevate">
              LIVE MARKET ODDS
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {awayPlayers.length + homePlayers.length} players
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <>
        {bestPick && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-500/25 bg-emerald-500/10 px-4 py-3" data-testid={`nba-model-top-pick-${game.id}`}>
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"><Star className="h-4 w-4 fill-current" /></span>
              <div className="min-w-0">
                <div className="text-[9px] font-bold uppercase tracking-[.14em] text-emerald-700 dark:text-emerald-400">Model’s top first-basket pick</div>
                <div className="truncate text-sm font-bold">{bestPick.player} <span className="font-medium text-muted-foreground">· {bestPick.team}</span></div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-lg font-black text-emerald-700 dark:text-emerald-400">{bestPick.firstBasketPct.toFixed(1)}%</div>
              <div className="text-[9px] text-muted-foreground">Model estimate{bestPick.liveOdds ? ` · ${bestPick.liveOdds}` : " · odds optional"}</div>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
          <div>
            <div className="px-4 py-2 border-b bg-muted/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TeamLogo team={game.awayTeam} size="sm" />
                <span className="text-xs text-muted-foreground font-medium">AWAY</span>
                <span className="font-bold text-sm">{game.awayTeam}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{awayPlayers.length} players</span>
            </div>
            <div className="divide-y divide-border/40">
              {awayPlayers.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground text-center">No players found</p>
              ) : (
                awayPlayers.map((p, i) => (
                  <PlayerCard
                    key={`${p.team}-${p.player}`}
                    stat={p}
                    rank={i + 1}
                    showLiveOdds={showLiveOdds}
                    isTopPick={Boolean(bestPick && p.player === bestPick.player && p.team === bestPick.team)}
                    isSneakyValue={checkMarketValue(p, i + 1)}
                    isDarkHorse={i === 3}
                  />
                ))
              )}
            </div>
          </div>

          <div>
            <div className="px-4 py-2 border-b bg-muted/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TeamLogo team={game.homeTeam} size="sm" />
                <span className="text-xs text-muted-foreground font-medium">HOME</span>
                <span className="font-bold text-sm">{game.homeTeam}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{homePlayers.length} players</span>
            </div>
            <div className="divide-y divide-border/40">
              {homePlayers.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground text-center">No players found</p>
              ) : (
                homePlayers.map((p, i) => (
                  <PlayerCard
                    key={`${p.team}-${p.player}`}
                    stat={p}
                    rank={i + 1}
                    showLiveOdds={showLiveOdds}
                    isTopPick={Boolean(bestPick && p.player === bestPick.player && p.team === bestPick.team)}
                    isSneakyValue={checkMarketValue(p, i + 1)}
                    isDarkHorse={i === 3}
                  />
                ))
              )}
            </div>
          </div>
        </div>
        </>
      )}
    </div>
  );
}

export default function PlayerStats() {
  const [searchQuery, setSearchQuery] = useState("");
  // Keep projected candidates visible before official starters are confirmed.
  const [filterStarters, setFilterStarters] = useState(true);
  const [viewMode, setViewMode] = useState<"h2h" | "list">("h2h");

  const { data: espnStats, isLoading: espnLoading, error: espnError, refetch, isFetching } = useQuery<EspnPlayerStat[]>({
    queryKey: ["/api/espn-player-stats"],
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const { data: games } = useQuery<Game[]>({
    queryKey: ["/api/games"],
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  // Show the next scheduled NBA games, including the next slate if it falls after midnight ET.
  const todayGames = useMemo(() => {
    if (!games) return [];
    const now = Date.now();
    const horizon = now + 72 * 60 * 60 * 1000;
    const isUnfinished = (status?: string) => {
      const s = (status || "").toLowerCase();
      return !["final", "completed", "complete", "post", "closed"].some((v) => s.includes(v));
    };
    return games
      .filter((g) => {
        if (!isUnfinished(g.status)) return false;
        if (!g.gameTime) return g.gameDate === "Today";
        const startTime = new Date(g.gameTime).getTime();
        return Number.isFinite(startTime) && startTime >= now - 3 * 60 * 60 * 1000 && startTime <= horizon;
      })
      .sort((a, b) => {
        const at = a.gameTime ? new Date(a.gameTime).getTime() : Number.MAX_SAFE_INTEGER;
        const bt = b.gameTime ? new Date(b.gameTime).getTime() : Number.MAX_SAFE_INTEGER;
        return at - bt;
      });
  }, [games]);

  const allActivePlayers = useMemo(() => {
    if (!espnStats) return [];
    let result = [...espnStats].filter((p) => {
      const inj = p.injuryStatus?.toLowerCase() || "";
      return !inj.includes("out") && !inj.includes("suspend");
    });
    // Focus this page on first-basket starter candidates, not full rosters.
    result = result.filter((p) => p.isStarter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) => p.player.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => b.firstBasketPct - a.firstBasketPct);
  }, [espnStats, filterStarters, searchQuery]);

  const matchupGroups = useMemo(() => {
    return todayGames.map((game) => {
      const away = allActivePlayers
        .filter((p) => p.team === game.awayTeam && p.isStarter)
        .sort((a, b) => b.firstBasketPct - a.firstBasketPct)
        .slice(0, 5);
      const home = allActivePlayers
        .filter((p) => p.team === game.homeTeam && p.isStarter)
        .sort((a, b) => b.firstBasketPct - a.firstBasketPct)
        .slice(0, 5);
      return { game, away, home };
    });
  }, [todayGames, allActivePlayers]);

  const gameTopPicks = useMemo(() => matchupGroups.flatMap(({ game, away, home }) => {
    const p = [...away, ...home].sort((a, b) => b.firstBasketPct - a.firstBasketPct)[0];
    return p ? [{ game, p }] : [];
  }), [matchupGroups]);
  const avgTopProbability = gameTopPicks.length
    ? gameTopPicks.reduce((sum, item) => sum + item.p.firstBasketPct, 0) / gameTopPicks.length
    : null;
  const topModelPick = [...gameTopPicks].sort((a, b) => b.p.firstBasketPct - a.p.firstBasketPct)[0] ?? null;

  const hasMarketOdds = useMemo(() => espnStats?.some((p) => !!p.liveOdds) ?? false, [espnStats]);
  const hasLiveOdds = useMemo(() => espnStats?.some((p) => !!p.liveOdds && !p.liveOddsFrozen) ?? false, [espnStats]);
  const hasFrozenOdds = useMemo(() => espnStats?.some((p) => !!p.liveOdds && !!p.liveOddsFrozen) ?? false, [espnStats]);

  const teamRankMap = useMemo<Record<string, number>>(() => {
    if (!espnStats) return {};
    const byTeam: Record<string, EspnPlayerStat[]> = {};
    espnStats.forEach(s => {
      if (!byTeam[s.team]) byTeam[s.team] = [];
      byTeam[s.team].push(s);
    });
    const map: Record<string, number> = {};
    Object.values(byTeam).forEach(players => {
      [...players].sort((a, b) => b.firstBasketPct - a.firstBasketPct)
        .forEach((p, i) => { map[`${p.team}-${p.player}`] = i + 1; });
    });
    return map;
  }, [espnStats]);

  if (espnLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const hasStats = espnStats && espnStats.length > 0;

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            NBA First Basket
          </h1>
          {hasMarketOdds && (
            <p className="text-xs text-green-500 font-semibold mt-0.5">
              {hasLiveOdds && hasFrozenOdds
                ? "Live + Frozen Pregame First-Basket Odds"
                : hasFrozenOdds
                  ? "Frozen Pregame First-Basket Odds"
                  : "Live First-Basket Market Odds"}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-md border overflow-hidden">
            <button
              onClick={() => setViewMode("h2h")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "h2h" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
              data-testid="button-view-h2h"
            >
              H2H View
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
              data-testid="button-view-list"
            >
              List View
            </button>
          </div>

          <Button
            variant={filterStarters ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStarters(!filterStarters)}
            className="text-xs"
            data-testid="button-filter-starters"
          >
            Starters Only
          </Button>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search players..."
              className="pl-9 w-44 text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search-players"
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-espn-stats"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {espnError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load player stats. ESPN API may be temporarily unavailable.
        </div>
      )}

      {viewMode === "h2h" && matchupGroups.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="nba-first-basket-summary">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current Slate</div>
            <div className="mt-1 text-2xl font-black">{matchupGroups.length}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">Every scheduled matchup in the active slate.</div>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Average #1 Probability</div>
            <div className="mt-1 text-2xl font-black text-emerald-600 dark:text-emerald-400">{avgTopProbability === null ? "—" : `${avgTopProbability.toFixed(1)}%`}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">Average model estimate of each matchup’s top-ranked player.</div>
          </div>
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Strongest Model Pick</div>
            <div className="mt-1 truncate text-base font-black">{topModelPick?.p.player ?? "—"}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">{topModelPick ? `${topModelPick.p.team} · ${topModelPick.p.firstBasketPct.toFixed(1)}% · ${topModelPick.game.awayTeam} @ ${topModelPick.game.homeTeam}` : "Waiting for eligible player data."}</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <span className="font-semibold uppercase tracking-wider">FB% key:</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Elite 28%+</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />Good 20–27%</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-700 inline-block" />Top Pick</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-700 inline-block" />Market Value = live odds + edge</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500/70 inline-block" />Low &lt;20%</span>
        <span className="ml-auto flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Live = market feed</span>
          <span className="text-muted-foreground/40">|</span>
          <span className="flex items-center gap-1"><span className="text-muted-foreground/60 font-bold text-[10px]">Est</span> = model estimate only</span>
          <span className="text-muted-foreground/40">|</span>
          <a
            href="https://www.fanduel.com/sports/nba"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <FdLogo className="w-3.5 h-3.5" />
            <span>Compare on FanDuel</span>
          </a>
        </span>
      </div>

      {!hasStats && todayGames.length === 0 ? (
        <div className="rounded-md border bg-card px-6 py-12 text-center">
          <TrendingUp className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium">Loading player data from ESPN...</p>
          <p className="text-xs text-muted-foreground mt-1">
            Building player rankings from NBA stats and verified first-basket history. Market odds are optional.
          </p>
          <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" /> Try Again
          </Button>
        </div>
      ) : viewMode === "h2h" ? (
        <div className="space-y-4">
          {matchupGroups.length === 0 ? (
            <div className="rounded-md border bg-card px-6 py-8 text-center">
              <p className="text-sm text-muted-foreground">No upcoming games found in the active slate. Check back later.</p>
            </div>
          ) : (
            matchupGroups.map(({ game, away, home }) => (
              <MatchupH2H
                key={game.id}
                game={game}
                awayPlayers={away}
                homePlayers={home}
                showLiveOdds={hasMarketOdds}
              />
            ))
          )}
        </div>
      ) : (
        <div className="rounded-md border bg-card overflow-hidden">
          <div className="divide-y divide-border/40">
            {allActivePlayers.length === 0 ? (
              <p className="px-6 py-8 text-sm text-muted-foreground text-center">No players match your filter.</p>
            ) : (
              allActivePlayers.map((stat, i) => {
                const teamRank = teamRankMap[`${stat.team}-${stat.player}`] ?? 999;
                return (
                  <PlayerCard
                    key={`${stat.team}-${stat.player}`}
                    stat={stat}
                    rank={i + 1}
                    teamRank={teamRank}
                    showLiveOdds={hasMarketOdds}
                    isTopPick={teamRank <= 2}
                    isSneakyValue={checkMarketValue(stat, teamRank)}
                    isDarkHorse={teamRank === 4}
                  />
                );
              })
            )}
          </div>
          <div className="px-4 py-2 border-t bg-muted/30">
            <p className="text-xs text-muted-foreground">
              {allActivePlayers.length} players shown &bull; Sorted by Scoring Probability
              {hasMarketOdds && (hasFrozenOdds ? " &bull; archived pregame market odds included" : " &bull; live market odds included")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
