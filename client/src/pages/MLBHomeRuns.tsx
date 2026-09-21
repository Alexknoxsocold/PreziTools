import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Clock3,
  Cloud,
  CloudRain,
  Crosshair,
  Flame,
  MapPin,
  Sun,
  ThermometerSun,
  Wind,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type BookQuote = {
  bookmaker: string;
  bookmakerKey: string;
  americanOdds: number;
  updatedAt: string | null;
};
type HrMarket = {
  source: "PropLine";
  bestOdds: number;
  bestBook: string;
  impliedProbability: number;
  consensusImpliedProbability: number;
  quoteCount: number;
  trustedQuoteCount: number;
  outlierQuoteCount: number;
  priceVerified: boolean;
  modelEdge: number;
  expectedValue: number;
  valueTier: "BEST_VALUE" | "VALUE" | "NONE";
  quotes: BookQuote[];
  capturedAt: string;
  frozen?: boolean;
  displayStatus?: "frozen-pregame";
  frozenAt?: string;
};
type Candidate = {
  gamePk: number;
  gameTime: string;
  playerId: number;
  player: string;
  team: string;
  opponent: string;
  headshot: string;
  battingOrder: number | null;
  lineupConfirmed: boolean;
  probablePitcher: string | null;
  venue: string | null;
  probability: number;
  confidence: number;
  tier: "POWER_PLAY" | "STRONG" | "WATCH";
  season: {
    plateAppearances: number;
    homeRuns: number;
    homeRunRate: number;
    slugging: number | null;
    ops: number | null;
  };
  recent: {
    plateAppearances: number;
    homeRuns: number;
    homeRunRate: number | null;
  };
  pitcher: {
    battersFaced: number;
    homeRunsAllowed: number;
    homeRunRateAllowed: number | null;
  };
  environment: {
    parkFactor: number;
    temperatureF: number | null;
    windMph: number | null;
    windDirection: string | null;
    windDegrees?: number | null;
    precipitationProbability?: number | null;
    condition?: string | null;
    weatherSource?: "MLB" | "Open-Meteo" | "unavailable";
    weatherFactor: number;
  };
  factors: string[];
  market: HrMarket | null;
  homepageEligible?: boolean;
};
type Payload = {
  date: string;
  modelVersion: string;
  updatedAt: string;
  candidates: Candidate[];
  strongest: Candidate[];
  valuePlays: Candidate[];
  watchlist: Candidate[];
  gamesWithConfirmedLineups: number;
  teamsWithConfirmedLineups: number;
  totalGames: number;
  marketStatus: "available" | "unavailable" | "disabled";
  marketGamesMatched: number;
  marketPlayersPriced: number;
  homepageReady?: boolean;
  methodology: string;
  note: string;
};
function time(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "Time pending"
    : `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`;
}
function updatedTime(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? null
    : `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`;
}
function odds(value: number) {
  return value > 0 ? `+${Math.round(value)}` : String(Math.round(value));
}
function gameHasStarted(row: Candidate) {
  const start = new Date(row.gameTime).getTime();
  return Number.isFinite(start) && start <= Date.now();
}
function qualifiesForValue(row: Candidate) {
  const m = row.market;
  return (
    !!m &&
    !gameHasStarted(row) &&
    row.lineupConfirmed &&
    m.priceVerified &&
    m.trustedQuoteCount >= 2 &&
    row.confidence >= 70 &&
    row.probability >= 12 &&
    m.modelEdge >= 2 &&
    m.bestOdds >= 150 &&
    m.bestOdds <= 1200
  );
}
function marketActive(row: Candidate) {
  return !row.lineupConfirmed && !!row.market && row.market.quotes.length > 0;
}
function tierLabel(row: Candidate) {
  if (!row.lineupConfirmed)
    return marketActive(row) ? "MARKET ACTIVE" : "WATCH";
  return row.tier === "POWER_PLAY" ? "POWER PLAY" : row.tier;
}
function tierClass(row: Candidate) {
  if (!row.lineupConfirmed)
    return marketActive(row)
      ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300"
      : "border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-300";
  if (row.tier === "POWER_PLAY")
    return "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
  if (row.tier === "STRONG")
    return "border-orange-500/35 bg-orange-500/10 text-orange-600 dark:text-orange-300";
  return "border-border bg-muted/30 text-muted-foreground";
}
function probabilityClass(probability: number) {
  if (probability >= 22) return "text-emerald-500";
  if (probability >= 17) return "text-orange-500";
  if (probability >= 12) return "text-amber-500";
  return "text-foreground";
}
function environmentEffect(row: Candidate) {
  return (row.environment.parkFactor * row.environment.weatherFactor - 1) * 100;
}
function environmentTone(effect: number) {
  if (effect >= 10)
    return {
      label: "ELITE",
      shell:
        "border-emerald-500/35 bg-gradient-to-br from-emerald-500/16 via-card to-lime-500/8",
      chip: "bg-emerald-500 text-white",
      accent: "text-emerald-500",
      bar: "bg-emerald-500",
    };
  if (effect >= 4)
    return {
      label: "BOOST",
      shell:
        "border-cyan-500/30 bg-gradient-to-br from-cyan-500/14 via-card to-emerald-500/7",
      chip: "bg-cyan-500 text-white",
      accent: "text-cyan-500",
      bar: "bg-cyan-500",
    };
  if (effect <= -8)
    return {
      label: "COLD",
      shell:
        "border-rose-500/30 bg-gradient-to-br from-rose-500/12 via-card to-slate-500/8",
      chip: "bg-rose-500 text-white",
      accent: "text-rose-500",
      bar: "bg-rose-500",
    };
  if (effect <= -3)
    return {
      label: "LOW",
      shell:
        "border-amber-500/30 bg-gradient-to-br from-amber-500/12 via-card to-card",
      chip: "bg-amber-500 text-black",
      accent: "text-amber-500",
      bar: "bg-amber-500",
    };
  return {
    label: "NEUTRAL",
    shell:
      "border-slate-500/20 bg-gradient-to-br from-slate-500/8 via-card to-card",
    chip: "bg-slate-500 text-white",
    accent: "text-muted-foreground",
    bar: "bg-slate-400",
  };
}
function weatherIcon(row: Candidate) {
  const condition = (row.environment.condition ?? "").toLowerCase(),
    rain = row.environment.precipitationProbability ?? 0;
  if (condition.includes("rain") || condition.includes("storm") || rain >= 45)
    return CloudRain;
  if (condition.includes("cloud") || condition.includes("overcast"))
    return Cloud;
  return Sun;
}
function windSummary(row: Candidate) {
  if (row.environment.windDirection) return row.environment.windDirection;
  if (row.environment.windMph !== null) return `${row.environment.windMph} mph`;
  return "—";
}
const BOOK_DOMAINS: Array<[string, string]> = [
  ["fanduel", "fanduel.com"],
  ["draftkings", "draftkings.com"],
  ["betmgm", "betmgm.com"],
  ["caesars", "caesars.com"],
  ["betrivers", "betrivers.com"],
  ["fanatics", "fanatics.com"],
  ["espnbet", "espnbet.com"],
  ["bet365", "bet365.com"],
  ["bovada", "bovada.lv"],
  ["pinnacle", "pinnacle.com"],
  ["hardrock", "hardrock.bet"],
  ["betonline", "betonline.ag"],
  ["thescore", "thescore.bet"],
  ["scorebet", "thescore.bet"],
  ["fliff", "getfliff.com"],
  ["novig", "novig.us"],
  ["kalshi", "kalshi.com"],
  ["prizepicks", "prizepicks.com"],
  ["sleeper", "sleeper.com"],
];
function bookDomain(quote: Pick<BookQuote, "bookmaker" | "bookmakerKey">) {
  const key = `${quote.bookmakerKey} ${quote.bookmaker}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return BOOK_DOMAINS.find(([needle]) => key.includes(needle))?.[1] ?? null;
}
function SportsbookLogo({
  quote,
}: {
  quote: Pick<BookQuote, "bookmaker" | "bookmakerKey">;
}) {
  const domain = bookDomain(quote),
    initial = quote.bookmaker.trim().charAt(0).toUpperCase() || "S";
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white text-[10px] font-black text-black">
      {domain ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
          alt={`${quote.bookmaker} logo`}
          className="h-5 w-5 object-contain"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        initial
      )}
    </div>
  );
}
function BookPrice({
  quote,
  best = false,
}: {
  quote: BookQuote;
  best?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${best ? "border-violet-500/35 bg-violet-500/[.08]" : "bg-background/65"}`}
    >
      <SportsbookLogo quote={quote} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[10px] font-semibold">
          {quote.bookmaker}
        </div>
        {best && (
          <div className="text-[7px] font-black uppercase tracking-wide text-violet-500">
            Best
          </div>
        )}
      </div>
      <div className="shrink-0 font-mono text-xs font-black">
        {odds(quote.americanOdds)}
      </div>
    </div>
  );
}
function PlayerHeadshot({
  row,
  size = "lg",
}: {
  row: Candidate;
  size?: "lg" | "sm";
}) {
  const dimensions = size === "lg" ? "h-14 w-14" : "h-10 w-10";
  return (
    <div
      className={`${dimensions} shrink-0 overflow-hidden rounded-full bg-muted/70 ring-1 ring-border/70`}
    >
      <img
        src={row.headshot}
        alt={row.player}
        className="h-full w-full scale-[0.9] object-contain object-center"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    </div>
  );
}
function BaseballDiamond({ row }: { row: Candidate }) {
  const degrees = row.environment.windDegrees ?? 0,
    hasDirection =
      row.environment.windDegrees !== null &&
      row.environment.windDegrees !== undefined,
    WeatherIcon = weatherIcon(row);
  return (
    <div className="relative h-40 w-full min-w-[145px] overflow-hidden rounded-3xl border border-white/10 bg-[#15291d] shadow-inner">
      <div className="absolute inset-x-0 top-0 h-[42%] bg-gradient-to-b from-sky-700/55 via-sky-500/20 to-transparent" />
      <div className="absolute left-1/2 top-[16%] h-[115%] w-[115%] -translate-x-1/2 rounded-[50%_50%_12%_12%] border-[10px] border-emerald-900/80 bg-emerald-700/70" />
      <div className="absolute left-1/2 top-[40%] h-[92%] w-[92%] -translate-x-1/2 rounded-[50%_50%_10%_10%] border-[3px] border-amber-200/35 bg-emerald-600/50" />
      <div className="absolute left-1/2 top-[67%] h-[74px] w-[74px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[10px] bg-amber-300/60" />
      <div className="absolute left-1/2 top-[67%] h-[48px] w-[48px] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-emerald-600/95" />
      <div className="absolute bottom-[12px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border border-slate-300 bg-white" />
      <div className="absolute bottom-[48px] left-[31%] h-2.5 w-2.5 rotate-45 bg-white" />
      <div className="absolute bottom-[48px] right-[31%] h-2.5 w-2.5 rotate-45 bg-white" />
      <div className="absolute left-1/2 top-[44%] h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-white" />
      <div className="absolute bottom-[17px] left-1/2 h-[72px] w-[2px] origin-bottom -rotate-[34deg] bg-white/45" />
      <div className="absolute bottom-[17px] left-1/2 h-[72px] w-[2px] origin-bottom rotate-[34deg] bg-white/45" />
      <div className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-yellow-300">
        <WeatherIcon className="h-5 w-5" />
      </div>
      <div
        className="absolute left-1/2 top-[55%] h-14 w-[3px] origin-bottom rounded-full bg-cyan-100"
        style={{ transform: `translate(-50%, -100%) rotate(${degrees}deg)` }}
      />
      <div className="absolute bottom-3 left-3 rounded-full bg-black/65 px-2.5 py-1 text-[8px] font-black text-white">
        {hasDirection ? `${Math.round(degrees)}° WIND` : "WIND"}
      </div>
      <div className="absolute bottom-3 right-3 rounded-full bg-black/65 px-2.5 py-1 text-[8px] font-bold text-white">
        {row.environment.windMph !== null
          ? `${Math.round(row.environment.windMph)} MPH`
          : "—"}
      </div>
    </div>
  );
}
function EnvironmentCard({
  row,
  candidateCount,
  selected,
  onSelect,
}: {
  row: Candidate;
  candidateCount: number;
  selected: boolean;
  onSelect: (row: Candidate) => void;
}) {
  const effect = environmentEffect(row),
    tone = environmentTone(effect),
    WeatherIcon = weatherIcon(row),
    precip = row.environment.precipitationProbability;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Show home run hitters for ${row.team} versus ${row.opponent}`}
      onClick={() => onSelect(row)}
      className={`min-w-[390px] flex-1 overflow-hidden rounded-3xl border text-left shadow-sm transition ${tone.shell} ${selected ? "ring-2 ring-orange-500 ring-offset-2 ring-offset-background" : "hover:border-orange-500/50 active:scale-[0.99]"}`}
    >
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span>⚾</span>
              <span className="truncate text-sm font-black">
                {row.team} vs {row.opponent}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 truncate text-[9px] text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {row.venue ?? "Venue"} · {time(row.gameTime)}
            </div>
          </div>
          <div
            className={`rounded-full px-2.5 py-1 text-[8px] font-black ${tone.chip}`}
          >
            {tone.label}
          </div>
        </div>
      </div>
      <div className="px-4">
        <BaseballDiamond row={row} />
      </div>
      <div className="grid grid-cols-4 gap-2 p-4">
        <div className="rounded-2xl border bg-background/55 p-2.5 text-center">
          <ThermometerSun className="mx-auto h-4 w-4 text-orange-400" />
          <div className="mt-1 font-mono text-lg font-black">
            {row.environment.temperatureF !== null
              ? `${Math.round(row.environment.temperatureF)}°`
              : "—"}
          </div>
          <div className="text-[8px] uppercase text-muted-foreground">Temp</div>
        </div>
        <div className="rounded-2xl border bg-background/55 p-2.5 text-center">
          <Wind className="mx-auto h-4 w-4 text-cyan-400" />
          <div className="mt-1 font-mono text-lg font-black">
            {row.environment.windMph !== null
              ? Math.round(row.environment.windMph)
              : "—"}
          </div>
          <div className="text-[8px] uppercase text-muted-foreground">mph</div>
        </div>
        <div className="rounded-2xl border bg-background/55 p-2.5 text-center">
          <WeatherIcon className="mx-auto h-4 w-4 text-sky-400" />
          <div className="mt-1 truncate text-[10px] font-black">
            {row.environment.condition ?? "Clear"}
          </div>
          <div className="text-[8px] uppercase text-muted-foreground">
            {precip !== null && precip !== undefined
              ? `${Math.round(precip)}% rain`
              : "Weather"}
          </div>
        </div>
        <div className="rounded-2xl border bg-background/55 p-2.5 text-center">
          <Flame className={`mx-auto h-4 w-4 ${tone.accent}`} />
          <div className={`mt-1 font-mono text-lg font-black ${tone.accent}`}>
            {effect >= 0 ? "+" : ""}
            {effect.toFixed(1)}%
          </div>
          <div className="text-[8px] uppercase text-muted-foreground">
            HR carry
          </div>
        </div>
      </div>
      <div className="border-t bg-background/25 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-background/60">
            <div
              className={`h-full rounded-full ${tone.bar}`}
              style={{
                width: `${Math.max(12, Math.min(100, 50 + effect * 3))}%`,
              }}
            />
          </div>
          <span className="max-w-[155px] truncate text-[9px] text-muted-foreground">
            {windSummary(row)}
          </span>
          <span className="shrink-0 text-[9px] font-black text-muted-foreground">
            {candidateCount} hitters
          </span>
        </div>
      </div>
    </button>
  );
}
function ConfirmedRow({
  row,
  onOpen,
}: {
  row: Candidate;
  onOpen: (row: Candidate) => void;
}) {
  const prices = [...(row.market?.quotes ?? [])]
      .sort((a, b) => b.americanOdds - a.americanOdds)
      .slice(0, 4),
    isValue = qualifiesForValue(row);
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="w-full border-b border-border/45 px-4 py-3.5 text-left last:border-b-0 hover:bg-orange-500/[.045]"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_100px] items-center gap-3">
        <PlayerHeadshot row={row} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[15px] font-bold">{row.player}</span>
            {row.battingOrder !== null && (
              <Badge variant="outline" className="h-5 text-[9px]">
                #{row.battingOrder}
              </Badge>
            )}
            {!row.lineupConfirmed && marketActive(row) && (
              <Badge
                variant="outline"
                className="h-5 border-cyan-500/30 bg-cyan-500/10 text-[8px] text-cyan-600"
              >
                PROJECTED
              </Badge>
            )}
            {isValue && (
              <Badge
                variant="outline"
                className="h-5 border-violet-500/30 bg-violet-500/10 text-[8px] text-violet-600"
              >
                VALUE
              </Badge>
            )}
            {row.market?.frozen && (
              <Badge
                variant="outline"
                className="h-5 border-emerald-500/30 bg-emerald-500/10 text-[8px] text-emerald-600"
              >
                FROZEN PREGAME
              </Badge>
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {row.team} vs {row.opponent} · {time(row.gameTime)}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline" className={`text-[8px] ${tierClass(row)}`}>
              {tierLabel(row)}
            </Badge>
            <span className="text-[9px] text-muted-foreground">
              {row.lineupConfirmed
                ? `${row.confidence}% confidence`
                : `Props posted · lineup not official yet`}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div
            className={`font-mono text-2xl font-black ${probabilityClass(row.probability)}`}
          >
            {row.probability.toFixed(1)}%
          </div>
          <div className="text-[8px] uppercase text-muted-foreground">
            HR chance
          </div>
        </div>
      </div>
      {prices.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {prices.map((q, i) => (
            <BookPrice
              key={`${q.bookmakerKey}-${i}`}
              quote={q}
              best={i === 0}
            />
          ))}
        </div>
      )}
    </button>
  );
}
function WatchRow({
  row,
  onOpen,
}: {
  row: Candidate;
  onOpen: (row: Candidate) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="grid w-full grid-cols-[auto_minmax(0,1fr)_90px] items-center gap-3 border-b px-4 py-3 text-left last:border-b-0"
    >
      <PlayerHeadshot row={row} size="sm" />
      <div className="min-w-0">
        <span className="truncate text-sm font-bold">{row.player}</span>
        <div className="text-[10px] text-muted-foreground">
          {row.team} vs {row.opponent} · {time(row.gameTime)}
        </div>
        <Badge
          variant="outline"
          className={`mt-1.5 text-[8px] ${tierClass(row)}`}
        >
          {tierLabel(row)}
        </Badge>
      </div>
      <div className="text-right">
        <div
          className={`font-mono text-xl font-black ${probabilityClass(row.probability)}`}
        >
          {row.probability.toFixed(1)}%
        </div>
        <div className="text-[8px] uppercase text-muted-foreground">
          HR chance
        </div>
      </div>
    </button>
  );
}
function DetailMetric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-[8px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-black">{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
function PlayerDetailModal({
  row,
  onClose,
}: {
  row: Candidate;
  onClose: () => void;
}) {
  const prices = [...(row.market?.quotes ?? [])].sort(
    (a, b) => b.americanOdds - a.americanOdds,
  );
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-card">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-card/95 px-5 py-4">
          <div className="flex items-center gap-3">
            <PlayerHeadshot row={row} />
            <div>
              <h3 className="text-xl font-black">{row.player}</h3>
              <div className="text-xs text-muted-foreground">
                {row.team} vs {row.opponent} · {time(row.gameTime)}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DetailMetric
              label="HR Probability"
              value={`${row.probability.toFixed(1)}%`}
              sub={`${row.confidence}% confidence`}
            />
            <DetailMetric
              label="Season Power"
              value={`${row.season.homeRuns} HR`}
              sub={`${row.season.plateAppearances} PA`}
            />
            <DetailMetric
              label="Last 14 Days"
              value={`${row.recent.homeRuns} HR`}
              sub={`${row.recent.plateAppearances} PA`}
            />
            <DetailMetric
              label="Pitcher HR Allowed"
              value={`${row.pitcher.homeRunsAllowed} HR`}
              sub={`${row.pitcher.battersFaced} BF`}
            />
          </div>
          {prices.length > 0 && (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/[.06] p-4">
              <div className="flex justify-between">
                <div className="text-sm font-bold">
                  {row.market?.frozen ? "Frozen pregame sportsbook prices" : "Sportsbook prices"}
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {prices.length} books
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {prices.map((q, i) => (
                  <BookPrice
                    key={`${q.bookmakerKey}-${i}`}
                    quote={q}
                    best={i === 0}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border bg-muted/15 p-4">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Wind className="h-4 w-4 text-cyan-500" />
                Environment
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground">
                {row.venue ?? "Venue pending"} ·{" "}
                {row.environment.temperatureF !== null
                  ? `${row.environment.temperatureF}°F`
                  : "—"}{" "}
                ·{" "}
                {row.environment.windMph !== null
                  ? `${row.environment.windMph} mph`
                  : "—"}
              </div>
            </div>
            <div className="rounded-xl border bg-muted/15 p-4">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Crosshair className="h-4 w-4 text-emerald-500" />
                Matchup
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground">
                Pitcher:{" "}
                <span className="font-medium text-foreground">
                  {row.probablePitcher ?? "Pending"}
                </span>{" "}
                ·{" "}
                {row.lineupConfirmed
                  ? `Batting #${row.battingOrder ?? "—"}`
                  : marketActive(row)
                    ? "Projected · props posted"
                    : "Lineup pending"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function GameHrModal({
  game,
  rows,
  onClose,
  onOpenPlayer,
}: {
  game: Candidate;
  rows: Candidate[];
  onClose: () => void;
  onOpenPlayer: (row: Candidate) => void;
}) {
  const effect = environmentEffect(game);
  const WeatherIcon = weatherIcon(game);
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-t-3xl border bg-card shadow-2xl sm:rounded-3xl">
        <div className="border-b bg-gradient-to-br from-orange-500/15 via-card to-cyan-500/10 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-orange-500">
                Top HR targets
              </div>
              <h3 className="mt-1 text-2xl font-black">
                {game.team} vs {game.opponent}
              </h3>
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {game.venue ?? "Venue pending"} · {time(game.gameTime)}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl border bg-background/60 p-3 text-center">
              <WeatherIcon className="mx-auto h-4 w-4 text-sky-400" />
              <div className="mt-1 truncate text-xs font-black">
                {game.environment.condition ?? "Clear"}
              </div>
              <div className="text-[8px] uppercase text-muted-foreground">
                Weather
              </div>
            </div>
            <div className="rounded-xl border bg-background/60 p-3 text-center">
              <Wind className="mx-auto h-4 w-4 text-cyan-400" />
              <div className="mt-1 text-xs font-black">
                {game.environment.windMph !== null
                  ? `${Math.round(game.environment.windMph)} mph`
                  : "—"}
              </div>
              <div className="truncate text-[8px] uppercase text-muted-foreground">
                {windSummary(game)}
              </div>
            </div>
            <div className="rounded-xl border bg-background/60 p-3 text-center">
              <Flame className="mx-auto h-4 w-4 text-orange-500" />
              <div className="mt-1 font-mono text-xs font-black">
                {effect >= 0 ? "+" : ""}
                {effect.toFixed(1)}%
              </div>
              <div className="text-[8px] uppercase text-muted-foreground">
                HR carry
              </div>
            </div>
          </div>
        </div>
        <div className="max-h-[58vh] overflow-y-auto">
          {rows.map((row, index) => (
            <div key={`${row.gamePk}-${row.playerId}`} className="relative">
              <div className="absolute left-3 top-4 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-[10px] font-black text-white shadow">
                {index + 1}
              </div>
              <ConfirmedRow row={row} onOpen={onOpenPlayer} />
            </div>
          ))}
        </div>
        <div className="border-t bg-muted/20 px-5 py-3 text-center text-[9px] text-muted-foreground">
          Ranked for today using hitter power, pitcher matchup, park, weather,
          and wind
        </div>
      </div>
    </div>
  );
}
export default function MLBHomeRuns() {
  const [selectedPlayer, setSelectedPlayer] = useState<Candidate | null>(null);
  const [selectedGamePk, setSelectedGamePk] = useState<number | null>(null);
  const { data, isLoading, error } = useQuery<Payload>({
    queryKey: ["/api/mlb/home-runs"],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
  const upcomingCandidates = useMemo(
    () => (data?.candidates ?? []).filter((row) => !gameHasStarted(row)),
    [data?.candidates],
  );
  const environmentGames = useMemo(() => {
    const games = new Map<number, { row: Candidate; count: number }>();
    for (const row of upcomingCandidates) {
      const current = games.get(row.gamePk);
      if (!current) games.set(row.gamePk, { row, count: 1 });
      else current.count += 1;
    }
    return [...games.values()]
      .sort((a, b) => environmentEffect(b.row) - environmentEffect(a.row))
      .slice(0, 8);
  }, [upcomingCandidates]);
  if (isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  const confirmedRows = upcomingCandidates
      .filter((row) => row.lineupConfirmed)
      .sort(
        (a, b) => b.probability - a.probability || b.confidence - a.confidence,
      )
      .slice(0, 15),
    marketRows = upcomingCandidates
      .filter((row) => marketActive(row))
      .sort(
        (a, b) => b.probability - a.probability || b.confidence - a.confidence,
      )
      .slice(0, 15),
    boardRows = [...confirmedRows, ...marketRows]
      .sort(
        (a, b) =>
          Number(b.lineupConfirmed) - Number(a.lineupConfirmed) ||
          b.probability - a.probability ||
          b.confidence - a.confidence,
      )
      .slice(0, 20),
    selectedGameRows =
      selectedGamePk === null
        ? []
        : upcomingCandidates
            .filter((row) => row.gamePk === selectedGamePk)
            .sort(
              (a, b) =>
                b.probability - a.probability || b.confidence - a.confidence,
            )
            .slice(0, 5),
    selectedGame = environmentGames.find(
      ({ row }) => row.gamePk === selectedGamePk,
    )?.row,
    watchRows = (data?.watchlist ?? []).filter(
      (row) => !gameHasStarted(row) && !marketActive(row),
    ),
    top = [...boardRows, ...watchRows].sort(
      (a, b) => b.probability - a.probability,
    )[0],
    valueCount = confirmedRows.filter(qualifiesForValue).length;
  return (
    <div className="space-y-6 pb-4">
      {selectedPlayer && (
        <PlayerDetailModal
          row={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
      {selectedGame && (
        <GameHrModal
          game={selectedGame}
          rows={selectedGameRows}
          onClose={() => setSelectedGamePk(null)}
          onOpenPlayer={setSelectedPlayer}
        />
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-500/15">
            <Flame className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <h1 className="text-xl font-black">Home Runs</h1>
            <div className="text-[10px] text-muted-foreground">
              Today&apos;s MLB home run board
            </div>
          </div>
        </div>
        {updatedTime(data?.updatedAt) && (
          <div className="text-right text-[9px] text-muted-foreground">
            {updatedTime(data?.updatedAt)}
          </div>
        )}
      </div>
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          MLB home-run data could not be loaded right now.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-orange-500/20 bg-gradient-to-br from-orange-500/12 to-card p-4">
              <div className="text-[9px] font-bold uppercase text-orange-500">
                Top HR Today
              </div>
              <div className="mt-1 font-mono text-2xl font-black">
                {top ? `${top.probability.toFixed(1)}%` : "—"}
              </div>
              <div className="truncate text-[9px] text-muted-foreground">
                {top?.player ?? "—"}
              </div>
            </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/12 to-card p-4">
              <div className="text-[9px] font-bold uppercase text-emerald-500">
                Confirmed / Market
              </div>
              <div className="mt-1 font-mono text-2xl font-black">
                {boardRows.length}
              </div>
              <div className="truncate text-[9px] text-muted-foreground">
                {confirmedRows.length} confirmed · {marketRows.length} market
                active
              </div>
            </div>
            <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/12 to-card p-4">
              <div className="text-[9px] font-bold uppercase text-cyan-500">
                Players Priced
              </div>
              <div className="mt-1 font-mono text-2xl font-black">
                {data?.marketPlayersPriced ?? 0}
              </div>
            </div>
          </div>
          {environmentGames.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wind className="h-4 w-4 text-cyan-500" />
                  <h2 className="text-sm font-black">
                    Today&apos;s HR Environment
                  </h2>
                </div>
                <span className="text-[9px] text-muted-foreground">
                  UPCOMING
                </span>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {environmentGames.map(({ row, count }) => (
                  <EnvironmentCard
                    key={row.gamePk}
                    row={row}
                    candidateCount={count}
                    selected={selectedGamePk === row.gamePk}
                    onSelect={(game) => setSelectedGamePk(game.gamePk)}
                  />
                ))}
              </div>
            </section>
          )}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-orange-500" />
                <h2 className="text-base font-black">Today&apos;s HR Board</h2>
                <Badge variant="outline" className="h-5 text-[9px]">
                  {boardRows.length}
                </Badge>
              </div>
              {valueCount > 0 ? (
                <span className="text-[9px] font-semibold text-violet-500">
                  {valueCount} VALUE {valueCount === 1 ? "PRICE" : "PRICES"}
                </span>
              ) : null}
            </div>
            <div className="max-h-[820px] overflow-y-auto rounded-2xl border border-orange-500/20 bg-card/85">
              {boardRows.length ? (
                boardRows.map((row) => (
                  <ConfirmedRow
                    key={`${row.gamePk}-${row.playerId}`}
                    row={row}
                    onOpen={setSelectedPlayer}
                  />
                ))
              ) : (
                <div className="px-5 py-12 text-center">
                  <Clock3 className="mx-auto h-7 w-7 text-muted-foreground/35" />
                  <div className="mt-2 text-sm font-semibold">
                    Waiting for lineups or active HR markets
                  </div>
                </div>
              )}
            </div>
          </section>
          <section>
            <div className="mb-2 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-amber-500" />
              <h2 className="text-sm font-black">Early Watchlist</h2>
            </div>
            <div className="max-h-[420px] overflow-y-auto rounded-2xl border border-amber-500/15 bg-card/75">
              {watchRows.length ? (
                watchRows.map((row) => (
                  <WatchRow
                    key={`${row.gamePk}-${row.playerId}`}
                    row={row}
                    onOpen={setSelectedPlayer}
                  />
                ))
              ) : (
                <div className="px-5 py-10 text-center">
                  <Activity className="mx-auto h-7 w-7 text-muted-foreground/35" />
                  <div className="mt-2 text-sm font-semibold">
                    No early watchlist players
                  </div>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
