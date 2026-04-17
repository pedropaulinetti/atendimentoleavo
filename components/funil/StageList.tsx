"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { resolveDateRangePreset } from "@/lib/funil/dateRange";
import { StageBar } from "./StageBar";
import { DealsDrawer } from "./DealsDrawer";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InboxIcon, AlertTriangle } from "lucide-react";

interface StageData {
  stage: { id: string; name: string; index: number; color?: string };
  metrics: { count: number; avgTimeInStageMs: number; stuckCount: number };
  deals: { id: string; name: string; createdAt: string; lastMovedAt: string | null; value: number | null }[];
}

export function StageList() {
  const sp = useSearchParams();
  const preset = (sp.get("preset") ?? "30d") as "today" | "week" | "30d" | "month";
  const range = resolveDateRangePreset(preset);
  const from = sp.get("from") ?? range.from;
  const to = sp.get("to") ?? range.to;

  const [openStageId, setOpenStageId] = useState<string | null>(null);

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

  if (isLoading) return (
    <div className="space-y-2">
      {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
    </div>
  );

  if (error) return (
    <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">
      Falha ao carregar. Tentando novamente…
    </Card>
  );

  if (!data) return null;

  const maxCount = Math.max(1, ...data.stages.map(s => s.metrics.count));
  const sorted = [...data.stages].sort((a, b) => a.stage.index - b.stage.index);
  const openStage = sorted.find(s => s.stage.id === openStageId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-500">
          <span className="font-semibold text-zinc-900 tabular-nums">{data.total}</span> leads no período
        </span>
        {data.truncated && (
          <Badge variant="outline" className="gap-1.5 border-amber-200 bg-amber-50 text-amber-700">
            <AlertTriangle className="size-3.5" />
            Exibindo apenas 2500 leads (truncado)
          </Badge>
        )}
      </div>

      {sorted.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="flex flex-col items-center gap-3">
            <InboxIcon className="size-10 text-zinc-300" />
            <div>
              <p className="font-medium text-zinc-900">Nenhum lead no período</p>
              <p className="mt-1 text-sm text-zinc-500">Tente selecionar um período diferente.</p>
            </div>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {sorted.map(s => (
            <button
              key={s.stage.id}
              onClick={() => setOpenStageId(s.stage.id)}
              className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 rounded-xl"
            >
              <StageBar
                name={s.stage.name}
                count={s.metrics.count}
                maxCount={maxCount}
                avgDays={s.metrics.avgTimeInStageMs / 86_400_000}
                stuckCount={s.metrics.stuckCount}
                color={s.stage.color}
              />
            </button>
          ))}
        </div>
      )}

      {openStage && (
        <DealsDrawer
          stageName={openStage.stage.name}
          deals={openStage.deals}
          onClose={() => setOpenStageId(null)}
        />
      )}
    </div>
  );
}
