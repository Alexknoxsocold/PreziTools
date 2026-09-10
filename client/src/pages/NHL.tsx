import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, ShieldCheck, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type MarketTab = 'anytime' | 'first' | 'moneyline';
type Scorer = { player: string; bestOdds: number; bestBook: string; modelProbability?: number; impliedProbability: number; edgePoints?: number; expectedValue?: number; qualifies?: boolean; reasons?: string[]; dataStatus: 'modeled' | 'not-ready' };
type MlModel = { modelProbability: number; marketProbability: number; edgePoints: number; expectedValue: number; qualifies: boolean; reasons: string[] };
type MlSide = { team: string; bestOdds: number; bestBook: string; model: MlModel | null; dataStatus: 'modeled' | 'not-ready' };
type Game = { id: string; date: string; away: string; home: string; moneyline: { away: MlSide; home: MlSide } | null; anytimeGoal: Scorer[]; firstGoal: Scorer[] };
type Perf = { totalRecorded: number; pending: number; graded: number; wins: number; losses: number; hitRate: number | null; units: number; roi: number | null; markets: { market: string; picks: number; wins: number; losses: number; hitRate: number | null; units: number; roi: number | null }[]; modelPolicy: string; automaticRewriting: boolean };
type Feed = { modelVersion: string; moneylineModelVersion: string; marketStatus: string; games: Game[]; health: { rawScorers: number; modeledScorers: number; coveragePct: number }; performance: Perf };
type WikiSummary = { thumbnail?: { source?: string }; originalimage?: { source?: string } };

const odds = (n: number) => n > 0 ? `+${n}` : `${n}`;
const pct = (n?: number | null) => n == null ? '—' : `${n.toFixed(1)}%`;
const ev = (n?: number | null) => n == null ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
const edge = (n?: number | null) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;

const NHL_ABBR: Record<string, string> = {
  'Anaheim Ducks': 'ana', 'Boston Bruins': 'bos', 'Buffalo Sabres': 'buf', 'Calgary Flames': 'cgy', 'Carolina Hurricanes': 'car',
  'Chicago Blackhawks': 'chi', 'Colorado Avalanche': 'col', 'Columbus Blue Jackets': 'cbj', 'Dallas Stars': 'dal', 'Detroit Red Wings': 'det',
  'Edmonton Oilers': 'edm', 'Florida Panthers': 'fla', 'Los Angeles Kings': 'la', 'Minnesota Wild': 'min', 'Montreal Canadiens': 'mtl',
  'Nashville Predators': 'nsh', 'New Jersey Devils': 'nj', 'New York Islanders': 'nyi', 'New York Rangers': 'nyr', 'Ottawa Senators': 'ott',
  'Philadelphia Flyers': 'phi', 'Pittsburgh Penguins': 'pit', 'San Jose Sharks': 'sj', 'Seattle Kraken': 'sea', 'St. Louis Blues': 'stl',
  'Tampa Bay Lightning': 'tb', 'Toronto Maple Leafs': 'tor', 'Utah Mammoth': 'utah', 'Utah Hockey Club': 'utah', 'Vancouver Canucks': 'van',
  'Vegas Golden Knights': 'vgk', 'Washington Capitals': 'wsh', 'Winnipeg Jets': 'wpg'
};

function teamLogo(team: string) {
  const abbr = NHL_ABBR[team];
  return abbr ? `https://a.espncdn.com/i/teamlogos/nhl/500/${abbr}.png` : null;
}

function TeamMark({ team, large = false }: { team: string; large?: boolean }) {
  const logo = teamLogo(team);
  return <div className="flex min-w-0 items-center gap-2">
    <div className={`${large ? 'h-10 w-10 sm:h-12 sm:w-12' : 'h-7 w-7'} flex shrink-0 items-center justify-center rounded-full border bg-white/95 p-1 shadow-sm`}>
      {logo ? <img src={logo} alt={`${team} logo`} loading="lazy" decoding="async" className="h-full w-full object-contain"/> : <span className="text-[9px] font-black text-black">{team.slice(0, 2).toUpperCase()}</span>}
    </div>
    <div className={`${large ? 'text-xs sm:text-sm' : 'text-[11px]'} min-w-0 truncate font-black`}>{team}</div>
  </div>;
}

function PlayerPhoto({ name }: { name: string }) {
  const [loadPhoto, setLoadPhoto] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setLoadPhoto(true), 350); return () => window.clearTimeout(timer); }, [name]);
  const { data } = useQuery<WikiSummary>({
    queryKey: ['nhl-player-photo', name], staleTime: 86400000, gcTime: 604800000, retry: 0, enabled: loadPhoto,
    queryFn: async () => { const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`); if (!r.ok) throw new Error('photo unavailable'); return r.json(); }
  });
  const image = data?.thumbnail?.source ?? data?.originalimage?.source;
  return <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-muted/40 sm:h-20 sm:w-20">
    {image ? <img src={image} alt={name} loading="lazy" decoding="async" className="h-full w-full object-cover object-top"/> : <div className="flex h-full w-full items-center justify-center text-lg font-black text-muted-foreground">{name.split(' ').map(x => x[0]).slice(0, 2).join('')}</div>}
  </div>;
}

function metricTone(value: number | undefined | null, kind: 'prob' | 'edge' | 'ev') {
  if (value == null) return 'text-muted-foreground';
  if (kind === 'edge') return value >= 5 ? 'text-emerald-500' : value > 0 ? 'text-amber-400' : 'text-rose-500';
  if (kind === 'ev') return value >= .10 ? 'text-emerald-500' : value > 0 ? 'text-amber-400' : 'text-rose-500';
  return value >= 40 ? 'text-emerald-500' : value >= 20 ? 'text-amber-400' : 'text-foreground';
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-lg bg-background/55 px-2 py-2 text-center">
    <div className="text-[8px] font-bold uppercase tracking-wide text-muted-foreground sm:text-[9px]">{label}</div>
    <div className={`mt-0.5 font-mono text-sm font-black sm:text-base ${tone ?? ''}`}>{value}</div>
  </div>;
}

function GameHeader({ game }: { game: Game }) {
  return <div className="border-b bg-background/35 px-3 py-3 sm:px-5 sm:py-4">
    <div className="flex items-center justify-between gap-2 sm:gap-4">
      <TeamMark team={game.away} large/>
      <span className="shrink-0 text-[9px] font-black text-muted-foreground">AT</span>
      <div className="flex justify-end"><TeamMark team={game.home} large/></div>
    </div>
    <div className="mt-2 text-center text-[9px] text-muted-foreground sm:text-[10px]">{game.date ? new Date(game.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : ''}</div>
  </div>;
}

function PlayerCard({ p, rank }: { p: Scorer; rank: number }) {
  const ready = p.dataStatus === 'modeled';
  return <Card className={`${p.qualifies ? 'border-emerald-500/35 ring-1 ring-emerald-500/10' : ''} overflow-hidden`}>
    <CardContent className="p-3 sm:p-4">
      <div className="flex gap-3 sm:gap-4">
        <PlayerPhoto name={p.player}/>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><div className="text-[9px] font-black text-muted-foreground">#{rank}</div><div className="truncate text-base font-black sm:text-lg">{p.player}</div><div className="mt-1 text-[10px] text-muted-foreground sm:text-xs">{odds(p.bestOdds)} · {p.bestBook}</div></div>
            <Badge className={`shrink-0 text-[8px] sm:text-[10px] ${p.qualifies ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-500' : ready ? 'border-amber-400/40 bg-amber-500/15 text-amber-400' : 'border-border bg-muted text-muted-foreground'}`}>{p.qualifies ? 'OFFICIAL PLAY' : ready ? 'MODEL LEAN' : 'DATA NOT READY'}</Badge>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1.5 sm:gap-2">
            <Metric label="Prezi" value={ready ? pct(p.modelProbability) : '—'} tone={metricTone(p.modelProbability, 'prob')}/>
            <Metric label="Book" value={pct(p.impliedProbability)}/>
            <Metric label="Edge" value={ready ? edge(p.edgePoints) : '—'} tone={metricTone(p.edgePoints, 'edge')}/>
            <Metric label="EV" value={ready ? ev(p.expectedValue) : '—'} tone={metricTone(p.expectedValue, 'ev')}/>
          </div>
        </div>
      </div>
      {p.reasons?.length ? <details className="mt-3"><summary className="cursor-pointer text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Model details</summary><div className="mt-2 rounded-lg bg-muted/30 p-2.5 text-[10px] leading-5 text-muted-foreground">{p.reasons.slice(0, 3).map((r, i) => <div key={i}>• {r}</div>)}</div></details> : null}
    </CardContent>
  </Card>;
}

function GoalGame({ game, first }: { game: Game; first: boolean }) {
  const rows = first ? game.firstGoal : game.anytimeGoal;
  return <section className="overflow-hidden rounded-xl border bg-card shadow-sm sm:rounded-2xl">
    <GameHeader game={game}/>
    <div className="p-3 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Target className="h-4 w-4 text-primary"/><h2 className="text-sm font-black sm:text-base">{first ? 'First Goal Scorers' : 'Anytime Goal Scorers'}</h2></div><Badge variant="outline" className="text-[9px]">{rows.length} picks</Badge></div>
      {rows.length ? <div className="space-y-2.5 sm:space-y-3">{rows.map((p, i) => <PlayerCard key={`${game.id}-${p.player}`} p={p} rank={i + 1}/>)}</div> : <Empty label={first ? 'First Goal' : 'Anytime Goal'}/>} 
    </div>
  </section>;
}

function MoneylineGame({ game }: { game: Game }) {
  const m = game.moneyline;
  return <section className="overflow-hidden rounded-xl border bg-card shadow-sm sm:rounded-2xl">
    <GameHeader game={game}/>
    <div className="p-3 sm:p-5">
      {!m ? <Empty label="Moneyline"/> : <div className="grid gap-3 sm:grid-cols-2">{[m.away, m.home].map(s => { const x = s.model; return <Card key={s.team} className={`${x?.qualifies ? 'border-emerald-500/35 ring-1 ring-emerald-500/10' : ''}`}><CardContent className="p-4"><div className="flex items-start justify-between gap-2"><TeamMark team={s.team}/><Badge className={`text-[8px] ${x?.qualifies ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-500' : x ? 'border-amber-400/40 bg-amber-500/15 text-amber-400' : ''}`}>{x?.qualifies ? 'OFFICIAL PLAY' : x ? 'MODEL LEAN' : 'DATA NOT READY'}</Badge></div><div className="mt-3 font-mono text-2xl font-black">{odds(s.bestOdds)}</div><div className="text-[10px] text-muted-foreground">{s.bestBook}</div>{x ? <div className="mt-4 grid grid-cols-4 gap-1.5"><Metric label="Prezi" value={pct(x.modelProbability)} tone={metricTone(x.modelProbability, 'prob')}/><Metric label="Book" value={pct(x.marketProbability)}/><Metric label="Edge" value={edge(x.edgePoints)} tone={metricTone(x.edgePoints, 'edge')}/><Metric label="EV" value={ev(x.expectedValue)} tone={metricTone(x.expectedValue, 'ev')}/></div> : null}</CardContent></Card>})}</div>}
    </div>
  </section>;
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-xl border bg-card/50 p-7 text-center"><ShieldCheck className="mx-auto h-6 w-6 text-muted-foreground/40"/><div className="mt-2 text-sm font-semibold">No {label} market data available.</div></div>;
}

function Performance({ p }: { p: Perf }) {
  return <Card><CardContent className="p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-black sm:text-lg">NHL V1 Forward-Test Performance</h2><p className="text-[10px] text-muted-foreground">Frozen production predictions · no automatic model rewriting</p></div><Badge variant="outline">{p.graded} graded · {p.pending} pending</Badge></div><div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-5"><Metric label="Record" value={`${p.wins}-${p.losses}`}/><Metric label="Hit Rate" value={p.hitRate == null ? '—' : `${p.hitRate}%`} tone={p.hitRate != null && p.hitRate >= 50 ? 'text-emerald-500' : ''}/><Metric label="Units" value={`${p.units > 0 ? '+' : ''}${p.units}`} tone={p.units > 0 ? 'text-emerald-500' : p.units < 0 ? 'text-rose-500' : ''}/><Metric label="ROI" value={p.roi == null ? '—' : `${p.roi}%`} tone={p.roi != null && p.roi > 0 ? 'text-emerald-500' : p.roi != null && p.roi < 0 ? 'text-rose-500' : ''}/><Metric label="Recorded" value={`${p.totalRecorded}`}/></div></CardContent></Card>;
}

export default function NHL() {
  const [tab, setTab] = useState<MarketTab>('anytime');
  const query = useQuery<Feed>({ queryKey: ['/api/nhl/markets'], queryFn: async () => { const r = await fetch('/api/nhl/markets'); if (!r.ok) throw new Error(); return r.json(); }, staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000, refetchInterval: 5 * 60 * 1000, refetchOnWindowFocus: false });
  if (query.isLoading) return <div className="py-12 text-center">Loading NHL models…</div>;
  if (query.error || !query.data) return <div className="py-12 text-center text-muted-foreground">NHL market data is temporarily unavailable.</div>;
  const data = query.data;
  const now = Date.now();
  const nextGame = [...data.games].filter(g => { const t = Date.parse(g.date); return Number.isFinite(t) && t > now; }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0] ?? [...data.games].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
  const visible = nextGame ? (tab === 'anytime' && nextGame.anytimeGoal.length ? [nextGame] : tab === 'first' && nextGame.firstGoal.length ? [nextGame] : tab === 'moneyline' && nextGame.moneyline ? [nextGame] : []) : [];
  return <div className="-mx-4 -mt-8 md:-mx-6 lg:-mx-8">
    <div className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-2 sm:px-4">
        <div className="flex overflow-x-auto">
          <button onClick={() => setTab('anytime')} className={`h-11 whitespace-nowrap border-b-2 px-3 text-[11px] sm:h-12 sm:px-5 sm:text-xs ${tab === 'anytime' ? 'border-primary font-black text-primary' : 'border-transparent text-muted-foreground'}`}>Anytime Goal</button>
          <button onClick={() => setTab('first')} className={`h-11 whitespace-nowrap border-b-2 px-3 text-[11px] sm:h-12 sm:px-5 sm:text-xs ${tab === 'first' ? 'border-primary font-black text-primary' : 'border-transparent text-muted-foreground'}`}>First Goal</button>
          <button onClick={() => setTab('moneyline')} className={`h-11 whitespace-nowrap border-b-2 px-3 text-[11px] sm:h-12 sm:px-5 sm:text-xs ${tab === 'moneyline' ? 'border-primary font-black text-primary' : 'border-transparent text-muted-foreground'}`}>Moneyline</button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => query.refetch()} className="h-8 w-8 p-0"><RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? 'animate-spin' : ''}`}/></Button>
      </div>
    </div>
    <main className="mx-auto max-w-6xl space-y-4 px-2.5 py-4 sm:space-y-6 sm:px-4 sm:py-6">
      <div><h1 className="text-2xl font-black sm:text-3xl">NHL Models</h1><p className="text-xs text-muted-foreground">Next upcoming matchup only · separate market views · frozen V1 forward test</p></div>
      <Performance p={data.performance}/>
      <div className="flex gap-2"><Badge variant="outline">Coverage {data.health.coveragePct}%</Badge><Badge variant="outline">Modeled {data.health.modeledScorers}/{data.health.rawScorers}</Badge></div>
      {visible.length ? <div className="space-y-3 sm:space-y-5">{tab === 'moneyline' ? <MoneylineGame game={visible[0]}/> : <GoalGame game={visible[0]} first={tab === 'first'}/>}</div> : <Empty label={tab === 'anytime' ? 'Anytime Goal' : tab === 'first' ? 'First Goal' : 'Moneyline'}/>} 
    </main>
  </div>;
}