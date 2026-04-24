import { describe, it, expect } from "vitest";
import { downsample, pickBucketMs } from "@/lib/metrics/downsample";

describe("pickBucketMs", () => {
  it("maps ranges to bucket sizes", () => {
    expect(pickBucketMs("24h")).toBe(0);
    expect(pickBucketMs("7d")).toBe(60 * 60_000);
    expect(pickBucketMs("30d")).toBe(4 * 60 * 60_000);
    expect(pickBucketMs("90d")).toBe(24 * 60 * 60_000);
  });
});

describe("downsample", () => {
  const base = new Date("2026-04-24T00:00:00Z").getTime();
  const make = <E extends Record<string, unknown>>(
    n: number,
    step: number,
    extras: (i: number) => E,
  ) =>
    Array.from({ length: n }, (_, i) => ({
      capturedAt: new Date(base + i * step).toISOString(),
      ...extras(i),
    }));

  it("returns points unchanged when bucketMs is 0", () => {
    const pts = make(5, 60_000, i => ({ total: i }));
    const out = downsample(pts, 0, { total: "avg" });
    expect(out).toEqual(pts);
  });

  it("buckets and averages counts within bucketMs=1h", () => {
    const pts = make(4, 15 * 60_000, i => ({ total: i + 1 }));
    const out = downsample(pts, 60 * 60_000, { total: "avg" });
    expect(out).toHaveLength(1);
    expect(out[0].total).toBe(2.5);
  });

  it("takes max for `max` aggregator", () => {
    const pts = make(3, 10 * 60_000, i => ({ maxMin: [5, 20, 7][i] }));
    const out = downsample(pts, 60 * 60_000, { maxMin: "max" });
    expect(out[0].maxMin).toBe(20);
  });

  it("takes last-in-bucket for `last` aggregator", () => {
    const pts = make(3, 10 * 60_000, i => ({ payload: ["a", "b", "c"][i] }));
    const out = downsample(pts, 60 * 60_000, { payload: "last" });
    expect(out[0].payload).toBe("c");
  });

  it("keeps capturedAt as the bucket start", () => {
    const pts = make(4, 15 * 60_000, () => ({ total: 1 }));
    const out = downsample(pts, 60 * 60_000, { total: "avg" });
    expect(new Date(out[0].capturedAt).getTime()).toBe(base);
  });

  it("emits only buckets with data (no empty gaps)", () => {
    const pts = [
      ...make(2, 10 * 60_000, () => ({ total: 1 })),
      { capturedAt: new Date(base + 3 * 60 * 60_000).toISOString(), total: 1 }, // 3h later
    ];
    const out = downsample(pts, 60 * 60_000, { total: "avg" });
    expect(out).toHaveLength(2);
  });
});
