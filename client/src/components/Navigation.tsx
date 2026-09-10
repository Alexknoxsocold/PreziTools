import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { CheckCircle2, ChevronDown, Sparkles, XCircle } from "lucide-react";

function BasketballIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3c2.2 2.6 3.3 5.6 3.3 9S14.2 18.4 12 21M12 3C9.8 5.6 8.7 8.6 8.7 12s1.1 6.4 3.3 9M3.4 9.2c2.6.8 5.5 1.2 8.6 1.2s6-.4 8.6-1.2M3.4 14.8c2.6-.8 5.5-1.2 8.6-1.2s6 .4 8.6 1.2"/></svg>;
}

function BaseballIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M7.1 4.5c1.7 1.7 2.6 3.8 2.6 6.2s-.9 4.5-2.6 6.2M16.9 7.1c-1.7 1.7-2.6 3.8-2.6 6.2s.9 4.5 2.6 6.2"/><path d="m8.3 7.5-1.5.4m2.1 2.2-1.6.2m8.4 6.2 1.5-.4m-2.1-2.2 1.6-.2"/></svg>;
}

function FootballIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d="M19.8 4.2c-3.1-3.1-9.2-.8-12.7 2.7S1.3 16.5 4.2 19.8c3.1 3.1 9.2.8 12.7-2.7s5.8-9.6 2.9-12.9Z"/><path d="m8.5 15.5 7-7m-4.8 4.8-2-2m4.6.6-2-2m4.6.6-2-2"/></svg>;
}

function HockeyIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d="m15.8 3-2.7 11.2c-.4 1.6-1.8 2.8-3.5 2.8H5.5c-1.4 0-2.5 1.1-2.5 2.5S4.1 22 5.5 22h5.1c3.4 0 6.4-2.3 7.2-5.6L21 3"/><ellipse cx="18.5" cy="20" rx="2.5" ry="1.2"/></svg>;
}

type SportIcon = "best" | "basketball" | "baseball" | "football" | "hockey";
type Outcome = { id:string; sport:string; market:string; matchup:string; pick:string; probability:number; result:"won"|"lost"; actual:string; href:string };
type OutcomePayload = { date:string; total:number; wins:number; losses:number; outcomes:Outcome[] };

const navItems: { label: string; path: string; icon: SportIcon; glow: string }[] = [
  { label: "Best Plays", path: "/", icon: "best", glow: "nav-glow-best" },
  { label: "NBA", path: "/nba", icon: "basketball", glow: "nav-glow-nba" },
  { label: "WNBA", path: "/wnba", icon: "basketball", glow: "nav-glow-wnba" },
  { label: "MLB", path: "/mlb", icon: "baseball", glow: "nav-glow-mlb" },
  { label: "NFL", path: "/nfl", icon: "football", glow: "nav-glow-nfl" },
  { label: "NHL", path: "/nhl", icon: "hockey", glow: "nav-glow-nhl" },
];

function NavIcon({ type }: { type: SportIcon }) {
  const className = "w-4 h-4 shrink-0";
  if (type === "basketball") return <BasketballIcon className={className}/>;
  if (type === "baseball") return <BaseballIcon className={className}/>;
  if (type === "football") return <FootballIcon className={className}/>;
  if (type === "hockey") return <HockeyIcon className={className}/>;
  return <Sparkles aria-hidden="true" className={className}/>;
}

function YesterdayResults() {
  const [open,setOpen]=useState(false);
  const query=useQuery<OutcomePayload>({
    queryKey:["/api/best-plays/outcomes","yesterday"],
    queryFn:async()=>{const r=await fetch("/api/best-plays/outcomes?date=yesterday");if(!r.ok)throw new Error("results unavailable");return r.json();},
    staleTime:5*60*1000,
    refetchInterval:10*60*1000,
    retry:1
  });
  const data=query.data;
  const decided=(data?.wins??0)+(data?.losses??0);
  const rate=decided?Math.round(((data?.wins??0)/decided)*100):null;
  return <div className="border-t border-border/45 bg-background/75 backdrop-blur">
    <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-1.5">
      <button type="button" onClick={()=>setOpen(v=>!v)} className="w-full rounded-xl border border-border/60 bg-card/70 px-3 py-2.5 text-left transition-colors hover:bg-muted/40" aria-expanded={open}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5"><div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/10"><CheckCircle2 className="h-4 w-4 text-emerald-500"/></div><div className="min-w-0"><div className="text-[11px] font-black sm:text-xs">Yesterday&apos;s Results</div><div className="text-[9px] text-muted-foreground sm:text-[10px]">Verified graded Best Plays</div></div></div>
          <div className="flex shrink-0 items-center gap-2.5">{query.isLoading?<span className="text-[10px] text-muted-foreground">Loading…</span>:data&&decided>0?<><span className="font-mono text-xs font-black"><span className="text-emerald-500">{data.wins}W</span> <span className="text-muted-foreground">–</span> <span className="text-rose-500">{data.losses}L</span></span>{rate!==null&&<span className="hidden rounded-full bg-muted/60 px-2 py-1 text-[9px] font-bold sm:inline">{rate}% hit</span>}</>:<span className="text-[10px] text-muted-foreground">No graded plays</span>}<ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform",open&&"rotate-180")}/></div>
        </div>
      </button>
      {open&&<div className="mt-1.5 overflow-hidden rounded-xl border border-border/60 bg-card/80 shadow-lg"><div className="flex items-center justify-between border-b border-border/50 px-3 py-2"><span className="text-[9px] font-bold uppercase tracking-[.16em] text-muted-foreground">{data?.date??"Yesterday"}</span>{data&&<span className="text-[9px] text-muted-foreground">{data.total} verified play{data.total===1?"":"s"}</span>}</div>{query.isLoading?<div className="p-5 text-center text-xs text-muted-foreground">Loading verified results…</div>:query.error?<div className="p-5 text-center text-xs text-muted-foreground">Yesterday&apos;s results are temporarily unavailable.</div>:data?.outcomes?.length?<div className="max-h-[340px] divide-y divide-border/40 overflow-y-auto">{data.outcomes.map(row=><Link key={row.id} href={row.href}><div className="grid grid-cols-[52px_1fr_auto] items-center gap-2 px-3 py-3 transition-colors hover:bg-muted/35"><div className="text-[9px] font-black text-muted-foreground">{row.sport}</div><div className="min-w-0"><div className="truncate text-xs font-bold">{row.pick}</div><div className="mt-0.5 truncate text-[9px] text-muted-foreground">{row.market} · {row.matchup}</div><div className="mt-0.5 truncate text-[9px] text-muted-foreground/80">{row.actual}</div></div><div className="flex items-center gap-2"><span className="hidden font-mono text-[10px] font-bold text-muted-foreground sm:inline">{Number(row.probability).toFixed(1)}%</span>{row.result==="won"?<span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[9px] font-black text-emerald-500"><CheckCircle2 className="h-3 w-3"/>WIN</span>:<span className="inline-flex items-center gap-1 rounded-full border border-rose-500/25 bg-rose-500/10 px-2 py-1 text-[9px] font-black text-rose-500"><XCircle className="h-3 w-3"/>LOSS</span>}</div></div></Link>)}</div>:<div className="p-5 text-center"><div className="text-xs font-semibold">No verified graded plays for yesterday yet.</div><div className="mt-1 text-[10px] text-muted-foreground">Only locked, actually graded predictions appear here.</div></div>}</div>}
    </div>
  </div>;
}

export default function Navigation() {
  const [location] = useLocation();
  return (
    <nav className="site-sports-nav border-b bg-card sticky top-14 z-40" aria-label="Primary sports navigation">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8">
        <div className="flex items-center gap-1 overflow-x-auto overscroll-x-contain py-1.5 scrollbar-none">
          {navItems.map((item) => {
            const isActive = location === item.path || (item.path !== "/" && location.startsWith(`${item.path}/`));
            return (
              <Link key={item.path} href={item.path}>
                <span className={cn("sport-nav-tab min-h-10 flex items-center gap-1.5 rounded-lg px-3 sm:px-4 py-2 text-[11px] sm:text-xs font-semibold whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",item.glow,isActive ? "sport-nav-active" : "text-muted-foreground")} aria-current={isActive ? "page" : undefined} data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}>
                  <NavIcon type={item.icon}/>{item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
      {location==="/"&&<YesterdayResults/>}
    </nav>
  );
}
