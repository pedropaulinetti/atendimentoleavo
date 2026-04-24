export type Aggregator = "avg" | "max" | "last";

export type Range = "24h" | "7d" | "30d" | "90d";

export function pickBucketMs(range: Range): number {
  switch (range) {
    case "24h": return 0;
    case "7d":  return 60 * 60_000;
    case "30d": return 4 * 60 * 60_000;
    case "90d": return 24 * 60 * 60_000;
  }
}

type Point = { capturedAt: string } & Record<string, unknown>;

export function downsample<T extends Point>(
  points: T[],
  bucketMs: number,
  aggregators: Partial<Record<keyof T, Aggregator>>,
): T[] {
  if (bucketMs <= 0 || points.length === 0) return points;

  const buckets = new Map<number, T[]>();
  for (const p of points) {
    const t = new Date(p.capturedAt).getTime();
    const key = Math.floor(t / bucketMs) * bucketMs;
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }

  const keysSorted = Array.from(buckets.keys()).sort((a, b) => a - b);
  return keysSorted.map(k => {
    const bucket = buckets.get(k)!;
    const out: Record<string, unknown> = { capturedAt: new Date(k).toISOString() };
    for (const field in aggregators) {
      const agg = aggregators[field as keyof T]!;
      const values = bucket.map(p => p[field as keyof T]);
      if (agg === "avg") {
        const nums = values.filter((v): v is number => typeof v === "number");
        out[field] = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      } else if (agg === "max") {
        const nums = values.filter((v): v is number => typeof v === "number");
        out[field] = nums.length ? Math.max(...nums) : 0;
      } else if (agg === "last") {
        out[field] = values[values.length - 1];
      }
    }
    return out as T;
  });
}
