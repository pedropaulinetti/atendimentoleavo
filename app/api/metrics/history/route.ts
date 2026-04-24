import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { downsample, pickBucketMs, type Range } from "@/lib/metrics/downsample";

const RANGES: Range[] = ["24h", "7d", "30d", "90d"];
const RANGE_MS: Record<Range, number> = {
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

type Source = "monitor" | "funil";

const MONITOR_AGG = {
  total: "avg", countRed: "avg", countYellow: "avg", countGreen: "avg",
  avgMinutos: "avg", maxMinutos: "max", byDepartment: "last",
} as const;

const FUNIL_AGG = {
  totalDeals: "avg", totalStuck: "avg", avgStageDays: "avg",
  activeStages: "avg", stages: "last",
} as const;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const source = req.nextUrl.searchParams.get("source") as Source | null;
  const range = req.nextUrl.searchParams.get("range") as Range | null;
  if (source !== "monitor" && source !== "funil") {
    return NextResponse.json({ error: "invalid source" }, { status: 400 });
  }
  if (!range || !RANGES.includes(range)) {
    return NextResponse.json({ error: "invalid range" }, { status: 400 });
  }

  const since = new Date(Date.now() - RANGE_MS[range]).toISOString();
  const db = createAdminClient();
  const table = source === "monitor" ? "monitor_snapshots" : "funil_snapshots";
  const { data, error } = await db
    .from(table)
    .select("*")
    .gte("captured_at", since)
    .order("captured_at", { ascending: true });

  if (error) {
    // Postgres 42P01 = undefined_table. Treat as "no data yet" so the UI shows
    // the EmptyState instead of a noisy error banner before the migration runs.
    if (error.code === "42P01") {
      return NextResponse.json({ points: [], downsampled: false, sourceCount: 0 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []).map(r =>
    source === "monitor" ? toMonitorPoint(r) : toFunilPoint(r),
  );
  const bucketMs = pickBucketMs(range);
  const aggregators = source === "monitor" ? MONITOR_AGG : FUNIL_AGG;
  const points = downsample(rows, bucketMs, aggregators as never);

  return NextResponse.json({
    points,
    downsampled: bucketMs > 0 && rows.length > points.length,
    sourceCount: rows.length,
  });
}

function toMonitorPoint(r: Record<string, unknown>) {
  return {
    capturedAt: r.captured_at as string,
    total: r.total as number,
    countRed: r.count_red as number,
    countYellow: r.count_yellow as number,
    countGreen: r.count_green as number,
    avgMinutos: Number(r.avg_minutos),
    maxMinutos: Number(r.max_minutos),
    byDepartment: r.by_department as Array<{ name: string; color: string; count: number }>,
  };
}

function toFunilPoint(r: Record<string, unknown>) {
  return {
    capturedAt: r.captured_at as string,
    totalDeals: r.total_deals as number,
    totalStuck: r.total_stuck as number,
    avgStageDays: Number(r.avg_stage_days),
    activeStages: r.active_stages as number,
    stages: r.stages,
  };
}
