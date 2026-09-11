import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Activity, TrendingUp, ShieldCheck } from "lucide-react";

type Summary = {
  graded: number;
  wins: number;
  losses: number;
  pushes: number;
  units: number;
  roi: number | null;
  winRate: number | null;
  avgModelProbability: number | null;
  avgMarketProbability: number | null;
  avgEdge: number | null;
  brierScore: number | null;
  logLoss: number | null;
  calibrationGap: number | null;
};

type Calibration = {
  modelVersion: string;
  readiness: { stage: string; canReweight: boolean; message?: string };
  thresholds?: { overallGradedForWeightReview: number; segmentGradedForWeightReview: number };
  overall: Summary | null;
  ledger?: { totalLocked: number; settled: number; ungraded: number };
  splits?: {
    league?: Array<{ segment: string; sampleReady: boolean } & Summary>;
    market?: Array<{ segment: string; sampleReady: boolean } & Summary>;
    status?: Array<{ segment: string; sampleReady: boolean } & Summary>;
    edgeBucket?: Array<{ segment: string; sampleReady: boolean } & Summary>;
  };
};

type Performance = {
  clv?: {
    tracked: number;
    positive: number;
    positiveRate: number | null;
    moneylineTracked: number;
    avgMoneylineImpliedClv: number | null;
    totalTracked: number;
    avgTotalLineClv: number | null;
    avgPriceImpliedClv: number | null;
  };
};

function pct(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function num(value: number | null | undefined, digits = 2) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function readinessLabel(stage: string) {
  return stage.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
}

function SegmentTable({ title, rows }: { title: string; rows?: Array<{ segment: string; sampleReady: boolean } & Summary> }) {
  if (!rows?.length) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-y">
            <tr>
              <th className="text-left font-medium px-4 py-2">Segment</th>
              <th className="text-right font-medium px-3 py-2">N</th>
              <th className="text-right font-medium px-3 py-2">Win</th>
              <th className="text-right font-medium px-3 py-2">ROI</th>
              <th className="text-right font-medium px-3 py-2">Edge</th>
              <th className="text-right font-medium px-3 py-2">Brier</th>
              <th className="text-right font-medium px-4 py-2">Ready</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(row => (
              <tr key={row.segment}>
                <td className="px-4 py-2.5 font-medium">{row.segment}</td>
                <td className="px-3 py-2.5 text-right">{row.graded}</td>
                <td className="px-3 py-2.5 text-right">{pct(row.winRate)}</td>
                <td className="px-3 py-2.5 text-right">{pct(row.roi)}</td>
                <td className="px-3 py-2.5 text-right">{pct(row.avgEdge)}</td>
                <td className="px-3 py-2.5 text-right">{num(row.brierScore, 3)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Badge variant={row.sampleReady ? "default" : "secondary"}>{row.sampleReady ? "Yes" : "No"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function InternationalBaseballAdminDiagnostics({ enabled }: { enabled: boolean }) {
  const calibration = useQuery<Calibration>({
    queryKey: ["/api/international-baseball/calibration"],
    enabled,
    refetchInterval: enabled ? 60_000 : false,
  });
  const performance = useQuery<Performance>({
    queryKey: ["/api/international-baseball/performance"],
    enabled,
    refetchInterval: enabled ? 60_000 : false,
  });

  if (calibration.isLoading || performance.isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!calibration.data?.overall) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">KBO / NPB diagnostics are not available yet.</CardContent>
      </Card>
    );
  }

  const data = calibration.data;
  const overall = data.overall;
  const clv = performance.data?.clv;
  const target = data.thresholds?.overallGradedForWeightReview ?? 200;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg"><Activity className="h-5 w-5" />KBO / NPB Model Diagnostics</CardTitle>
              <CardDescription className="mt-1">{data.modelVersion}</CardDescription>
            </div>
            <Badge variant={data.readiness.canReweight ? "default" : "secondary"}>{readinessLabel(data.readiness.stage)}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Graded</div><div className="text-xl font-semibold">{overall.graded}<span className="text-xs text-muted-foreground font-normal"> / {target}</span></div></div>
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Win Rate</div><div className="text-xl font-semibold">{pct(overall.winRate)}</div></div>
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">ROI</div><div className="text-xl font-semibold">{pct(overall.roi)}</div></div>
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Units</div><div className="text-xl font-semibold">{num(overall.units)}</div></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Avg Edge</div><div className="font-semibold">{pct(overall.avgEdge)}</div></div>
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Calibration Gap</div><div className="font-semibold">{pct(overall.calibrationGap)}</div></div>
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Brier</div><div className="font-semibold">{num(overall.brierScore, 3)}</div></div>
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Log Loss</div><div className="font-semibold">{num(overall.logLoss, 3)}</div></div>
          </div>
          <div className="flex gap-2 items-start rounded-md border p-3 text-sm">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{data.readiness.message ?? "Production weights remain locked until the sample is large enough."}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4" />Pregame Market / CLV</CardTitle>
          <CardDescription>Latest observed pregame market versus the original locked price or line.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Tracked</div><div className="text-lg font-semibold">{clv?.tracked ?? 0}</div></div>
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Positive CLV</div><div className="text-lg font-semibold">{pct(clv?.positiveRate)}</div></div>
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">ML Implied CLV</div><div className="text-lg font-semibold">{pct(clv?.avgMoneylineImpliedClv)}</div></div>
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Totals Line CLV</div><div className="text-lg font-semibold">{num(clv?.avgTotalLineClv)}</div></div>
          </div>
        </CardContent>
      </Card>

      <SegmentTable title="By League" rows={data.splits?.league} />
      <SegmentTable title="By Market" rows={data.splits?.market} />
      <SegmentTable title="By Pick Strength" rows={data.splits?.status} />
      <SegmentTable title="By Edge Bucket" rows={data.splits?.edgeBucket} />
    </div>
  );
}
