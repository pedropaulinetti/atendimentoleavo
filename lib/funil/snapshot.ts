import { dcFetch } from "@/lib/datacrazy/client";
import { getStages } from "@/lib/datacrazy/pipeline";
import { groupDealsByStage, computeStageMetrics } from "@/lib/funil/metrics";
import type { DCDeal } from "@/lib/datacrazy/types";

const MAX_PAGES = 5;
const PAGE_SIZE = 500;

export interface FunilStageSnapshot {
  id: string;
  name: string;
  index: number;
  color?: string;
  count: number;
  avgMs: number;
  stuck: number;
}

export interface FunilSnapshot {
  totalDeals: number;
  totalStuck: number;
  avgStageDays: number;
  activeStages: number;
  stages: FunilStageSnapshot[];
}

export interface FunilCapture {
  snapshot: FunilSnapshot;
  deals: DCDeal[];
  truncated: boolean;
  capturedAt: string;
}

export async function captureFunil(
  opts?: { from: string; to: string },
): Promise<FunilCapture> {
  const stages = await getStages();
  const stageIdSet = new Set(stages.map(s => s.id));
  const dateFilter = opts
    ? { createdAtGreaterOrEqual: opts.from, createdAtLessOrEqual: opts.to }
    : {};

  const all: DCDeal[] = [];
  let skip = 0;
  let pages = 0;
  let truncated = false;
  for (; pages < MAX_PAGES; pages++) {
    const res = await dcFetch<{ count: number; data: DCDeal[] }>("/businesses", {
      take: PAGE_SIZE, skip,
      filter: { status: "in_process", ...dateFilter },
    });
    all.push(...res.data.filter(d => stageIdSet.has(d.stageId)));
    if (res.data.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
    if (pages + 1 === MAX_PAGES) truncated = true;
  }

  const grouped = groupDealsByStage(all, stages);
  const now = Date.now();
  const stageSnapshots: FunilStageSnapshot[] = stages.map(s => {
    const m = computeStageMetrics(grouped.get(s.id) ?? [], now);
    return {
      id: s.id, name: s.name, index: s.index, color: s.color,
      count: m.count, avgMs: m.avgTimeInStageMs, stuck: m.stuckCount,
    };
  });

  const totalDeals = stageSnapshots.reduce((sum, s) => sum + s.count, 0);
  const totalStuck = stageSnapshots.reduce((sum, s) => sum + s.stuck, 0);
  const weighted = stageSnapshots.reduce(
    (acc, s) => ({ sum: acc.sum + s.avgMs * s.count, n: acc.n + s.count }),
    { sum: 0, n: 0 },
  );
  const avgStageDays = weighted.n > 0 ? weighted.sum / weighted.n / 86_400_000 : 0;
  const activeStages = stageSnapshots.filter(s => s.count > 0).length;

  return {
    snapshot: { totalDeals, totalStuck, avgStageDays, activeStages, stages: stageSnapshots },
    deals: all,
    truncated,
    capturedAt: new Date().toISOString(),
  };
}

export async function captureFunilSnapshot(
  opts?: { from: string; to: string },
): Promise<FunilSnapshot> {
  return (await captureFunil(opts)).snapshot;
}
