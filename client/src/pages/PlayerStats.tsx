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


const NBA_TEAM_TINT: Record<string, string> = {
 ATL:"#C8102E", BOS:"#007A33", BKN:"#000000", CHA:"#1D1160", CHI:"#CE1141", CLE:"#6F263D", DAL:"#00538C", DEN:"#0E2240", DET:"#C8102E", GSW:"#1D428A", HOU:"#CE1141", IND:"#002D62", LAC:"#C8102E", LAL:"#552583", MEM:"#5D76A9", MIA:"#98002E", MIL:"#00471B", MIN:"#0C2340", NOP:"#0C2340", NYK:"#006BB6", OKC:"#007AC1", ORL:"#0077C0", PHI:"#006BB6", PHX:"#1D1160", POR:"#E03A3E", SAC:"#5A2D81", SAS:"#C4CED4", TOR:"#CE1141", UTA:"#002B5C", WAS:"#002B5C",
};
const NBA_ARENA_IMAGE: Record<string, string> = {
 ATL:"https://commons.wikimedia.org/wiki/Special:FilePath/State%20Farm%20Arena%20Atlanta.jpg",
 BOS:"https://commons.wikimedia.org/wiki/Special:FilePath/TD%20Garden%20Boston.jpg",
 BKN:"https://commons.wikimedia.org/wiki/Special:FilePath/Barclays%20Center%20Brooklyn.jpg",
 CHI:"https://commons.wikimedia.org/wiki/Special:FilePath/United%20Center%20Chicago.jpg",
 CLE:"https://commons.wikimedia.org/wiki/Special:FilePath/Rocket%20Mortgage%20FieldHouse.jpg",
 DAL:"https://commons.wikimedia.org/wiki/Special:FilePath/American%20Airlines%20Center%20Dallas.jpg",
 DEN:"https://commons.wikimedia.org/wiki/Special:FilePath/Ball%20Arena%20Denver.jpg",
 GSW:"https://commons.wikimedia.org/wiki/Special:FilePath/Chase%20Center%20San%20Francisco.jpg",
 LAL:"https://commons.wikimedia.org/wiki/Special:FilePath/Crypto.com%20Arena%20interior%202024.jpg",
 MIA:"https://commons.wikimedia.org/wiki/Special:FilePath/Kaseya%20Center%20Miami.jpg",
 NYK:"https://commons.wikimedia.org/wiki/Special:FilePath/Madison%20Square%20Garden%20basketball.jpg",
 OKC:"https://commons.wikimedia.org/wiki/Special:FilePath/Paycom%20Center%20Oklahoma%20City.jpg",
 PHI:"https://commons.wikimedia.org/wiki/Special:FilePath/Wells%20Fargo%20Center%20Philadelphia.jpg",
 PHX:"https://commons.wikimedia.org/wiki/Special:FilePath/Footprint%20Center.jpg",
 SAS:"https://commons.wikimedia.org/wiki/Special:FilePath/Frost%20Bank%20Center.jpg",
 TOR:"https://commons.wikimedia.org/wiki/Special:FilePath/Scotiabank%20Arena%20Toronto.jpg",
};
function NbaArenaBackdrop({ homeTeam }: { homeTeam: string }) {
 const key=homeTeam.toUpperCase(); const src=NBA_ARENA_IMAGE[key]; const tint=NBA_TEAM_TINT[key] || "#1F2937";
 return <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
  <div className="absolute inset-0 opacity-20" style={{background:"linear-gradient(135deg, "+tint+"55, transparent 58%)"}} />
  {src ? <img src={src} alt="" loading="lazy" className="absolute inset-[-18px] h-[calc(100%+36px)] w-[calc(100%+36px)] scale-105 object-cover opacity-[0.18] blur-[10px] saturate-[.65]" onError={(e)=>{e.currentTarget.style.display="none";}} /> : null}
  <div className="absolute inset-0 bg-gradient-to-b from-background/64 via-background/76 to-background/94" />
  <div className="absolute inset-0 bg-gradient-to-r from-background/32 via-transparent to-background/42" />
 </div>;
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
  const barColor = isTopPick
    ? "bg-emerald-400 shadow-[0_0_9px_rgba(16,185,129,0.8)]"
    : isElite || isGood || isSneakyValue || isDarkHorse
      ? "bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.65)]"
      : "bg-red-500/70";
  const textColor = isTopPick
    ? "text-emerald-700 dark:text-emerald-300"
    : isElite || isGood || isSneakyValue || isDarkHorse
      ? "text-yellow-700 dark:text-yellow-300"
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
    if (!t) return "Time TBD";
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? t : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
  };
  const hasLive = awayPlayers.some(p => !!p.liveOdds) || homePlayers.some(p => !!p.liveOdds);
  const allPlayers = [...awayPlayers, ...homePlayers].sort((a, b) => b.firstBasketPct - a.firstBasketPct);
  const bestPick = allPlayers[0] ?? null;
  const candidates = awayPlayers.length + homePlayers.length;

  return (
    <article className="relative isolate overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md">
      <NbaArenaBackdrop homeTeam={game.homeTeam} />
      <div className="relative z-10">
        <div className="border-b bg-background/55 p-4 backdrop-blur-[2px]">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <TeamLogo team={game.awayTeam} size="md" />
              <div className="min-w-0">
                <div className="text-sm font-black">{game.awayTeam}</div>
                <div className="max-w-[130px] truncate text-[9px] text-muted-foreground">Away team</div>
              </div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">First Basket</div>
              <div className="mt-1 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />{formatTime(game.gameTime)}
              </div>
            </div>
            <div className="flex min-w-0 items-center justify-end gap-3 text-right">
              <div className="min-w-0">
                <div className="text-sm font-black">{game.homeTeam}</div>
                <div className="max-w-[130px] truncate text-[9px] text-muted-foreground">Home team</div>
              </div>
              <TeamLogo team={game.homeTeam} size="md" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Badge variant="outline" className="border-yellow-500/35 bg-yellow-500/10 text-[8px] text-yellow-700 dark:text-yellow-300">
              STARTER CANDIDATES · PROJECTED UNTIL CONFIRMED
            </Badge>
            <Badge variant="outline" className="text-[8px]">{game.status || "Scheduled"}</Badge>
            {hasLive ? (
              <Badge className="border-emerald-500/30 bg-emerald-500/15 text-[8px] text-emerald-600 dark:text-emerald-300">LIVE MARKET ODDS</Badge>
            ) : (
              <Badge variant="outline" className="text-[8px]">MODEL ONLY · ODDS OPTIONAL</Badge>
            )}
          </div>
        </div>

        <div className="space-y-3 bg-background/48 p-4 backdrop-blur-[2px]">
          {bestPick ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[.07] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                    <Star className="h-4 w-4 fill-current" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold uppercase tracking-[.12em] text-emerald-700 dark:text-emerald-300">Model’s strongest candidate</div>
                    <div className="truncate text-sm font-black">{bestPick.player} <span className="font-medium text-muted-foreground">· {bestPick.team}</span></div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-xl font-black text-emerald-600 dark:text-emerald-300">{bestPick.firstBasketPct.toFixed(1)}%</div>
                  <div className="text-[8px] uppercase tracking-[.12em] text-muted-foreground">Model estimate</div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-border/70 bg-background/62 p-3 backdrop-blur-sm">
            <button type="button" onClick={() => setExpanded(v => !v)} className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={expanded}>
              <div>
                <div className="text-xs font-bold">Starter rankings</div>
                <div className="mt-0.5 text-[9px] text-muted-foreground">Five candidates per team at most, ranked by the existing first-basket model.</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[8px]">{candidates}/10 candidates</Badge>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
              </div>
            </button>
            {expanded ? (
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {[
                  { team: game.awayTeam, label: "AWAY", players: awayPlayers },
                  { team: game.homeTeam, label: "HOME", players: homePlayers },
                ].map(({ team, label, players }) => (
                  <section key={team} className="rounded-xl border border-border/60 bg-background/45 p-2">
                    <div className="mb-2 flex items-center gap-2 px-1">
                      <TeamLogo team={team} size="sm" />
                      <span className="text-[9px] font-bold uppercase tracking-[.12em] text-muted-foreground">{label}</span>
                      <span className="text-xs font-black">{team}</span>
                      <span className="ml-auto text-[9px] text-muted-foreground">{players.length}/5</span>
                    </div>
                    <div className="space-y-2">
                      {players.length ? players.map((p, i) => (
                        <PlayerCard
                          key={`${p.team}-${p.player}`}
                          stat={p}
                          rank={i + 1}
                          showLiveOdds={showLiveOdds}
                          isTopPick={i < 2}
                          isSneakyValue={checkMarketValue(p, i + 1)}
                          isDarkHorse={i >= 2}
                        />
                      )) : (
                        <div className="rounded-lg border border-dashed bg-background/50 p-5 text-center text-xs text-muted-foreground">Starter candidates are not available for this team yet.</div>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
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

  // Show only today's NBA slate in Eastern Time, never tomorrow's games from a 72-hour window.
  const todayGames = useMemo(() => {
    if (!games) return [];
    const now = Date.now();
    const todayET = new Intl.DateTimeFormat("en-CA", { timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
    const isUnfinished = (status?: string) => {
      const s = (status || "").toLowerCase();
      return !["final", "completed", "complete", "post", "closed"].some((v) => s.includes(v));
    };
    return games.filter((g) => {
      if (!isUnfinished(g.status)) return false;
      if (!g.gameTime) return g.gameDate === "Today";
      const start = new Date(g.gameTime);
      const startTime = start.getTime();
      if (!Number.isFinite(startTime) || startTime < now - 3 * 60 * 60 * 1000) return false;
      return new Intl.DateTimeFormat("en-CA", { timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit" }).format(start) === todayET;
    }).sort((a,b) => new Date(a.gameTime || 0).getTime() - new Date(b.gameTime || 0).getTime());
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
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 md:px-6 lg:px-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const hasStats = espnStats && espnStats.length > 0;

  return (
    <div className="-mx-4 -mt-8 md:-mx-6 lg:-mx-8">
      <div className="border-b bg-card"><div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 md:px-6 lg:px-8"><div className="flex overflow-x-auto"><div className="flex items-center gap-1.5 whitespace-nowrap border-b-2 border-primary px-4 py-4 text-xs font-semibold"><Zap className="h-3.5 w-3.5" />First Baskets</div><div className="flex items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-4 py-4 text-xs text-muted-foreground"><Activity className="h-3.5 w-3.5" />Starter Rankings</div></div><Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="shrink-0 gap-2"><RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button></div></div>
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 lg:px-8 space-y-5">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            NBA First Basket
          </h1>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">A WNBA-style game-by-game view of starter candidates, first-basket model probabilities, verified history, and live market value when available.</p>
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
          <div className="hidden flex rounded-md border overflow-hidden">
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

          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300" data-testid="button-filter-starters">
            Starters Only · 10 max
          </span>

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
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="nba-first-basket-summary">
          <div className="rounded-xl border bg-card/85 p-4 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current Slate</div>
            <div className="mt-1 text-2xl font-black">{matchupGroups.length}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">Every scheduled matchup in the active slate.</div>
          </div>
          <div className="rounded-xl border bg-card/85 p-4 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Average #1 Probability</div>
            <div className="mt-1 text-2xl font-black text-emerald-600 dark:text-emerald-400">{avgTopProbability === null ? "—" : `${avgTopProbability.toFixed(1)}%`}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">Average model estimate of each matchup’s top-ranked player.</div>
          </div>
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[.05] p-4 shadow-sm">
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
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
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
    </div>
  );
}
