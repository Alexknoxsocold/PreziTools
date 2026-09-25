import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Clock, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import BestPlaysSportsSky from "@/components/BestPlaysSportsSky";

type Pitcher = { name?: string | null; headshot?: string | null };
type MlbTeam =
  | string
  | {
      abbreviation?: string;
      name?: string;
      logo?: string | null;
      pitcher?: Pitcher;
    };
type MlbGame = {
  gamePk?: number;
  id?: string;
  away?: MlbTeam;
  home?: MlbTeam;
  gameTime?: string;
  date?: string;
  shortName?: string;
  recommendation?: string;
  pick?: string;
  playStatus?: "BEST_PLAY" | "PLAY" | "LEAN" | "NO_PLAY";
  confidence?: string;
  nrfiProbability?: number;
  yrfiProbability?: number;
  probability?: number;
  modelEdge?: number;
  edge?: number;
  marketValue?: {
    available?: boolean;
    book?: string | null;
    price?: number | null;
    edge?: number | null;
    ev?: number | null;
    valuePlay?: boolean;
  } | null;
};
type MlbHrMarket = {
  bestOdds: number;
  bestBook: string;
  consensusImpliedProbability: number;
  modelEdge: number;
  expectedValue: number;
  priceVerified: boolean;
  valueTier: "BEST_VALUE" | "VALUE" | "NONE";
};
type MlbHrCandidate = {
  gamePk: number;
  gameTime: string;
  playerId: number;
  player: string;
  team: string;
  opponent: string;
  headshot: string;
  battingOrder: number | null;
  lineupConfirmed: boolean;
  probability: number;
  confidence: number;
  tier: "POWER_PLAY" | "STRONG" | "WATCH";
  season: { plateAppearances: number; homeRuns: number; homeRunRate: number };
  probablePitcher: string | null;
  market?: MlbHrMarket | null;
};
type MlbHrPayload = {
  strongest: MlbHrCandidate[];
  watchlist: MlbHrCandidate[];
  valuePlays?: MlbHrCandidate[];
};
type WnbaMarketOdds = {
  bestOdds: number;
  bestOddsDisplay: string;
  bestBook: string;
  fanduelOdds: number | null;
  draftkingsOdds: number | null;
  edgePoints: number;
  expectedValue: number;
  qualifiesValue: boolean;
};
type WnbaCandidate = {
  name: string;
  team: string;
  probability: number;
  rank: number;
  headshot?: string | null;
  marketOdds?: WnbaMarketOdds | null;
};
type WnbaGame = {
  id: string;
  date: string;
  awayTeam: string;
  homeTeam: string;
  status?: string;
  lineupStatus: string;
  candidates: WnbaCandidate[];
  topPick: WnbaCandidate | null;
};
type WnbaSlate = { games: WnbaGame[] };
type NflTdPick = {
  player: string;
  team?: string;
  headshot?: string;
  bestOdds: number;
  bestBook: string;
  modelProbability?: number;
  edgePoints?: number;
  expectedValue?: number;
  qualifies?: boolean;
};
type NflTdGame = {
  id: string;
  date: string;
  away: { abbreviation: string; name: string; logo: string | null };
  home: { abbreviation: string; name: string; logo: string | null };
  anytimeTd: NflTdPick[];
  firstTd: NflTdPick[];
};
type NflMarkets = { games: NflTdGame[] };
type NbaGame = {
  id: string;
  awayTeam: string;
  homeTeam: string;
  gameTime?: string | null;
  gameDate?: string | null;
};
type NbaPlayer = {
  player: string;
  team: string;
  firstBasketPct: number;
  liveOdds?: string;
  liveOddsSource?: string;
  liveOddsSportsbook?: string;
  headshot?: string | null;
  injuryStatus?: string;
  isStarter?: boolean;
};
type Play = {
  id: string;
  sport: "MLB" | "NBA" | "WNBA" | "NFL";
  market: string;
  matchup: string;
  pick: string;
  probability: number;
  time: string;
  tier: "BEST PLAY" | "STRONG PLAY" | "VALUE";
  note: string;
  /** Existing model-qualified EV, normalized to percentage points for curation only. */
  valueScore?: number;
  href: string;
  headshot?: string | null;
  awayLogo?: string | null;
  homeLogo?: string | null;
  awayAbbr?: string;
  homeAbbr?: string;
  awayPitcher?: Pitcher | null;
  homePitcher?: Pitcher | null;
};
type Filter =
  "ALL" | "MLB" | "HOME RUNS" | "NRFI/YRFI" | "NBA" | "WNBA" | "NFL";

const PAGE_SIZE = 10;
const BEST_PLAYS_CACHE_KEY = "prezitools.best-plays.v1";
const BEST_PLAYS_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const FILTERS: Filter[] = [
  "ALL",
  "MLB",
  "HOME RUNS",
  "NRFI/YRFI",
  "NBA",
  "WNBA",
  "NFL",
];
function gameTime(v: string) {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "Time pending"
    : d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      }) + " ET";
}
function tier(prob: number): Play["tier"] {
  return prob >= 62 ? "BEST PLAY" : prob >= 56 ? "STRONG PLAY" : "VALUE";
}
function tierClass(t: Play["tier"]) {
  return t === "BEST PLAY"
    ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
    : t === "STRONG PLAY"
      ? "bg-primary/10 text-primary border-primary/25"
      : "bg-yellow-500/15 text-yellow-600 border-yellow-500/30";
}
function railClass(t: Play["tier"]) {
  return t === "BEST PLAY"
    ? "bg-emerald-500"
    : t === "STRONG PLAY"
      ? "bg-primary"
      : "bg-yellow-500";
}
function probabilityClass(p: Play) {
  const m = p.market.toLowerCase(),
    v = p.probability;
  if (m.includes("first basket") || m.includes("first td"))
    return v >= 18
      ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,.14)]"
      : v >= 12
        ? "border-cyan-400/45 bg-cyan-500/12 text-cyan-300"
        : v >= 8
          ? "border-amber-400/45 bg-amber-500/12 text-amber-300"
          : "border-border/60 bg-muted/35 text-muted-foreground";
  if (m.includes("anytime td"))
    return v >= 35
      ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-300"
      : v >= 25
        ? "border-cyan-400/45 bg-cyan-500/12 text-cyan-300"
        : v >= 18
          ? "border-amber-400/45 bg-amber-500/12 text-amber-300"
          : "border-border/60 bg-muted/35 text-muted-foreground";
  if (m.includes("home run") || m.includes("hr"))
    return v >= 30
      ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-300"
      : v >= 22
        ? "border-cyan-400/45 bg-cyan-500/12 text-cyan-300"
        : v >= 18
          ? "border-amber-400/45 bg-amber-500/12 text-amber-300"
          : "border-border/60 bg-muted/35 text-muted-foreground";
  return v >= 62
    ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-300"
    : v >= 56
      ? "border-cyan-400/45 bg-cyan-500/12 text-cyan-300"
      : v >= 53.5
        ? "border-amber-400/45 bg-amber-500/12 text-amber-300"
        : "border-border/60 bg-muted/35 text-muted-foreground";
}
function americanOdds(v: number | null) {
  if (v === null) return "";
  return v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`;
}
function teamName(team: MlbTeam | undefined) {
  if (typeof team === "string") return team;
  if (!team) return "TBD";
  return team.abbreviation || team.name || "TBD";
}
function isHr(p: Play) {
  return p.id.startsWith("mlb-hr-");
}
function selectionGroup(p: Play) {
  if (isHr(p)) return "MLB:HR";
  if (p.sport === "MLB") return "MLB:NRFI/YRFI";
  if (p.sport === "NBA") return "NBA:First Basket";
  if (p.sport === "WNBA") return "WNBA:First Basket";
  if (p.market === "First TD" || p.market === "Anytime TD")
    return `NFL:${p.market}`;
  return `${p.sport}:${p.market}`;
}
function filterPlay(p: Play, f: Filter) {
  if (f === "ALL") return true;
  if (f === "HOME RUNS") return isHr(p);
  if (f === "NRFI/YRFI")
    return (
      p.sport === "MLB" &&
      !isHr(p) &&
      (p.market === "NRFI" || p.market === "YRFI")
    );
  return p.sport === f;
}
const ESPN_MLB_ABBR: Record<string, string> = {
  AZ: "ari",
  ARI: "ari",
  ATH: "ath",
  OAK: "ath",
  ATL: "atl",
  BAL: "bal",
  BOS: "bos",
  CHC: "chc",
  CWS: "chw",
  CHW: "chw",
  CIN: "cin",
  CLE: "cle",
  COL: "col",
  DET: "det",
  HOU: "hou",
  KC: "kc",
  KCR: "kc",
  LAA: "laa",
  LAD: "lad",
  MIA: "mia",
  MIL: "mil",
  MIN: "min",
  NYM: "nym",
  NYY: "nyy",
  PHI: "phi",
  PIT: "pit",
  SD: "sd",
  SDP: "sd",
  SEA: "sea",
  SF: "sf",
  SFG: "sf",
  STL: "stl",
  TB: "tb",
  TBR: "tb",
  TEX: "tex",
  TOR: "tor",
  WSH: "wsh",
  WAS: "wsh",
};
const MLB_TEAM_BG: Record<string, string> = {
  ARI: "#FFF4F5",
  AZ: "#FFF4F5",
  ATH: "#FFF8D8",
  OAK: "#FFF8D8",
  ATL: "#FFF3F5",
  BAL: "#FFF3E8",
  BOS: "#FFF2F3",
  CHC: "#FFFFFF",
  CWS: "#F1F3F5",
  CHW: "#F1F3F5",
  CIN: "#FFF1F2",
  CLE: "#FFFFFF",
  COL: "#F3F0FF",
  DET: "#FFFFFF",
  HOU: "#FFF1E8",
  KC: "#FFFFFF",
  KCR: "#FFFFFF",
  LAA: "#FFFFFF",
  LAD: "#FFFFFF",
  MIA: "#FFFFFF",
  MIL: "#FFF6D8",
  MIN: "#FFFFFF",
  NYM: "#FFF2E8",
  NYY: "#FFFFFF",
  PHI: "#FFFFFF",
  PIT: "#1F2937",
  SD: "#FFF1D6",
  SDP: "#FFF1D6",
  SEA: "#E9FFFB",
  SF: "#FFF0E6",
  SFG: "#FFF0E6",
  STL: "#FFFFFF",
  TB: "#FFF8D8",
  TBR: "#FFF8D8",
  TEX: "#FFFFFF",
  TOR: "#FFFFFF",
  WSH: "#FFFFFF",
  WAS: "#FFFFFF",
};
function fallbackMlbLogo(abbr: string | undefined) {
  if (!abbr || abbr === "TBD") return null;
  const key = abbr.toUpperCase(),
    espn = ESPN_MLB_ABBR[key] || key.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${espn}.png`;
}
function teamLogo(team: MlbTeam | undefined) {
  if (typeof team === "object" && team?.logo) return team.logo;
  return fallbackMlbLogo(teamName(team));
}
function pitcher(team: MlbTeam | undefined) {
  return typeof team === "object" && team?.pitcher ? team.pitcher : null;
}
function activeEtDateISO() {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  const target = hour >= 23 ? new Date(now.getTime() + 86400000) : now;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(target);
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`;
}
function readCachedBestPlays(): Play[] {
  if (typeof window === "undefined") return [];
  try {
    const cached = JSON.parse(localStorage.getItem(BEST_PLAYS_CACHE_KEY) || "null") as {
      date?: string;
      savedAt?: number;
      plays?: Play[];
    } | null;
    if (
      !cached ||
      cached.date !== activeEtDateISO() ||
      !Number.isFinite(cached.savedAt) ||
      Date.now() - Number(cached.savedAt) > BEST_PLAYS_CACHE_MAX_AGE_MS ||
      !Array.isArray(cached.plays)
    ) {
      return [];
    }
    return cached.plays.filter((play) => {
      const start = new Date(play.time).getTime();
      return (
        typeof play.id === "string" &&
        typeof play.pick === "string" &&
        !(play.sport === "NFL" && play.market.toLowerCase().includes("moneyline")) &&
        Number.isFinite(play.probability) &&
        Number.isFinite(start) &&
        start > Date.now()
      );
    });
  } catch {
    return [];
  }
}
function writeCachedBestPlays(plays: Play[]) {
  if (typeof window === "undefined") return;
  try {
    if (!plays.length) {
      localStorage.removeItem(BEST_PLAYS_CACHE_KEY);
      return;
    }
    localStorage.setItem(
      BEST_PLAYS_CACHE_KEY,
      JSON.stringify({ date: activeEtDateISO(), savedAt: Date.now(), plays }),
    );
  } catch {
    // Storage can be unavailable in private/restricted browsing; live queries still work.
  }
}
function nbaGameOnActiveDate(g: NbaGame, dateISO: string) {
  if (g.gameDate && g.gameDate !== "Today") return g.gameDate === dateISO;
  if (g.gameTime) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(g.gameTime));
    return (
      `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}` ===
      dateISO
    );
  }
  return g.gameDate === "Today";
}
function parseAmericanOdds(v?: string) {
  const m = v?.trim().match(/^([+-]?\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n !== 0 ? n : null;
}
function nbaMarketValue(p: NbaPlayer) {
  const odds = parseAmericanOdds(p.liveOdds);
  if (odds === null) return null;
  const implied =
    odds > 0
      ? (100 / (odds + 100)) * 100
      : (Math.abs(odds) / (Math.abs(odds) + 100)) * 100;
  const edge = p.firstBasketPct - implied;
  const prob = Math.max(0, Math.min(1, p.firstBasketPct / 100));
  const profit = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  const ev = prob * profit - (1 - prob);
  return { edge, ev, qualifies: edge >= 2.5 && ev >= 0.05 };
}
function isUnavailable(p: NbaPlayer) {
  const s = (p.injuryStatus || "").toLowerCase();
  return s.includes("out") || s.includes("suspend") || s === "inactive";
}
function nbaSourceLabel(p: NbaPlayer) {
  if (p.liveOddsSportsbook) return p.liveOddsSportsbook;
  if (p.liveOddsSource === "espn-core") return "ESPN market feed";
  return "live market";
}
function TeamLogo({ src, abbr }: { src?: string | null; abbr?: string }) {
  const bg = MLB_TEAM_BG[(abbr || "").toUpperCase()] || "#FFFFFF";
  return (
    <div
      className="w-8 h-8 rounded-full border border-black/10 shadow-md flex items-center justify-center overflow-hidden shrink-0 ring-2 ring-card"
      style={{ backgroundColor: bg }}
    >
      {src ? (
        <img
          src={src}
          alt={`${abbr || "Team"} logo`}
          className="w-6 h-6 object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,.18)]"
        />
      ) : (
        <span className="text-[8px] font-black text-slate-900">{abbr}</span>
      )}
    </div>
  );
}
function PlayAvatar({ p, index }: { p: Play; index: number }) {
  if (p.headshot)
    return (
      <div className="w-11 h-11 rounded-full overflow-hidden bg-muted ring-1 ring-border/60">
        <img
          src={p.headshot}
          alt=""
          className="w-full h-full scale-[0.92] origin-bottom object-contain object-bottom"
        />
      </div>
    );
  if (p.awayLogo || p.homeLogo)
    return (
      <div className="relative w-[58px] h-[48px] shrink-0">
        <div className="absolute left-0 top-0">
          <TeamLogo src={p.awayLogo} abbr={p.awayAbbr} />
        </div>
        <div className="absolute right-0 bottom-0">
          <TeamLogo src={p.homeLogo} abbr={p.homeAbbr} />
        </div>
      </div>
    );
  return (
    <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center font-bold text-xs">
      {index + 1}
    </div>
  );
}
function PitcherMatchup({ p }: { p: Play }) {
  if (p.sport !== "MLB" || (!p.awayPitcher && !p.homePitcher))
    return <span>{p.note}</span>;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex -space-x-2 shrink-0">
        {[p.awayPitcher, p.homePitcher].map((x, i) =>
          x?.headshot ? (
            <img
              key={i}
              src={x.headshot}
              alt={x.name || "Pitcher"}
              className="w-8 h-8 rounded-full object-cover object-top border-2 border-card bg-muted"
            />
          ) : (
            <span
              key={i}
              className="w-8 h-8 rounded-full border-2 border-card bg-muted"
            />
          ),
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-[.14em] text-muted-foreground">
          Pitcher matchup
        </div>
        <div className="text-[10px] font-medium truncate">
          {p.awayPitcher?.name || "TBD"} vs {p.homePitcher?.name || "TBD"}
        </div>
      </div>
    </div>
  );
}

export default function BestPlays() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [cachedPlays, setCachedPlays] = useState<Play[]>(readCachedBestPlays);
  const mlb = useQuery<any>({
    queryKey: ["/api/mlb/nrfi"],
    staleTime: 60000,
    refetchInterval: 60000,
    retry: 1,
  });
  const mlbHr = useQuery<MlbHrPayload>({
    queryKey: ["/api/mlb/home-runs"],
    staleTime: 60000,
    refetchInterval: 60000,
    retry: 1,
  });
  const nbaStats = useQuery<NbaPlayer[]>({
    queryKey: ["/api/espn-player-stats"],
    staleTime: 60000,
    refetchInterval: 120000,
    retry: 1,
  });
  const nbaGames = useQuery<NbaGame[]>({
    queryKey: ["/api/games"],
    staleTime: 60000,
    refetchInterval: 120000,
    retry: 1,
  });
  const wnba = useQuery<WnbaSlate>({
    queryKey: ["/api/wnba/first-basket"],
    staleTime: 60000,
    refetchInterval: 120000,
    retry: 1,
  });
  const nflMarkets = useQuery<NflMarkets>({
    queryKey: ["/api/nfl/markets"],
    staleTime: 120000,
    refetchInterval: 300000,
    retry: 1,
  });

  const plays = useMemo(() => {
    const out: Play[] = [];
    const mg: MlbGame[] = Array.isArray(mlb.data)
      ? mlb.data
      : mlb.data?.games || [];
    for (const g of mg) {
      const rec = (g.recommendation || g.pick || "").toUpperCase(),
        status = g.playStatus;
      if (!rec || status === "NO_PLAY" || rec.includes("NO PLAY")) continue;
      const isNrfi = rec.includes("NRFI"),
        nrfi = Number(g.nrfiProbability),
        explicitYrfi = Number(g.yrfiProbability),
        fallback = Number(g.probability),
        p = isNrfi
          ? Number.isFinite(nrfi)
            ? nrfi
            : fallback
          : Number.isFinite(explicitYrfi)
            ? explicitYrfi
            : Number.isFinite(nrfi)
              ? 100 - nrfi
              : fallback;
      if (!Number.isFinite(p)) continue;
      const valueLean =
          status === "LEAN" &&
          g.marketValue?.available === true &&
          g.marketValue?.valuePlay === true,
        edge = Number(g.modelEdge ?? g.edge ?? Math.abs(p - 50)),
        qualifies =
          status === "BEST_PLAY" ||
          status === "PLAY" ||
          valueLean ||
          (!status && edge >= 3.5);
      if (!qualifies || p < 53.5) continue;
      const awayAbbr = teamName(g.away),
        homeAbbr = teamName(g.home),
        id = String(
          g.gamePk ??
            g.id ??
            `${awayAbbr}-${homeAbbr}-${g.date ?? g.gameTime ?? ""}`,
        ),
        playTier =
          status === "BEST_PLAY"
            ? "BEST PLAY"
            : status === "PLAY"
              ? "STRONG PLAY"
              : "VALUE";
      out.push({
        id: `mlb-${id}`,
        sport: "MLB",
        market: isNrfi ? "NRFI" : "YRFI",
        matchup: g.shortName || `${awayAbbr} @ ${homeAbbr}`,
        pick: isNrfi ? "No Run 1st Inning" : "Yes Run 1st Inning",
        probability: p,
        time: g.date || g.gameTime || "",
        tier: playTier,
        note: valueLean
          ? `VALUE LEAN · ${g.marketValue?.price != null ? americanOdds(g.marketValue.price) : "verified price"}${g.marketValue?.book ? ` ${g.marketValue.book}` : ""}${g.marketValue?.edge != null ? ` · +${g.marketValue.edge.toFixed(1)} pt edge` : ""}${g.marketValue?.ev != null ? ` · +${g.marketValue.ev.toFixed(1)}% EV` : ""}`
          : g.confidence
            ? `${g.confidence} confidence`
            : "Model-qualified play",
        valueScore: valueLean ? (g.marketValue?.ev ?? undefined) : undefined,
        href: "/mlb",
        awayLogo: teamLogo(g.away),
        homeLogo: teamLogo(g.home),
        awayAbbr,
        homeAbbr,
        awayPitcher: pitcher(g.away),
        homePitcher: pitcher(g.home),
      });
    }
    const hrCandidates = Array.from(
      new Map(
        [
          ...(mlbHr.data?.strongest || []),
          ...(mlbHr.data?.watchlist || []),
        ].map((p) => [`${p.gamePk}-${p.playerId}`, p]),
      ).values(),
    );
    // Best Plays is intentionally much stricter than the full HR page. HRs should feel rare and hand-picked.
    const hrPlays = hrCandidates
      .filter(
        (p) =>
          p.season.plateAppearances >= 100 &&
          p.lineupConfirmed &&
          p.tier === "POWER_PLAY" &&
          p.confidence >= 80 &&
          p.probability >= 20,
      )
      .sort(
        (a, b) => b.confidence - a.confidence || b.probability - a.probability,
      )
      .slice(0, 2);
    for (const p of hrPlays) {
      const elite =
        p.lineupConfirmed && p.tier === "POWER_PLAY" && p.confidence >= 80;
      out.push({
        id: `mlb-hr-${p.gamePk}-${p.playerId}`,
        sport: "MLB",
        market: p.lineupConfirmed ? "HR Power" : "HR Projected",
        matchup: `${p.team} vs ${p.opponent}`,
        pick: `${p.player} Home Run`,
        probability: p.probability,
        time: p.gameTime,
        tier: p.lineupConfirmed
          ? elite
            ? "BEST PLAY"
            : "STRONG PLAY"
          : "VALUE",
        note: `${p.lineupConfirmed ? "Confirmed lineup" : "PROJECTED · lineup not confirmed"} · ${p.confidence}% confidence · ${p.season.homeRuns} season HR${p.probablePitcher ? ` · vs ${p.probablePitcher}` : ""}`,
        href: "/mlb/home-runs",
        headshot: p.headshot,
      });
    }
    const hrValuePlays = (mlbHr.data?.valuePlays || [])
      .filter(
        (p) =>
          p.season.plateAppearances >= 100 &&
          p.lineupConfirmed &&
          (p.tier === "POWER_PLAY" || p.tier === "STRONG") &&
          p.market?.priceVerified &&
          p.market.valueTier === "BEST_VALUE" &&
          !hrPlays.some(
            (x) => x.gamePk === p.gamePk && x.playerId === p.playerId,
          ),
      )
      .sort(
        (a, b) =>
          (b.market?.expectedValue ?? 0) - (a.market?.expectedValue ?? 0) ||
          (b.market?.modelEdge ?? 0) - (a.market?.modelEdge ?? 0),
      )
      .slice(0, 1);
    for (const p of hrValuePlays) {
      const m = p.market!;
      out.push({
        id: `mlb-hr-value-${p.gamePk}-${p.playerId}`,
        sport: "MLB",
        market: "HR Value",
        matchup: `${p.team} vs ${p.opponent}`,
        pick: `${p.player} Home Run`,
        probability: p.probability,
        time: p.gameTime,
        tier: "VALUE",
        note: `MARKET EDGE · ${m.bestOdds > 0 ? "+" : ""}${Math.round(m.bestOdds)} ${m.bestBook} · ${m.modelEdge >= 0 ? "+" : ""}${m.modelEdge.toFixed(1)} pt edge · ${m.expectedValue >= 0 ? "+" : ""}${m.expectedValue.toFixed(0)}% EV · confirmed lineup`,
        valueScore: m.expectedValue,
        href: "/mlb/home-runs",
        headshot: p.headshot,
      });
    }
    const activeDate = activeEtDateISO();
    const activeNbaGames = (nbaGames.data || []).filter((g) =>
      nbaGameOnActiveDate(g, activeDate),
    );
    for (const g of activeNbaGames) {
      const starters = (nbaStats.data || [])
        .filter(
          (p) =>
            (p.team === g.awayTeam || p.team === g.homeTeam) &&
            p.isStarter &&
            !isUnavailable(p),
        )
        .sort((a, b) => b.firstBasketPct - a.firstBasketPct);
      const top = starters.slice(0, 3);
      for (let i = 0; i < top.length; i++) {
        const p = top[i];
        if (p.firstBasketPct < 10) continue;
        const metrics = nbaMarketValue(p),
          qualifiesTop = i === 0 && p.firstBasketPct >= 12,
          qualifiesValue = !!metrics?.qualifies;
        if (!qualifiesTop && !qualifiesValue) continue;
        out.push({
          id: `nba-${g.id}-${p.team}-${p.player}${qualifiesValue ? "-value" : ""}`,
          sport: "NBA",
          market: qualifiesValue ? "First Basket Value" : "First Basket",
          matchup: `${g.awayTeam} @ ${g.homeTeam}`,
          pick: p.player,
          probability: p.firstBasketPct,
          time: g.gameTime || g.gameDate || "",
          tier: qualifiesValue
            ? "VALUE"
            : p.firstBasketPct >= 18
              ? "BEST PLAY"
              : "STRONG PLAY",
          note:
            qualifiesValue && metrics
              ? `${p.liveOdds} · +${metrics.edge.toFixed(1)} pt edge · ${metrics.ev * 100 >= 0 ? "+" : ""}${(metrics.ev * 100).toFixed(0)}% EV`
              : p.liveOdds
                ? `${p.liveOdds} · ${nbaSourceLabel(p)}`
                : "Top model-ranked starter",
          valueScore:
            qualifiesValue && metrics ? metrics.ev * 100 : undefined,
          href: "/nba",
          headshot: p.headshot ?? null,
        });
      }
    }
    // WNBA First Basket is a specialty market: keep the full rankings on the WNBA page, but only surface a tiny curated slate here.
    const wnbaSelections = (wnba.data?.games || [])
      .filter((g) => new Date(g.date).getTime() > Date.now())
      .flatMap((g) => {
        const confirmed = g.lineupStatus === "confirmed";
        return (g.candidates || [])
          .filter(
            (p) =>
              p.probability >= 10 &&
              (confirmed
                ? p.rank === 1 || p.marketOdds?.qualifiesValue
                : p.rank === 1),
          )
          .map((p) => ({
            g,
            p,
            confirmed,
            value: confirmed && !!p.marketOdds?.qualifiesValue,
          }));
      })
      .sort(
        (a, b) =>
          Number(b.value) - Number(a.value) ||
          b.p.probability - a.p.probability ||
          a.p.rank - b.p.rank,
      )
      .slice(0, 2);
    for (const { g, p, confirmed, value } of wnbaSelections) {
      const m = p.marketOdds;
      out.push({
        id: `wnba-${g.id}-${p.rank}${value ? "-value" : ""}`,
        sport: "WNBA",
        market: value ? "First Basket Value" : "First Basket",
        matchup: `${g.awayTeam} @ ${g.homeTeam}`,
        pick: p.name,
        probability: Math.min(99, Math.max(0, p.probability)),
        time: g.date,
        tier: value ? "VALUE" : confirmed ? "BEST PLAY" : "STRONG PLAY",
        note:
          value && m
            ? `${m.bestOddsDisplay} · ${m.bestBook} · ${m.edgePoints >= 0 ? "+" : ""}${m.edgePoints.toFixed(1)} pt edge · ${m.expectedValue >= 0 ? "+" : ""}${(m.expectedValue * 100).toFixed(0)}% EV`
            : confirmed
              ? "Confirmed starters · slate-selected"
              : "Projected starter · model No. 1 candidate",
        valueScore: value && m ? m.expectedValue * 100 : undefined,
        href: "/wnba",
        headshot: p.headshot ?? null,
      });
    }
    for (const g of nflMarkets.data?.games || []) {
      for (const [market, rows] of [
        ["First TD", g.firstTd],
        ["Anytime TD", g.anytimeTd],
      ] as const) {
        const chosen = rows
          .filter((x) => x.qualifies && x.modelProbability != null)
          .sort(
            (a, b) =>
              (b.expectedValue ?? 0) - (a.expectedValue ?? 0) ||
              (b.edgePoints ?? 0) - (a.edgePoints ?? 0) ||
              (b.modelProbability ?? 0) - (a.modelProbability ?? 0),
          )
          .slice(0, 1);
        for (const p of chosen) {
          if (p.modelProbability == null) continue;
          const edge = p.edgePoints ?? 0,
            ev = p.expectedValue ?? 0;
          if (edge < 2.5 || ev < 0.05) continue;
          out.push({
            id: `nfl-td-${market}-${g.id}-${p.player}`,
            sport: "NFL",
            market,
            matchup: `${g.away.abbreviation} @ ${g.home.abbreviation}`,
            pick: p.player,
            probability: p.modelProbability,
            time: g.date,
            tier: edge >= 5 && ev >= 0.14 ? "BEST PLAY" : "STRONG PLAY",
            note: `OFFICIAL PLAY · ${p.bestOdds > 0 ? "+" : ""}${Math.round(p.bestOdds)} ${p.bestBook} · ${edge >= 0 ? "+" : ""}${edge.toFixed(1)} pt edge · ${ev >= 0 ? "+" : ""}${(ev * 100).toFixed(0)}% EV`,
            href: "/nfl",
            headshot: p.headshot ?? null,
            awayLogo: g.away.logo,
            homeLogo: g.home.logo,
            awayAbbr: g.away.abbreviation,
            homeAbbr: g.home.abbreviation,
          });
        }
      }
    }
    const ranked = out.sort((a, b) => {
      const r = { "BEST PLAY": 0, "STRONG PLAY": 1, VALUE: 2 };
      return (
        r[a.tier] - r[b.tier] ||
        (a.tier === "VALUE" && b.tier === "VALUE"
          ? (b.valueScore ?? -Infinity) - (a.valueScore ?? -Infinity)
          : 0) ||
        b.probability - a.probability
      );
    });
      const caps: Record<string, number> = {
        "MLB:HR": 2,
        "MLB:Value Lean": 1,
        "NBA:First Basket": 3,
        "WNBA:First Basket": 2,
        "NFL:First TD": 2,
        "NFL:Anytime TD": 2,
      },
      counts: Record<string, number> = {};
    // Build one market-aware card from candidates that already cleared their own
    // model gates. A round-robin pass prevents high-base-rate markets from taking
    // every slot merely because their raw percentages are numerically larger.
    const capped = ranked.filter((p) => {
      const key = isHr(p)
        ? "MLB:HR"
        : p.sport === "MLB" && p.note.startsWith("VALUE LEAN")
          ? "MLB:Value Lean"
        : p.market.includes("First Basket")
          ? `${p.sport}:First Basket`
          : p.market === "First TD"
            ? "NFL:First TD"
            : p.market === "Anytime TD"
              ? "NFL:Anytime TD"
              : "";
      if (!key || !caps[key]) return true;
      counts[key] = (counts[key] || 0) + 1;
      return counts[key] <= caps[key];
    });
    const curated: Play[] = [];
    // Reserve one discovery position only when a play has already cleared its
    // sport's real market-value and evidence gates. This never manufactures a
    // long shot or relaxes a model threshold; it prevents qualified value from
    // being permanently buried behind higher-base-rate plays.
    const discoveryValue = capped
      .filter((p) => p.tier === "VALUE" && p.valueScore !== undefined)
      .sort(
        (a, b) =>
          (b.valueScore ?? -Infinity) - (a.valueScore ?? -Infinity) ||
          b.probability - a.probability,
      )[0];
    if (discoveryValue) curated.push(discoveryValue);
    for (const playTier of ["BEST PLAY", "STRONG PLAY", "VALUE"] as const) {
      const remaining = capped.filter(
        (p) => p.tier === playTier && p.id !== discoveryValue?.id,
      );
      while (curated.length < PAGE_SIZE && remaining.length) {
        const used = new Set<string>();
        for (let i = 0; i < remaining.length && curated.length < PAGE_SIZE;) {
          const group = selectionGroup(remaining[i]);
          if (used.has(group)) {
            i++;
            continue;
          }
          used.add(group);
          curated.push(remaining.splice(i, 1)[0]);
        }
      }
    }
    return curated;
  }, [
    mlb.data,
    mlbHr.data,
    nbaStats.data,
    nbaGames.data,
    wnba.data,
    nflMarkets.data,
  ]);

  const loading =
    mlb.isLoading ||
    mlbHr.isLoading ||
    nbaStats.isLoading ||
    nbaGames.isLoading ||
    wnba.isLoading ||
    nflMarkets.isLoading;
  const displayPlays = loading && cachedPlays.length ? cachedPlays : plays;
  const visiblePlays = useMemo(
    () => displayPlays.filter((p) => filterPlay(p, filter)),
    [displayPlays, filter],
  );
  const totalPages = Math.max(1, Math.ceil(visiblePlays.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedPlays = visiblePlays.slice(pageStart, pageStart + PAGE_SIZE);
  const refreshing =
    mlb.isFetching ||
    mlbHr.isFetching ||
    nbaStats.isFetching ||
    nbaGames.isFetching ||
    wnba.isFetching ||
    nflMarkets.isFetching;
  useEffect(() => {
    if (loading) return;
    writeCachedBestPlays(plays);
    setCachedPlays(plays);
  }, [loading, plays]);
  useEffect(() => {
    if (loading || !plays.length) return;
    const controller = new AbortController();
    void fetch("/api/best-plays/selections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: activeEtDateISO(),
        plays: plays.map(({ id, sport, market, matchup, pick, probability, tier, time, href }) => ({
          id,
          sport,
          market,
          matchup,
          pick,
          probability,
          tier,
          time,
          href,
        })),
      }),
      signal: controller.signal,
    }).catch(() => undefined);
    return () => controller.abort();
  }, [loading, plays]);
  const cols = "md:grid-cols-[82px_78px_minmax(230px,1fr)_220px_118px_112px]";
  return (
    <div className="relative -mx-4 md:-mx-6 lg:-mx-8 -my-8 min-h-[calc(100vh-7rem)] overflow-hidden px-4 md:px-6 lg:px-8 py-8">
      <style>{`@keyframes bpStarDrift{from{transform:translate3d(0,0,0)}to{transform:translate3d(-34px,28px,0)}}@keyframes bpNebulaFloat{0%,100%{transform:translate3d(-2%,0,0) scale(1)}50%{transform:translate3d(3%,-2%,0) scale(1.05)}}@keyframes bpShoot{0%,58%{opacity:0;transform:translate3d(0,0,0) rotate(-28deg) scaleX(.6)}62%{opacity:1}82%{opacity:.9}96%{opacity:.35}100%{opacity:0;transform:translate3d(-310px,175px,0) rotate(-28deg) scaleX(1)}}.bp-shoot{position:absolute;width:135px;height:2px;border-radius:999px;background:linear-gradient(90deg,transparent 0%,rgba(125,211,252,.16) 15%,rgba(191,219,254,.7) 58%,rgba(255,255,255,1) 100%);filter:drop-shadow(0 0 5px rgba(147,197,253,.8)) drop-shadow(0 0 10px rgba(99,102,241,.3));transform-origin:right center}.bp-shoot:before{content:'';position:absolute;right:3px;top:-2px;width:32px;height:5px;border-radius:999px;background:linear-gradient(90deg,transparent,rgba(219,234,254,.38));filter:blur(2px)}.bp-shoot:after{content:'';position:absolute;right:-2px;top:-2px;width:5px;height:5px;border-radius:999px;background:white;box-shadow:0 0 7px rgba(255,255,255,1),0 0 14px rgba(125,211,252,.9)}@media (prefers-reduced-motion:reduce){.bp-stars,.bp-nebula,.bp-shoot{animation:none!important}.bp-shoot{display:none}}`}</style>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--background))_18%,rgba(10,14,28,.96)_100%)]" />
      <div
        className="bp-nebula pointer-events-none absolute -inset-[12%] opacity-35 blur-3xl animate-[bpNebulaFloat_26s_ease-in-out_infinite]"
        style={{
          background:
            "radial-gradient(circle at 28% 30%, rgba(99,102,241,.22), transparent 28%), radial-gradient(circle at 72% 22%, rgba(56,189,248,.12), transparent 24%), radial-gradient(circle at 58% 78%, rgba(168,85,247,.14), transparent 30%)",
        }}
      />
      <div
        className="bp-stars pointer-events-none absolute -inset-16 opacity-40 animate-[bpStarDrift_44s_linear_infinite]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,.9) 0 1px, transparent 1.2px), radial-gradient(circle, rgba(191,219,254,.7) 0 1px, transparent 1.2px)",
          backgroundSize: "52px 52px, 83px 83px",
          backgroundPosition: "0 0, 23px 17px",
        }}
      />
      <BestPlaysSportsSky />
      <div className="bp-shoot pointer-events-none top-[15%] right-[2%] opacity-0 animate-[bpShoot_8s_ease-in-out_infinite]" />
      <div
        className="bp-shoot pointer-events-none top-[36%] right-[18%] opacity-0 animate-[bpShoot_11s_ease-in-out_2.5s_infinite]"
        style={{ width: "105px" }}
      />
      <div
        className="bp-shoot pointer-events-none top-[59%] right-[5%] opacity-0 animate-[bpShoot_13s_ease-in-out_5s_infinite]"
        style={{ width: "120px" }}
      />
      <div
        className="bp-shoot pointer-events-none top-[78%] right-[28%] opacity-0 animate-[bpShoot_15s_ease-in-out_7.5s_infinite]"
        style={{ width: "88px" }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/20 via-transparent to-background/55" />
      <div className="bp-content relative z-10 space-y-5">
        <div className="bp-page-header flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-bold tracking-tight">
                Today's Best Plays
              </h1>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Curated model-approved plays across active sports, ranked by
              strength and value.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              mlb.refetch();
              mlbHr.refetch();
              nbaStats.refetch();
              nbaGames.refetch();
              wnba.refetch();
              nflMarkets.refetch();
            }}
            className="gap-2 rounded-full bg-card/70 backdrop-blur"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
        <div className="bp-filter-strip flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[10px] font-bold tracking-wide transition-all ${filter === f ? "border-primary/50 bg-primary/15 text-primary shadow-sm" : "border-border/60 bg-card/55 text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="bp-plays-panel relative rounded-2xl border border-border/60 bg-card/75 backdrop-blur-md overflow-hidden shadow-lg shadow-black/10">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
          <div
            className={`hidden md:grid ${cols} items-center px-2 py-2.5 bg-muted/20 border-b border-border/50 text-[9px] font-semibold uppercase tracking-[.18em] text-muted-foreground`}
          >
            <div className="px-2 text-center">Teams</div>
            <div className="px-3 border-l border-border/40">League</div>
            <div className="px-4 border-l border-border/40">Play</div>
            <div className="px-4 border-l border-border/40">Matchup Intel</div>
            <div className="px-4 border-l border-border/40 text-right">
              Confidence
            </div>
            <div
              className="px-4 border-l border-border/40"
              aria-hidden="true"
            />
          </div>
          {loading && !displayPlays.length ? (
            <div className="p-4 space-y-3">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
            </div>
          ) : visiblePlays.length ? (
            <>
              <div className="bp-card-list p-2 space-y-2">
                {pagedPlays.map((p, i) => {
                  const hr = isHr(p),
                    projected = hr && p.market === "HR Projected";
                  return (
                    <Link href={p.href} key={p.id}>
                      <div
                        className={`bp-play-row group relative grid grid-cols-[72px_1fr_auto] ${cols} items-center overflow-hidden rounded-xl border border-border/45 bg-background/55 backdrop-blur-sm hover:bg-muted/45 hover:border-border/80 hover:shadow-sm transition-all cursor-pointer`}
                        data-sport={p.sport}
                      >
                        {!hr && (
                          <div
                            className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-full ${railClass(p.tier)}`}
                          />
                        )}
                        <div className="px-2 py-4 flex items-center justify-center">
                          <PlayAvatar p={p} index={pageStart + i} />
                        </div>
                        <div className="hidden md:flex px-3 py-4 border-l border-border/35 self-stretch items-center">
                          <Badge
                            variant="outline"
                            className="bp-league-badge bg-card/70 text-[9px] font-semibold"
                          >
                            {hr ? "MLB HR" : p.sport}
                          </Badge>
                        </div>
                        <div className="min-w-0 px-3 md:px-4 py-4 md:border-l border-border/35">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="bp-play-title font-bold text-[15px] tracking-tight">
                              {p.pick}
                            </span>
                            <Badge
                              variant="outline"
                              className={`text-[8px] ${tierClass(p.tier)}`}
                            >
                              {p.tier}
                            </Badge>
                            {hr && (
                              <Badge
                                variant="outline"
                                className={`text-[8px] ${projected ? "border-amber-400/35 bg-amber-400/10 text-amber-500" : "border-emerald-500/35 bg-emerald-500/10 text-emerald-500"}`}
                              >
                                {projected
                                  ? "PROJECTED LINEUP"
                                  : "LINEUP CONFIRMED"}
                              </Badge>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1.5">
                            <span>{p.matchup}</span>
                            <span className="opacity-40">•</span>
                            <span>{hr ? "HOME RUN" : p.market}</span>
                          </div>
                          {hr ? (
                            <div className="mt-2 text-[10px] text-muted-foreground">
                              {p.note}
                            </div>
                          ) : p.sport === "MLB" &&
                            (p.awayPitcher || p.homePitcher) ? (
                            <div className="md:hidden mt-2.5">
                              <PitcherMatchup p={p} />
                            </div>
                          ) : null}
                        </div>
                        <div className="hidden md:flex px-4 py-4 border-l border-border/35 min-h-[76px] items-center text-xs text-muted-foreground">
                          <PitcherMatchup p={p} />
                        </div>
                        <div className="px-3 md:px-4 py-4 md:border-l border-border/35 text-right">
                          <div
                            className={`bp-confidence-pill inline-flex flex-col items-end rounded-lg border px-2.5 py-1.5 ${probabilityClass(p)}`}
                          >
                            <div className="font-mono font-black text-base leading-none">
                              {p.probability.toFixed(1)}%
                            </div>
                            <div className="text-[8px] uppercase tracking-[.16em] text-muted-foreground mt-1">
                              model
                            </div>
                          </div>
                        </div>
                        <div className="bp-time-row md:hidden col-span-3 flex items-center justify-center gap-1.5 -mt-1 pb-3 text-[10px] font-medium text-muted-foreground text-center">
                          <Clock className="w-3.5 h-3.5" />
                          {gameTime(p.time)}
                        </div>
                        <div className="hidden md:flex px-4 py-4 border-l border-border/35 justify-end items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                          <Clock className="w-3.5 h-3.5" />
                          {gameTime(p.time)}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
              {totalPages > 1 && (
                <div className="flex flex-col gap-2 border-t border-border/50 bg-muted/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-[10px] text-muted-foreground">
                    Showing {pageStart + 1}–
                    {Math.min(pageStart + PAGE_SIZE, visiblePlays.length)} of{" "}
                    {visiblePlays.length} plays
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-full px-3 text-[10px]"
                      disabled={currentPage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <div className="min-w-[82px] text-center text-[10px] font-semibold text-muted-foreground">
                      Page {currentPage} of {totalPages}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-full px-3 text-[10px]"
                      disabled={currentPage >= totalPages}
                      onClick={() =>
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="py-16 px-4 text-center">
              <Sparkles className="w-7 h-7 mx-auto text-muted-foreground mb-3" />
              <div className="font-semibold text-sm">
                No qualifying{" "}
                {filter === "ALL" ? "plays" : filter.toLowerCase() + " plays"}{" "}
                right now
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Check back closer to game time as the models update.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
