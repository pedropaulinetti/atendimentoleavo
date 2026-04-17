import type { DCDeal, DCPipelineStage } from "@/lib/datacrazy/types";

const STUCK_THRESHOLD_MS = 7 * 86_400_000;

export function groupDealsByStage(deals: DCDeal[], stages: Pick<DCPipelineStage, "id">[]) {
  const map = new Map<string, DCDeal[]>();
  for (const s of stages) map.set(s.id, []);
  for (const d of deals) {
    const bucket = map.get(d.stageId);
    if (bucket) bucket.push(d);
  }
  return map;
}

export interface StageMetrics { count: number; avgTimeInStageMs: number; stuckCount: number; }

export function computeStageMetrics(deals: DCDeal[], now: number): StageMetrics {
  if (deals.length === 0) return { count: 0, avgTimeInStageMs: 0, stuckCount: 0 };
  let sum = 0, stuck = 0;
  for (const d of deals) {
    const anchor = d.lastMovedAt ?? d.createdAt;
    const age = now - new Date(anchor).getTime();
    sum += age;
    if (age > STUCK_THRESHOLD_MS) stuck++;
  }
  return { count: deals.length, avgTimeInStageMs: sum / deals.length, stuckCount: stuck };
}
