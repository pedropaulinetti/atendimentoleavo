import { describe, it, expect } from "vitest";
import { groupDealsByStage, computeStageMetrics } from "@/lib/funil/metrics";
import type { DCDeal } from "@/lib/datacrazy/types";

const now = new Date("2026-04-17T00:00:00Z").getTime();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

const deal = (id: string, stageId: string, moved: string | null, created = daysAgo(30)): DCDeal =>
  ({ id, name: id, stageId, status: "in_process", createdAt: created, lastMovedAt: moved, value: null });

describe("groupDealsByStage", () => {
  it("ignores deals with stageId not in known stages", () => {
    const stages = [{ id: "s1" }, { id: "s2" }] as any;
    const deals = [deal("a", "s1", daysAgo(1)), deal("b", "sX", daysAgo(1))];
    const g = groupDealsByStage(deals, stages);
    expect(g.get("s1")?.length).toBe(1);
    expect(g.get("s2")?.length).toBe(0);
    expect(g.has("sX")).toBe(false);
  });
});

describe("computeStageMetrics", () => {
  it("uses createdAt fallback when lastMovedAt null", () => {
    const deals = [deal("a", "s1", null, daysAgo(5))];
    const m = computeStageMetrics(deals, now);
    expect(m.count).toBe(1);
    expect(Math.round(m.avgTimeInStageMs / 86_400_000)).toBe(5);
  });

  it("flags deals >7 days as stuck", () => {
    const deals = [deal("a", "s1", daysAgo(3)), deal("b", "s1", daysAgo(8)), deal("c", "s1", daysAgo(10))];
    expect(computeStageMetrics(deals, now).stuckCount).toBe(2);
  });

  it("boundary: exactly 7 days is NOT stuck", () => {
    const deals = [deal("a", "s1", daysAgo(7))];
    expect(computeStageMetrics(deals, now).stuckCount).toBe(0);
  });

  it("empty list returns zeros", () => {
    expect(computeStageMetrics([], now)).toEqual({ count: 0, avgTimeInStageMs: 0, stuckCount: 0 });
  });
});
