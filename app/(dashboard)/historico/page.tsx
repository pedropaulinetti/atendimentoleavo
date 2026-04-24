"use client";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { RangeToggle } from "@/components/historico/RangeToggle";
import { EmptyState } from "@/components/historico/EmptyState";
import {
  MonitorTrendChart,
  type MonitorTrendPoint,
} from "@/components/historico/MonitorTrendChart";
import {
  MonitorTimingCharts,
  type MonitorTimingPoint,
} from "@/components/historico/MonitorTimingCharts";
import {
  FunilTrendChart,
  type FunilTrendPoint,
} from "@/components/historico/FunilTrendChart";
import {
  FunilDetailCharts,
  type FunilDetailPoint,
} from "@/components/historico/FunilDetailCharts";

type Range = "24h" | "7d" | "30d" | "90d";
const VALID_RANGES: Range[] = ["24h", "7d", "30d", "90d"];

type MonitorPoint = MonitorTrendPoint & MonitorTimingPoint;
type FunilPoint = FunilTrendPoint & FunilDetailPoint;

interface HistoryResponse<T> {
  points: T[];
  downsampled: boolean;
  sourceCount: number;
}

export default function HistoricoPage() {
  const sp = useSearchParams();
  const raw = sp.get("range");
  const range: Range = VALID_RANGES.includes(raw as Range) ? (raw as Range) : "7d";

  const monitor = useQuery<HistoryResponse<MonitorPoint>>({
    queryKey: ["history", "monitor", range],
    queryFn: async () => {
      const r = await fetch(`/api/metrics/history?source=monitor&range=${range}`);
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
  });

  const funil = useQuery<HistoryResponse<FunilPoint>>({
    queryKey: ["history", "funil", range],
    queryFn: async () => {
      const r = await fetch(`/api/metrics/history?source=funil&range=${range}`);
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
  });

  const isLoading = monitor.isLoading || funil.isLoading;
  const hasError = monitor.error || funil.error;
  const noData =
    (monitor.data?.sourceCount ?? 0) === 0 && (funil.data?.sourceCount ?? 0) === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Histórico</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Tendência das métricas ao longo do tempo
          </p>
        </div>
        <RangeToggle active={range} />
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      )}

      {hasError && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Falha ao carregar histórico. Tentando novamente…
        </Card>
      )}

      {!isLoading && !hasError && noData && <EmptyState />}

      {!isLoading && !hasError && !noData && (
        <>
          <section className="space-y-4">
            <h2 className="text-lg font-medium text-zinc-900">Monitor</h2>
            <MonitorTrendChart points={monitor.data?.points ?? []} />
            <MonitorTimingCharts points={monitor.data?.points ?? []} />
          </section>
          <section className="space-y-4">
            <h2 className="text-lg font-medium text-zinc-900">Funil</h2>
            <FunilTrendChart points={funil.data?.points ?? []} />
            <FunilDetailCharts points={funil.data?.points ?? []} />
          </section>
        </>
      )}
    </div>
  );
}
