import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw,
  Clock,
  AlertCircle,
  History,
  CircleDot,
  Activity,
  Trophy,
  Target,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type MarketOdds = {
  source: "ParlayAPI";
  market: "player_first_basket";
  bestOdds: number;
  bestOddsDisplay: string;
  bestBook: string;
  fanduelOdds: number | null;
  draftkingsOdds: number | null;
  impliedProbability: number;
  edgePoints: number;
  expectedValue: number;
  qualifiesValue: boolean;
  lastUpdate: string | null;
};

type Candidate = {
  name: string;
  team: string;
  position: string;
  headshot: string | null;
  seasonStarts: number;
  avgPoints: number;
  avgFga: number;
  fgPct: number;
  avgMinutes: number;
  currentFirstBaskets: number;
  currentGamesTracked: number;
  previousFirstBaskets: number;
  previousGamesTracked: number;
  openingFirstShots: number;
  openingFirstShotRate: number | null;
  openingShotFgPct: number | null;
  probability: number;
  rank: number;
  marketOdds?: MarketOdds | null;
};

type TipSignal = {
  awayJumper: string | null;
  homeJumper: string | null;
  awayTipWins: number;
  awayTipEvents: number;
  awayTipPct: number | null;
  homeTipWins: number;
  homeTipEvents: number;
  homeTipPct: number | null;
  projectedFirstPossessionTeam: string | null;
  confidence: "insufficient" | "emerging" | "usable";
};

type Game = {
  id: string;
  date: string;
  shortName: string;
  awayTeam: string;
  homeTeam: string;
  awayName: string;
  homeName: string;
  status: string;
  lineupStatus: "confirmed" | "projected" | "waiting";
  starters: { name: string; team: string }[];
  candidates: Candidate[];
  topPick: Candidate | null;
  tipSignal: TipSignal;
  verifiedFirstScorer: string | null;
  verifiedFirstScorerTeam: string | null;
};

type Slate = {
  season: number;
  updatedAt: string;
  teams: { abbreviation: string; name: string }[];
  games: Game[];
  source: string;
  modelVersion: string;
};

type HistoryRow = {
  playerName: string;
  team: string;
  season: number;
  fbScored: number;
  verifiedStarterGames: number;
  rate: number | null;
  lastUpdated: string;
};

type HistoryPayload = {
  currentSeason: number;
  previousSeason: number;
  current: HistoryRow[];
  previous: HistoryRow[];
  status: string;
  verifiedGames: number;
  coverageStart: string | null;
  coverageEnd: string | null;
  note: string;
};

type Section = "games" | "opening-tips" | "strongest" | "history";

function time(v: string) {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "Time pending"
    : d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      }) + " ET";
}

function pct(v: number | null) {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}
function rate(f: number, g: number) {
  return g > 0 ? `${((f / g) * 100).toFixed(1)}%` : "—";
}
function american(v: number | null) {
  return v === null ? "—" : v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`;
}

const WNBA_LOGO_SLUG: Record<string, string> = {
  ATL: "atl",
  CHI: "chi",
  CON: "con",
  CT: "con",
  DAL: "dal",
  GS: "gs",
  GSV: "gs",
  IND: "ind",
  LA: "la",
  LAS: "lv",
  LV: "lv",
  MIN: "min",
  NY: "ny",
  NYL: "ny",
  PHX: "phx",
  PHO: "phx",
  SEA: "sea",
  WAS: "was",
  WSH: "was",
};

const WNBA_TEAM_BG: Record<string, string> = {
  ATL: "#E31837",
  CHI: "#4DB3E6",
  CON: "#F05023",
  CT: "#F05023",
  DAL: "#0C2340",
  GS: "#F2C75C",
  GSV: "#F2C75C",
  IND: "#002D62",
  LA: "#552583",
  LAS: "#000000",
  LV: "#000000",
  MIN: "#005083",
  NY: "#6ECEB2",
  NYL: "#6ECEB2",
  PHX: "#201747",
  PHO: "#201747",
  SEA: "#2C5234",
  WAS: "#C8102E",
  WSH: "#C8102E",
};

const WNBA_ARENA_IMAGE: Record<string, string> = {
  ATL: "https://commons.wikimedia.org/wiki/Special:FilePath/Gateway%20Center%20Arena%20at%20College%20Park.jpg",
  CHI: "https://commons.wikimedia.org/wiki/Special:FilePath/Chicago%20Sky%20game%20at%20Wintrust%20Arena.jpg",
  CON: "https://commons.wikimedia.org/wiki/Special:FilePath/Mohegan%20Sun%20Arena%20-%20June%2020%2C%202025.jpg",
  CT: "https://commons.wikimedia.org/wiki/Special:FilePath/Mohegan%20Sun%20Arena%20-%20June%2020%2C%202025.jpg",
  DAL: "https://commons.wikimedia.org/wiki/Special:FilePath/College%20Park%20Center.jpg",
  GS: "https://commons.wikimedia.org/wiki/Special:FilePath/Chase%20Center.jpg",
  GSV: "https://commons.wikimedia.org/wiki/Special:FilePath/Chase%20Center.jpg",
  IND: "https://commons.wikimedia.org/wiki/Special:FilePath/Gainbridge%20Fieldhouse.jpg",
  LA: "https://commons.wikimedia.org/wiki/Special:FilePath/Crypto.com%20Arena%20interior%202024.jpg",
  LAS: "https://commons.wikimedia.org/wiki/Special:FilePath/Michelob%20Ultra%20Arena.jpg",
  LV: "https://commons.wikimedia.org/wiki/Special:FilePath/Michelob%20Ultra%20Arena.jpg",
  MIN: "https://commons.wikimedia.org/wiki/Special:FilePath/Target%20Center.jpg",
  NY: "https://commons.wikimedia.org/wiki/Special:FilePath/2024%20WNBA%20Finals%20Game%201%20NYL%20vs.%20MIN%2010.10.2024%2073.jpg",
  NYL: "https://commons.wikimedia.org/wiki/Special:FilePath/2024%20WNBA%20Finals%20Game%201%20NYL%20vs.%20MIN%2010.10.2024%2073.jpg",
  PHX: "https://commons.wikimedia.org/wiki/Special:FilePath/Footprint%20Center.jpg",
  PHO: "https://commons.wikimedia.org/wiki/Special:FilePath/Footprint%20Center.jpg",
  SEA: "https://commons.wikimedia.org/wiki/Special:FilePath/Seattle%20Storm%20vs%20Atlanta%20Dream%20at%20Climate%20Pledge%20Arena%20%28July%202022%29%20-%2002.jpg",
  WAS: "https://commons.wikimedia.org/wiki/Special:FilePath/AmeriCup%20Qualifying%20Game%20at%20St.%20Elizabeths%20East%20Entertainment%20and%20Sports%20Arena.jpg",
  WSH: "https://commons.wikimedia.org/wiki/Special:FilePath/AmeriCup%20Qualifying%20Game%20at%20St.%20Elizabeths%20East%20Entertainment%20and%20Sports%20Arena.jpg",
};

function wnbaLogo(team: string) {
  const key = team.toUpperCase();
  return `https://a.espncdn.com/i/teamlogos/wnba/500/${WNBA_LOGO_SLUG[key] || key.toLowerCase()}.png`;
}

function ArenaBackdrop({ homeTeam }: { homeTeam: string }) {
  const key = homeTeam.toUpperCase();
  const src = WNBA_ARENA_IMAGE[key];
  const tint = WNBA_TEAM_BG[key] || "#1F2937";
  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 opacity-20"
        style={{
          background: `linear-gradient(135deg, ${tint}44, transparent 58%)`,
        }}
      />
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="absolute inset-[-18px] h-[calc(100%+36px)] w-[calc(100%+36px)] scale-105 object-cover opacity-[0.22] blur-[6px] saturate-75"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-b from-background/64 via-background/76 to-background/94" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/32 via-transparent to-background/42" />
    </div>
  );
}

function TeamLogo({
  team,
  size = "md",
}: {
  team: string;
  size?: "sm" | "md" | "lg";
}) {
  const bg = WNBA_TEAM_BG[team.toUpperCase()] || "#1F2937";
  const wrapper =
    size === "lg" ? "h-14 w-14" : size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const image =
    size === "lg" ? "h-11 w-11" : size === "sm" ? "h-6 w-6" : "h-8 w-8";
  return (
    <div
      className={`${wrapper} shrink-0 rounded-full border border-white/20 shadow-sm flex items-center justify-center overflow-hidden`}
      style={{ backgroundColor: bg }}
    >
      <img
        src={wnbaLogo(team)}
        alt={`${team} logo`}
        className={`${image} object-contain`}
      />
    </div>
  );
}

function tier(p: Candidate) {
  if (p.rank <= 2)
    return {
      label: p.rank === 1 ? "BEST PLAY" : "STRONG PLAY",
      row: "border-emerald-500/20 bg-emerald-500/[.06] hover:bg-emerald-500/[.10]",
      badge:
        "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30",
    };
  if (p.rank === 3 && p.marketOdds?.qualifiesValue)
    return {
      label: "MARKET VALUE",
      row: "border-blue-500/20 bg-blue-500/[.06] hover:bg-blue-500/[.10]",
      badge:
        "bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30",
    };
  if (p.rank === 3)
    return {
      label: "MODEL #3",
      row: "border-border bg-muted/15 hover:bg-muted/30",
      badge: "bg-muted/50 text-muted-foreground border-border",
    };
  if (p.rank <= 5)
    return {
      label: "MODEL RANK",
      row: "border-yellow-500/15 bg-yellow-500/[.035] hover:bg-yellow-500/[.07]",
      badge:
        "bg-yellow-500/10 text-yellow-600 dark:text-yellow-300 border-yellow-500/20",
    };
  return {
    label: "LONGSHOT",
    row: "border-red-500/10 bg-red-500/[.025] hover:bg-red-500/[.06]",
    badge: "bg-red-500/10 text-red-500 border-red-500/25",
  };
}

function PlayerHeadshot({
  p,
  large = false,
}: {
  p: Candidate;
  large?: boolean;
}) {
  const size = large ? "h-16 w-16" : "h-11 w-11";
  return (
    <div
      className={`${size} shrink-0 overflow-hidden rounded-full border bg-muted shadow-sm`}
    >
      {p.headshot ? (
        <img
          src={p.headshot}
          alt={p.name}
          className="h-full w-full object-cover object-[50%_22%]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs font-bold">
          {p.team}
        </div>
      )}
    </div>
  );
}

function normalizePersonName(name: string | null) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function jumperCandidate(game: Game, name: string | null, team: string) {
  if (!name) return null;
  const target = normalizePersonName(name);
  const exact = game.candidates.find(
    (p) => p.team === team && normalizePersonName(p.name) === target,
  );
  if (exact) return exact;
  const last = name.trim().toLowerCase().split(/\s+/).pop();
  return (
    game.candidates.find(
      (p) =>
        p.team === team &&
        p.name.trim().toLowerCase().split(/\s+/).pop() === last,
    ) || null
  );
}

function TipHeadshot({
  player,
  name,
  team,
}: {
  player: Candidate | null;
  name: string | null;
  team: string;
}) {
  return (
    <div className="relative mx-auto h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-background/80 bg-muted shadow-md sm:h-[72px] sm:w-[72px]">
      {player?.headshot ? (
        <img
          src={player.headshot}
          alt={name || `${team} jump-ball player`}
          className="h-full w-full object-cover object-[50%_20%]"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{
            backgroundColor: WNBA_TEAM_BG[team.toUpperCase()] || "#1F2937",
          }}
        >
          <img
            src={wnbaLogo(team)}
            alt={`${team} logo`}
            className="h-11 w-11 object-contain"
          />
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-background/45 px-3 py-2">
      <div className="text-[8px] uppercase tracking-[.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm font-bold">{value}</div>
      {sub ? (
        <div className="mt-0.5 text-[8px] text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

function CandidateRow({ p, projected, verifiedWinner = false }: { p: Candidate; projected: boolean; verifiedWinner?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const t = tier(p);
  const m = p.marketOdds;
  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className={`relative w-full rounded-xl border text-left transition-all ${verifiedWinner ? "animate-pulse border-emerald-400 bg-emerald-500/15 shadow-[0_0_14px_rgba(34,197,94,.75),0_0_34px_rgba(34,197,94,.38)] ring-1 ring-emerald-400/70" : t.row}`}
      aria-expanded={expanded}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3">
        <PlayerHeadshot p={p} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-bold">
              #{p.rank} {p.name}
            </span>
            <Badge variant="secondary" className="text-[8px]">
              {p.team}
            </Badge>
            {verifiedWinner ? (
              <Badge className="border-emerald-300/70 bg-emerald-500 text-[8px] font-black text-white shadow-[0_0_12px_rgba(34,197,94,.75)]">
                ✓ VERIFIED FIRST BASKET
              </Badge>
            ) : null}
            <Badge variant="outline" className={`text-[8px] ${t.badge}`}>
              {t.label}
            </Badge>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {p.position} · {p.avgPoints.toFixed(1)} PPG · {p.avgFga.toFixed(1)}{" "}
            FGA · {p.avgMinutes.toFixed(1)} MIN
          </div>
          {m ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px]">
              <span className="font-semibold text-blue-600 dark:text-blue-300">
                Best {m.bestOddsDisplay} · {m.bestBook}
              </span>
              <span className="text-muted-foreground">
                FD {american(m.fanduelOdds)} · DK {american(m.draftkingsOdds)}
              </span>
              <span
                className={
                  m.edgePoints >= 0
                    ? "text-blue-600 dark:text-blue-300"
                    : "text-muted-foreground"
                }
              >
                Edge {m.edgePoints >= 0 ? "+" : ""}
                {m.edgePoints.toFixed(1)} pts · EV{" "}
                {m.expectedValue >= 0 ? "+" : ""}
                {(m.expectedValue * 100).toFixed(0)}%
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="font-mono text-xl font-black">
              {p.probability.toFixed(1)}%
            </div>
            <div className="text-[8px] uppercase tracking-[.12em] text-muted-foreground">
              {projected ? "preview" : "model"}
            </div>
          </div>
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </div>
      </div>
      {expanded ? (
        <div className="grid grid-cols-2 gap-2 border-t border-border/50 p-3 sm:grid-cols-4">
          <Metric
            label="Verified FB"
            value={`${p.currentFirstBaskets}/${p.currentGamesTracked}`}
            sub={rate(p.currentFirstBaskets, p.currentGamesTracked)}
          />
          <Metric
            label="Opening FGA"
            value={pct(p.openingFirstShotRate)}
            sub={`${pct(p.openingShotFgPct)} FG`}
          />
          <Metric
            label="Season Starts"
            value={`${p.seasonStarts}`}
            sub={`${p.avgMinutes.toFixed(1)} min/game`}
          />
          <Metric
            label="Shooting"
            value={`${p.fgPct.toFixed(1)}%`}
            sub={`${p.avgFga.toFixed(1)} FGA/game`}
          />
        </div>
      ) : null}
    </button>
  );
}

function StrongestCard({ game, p }: { game: Game; p: Candidate }) {
  const best = p.rank === 1;
  return (
    <article
      className={`relative isolate overflow-hidden rounded-xl border shadow-sm ${best ? "border-emerald-500/30 bg-emerald-500/[.05]" : "border-primary/20 bg-card"}`}
    >
      <ArenaBackdrop homeTeam={game.homeTeam} />
      <div className="relative z-10">
        <div
          className={`flex items-center justify-between gap-3 border-b px-4 py-3 ${best ? "bg-emerald-500/[.08]" : "bg-background/55"}`}
        >
          <div>
            <div className="text-[10px] text-muted-foreground">
              {game.awayTeam} @ {game.homeTeam} · {time(game.date)}
            </div>
            <div className="mt-0.5 text-sm font-bold">{p.name}</div>
          </div>
          <div className="text-right">
            <Badge
              className={
                best
                  ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                  : "bg-primary/10 text-primary border-primary/25"
              }
            >
              {best ? "BEST PLAY" : "STRONG PLAY"}
            </Badge>
            <div className="mt-1 font-mono text-lg font-black">
              {p.probability.toFixed(1)}%
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-background/42 p-4 backdrop-blur-[2px]">
          <PlayerHeadshot p={p} large />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-[9px]">
                {p.team}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {game.lineupStatus === "confirmed"
                  ? "Confirmed starters"
                  : "Projected lineup"}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {p.position} · {p.avgPoints.toFixed(1)} PPG ·{" "}
              {p.avgFga.toFixed(1)} FGA
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Verified FB: {p.currentFirstBaskets}/{p.currentGamesTracked} (
              {rate(p.currentFirstBaskets, p.currentGamesTracked)})
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function tipLine(team: string, wins: number, events: number, p: number | null) {
  return events > 0
    ? `${wins}/${events} verified jumps`
    : `${team} tip sample building`;
}

function TipCard({ game }: { game: Game }) {
  const t = game.tipSignal;
  const awayJumperPlayer = jumperCandidate(game, t.awayJumper, game.awayTeam);
  const homeJumperPlayer = jumperCandidate(game, t.homeJumper, game.homeTeam);
  const bothRates =
    t.awayTipPct !== null &&
    t.homeTipPct !== null &&
    t.awayTipPct !== t.homeTipPct;
  const awayFavored = bothRates
    ? (t.awayTipPct as number) > (t.homeTipPct as number)
    : t.projectedFirstPossessionTeam === game.awayTeam;
  const homeFavored = bothRates
    ? (t.homeTipPct as number) > (t.awayTipPct as number)
    : t.projectedFirstPossessionTeam === game.homeTeam;
  const hasLean = awayFavored || homeFavored;
  const awayClass = hasLean
    ? awayFavored
      ? "border-emerald-500/35 bg-emerald-500/[.08]"
      : "border-red-500/30 bg-red-500/[.06]"
    : "border-border/60 bg-background/40";
  const homeClass = hasLean
    ? homeFavored
      ? "border-emerald-500/35 bg-emerald-500/[.08]"
      : "border-red-500/30 bg-red-500/[.06]"
    : "border-border/60 bg-background/40";

  return (
    <div className="rounded-xl border border-border/70 bg-background/65 p-3 backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CircleDot className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold">Opening possession</span>
        </div>
        <div className="flex items-center gap-1.5">
          {!hasLean ? (
            <Badge
              variant="outline"
              className="border-yellow-500/35 bg-yellow-500/10 text-[8px] text-yellow-700 dark:text-yellow-300"
            >
              LEAN PENDING
            </Badge>
          ) : null}
          <Badge variant="outline" className="text-[8px]">
            {t.confidence.toUpperCase()}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 sm:gap-3">
        <div
          className={`rounded-xl border p-3 text-center transition-colors ${awayClass}`}
        >
          <TipHeadshot
            player={awayJumperPlayer}
            name={t.awayJumper}
            team={game.awayTeam}
          />
          <div
            className={`mt-2 truncate text-xs font-black ${hasLean ? (awayFavored ? "text-emerald-600 dark:text-emerald-300" : "text-red-500") : ""}`}
          >
            {t.awayJumper || "Tipper pending"}
          </div>
          <div className="mt-1 flex items-center justify-center gap-1.5">
            <TeamLogo team={game.awayTeam} size="sm" />
            <span className="text-[9px] font-bold text-muted-foreground">
              {game.awayTeam}
            </span>
          </div>
          <div
            className={`mt-2 font-mono text-xl font-black ${hasLean ? (awayFavored ? "text-emerald-600 dark:text-emerald-300" : "text-red-500") : ""}`}
          >
            {pct(t.awayTipPct)}
          </div>
          <div className="mt-0.5 text-[8px] uppercase tracking-[.1em] text-muted-foreground">
            verified tip rate
          </div>
          <div className="mt-2 text-[9px] text-muted-foreground">
            {tipLine(
              game.awayTeam,
              t.awayTipWins,
              t.awayTipEvents,
              t.awayTipPct,
            )}
          </div>
        </div>

        <div className="flex flex-col items-center justify-center px-0.5 text-center">
          <div className="rounded-full border bg-background/70 px-2 py-1 text-[9px] font-black tracking-[.15em] text-muted-foreground shadow-sm">
            VS
          </div>
          <div className="mt-1 text-[7px] uppercase tracking-[.12em] text-muted-foreground/70">
            jump ball
          </div>
        </div>

        <div
          className={`rounded-xl border p-3 text-center transition-colors ${homeClass}`}
        >
          <TipHeadshot
            player={homeJumperPlayer}
            name={t.homeJumper}
            team={game.homeTeam}
          />
          <div
            className={`mt-2 truncate text-xs font-black ${hasLean ? (homeFavored ? "text-emerald-600 dark:text-emerald-300" : "text-red-500") : ""}`}
          >
            {t.homeJumper || "Tipper pending"}
          </div>
          <div className="mt-1 flex items-center justify-center gap-1.5">
            <TeamLogo team={game.homeTeam} size="sm" />
            <span className="text-[9px] font-bold text-muted-foreground">
              {game.homeTeam}
            </span>
          </div>
          <div
            className={`mt-2 font-mono text-xl font-black ${hasLean ? (homeFavored ? "text-emerald-600 dark:text-emerald-300" : "text-red-500") : ""}`}
          >
            {pct(t.homeTipPct)}
          </div>
          <div className="mt-0.5 text-[8px] uppercase tracking-[.1em] text-muted-foreground">
            verified tip rate
          </div>
          <div className="mt-2 text-[9px] text-muted-foreground">
            {tipLine(
              game.homeTeam,
              t.homeTipWins,
              t.homeTipEvents,
              t.homeTipPct,
            )}
          </div>
        </div>
      </div>

      {hasLean ? (
        <div className="mt-3 border-t border-border/50 pt-2 text-center text-[9px] text-muted-foreground">
          Projected first possession:{" "}
          <span className="font-bold text-emerald-600 dark:text-emerald-300">
            {awayFavored ? game.awayTeam : game.homeTeam}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function GameCard({ game, showAll }: { game: Game; showAll: boolean }) {
  const [expanded, setExpanded] = useState(showAll);
  const confirmed = game.lineupStatus === "confirmed";
  return (
    <article className="relative isolate overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md">
      <ArenaBackdrop homeTeam={game.homeTeam} />
      <div className="relative z-10">
        <div className="border-b bg-background/55 p-4 backdrop-blur-[2px]">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="flex items-center gap-3">
              <TeamLogo team={game.awayTeam} size="md" />
              <div>
                <div className="text-sm font-black">{game.awayTeam}</div>
                <div className="max-w-[130px] truncate text-[9px] text-muted-foreground">
                  {game.awayName}
                </div>
              </div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">
                First Basket
              </div>
              <div className="mt-1 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {time(game.date)}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 text-right">
              <div>
                <div className="text-sm font-black">{game.homeTeam}</div>
                <div className="max-w-[130px] truncate text-[9px] text-muted-foreground">
                  {game.homeName}
                </div>
              </div>
              <TeamLogo team={game.homeTeam} size="md" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {confirmed ? (
              <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                STARTERS CONFIRMED
              </Badge>
            ) : game.lineupStatus === "waiting" ? (
              <Badge variant="outline">WAITING FOR LINEUP</Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-yellow-500/35 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"
              >
                PROJECTED LINEUP
              </Badge>
            )}
            <Badge variant="outline">{game.status}</Badge>
          </div>
        </div>
        <div className="space-y-3 bg-background/48 p-4 backdrop-blur-[2px]">
          <TipCard game={game} />
          {game.candidates.length ? (
            <div className="rounded-xl border border-border/70 bg-background/62 p-3 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <div>
                  <div className="text-xs font-bold">Player rankings</div>
                  <div className="mt-0.5 text-[9px] text-muted-foreground">
                    Tap a player to reveal verified first-basket and
                    opening-shot details.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[8px]">
                    {game.candidates.length} players
                  </Badge>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </div>
              </button>
              {expanded ? (
                <div className="mt-3 space-y-2">
                  {game.candidates.map((p) => (
                    <CandidateRow
                      key={`${game.id}-${p.team}-${p.name}`}
                      p={p}
                      projected={!confirmed}
                      verifiedWinner={Boolean(
                        game.verifiedFirstScorer &&
                        normalizePersonName(p.name) === normalizePersonName(game.verifiedFirstScorer) &&
                        p.team.toUpperCase() === (game.verifiedFirstScorerTeam || "").toUpperCase()
                      )}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed bg-background/50 p-5 text-center text-xs text-muted-foreground">
              Player model data is still building for this matchup.
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function HistoryTable({
  rows,
  season,
}: {
  rows: HistoryRow[];
  season: number;
}) {
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-semibold">
          {season} verified First Basket sample
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          This is not labeled full-season until every game is reconstructed.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/20 text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Player</th>
              <th className="px-3 py-2 text-left">Team</th>
              <th className="px-3 py-2 text-right">Verified FB</th>
              <th className="px-3 py-2 text-right">Verified starter games</th>
              <th className="px-4 py-2 text-right">Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r) => (
                <tr
                  key={`${season}-${r.team}-${r.playerName}`}
                  className="border-t"
                >
                  <td className="px-4 py-2 font-medium">{r.playerName}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.team}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.fbScored}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.verifiedStarterGames}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">
                    {pct(r.rate)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  Strict verified history is rebuilding.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  value,
  label,
  detail,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border bg-card/85 p-4 shadow-sm">
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg border bg-muted/25">
        {icon}
      </div>
      <div className="font-mono text-2xl font-black">{value}</div>
      <div className="mt-0.5 text-xs font-bold">{label}</div>
      <div className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
        {detail}
      </div>
    </div>
  );
}

export default function WNBA() {
  const [section, setSection] = useState<Section>("games");
  const [showAll, setShowAll] = useState(true);
  const slate = useQuery<Slate>({
    queryKey: ["/api/wnba/first-basket"],
    staleTime: 60000,
    refetchInterval: 120000,
  });
  const history = useQuery<HistoryPayload>({
    queryKey: ["/api/wnba/history"],
    staleTime: 60000,
    refetchInterval: 180000,
  });
  if (slate.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-28" />
        <Skeleton className="h-80" />
      </div>
    );

  const games = slate.data?.games ?? [];
  const topPicks = games
    .map((g) => g.topPick)
    .filter((p): p is Candidate => Boolean(p));
  const avgTopProbability = topPicks.length
    ? topPicks.reduce((sum, p) => sum + p.probability, 0) / topPicks.length
    : null;
  const topGame = games
    .filter((g) => g.topPick)
    .sort(
      (a, b) => (b.topPick?.probability ?? 0) - (a.topPick?.probability ?? 0),
    )[0];
  const teamScores = new Map<string, { total: number; count: number }>();
  for (const g of games)
    for (const p of g.candidates.slice(0, 3)) {
      const v = teamScores.get(p.team) || { total: 0, count: 0 };
      v.total += p.probability;
      v.count++;
      teamScores.set(p.team, v);
    }
  const topTeam =
    [...teamScores.entries()]
      .map(([team, v]) => ({ team, score: v.total / v.count }))
      .sort((a, b) => b.score - a.score)[0] || null;
  const tipEdges = games
    .flatMap((g) => [
      {
        team: g.awayTeam,
        jumper: g.tipSignal.awayJumper,
        pct: g.tipSignal.awayTipPct,
        events: g.tipSignal.awayTipEvents,
      },
      {
        team: g.homeTeam,
        jumper: g.tipSignal.homeJumper,
        pct: g.tipSignal.homeTipPct,
        events: g.tipSignal.homeTipEvents,
      },
    ])
    .filter((x) => x.pct !== null && x.events > 0)
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  const topTip = tipEdges[0] || null;
  const strongest = games
    .flatMap((game) =>
      game.candidates
        .slice(0, 2)
        .filter((p) => p.probability >= 10)
        .map((p) => ({ game, p })),
    )
    .sort((a, b) => a.p.rank - b.p.rank || b.p.probability - a.p.probability);

  return (
    <div className="-mx-4 -mt-8 md:-mx-6 lg:-mx-8">
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 md:px-6 lg:px-8">
          <div className="flex overflow-x-auto">
            <button
              onClick={() => setSection("games")}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-4 text-xs ${section === "games" ? "border-primary font-semibold" : "border-transparent text-muted-foreground"}`}
            >
              <Target className="h-3.5 w-3.5" />
              First Baskets
            </button>
            <button
              onClick={() => setSection("opening-tips")}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-4 text-xs ${section === "opening-tips" ? "border-primary font-semibold" : "border-transparent text-muted-foreground"}`}
            >
              <CircleDot className="h-3.5 w-3.5" />
              Opening Tips
            </button>
            <button
              onClick={() => setSection("strongest")}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-4 text-xs ${section === "strongest" ? "border-primary font-semibold" : "border-transparent text-muted-foreground"}`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Strongest Play
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              slate.refetch();
              history.refetch();
            }}
            className="shrink-0 gap-2"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${slate.isFetching || history.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-black">WNBA First Basket</h1>
            </div>
            <p className="max-w-3xl text-xs text-muted-foreground">
              {section === "strongest"
                ? "Only the strongest WNBA First Basket plays from today’s slate."
                : "A clearer game-by-game view of opening possession, model probability, verified first-basket history, and live market value when available."}
            </p>
          </div>
          {section === "games" ? (
            <button
              type="button"
              role="switch"
              aria-checked={showAll}
              onClick={() => setShowAll((v) => !v)}
              className="hidden items-center gap-2 rounded-full border bg-card px-3 py-2 text-xs font-medium shadow-sm transition-colors hover:bg-muted/40 md:flex"
            >
              <span>Expand rankings</span>
              <span
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showAll ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${showAll ? "translate-x-4" : "translate-x-0.5"}`}
                />
              </span>
            </button>
          ) : null}
        </div>

        {section === "opening-tips" ? (
          <>
            <div className="mb-4 rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <CircleDot className="h-4 w-4 text-primary" />
                <div className="text-sm font-semibold">WNBA Opening Tips</div>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Jump-ball matchups, verified tip rates, projected first
                possession, and confidence from the same opening-tip data used
                by the First Basket model.
              </div>
            </div>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              {games.map((game) => (
                <article
                  key={`tip-${game.id}`}
                  className="relative isolate overflow-hidden rounded-2xl border bg-card shadow-sm"
                >
                  <ArenaBackdrop homeTeam={game.homeTeam} />
                  <div className="relative z-10">
                    <div className="border-b bg-background/55 p-4 backdrop-blur-[2px]">
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                        <div className="flex items-center gap-3">
                          <TeamLogo team={game.awayTeam} size="md" />
                          <div>
                            <div className="text-sm font-black">
                              {game.awayTeam}
                            </div>
                            <div className="max-w-[130px] truncate text-[9px] text-muted-foreground">
                              {game.awayName}
                            </div>
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">
                            Opening Tip
                          </div>
                          <div className="mt-1 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {time(game.date)}
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-3 text-right">
                          <div>
                            <div className="text-sm font-black">
                              {game.homeTeam}
                            </div>
                            <div className="max-w-[130px] truncate text-[9px] text-muted-foreground">
                              {game.homeName}
                            </div>
                          </div>
                          <TeamLogo team={game.homeTeam} size="md" />
                        </div>
                      </div>
                    </div>
                    <div className="bg-background/48 p-4 backdrop-blur-[2px]">
                      <TipCard game={game} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : section === "games" ? (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SummaryCard
                icon={<Activity className="h-4 w-4 text-primary" />}
                value={`${games.length}`}
                label="Today's Games"
                detail="Every matchup on the current WNBA slate."
              />
              <SummaryCard
                icon={<Target className="h-4 w-4 text-emerald-500" />}
                value={
                  avgTopProbability === null
                    ? "—"
                    : `${avgTopProbability.toFixed(1)}%`
                }
                label="Avg #1 Probability"
                detail="Average model probability for each game's top-ranked scorer."
              />
              <SummaryCard
                icon={<CircleDot className="h-4 w-4 text-cyan-500" />}
                value={topTip?.jumper || topTip?.team || "—"}
                label="Top Jump Ball"
                detail={
                  topTip
                    ? `${topTip.team} · ${pct(topTip.pct)} verified tip rate`
                    : "Waiting for verified tip data."
                }
              />
              <SummaryCard
                icon={<Trophy className="h-4 w-4 text-yellow-500" />}
                value={topTeam?.team || topGame?.topPick?.team || "—"}
                label="Top Team Today"
                detail={
                  topGame?.topPick
                    ? `${topGame.topPick.name} leads at ${topGame.topPick.probability.toFixed(1)}%.`
                    : "Waiting for player model data."
                }
              />
            </div>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              {games.map((g) => (
                <GameCard key={g.id} game={g} showAll={showAll} />
              ))}
            </div>
          </>
        ) : section === "strongest" ? (
          <>
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-sm">
              <div>
                <div className="text-sm font-semibold">
                  Strongest WNBA plays
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Only each game's #1 Best Play and #2 Strong Play appear when
                  model probability is at least 10%. Market Value remains
                  separate and only appears when real odds clear the edge/EV
                  threshold.
                </div>
              </div>
              <Badge variant="outline">{strongest.length} plays</Badge>
            </div>
            {strongest.length ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {strongest.map(({ game, p }) => (
                  <StrongestCard
                    key={`${game.id}-${p.team}-${p.name}`}
                    game={game}
                    p={p}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border bg-card p-8 text-center">
                <div className="text-sm font-semibold">
                  No strongest plays available yet.
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  They will appear automatically when today's WNBA model has
                  qualifying plays.
                </div>
              </div>
            )}
          </>
        ) : history.isLoading ? (
          <Skeleton className="h-96" />
        ) : (
          <>
            <div className="mb-4 rounded-md border bg-card p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 text-yellow-500" />
                <div>
                  <div className="text-xs font-semibold">
                    History rebuild status:{" "}
                    {history.data?.status ?? "rebuilding"}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {history.data?.note}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Verified games: {history.data?.verifiedGames ?? 0}
                    {history.data?.coverageStart
                      ? ` · coverage ${new Date(history.data.coverageStart).toLocaleDateString()} to ${new Date(history.data?.coverageEnd || history.data.coverageStart).toLocaleDateString()}`
                      : ""}
                  </div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <HistoryTable
                rows={history.data?.current ?? []}
                season={
                  history.data?.currentSeason ?? new Date().getUTCFullYear()
                }
              />
              <HistoryTable
                rows={history.data?.previous ?? []}
                season={
                  history.data?.previousSeason ??
                  new Date().getUTCFullYear() - 1
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
