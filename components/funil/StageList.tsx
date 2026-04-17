"use client";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { resolveDateRangePreset } from "@/lib/funil/dateRange";
import { StageBar } from "./StageBar";
import { Skeleton } from "@/components/ui/skeleton";

interface StageData {
  stage: { id: string; name: string; order: number };
  metrics: { count: number; avgTimeInStageMs: number; stuckCount: number };
  deals: { id: string; name: string; createdAt: string; lastMovedAt: string | null; value: number | null }[];
}

export function StageList() {
  const sp = useSearchParams();
  const preset = (sp.get("preset") ?? "30d") as "today" | "week" | "30d" | "month";
  const range = resolveDateRangePreset(preset);
  const from = sp.get("from") ?? range.from;
  const to = sp.get("to") ?? range.to;

  const { data, isLoading, error } = useQuery({
    queryKey: ["deals", from, to],
    queryFn: async () => {
      const q = new URLSearchParams({ from, to });
      const r = await fetch(`/api/deals?${q}`);
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json() as Promise<{ stages: StageData[]; total: number; truncated: boolean }>;
    },
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}</div>;
  if (error) return <div className="rounded border border-red-300 bg-red-50 p-4 text-sm">Falha ao carregar. Tentando novamente…</div>;
  if (!data) return null;

  const maxCount = Math.max(1, ...data.stages.map(s => s.metrics.count));
  const sorted = [...data.stages].sort((a, b) => a.stage.order - b.stage.order);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span>{data.total} leads no período</span>
        {data.truncated && <span className="text-amber-600">⚠ Exibindo apenas 2500 leads (truncado)</span>}
      </div>
      {sorted.length === 0 ? (
        <div className="rounded-lg border bg-white p-12 text-center text-zinc-500">
          Nenhum lead criado neste período
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map(s => (
            <StageBar
              key={s.stage.id}
              name={s.stage.name}
              count={s.metrics.count}
              maxCount={maxCount}
              avgDays={s.metrics.avgTimeInStageMs / 86_400_000}
              stuckCount={s.metrics.stuckCount}
            />
          ))}
        </div>
      )}
    </div>
  );
}
