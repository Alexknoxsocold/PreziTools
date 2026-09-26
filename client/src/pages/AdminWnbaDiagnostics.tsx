import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface Diagnostics {
  modelVersion: string;
  trackedPlayers: number;
  processedGames: number;
  openingEvidence: number;
  lockedGames: number;
  gradedGames: number;
  topPickWins: number;
  topPickAccuracy: number | null;
  trackerStatus: string;
  historyStatus: string;
  sequenceModel: string;
  competitorBenchmark: Record<string, unknown>;
}

export default function AdminWnbaDiagnostics() {
  const { data, isLoading, error } = useQuery<Diagnostics>({
    queryKey: ['/api/admin/wnba/diagnostics?days=30'],
    staleTime: 30_000,
    retry: false,
  });
  if (isLoading) return <div role="status" aria-label="Loading WNBA diagnostics"><Skeleton className="h-8 w-64" /><Skeleton className="mt-4 h-64 w-full" /></div>;
  if (error || !data) return <div className="rounded-md border p-5 space-y-3"><p>WNBA diagnostics are unavailable or your admin session has expired.</p><Link href="/admin" className="text-primary underline">Open admin sign-in</Link></div>;
  const stats: [string, string | number][] = [
    ['Locked games · last 30 days', data.lockedGames],
    ['Graded games · last 30 days', data.gradedGames],
    ['Top-pick wins · last 30 days', data.topPickWins],
    ['Top-pick accuracy · last 30 days', data.topPickAccuracy == null ? '—' : `${data.topPickAccuracy.toFixed(1)}%`],
    ['Tracked players · current season', data.trackedPlayers],
    ['Processed games · all history', data.processedGames],
    ['Verified opening evidence · all history', data.openingEvidence],
  ];
  return <div className="space-y-6">
    <div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-xl font-bold">WNBA Diagnostics</h1><p className="text-sm text-muted-foreground mt-1">Pregame prediction coverage and verified results.</p></div><Badge variant="secondary">{data.modelVersion}</Badge></div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{stats.map(([label, value]) => <div key={label} className="rounded-md border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold mt-2">{value}</p></div>)}</div>
    <p className="text-sm text-muted-foreground">Historical results are evidence coverage, not model accuracy. Accuracy uses graded top picks from the pregame ledger.</p>
    <div className="rounded-md border bg-card p-5 space-y-3"><h2 className="font-semibold">Collection status</h2><dl className="grid grid-cols-2 gap-3 text-sm"><dt>Tracker</dt><dd>{data.trackerStatus}</dd><dt>History</dt><dd>{data.historyStatus}</dd><dt>Sequence model</dt><dd className="break-words">{data.sequenceModel}</dd></dl></div>
    <details className="rounded-md border bg-card p-5"><summary className="cursor-pointer font-semibold">Opening-tip competitor benchmark</summary><pre className="mt-3 overflow-auto text-xs whitespace-pre-wrap break-words">{JSON.stringify(data.competitorBenchmark, null, 2)}</pre></details>
    <Link href="/admin" className="text-sm text-primary underline">Back to admin</Link>
  </div>;
}
