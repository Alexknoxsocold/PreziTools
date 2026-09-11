import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";

type Status = "BEST_PLAY" | "PLAY" | "LEAN" | "NO_PLAY";
type Pick = { pick:string; probability:number; marketProbability:number; edge:number; status:Status; price:number|null; line?:number };
type Game = { id:string; league:"KBO"|"NPB"; startTime:string; awayTeam:string; homeTeam:string; moneyline:Pick; total:Pick|null };
type Payload = { games:Game[] };

function timeLabel(v:string){const d=new Date(v);return Number.isNaN(d.getTime())?"Time pending":d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET"}
function tierClass(s:Status){return s==="BEST_PLAY"?"border-emerald-500/35 bg-emerald-500/10 text-emerald-500":s==="PLAY"?"border-sky-500/35 bg-sky-500/10 text-sky-500":"border-amber-500/35 bg-amber-500/10 text-amber-500"}

export default function InternationalBestPlays(){
  const q=useQuery<Payload>({queryKey:["/api/international-baseball"],staleTime:90_000,refetchInterval:180_000,retry:1});
  const plays=useMemo(()=>{
    const rows:{id:string;league:"KBO"|"NPB";market:string;matchup:string;pick:string;probability:number;edge:number;status:Status;time:string}[]=[];
    for(const g of q.data?.games??[]){
      for(const [market,p] of [["Moneyline",g.moneyline],["Over / Under",g.total]] as const){
        if(!p||p.status==="NO_PLAY")continue;
        rows.push({id:`${g.id}-${market}`,league:g.league,market,matchup:`${g.awayTeam} @ ${g.homeTeam}`,pick:market==="Over / Under"&&p.line!=null?`${p.pick} ${p.line}`:p.pick,probability:p.probability,edge:p.edge,status:p.status,time:g.startTime});
      }
    }
    return rows.sort((a,b)=>(b.status==="BEST_PLAY"?3:b.status==="PLAY"?2:1)-(a.status==="BEST_PLAY"?3:a.status==="PLAY"?2:1)||b.edge-a.edge).slice(0,6);
  },[q.data]);
  if(!plays.length)return null;
  return <section className="rounded-xl border bg-card/80 p-3 sm:p-4">
    <div className="mb-3 flex items-center justify-between gap-3"><div><div className="text-sm font-black">KBO / NPB Best Plays</div><div className="text-[10px] text-muted-foreground">Official-data model vs live market</div></div><Link href="/kbo-npb" className="text-[10px] font-bold text-primary">View all</Link></div>
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{plays.map(p=><Link key={p.id} href="/kbo-npb" className="rounded-lg border border-border/60 bg-background/50 p-3 transition-colors hover:bg-muted/40"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex gap-1.5"><Badge variant="outline" className="text-[9px]">{p.league}</Badge><Badge variant="outline" className="text-[9px]">{p.market}</Badge></div><div className="mt-2 truncate text-[10px] text-muted-foreground">{p.matchup}</div><div className="mt-1 text-sm font-black">{p.pick}</div></div><span className={`rounded-full border px-2 py-1 text-[9px] font-black ${tierClass(p.status)}`}>{p.status.replace("_"," ")}</span></div><div className="mt-3 flex items-end justify-between"><div className="font-mono text-sm font-black">{p.probability.toFixed(1)}%</div><div className="text-right text-[9px] text-muted-foreground">{timeLabel(p.time)}<br/><span className="font-mono">+{p.edge.toFixed(1)}% edge</span></div></div></Link>)}</div>
  </section>;
}
