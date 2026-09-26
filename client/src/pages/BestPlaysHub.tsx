import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { CheckCircle2, ChevronDown, Clock3, Mail, Trophy, XCircle } from 'lucide-react';
import BestPlays from './BestPlays';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import mlbHero from '@/assets/best-plays-slides/mlb-home-run.webp';
import nbaHero from '@/assets/best-plays-slides/nba-jump-shot.webp';
import wnbaHero from '@/assets/best-plays-slides/wnba-jump-shot.webp';
import nflHero from '@/assets/best-plays-slides/nfl-quarterback.webp';

type Outcome = { id:string; sport:'MLB'|'WNBA'|'NBA'|string; market:string; matchup:string; pick:string; probability:number; result:'won'|'lost'; actual:string; gradedAt:string|null; href:string };
type OutcomePayload = { date:string; resetTimeZone?:string; resetAt?:string; total:number; wins:number; losses:number; outcomes:Outcome[] };
type View = 'games'|'outcomes'|'wins'|'yesterday';

function OutcomeCard({ row }: { row: Outcome }) {
  const won = row.result === "won";
  return <Link href={row.href} className={`bp-play-row group relative block overflow-hidden rounded-xl border p-4 transition-all ${won ? "border-emerald-500/35 bg-emerald-500/[.06] hover:bg-emerald-500/[.1]" : "border-rose-500/35 bg-rose-500/[.06] hover:bg-rose-500/[.1]"}`}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[9px]">{row.sport}</Badge>
          <Badge variant="outline" className="text-[9px]">{row.market}</Badge>
          <span className="truncate text-[10px] text-muted-foreground">{row.matchup}</span>
          <Badge variant="outline" className={`text-[8px] font-black ${won ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-500" : "border-rose-500/35 bg-rose-500/10 text-rose-500"}`}>{won ? "✓ WON" : "✕ LOST"}</Badge>
        </div>
        <div className="mt-2 text-[15px] font-bold tracking-tight">{row.pick}</div>
        <div className={`mt-1 text-[10px] font-medium ${won ? "text-emerald-600" : "text-rose-600"}`}>Verified result: {row.actual}</div>
      </div>
      <div className="shrink-0 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-right">
        <div className="font-mono text-lg font-black text-primary">{Number(row.probability).toFixed(1)}%</div>
        <div className="text-[8px] uppercase tracking-[.16em] text-muted-foreground">model</div>
      </div>
    </div>
  </Link>;
}

export default function BestPlaysHub() {
  const [view,setView]=useState<View>('games');
  const [newsletterEmail,setNewsletterEmail]=useState('');
  const [newsletterStatus,setNewsletterStatus]=useState('');
  const [subscribing,setSubscribing]=useState(false);
  const results=useQuery<OutcomePayload>({queryKey:['/api/best-plays/outcomes'],staleTime:30000,refetchInterval:60000,retry:1});
  const yesterdayResults=useQuery<OutcomePayload>({queryKey:['/api/best-plays/outcomes','yesterday'],queryFn:async()=>{const r=await fetch('/api/best-plays/outcomes?date=yesterday');if(!r.ok)throw new Error('Unable to load yesterday results');return r.json()},enabled:view==='yesterday',staleTime:300000,refetchInterval:600000,retry:1});
  const allOutcomes=[...(results.data?.outcomes||[])].filter(row=>String(row.sport).toUpperCase()!=='KBO').filter(row=>{const sport=String(row.sport).toUpperCase();const market=String(row.market||'').toLowerCase();const isHomeRun=sport==='MLB'&&(market.includes('home run')||/(^|\s)hr(\s|$)/.test(market));const isWnbaFirstBasket=sport==='WNBA'&&market.includes('first basket');return !isHomeRun&&!isWnbaFirstBasket;}).sort((a,b)=>new Date(b.gradedAt||0).getTime()-new Date(a.gradedAt||0).getTime());
  const filtered=allOutcomes.filter(row=>view!=='wins'||row.result==='won');
  const total=allOutcomes.length,wins=allOutcomes.filter(row=>row.result==='won').length,losses=allOutcomes.filter(row=>row.result==='lost').length;
  const outcomesLoading=results.isLoading,outcomesError=results.isError;
  const yesterdayOutcomes=(yesterdayResults.data?.outcomes||[]).sort((a,b)=>new Date(b.gradedAt||0).getTime()-new Date(a.gradedAt||0).getTime());
  const yesterdayWins=yesterdayResults.data?.wins||0,yesterdayLosses=yesterdayResults.data?.losses||0,yesterdayTotal=yesterdayWins+yesterdayLosses;

  async function subscribeNewsletter(e:React.FormEvent){e.preventDefault();if(!newsletterEmail.trim())return;setSubscribing(true);setNewsletterStatus('');try{const r=await fetch('/api/newsletter/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:newsletterEmail.trim()})});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body?.error||'Unable to subscribe');setNewsletterStatus('Subscribed — daily strongest plays will be sent to this email.');setNewsletterEmail('');}catch(err:any){setNewsletterStatus(err?.message||'Unable to subscribe right now.');}finally{setSubscribing(false);}}

  return <div className="bp-hub-shell relative left-1/2 w-screen -translate-x-1/2 -mt-4 min-h-[calc(100vh-10rem)] overflow-hidden">
    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(10,20,35,.98)_0%,rgba(8,18,32,.98)_22%,rgba(8,13,27,.98)_100%)]"/>
    <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/5 via-transparent to-background/35"/>

    <div className="bp-hub-frame relative z-10 mx-auto max-w-7xl space-y-4 px-3 py-4 sm:px-4 md:px-6 lg:px-8">
      <div className="bp-command-hero relative z-20 overflow-hidden border backdrop-blur-sm">
        <div className="bp-command-slides absolute inset-0" aria-hidden="true">
          {[mlbHero, nbaHero, wnbaHero, nflHero].map((src, index) => (
            <img key={src} src={src} alt="" className={`bp-command-slide bp-command-slide-${index + 1} absolute inset-0 h-full w-full object-cover object-center`}/>
          ))}
        </div>
        <div className="bp-command-shade absolute inset-0"/>
        <div className="relative flex min-h-[150px] flex-col justify-between gap-5 p-5 sm:min-h-[180px] sm:flex-row sm:items-end sm:p-7"><div className="bp-command-copy min-w-0"><div className="bp-command-kicker"><span className="bp-live-dot"/>PREZITOOLS INTELLIGENCE</div><div className="mt-3 flex items-center gap-3"><span className="bp-command-icon"><Trophy className="h-5 w-5"/></span><h1 className="text-2xl font-black tracking-[-.035em] sm:text-4xl">Best Plays Command Center</h1></div><div className="mt-2 text-[10px] font-medium uppercase tracking-[.18em] text-muted-foreground">Daily board · Midnight ET reset</div></div><div className="bp-view-control relative shrink-0"><select value={view} onChange={e=>setView(e.target.value as View)} className="bp-view-select appearance-none border bg-background/80 py-2.5 pl-4 pr-10 text-xs font-black backdrop-blur focus:outline-none focus:ring-2 focus:ring-ring" aria-label="Best Plays view"><option value="games">Today's Games</option><option value="outcomes">Today's Outcomes</option><option value="wins">Today's Winning Outcomes</option><option value="yesterday">Yesterday's Results</option></select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary"/></div></div>
      </div>

      <div className="bp-newsletter-dock border backdrop-blur-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-2 text-sm font-black"><span className="bp-mail-icon"><Mail className="h-4 w-4"/></span>PreziTools Daily Plays</div><div className="mt-1 text-[10px] text-muted-foreground">The strongest active plays, delivered once daily.</div></div><form onSubmit={subscribeNewsletter} className="flex w-full gap-2 sm:w-auto"><input type="email" required value={newsletterEmail} onChange={e=>setNewsletterEmail(e.target.value)} placeholder="you@email.com" className="bp-newsletter-input min-w-0 flex-1 border bg-background/70 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring sm:w-56" aria-label="Newsletter email"/><button type="submit" disabled={subscribing} className="bp-newsletter-button bg-primary px-4 py-2 text-xs font-black text-primary-foreground disabled:opacity-60">{subscribing?'Joining…':'Join'}</button></form></div>{newsletterStatus?<div className="mt-2 text-[10px] text-muted-foreground">{newsletterStatus}</div>:null}</div>

      {view==='games'?<BestPlays/>:view==='yesterday'?<div className="space-y-4">{yesterdayResults.isLoading?<><Skeleton className="h-24 w-full"/><Skeleton className="h-24 w-full"/></>:yesterdayResults.isError?<div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">Yesterday's verified results are temporarily unavailable.</div>:<><div className="grid grid-cols-3 gap-3"><div className="rounded-lg border bg-card p-3"><div className="text-xl font-bold">{yesterdayTotal}</div><div className="text-[10px] text-muted-foreground">Graded yesterday</div></div><div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3"><div className="text-xl font-bold text-emerald-500">{yesterdayWins}</div><div className="text-[10px] text-muted-foreground">Winning plays</div></div><div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3"><div className="text-xl font-bold text-red-500">{yesterdayLosses}</div><div className="text-[10px] text-muted-foreground">Misses</div></div></div><div className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><Clock3 className="w-3.5 h-3.5"/>Verified Best Plays from yesterday's Eastern Time calendar day.</div>{yesterdayOutcomes.length?<div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{yesterdayOutcomes.map(row=><OutcomeCard key={row.id} row={row}/>)}</div>:<div className="rounded-lg border bg-card p-8 text-center"><div className="font-semibold text-sm">No graded results from yesterday.</div><div className="mt-1 text-[10px] text-muted-foreground">Only verified Best Plays appear here.</div></div>}</>}</div>:<div className="space-y-4">{outcomesLoading?<><Skeleton className="h-24 w-full"/><Skeleton className="h-24 w-full"/></>:outcomesError?<div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">Today's verified outcomes are temporarily unavailable.</div>:<><div className="grid grid-cols-3 gap-3"><div className="rounded-lg border bg-card p-3"><div className="text-xl font-bold">{total}</div><div className="text-[10px] text-muted-foreground">Graded today</div></div><div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3"><div className="text-xl font-bold text-emerald-500">{wins}</div><div className="text-[10px] text-muted-foreground">Winning plays</div></div><div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3"><div className="text-xl font-bold text-red-500">{losses}</div><div className="text-[10px] text-muted-foreground">Misses</div></div></div><div className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><Clock3 className="w-3.5 h-3.5"/>Only verified, graded plays from the current Eastern Time calendar day appear here.</div>{filtered.length?<div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{filtered.map(row=><OutcomeCard key={row.id} row={row}/>)}</div>:<div className="rounded-lg border bg-card p-8 text-center"><div className="font-semibold text-sm">{view==='wins'?'No winning outcomes posted yet.':'No graded outcomes yet.'}</div><div className="mt-1 text-[10px] text-muted-foreground">Results will appear automatically as today's Best Plays finish and are verified.</div></div>}</>}</div>}
    </div>
  </div>;
}
