import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Crosshair, RefreshCw, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';


type MarketTab = 'anytime' | 'firsttd';
type BookQuote = { bookmaker: string; bookmakerKey: string; americanOdds: number; updatedAt: string | null };
type PlayerMarket = { player: string; team?: string; position?: string; espnId?: string; headshot?: string; bestOdds: number; bestBook: string; impliedProbability: number; quoteCount: number; quotes: BookQuote[]; modelProbability?: number; edgePoints?: number; expectedValue?: number; confidence?: 'watch' | 'strong' | 'elite'; qualifies?: boolean; reasons?: string[]; dataStatus?: 'modeled' | 'not-ready'; result?: 'won' | 'lost' | 'pending' };
type Team = { abbreviation: string; name: string; logo: string | null; record: string | null };
type Readiness = { anytimeTd: boolean; firstTd: boolean };
type NflGame = { id: string; date: string; status: string; away: Team; home: Team; marketStatus: 'available' | 'unavailable'; marketAvailable?: Readiness; modelReady?: Readiness; anytimeTd: PlayerMarket[]; firstTd: PlayerMarket[]; qualified: Readiness; tdLocks?: { anytimeTd: string | null; firstTd: string | null }; displaySnapshot?: { status: 'frozen-pregame'; capturedAt: string } };
type NflFeed = { games: NflGame[]; health?: { rawTdCandidates: number; modeledTdCandidates: number; notReadyTdCandidates: number; modelCoveragePct: number } };
type WikiSummary = { thumbnail?: { source?: string }; originalimage?: { source?: string } };

function formatTime(v: string) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'Time pending' : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
}
function odds(v: number | null) { if (v === null || !Number.isFinite(v)) return '—'; return v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`; }
function pct(v: number | undefined | null) { return v == null ? '—' : `${v.toFixed(1)}%`; }
function ev(v: number | undefined) { return v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`; }
const NFL_STADIUMS: Record<string, string> = {
  ARI: 'State Farm Stadium', ATL: 'Mercedes-Benz Stadium', BAL: 'M&T Bank Stadium', BUF: 'Highmark Stadium', CAR: 'Bank of America Stadium', CHI: 'Soldier Field', CIN: 'Paycor Stadium', CLE: 'Huntington Bank Field', DAL: 'AT&T Stadium', DEN: 'Empower Field at Mile High', DET: 'Ford Field', GB: 'Lambeau Field', HOU: 'NRG Stadium', IND: 'Lucas Oil Stadium', JAX: 'EverBank Stadium', KC: 'Arrowhead Stadium', LV: 'Allegiant Stadium', LAC: 'SoFi Stadium', LAR: 'SoFi Stadium', LA: 'SoFi Stadium', MIA: 'Hard Rock Stadium', MIN: 'U.S. Bank Stadium', NE: 'Gillette Stadium', NO: 'Caesars Superdome', NYG: 'MetLife Stadium', NYJ: 'MetLife Stadium', PHI: 'Lincoln Financial Field', PIT: 'Acrisure Stadium', SEA: 'Lumen Field', SF: "Levi's Stadium", TB: 'Raymond James Stadium', TEN: 'Nissan Stadium', WAS: 'Northwest Stadium'
};

function StadiumBackdrop({ home }: { home: Team }) {
  const venue = NFL_STADIUMS[home.abbreviation];
  const { data } = useQuery<WikiSummary>({
    queryKey: ['nfl-stadium-backdrop', venue], enabled: !!venue, staleTime: 86400000, gcTime: 604800000, retry: 0,
    queryFn: async () => { const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(venue)}`); if (!r.ok) throw new Error('stadium image unavailable'); return r.json(); }
  });
  const image = data?.originalimage?.source ?? data?.thumbnail?.source;
  if (!image) return null;
  return <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true"><img src={image} alt="" className="h-full w-full scale-110 object-cover opacity-[0.42] blur-[1px] saturate-[1.05] contrast-[1.05]"/><div className="absolute inset-0 bg-gradient-to-b from-background/38 via-background/62 to-background/88"/><div className="absolute inset-0 bg-gradient-to-r from-background/32 via-transparent to-background/28"/></div>;
}

const BOOK_DOMAINS: Array<[string, string]> = [['fanduel','fanduel.com'],['draftkings','draftkings.com'],['betmgm','betmgm.com'],['caesars','caesars.com'],['betrivers','betrivers.com'],['fanatics','fanatics.com'],['espnbet','espnbet.com'],['bet365','bet365.com'],['kalshi','kalshi.com']];
function bookDomain(book: string | null) { const key = (book ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); return BOOK_DOMAINS.find(([n]) => key.includes(n))?.[1] ?? null; }
function SportsbookLogo({ book }: { book: string | null }) {
  const d = bookDomain(book);
  return <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white text-[8px] font-black text-black sm:h-6 sm:w-6 sm:text-[9px]">{d ? <img src={`https://www.google.com/s2/favicons?domain=${d}&sz=64`} alt="" className="h-3.5 w-3.5 object-contain sm:h-4 sm:w-4"/> : (book ?? 'S')[0]}</span>;
}

function TeamMark({ team, large = false }: { team: Team; large?: boolean }) {
  return <div className="flex items-center gap-1.5 sm:gap-2">{team.logo ? <img src={team.logo} alt="" className={`${large ? 'h-8 w-8 sm:h-10 sm:w-10' : 'h-5 w-5 sm:h-6 sm:w-6'} object-contain`}/> : <div className={`${large ? 'h-8 w-8 sm:h-10 sm:w-10' : 'h-5 w-5 sm:h-6 sm:w-6'} rounded-full bg-muted`}/>}<div><div className="text-[11px] font-black sm:text-xs">{team.abbreviation}</div>{large && <div className="text-[8px] text-muted-foreground sm:text-[9px]">{team.record ?? team.name}</div>}</div></div>;
}

function GameHeader({ game, qualified, dataNotReady = false, locked = false }: { game: NflGame; qualified: boolean; dataNotReady?: boolean; locked?: boolean }) {
  const statusLabel = dataNotReady ? 'DATA NOT READY' : locked ? (qualified ? 'OFFICIAL LOCKED' : 'LOCKED BOARD') : 'PREVIEW';
  const statusClass = dataNotReady
    ? 'border-amber-400/50 bg-amber-500/15 text-amber-300'
    : locked
      ? qualified
        ? 'nfl-official-live border-emerald-400/50 text-emerald-50'
        : 'border-sky-400/40 bg-sky-500/10 text-sky-300'
      : 'border-violet-400/40 bg-violet-500/10 text-violet-200';
  return <div className="relative z-10 border-b border-border/70 bg-background/35 px-3 py-3 backdrop-blur-[1px] sm:px-5 sm:py-4"><div className="flex items-center justify-between gap-2 sm:gap-4"><div className="flex items-center gap-2.5 sm:gap-4"><TeamMark team={game.away} large/><span className="text-[9px] font-bold text-muted-foreground sm:text-[10px]">AT</span><TeamMark team={game.home} large/></div><Badge className={`shrink-0 px-2 text-[9px] sm:text-xs ${statusClass}`}>{statusLabel}</Badge></div><div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-muted-foreground sm:mt-3 sm:text-[10px]"><span className="flex items-center gap-1"><Clock className="h-3 w-3"/>{formatTime(game.date)}</span><span className="max-w-[42%] truncate text-right">{locked ? 'Pregame picks frozen' : 'Model updates until ~35m before kickoff'}</span></div></div>;
}

function PlayerPhoto({ row }: { row: PlayerMarket }) {
  return <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-muted/30 sm:h-20 sm:w-20 sm:rounded-xl">{row.headshot ? <img src={row.headshot} alt={row.player} className="h-full w-full object-cover object-top"/> : <div className="flex h-full w-full items-center justify-center text-lg font-black text-muted-foreground sm:text-xl">{row.player.split(' ').map(x => x[0]).slice(0, 2).join('')}</div>}</div>;
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return <div><div className="text-[7px] font-bold uppercase tracking-wide text-muted-foreground sm:text-[8px]">{label}</div><div className={`mt-0.5 font-mono text-xs font-black sm:text-sm ${good ? 'text-emerald-500' : ''}`}>{value}</div></div>;
}

function QuoteStrip({ quotes }: { quotes: BookQuote[] }) {
  return <div className="mt-2.5 flex gap-1.5 overflow-x-auto sm:mt-3 sm:gap-2">{[...quotes].sort((a, b) => b.americanOdds - a.americanOdds).slice(0, 3).map((q, i) => <div key={`${q.bookmakerKey}-${i}`} className="flex min-w-[92px] items-center gap-1.5 rounded-lg border bg-background/60 px-2 py-1.5 backdrop-blur-sm sm:min-w-[108px] sm:gap-2"><SportsbookLogo book={q.bookmaker}/><div><div className="max-w-[54px] truncate text-[7px] text-muted-foreground sm:max-w-[65px] sm:text-[8px]">{q.bookmaker}</div><div className="font-mono text-[11px] font-black sm:text-xs">{odds(q.americanOdds)}</div></div></div>)}</div>;
}

function PlayerPick({ row, index, game, locked }: { row: PlayerMarket; index: number; game: NflGame; locked: boolean }) {
  const team = row.team === game.home.abbreviation ? game.home : game.away;
  const edge = row.edgePoints;
  const dataNotReady = row.dataStatus === 'not-ready';
  const won = row.result === 'won';
  return <div className={`rounded-xl border p-3 backdrop-blur-sm sm:p-4 ${won ? 'nfl-verified-winner border-emerald-400 bg-emerald-500/10' : row.qualifies ? 'border-emerald-500/30 bg-background/75 ring-1 ring-emerald-500/10' : 'bg-background/65'}`}><div className="flex gap-2.5 sm:gap-4"><PlayerPhoto row={row}/><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2 sm:gap-3"><div className="min-w-0"><div className="flex items-center gap-1.5 sm:gap-2"><span className="text-[8px] font-black text-muted-foreground sm:text-[9px]">#{index + 1}</span><h3 className="truncate text-sm font-black sm:text-base">{row.player}</h3>{won ? <Badge className="h-5 border-emerald-300/60 bg-emerald-500 px-1.5 text-[7px] text-white">WON</Badge> : row.qualifies && <Badge className="hidden h-5 border-emerald-500/30 bg-emerald-500/15 px-1.5 text-[7px] text-emerald-500 xs:inline-flex">{locked ? 'PLAY' : 'LEADING'}</Badge>}{dataNotReady && <Badge className="hidden h-5 border-amber-500/30 bg-amber-500/15 px-1.5 text-[7px] text-amber-400 xs:inline-flex">DATA NOT READY</Badge>}</div><div className="mt-1 flex min-w-0 items-center gap-1.5 sm:gap-2"><TeamMark team={team}/><span className="truncate text-[8px] text-muted-foreground sm:text-[9px]">{row.position || 'Skill'} • {row.quoteCount} books</span></div></div><div className="shrink-0 text-right"><div className="font-mono text-xl font-black sm:text-2xl">{odds(row.bestOdds)}</div><div className="text-[7px] uppercase text-muted-foreground sm:text-[8px]">best odds</div></div></div><div className="mt-2.5 grid grid-cols-4 gap-1.5 border-t pt-2.5 sm:mt-3 sm:gap-3 sm:pt-3"><Metric label="Prezi %" value={pct(row.modelProbability)} good={row.qualifies}/><Metric label="Book %" value={pct(row.impliedProbability)}/><Metric label="Edge pts" value={edge == null ? '—' : `${edge >= 0 ? '+' : ''}${edge.toFixed(1)}`} good={edge != null && edge > 0}/><Metric label="Bet EV" value={ev(row.expectedValue)} good={(row.expectedValue ?? 0) > 0}/></div></div></div><QuoteStrip quotes={row.quotes}/>{row.reasons?.length ? <details className="mt-2.5 sm:mt-3"><summary className="cursor-pointer text-[8px] font-bold uppercase tracking-wide text-muted-foreground sm:text-[9px]">{dataNotReady ? 'Why this is not a model pick' : 'Why the model likes this player'}</summary><div className="mt-2 rounded-lg bg-background/55 p-2.5 text-[8px] leading-4 text-muted-foreground sm:p-3 sm:text-[9px] sm:leading-5">{row.reasons.slice(1).map((r, i) => <div key={i}>• {r}</div>)}</div></details> : null}</div>;
}

function TdCard({ game, first }: { game: NflGame; first: boolean }) {
  const rows = (first ? game.firstTd : game.anytimeTd).slice(0, 3);
  const lockedAt = first ? game.tdLocks?.firstTd : game.tdLocks?.anytimeTd;
  const locked = Boolean(lockedAt);
  const official = locked ? rows.filter(r => r.qualifies) : [];
  const modeled = rows.filter(r => r.dataStatus !== 'not-ready');
  const dataNotReady = rows.length === 0 || rows.every(r => r.dataStatus === 'not-ready');
  return <article className="relative isolate overflow-hidden rounded-xl border bg-card shadow-sm sm:rounded-2xl"><StadiumBackdrop home={game.home}/><GameHeader game={game} qualified={official.length > 0} dataNotReady={dataNotReady} locked={locked}/><div className="relative z-10 p-3 sm:p-5"><div className="mb-3 flex items-center justify-between gap-2 sm:mb-4"><div className="flex min-w-0 items-center gap-1.5 sm:gap-2"><Crosshair className="h-3.5 w-3.5 shrink-0 text-primary sm:h-4 sm:w-4"/><div className="truncate text-xs font-black sm:text-sm">{first ? 'Who scores the FIRST touchdown?' : 'Who scores a touchdown ANYTIME?'}</div></div><div className="flex shrink-0 gap-1.5 sm:gap-2">{locked ? <><Badge className="border-emerald-500/30 bg-emerald-500/15 px-2 text-[9px] text-emerald-500 sm:text-xs">{official.length} official</Badge><Badge variant="outline" className="px-2 text-[9px] sm:text-xs">LOCKED</Badge></> : <><Badge className="border-violet-400/30 bg-violet-500/10 px-2 text-[9px] text-violet-200 sm:text-xs">PREVIEW</Badge><Badge variant="outline" className="px-2 text-[9px] sm:text-xs">{modeled.length} candidate{modeled.length === 1 ? '' : 's'}</Badge></>}</div></div>{rows.length ? <div className="space-y-2.5 sm:space-y-3">{rows.map((r, i) => <PlayerPick key={`${game.id}-${r.player}`} row={r} index={i} game={game} locked={locked}/>)}</div> : <div className="rounded-xl border bg-background/65 p-6 text-center text-xs font-black text-amber-400 backdrop-blur-sm sm:p-8 sm:text-sm">DATA NOT READY</div>}</div></article>;
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-xl border bg-card p-8 text-center sm:rounded-2xl sm:p-12"><ShieldCheck className="mx-auto h-7 w-7 text-muted-foreground/40"/><div className="mt-3 text-sm font-semibold">No {label} model candidates right now</div></div>;
}

export default function NFL() {
  const [tab, setTab] = useState<MarketTab>('firsttd');
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 15000); return () => window.clearInterval(timer); }, []);
  const query = useQuery<NflFeed>({
    queryKey: ['/api/nfl/markets'],
    queryFn: async () => {
      const response = await fetch(`/api/nfl/markets?fresh=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load NFL markets');
      return response.json();
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 60000,
    retry: 1,
  });
  if (query.isLoading) return <Skeleton className="h-96"/>;

  const now = clock.getTime();
  const previewEnd = now + 72 * 60 * 60 * 1000;
  const postKickoffHold = now - 90 * 60 * 1000;
  const easternDateKey = (value: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  const games = [...(query.data?.games ?? [])]
    .filter(g => {
      const start = new Date(g.date).getTime();
      return Number.isFinite(start) && start >= postKickoffHold && start <= previewEnd;
    })
    .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  // Show one game-day slate at a time, not an arbitrary 24-clock-hour slice.
  // On Friday this can surface Sunday's slate as soon as TD markets are posted;
  // on Sunday it stays on Sunday, then naturally advances to Monday.
  const nextSlateDate = games[0] ? easternDateKey(games[0].date) : null;
  const visible = nextSlateDate
    ? games.filter(g => easternDateKey(g.date) === nextSlateDate)
    : [];

  return <div className="-mx-4 -mt-8 md:-mx-6 lg:-mx-8"><div className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between px-2 sm:px-4"><div className="nfl-market-tabs flex overflow-x-auto" role="tablist" aria-label="NFL sections"><button role="tab" aria-selected={tab === 'firsttd'} onClick={() => setTab('firsttd')} className={`h-10 whitespace-nowrap border-b-2 px-3 text-[11px] sm:h-12 sm:px-4 sm:text-xs ${tab === 'firsttd' ? 'border-primary font-bold' : 'border-transparent text-muted-foreground'}`}>First TD</button><button role="tab" aria-selected={tab === 'anytime'} onClick={() => setTab('anytime')} className={`h-10 whitespace-nowrap border-b-2 px-3 text-[11px] sm:h-12 sm:px-4 sm:text-xs ${tab === 'anytime' ? 'border-primary font-bold' : 'border-transparent text-muted-foreground'}`}>Anytime TD</button></div><Button variant="ghost" size="sm" onClick={() => query.refetch()} className="h-8 w-8 p-0 sm:h-9 sm:w-9"><RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? 'animate-spin' : ''}`}/></Button></div></div><main className="mx-auto max-w-6xl px-2.5 py-3 sm:px-4 sm:py-6">{query.isError ? <Empty label="NFL"/> : visible.length ? <div className="space-y-3 sm:space-y-5">{visible.map(g => <TdCard key={g.id} game={g} first={tab === 'firsttd'}/>)}</div> : <Empty label={tab === 'firsttd' ? 'First TD' : 'Anytime TD'}/>}</main></div>;
}
