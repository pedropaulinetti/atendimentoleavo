import { NextRequest, NextResponse } from "next/server";
import { captureMonitor } from "@/lib/monitor/snapshot";
import { captureFunilSnapshot } from "@/lib/funil/snapshot";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleDCError } from "@/lib/datacrazy/pipeline";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const [monitorCap, funil] = await Promise.all([
      captureMonitor(),
      captureFunilSnapshot(),
    ]);

    if (monitorCap.allFailed) {
      return NextResponse.json(
        { error: "MONITOR_ALL_SOURCES_FAILED", sourceErrors: monitorCap.sourceErrors },
        { status: 503 },
      );
    }

    const monitor = monitorCap.snapshot;
    const db = createAdminClient();

    const mRes = await db.from("monitor_snapshots").insert({
      total: monitor.total,
      count_red: monitor.countRed,
      count_yellow: monitor.countYellow,
      count_green: monitor.countGreen,
      avg_minutos: monitor.avgMinutos,
      max_minutos: monitor.maxMinutos,
      by_department: monitor.byDepartment,
    });
    if (mRes.error) throw new Error(`monitor_snapshots insert: ${mRes.error.message}`);

    const fRes = await db.from("funil_snapshots").insert({
      total_deals: funil.totalDeals,
      total_stuck: funil.totalStuck,
      avg_stage_days: funil.avgStageDays,
      active_stages: funil.activeStages,
      stages: funil.stages,
    });
    if (fRes.error) throw new Error(`funil_snapshots insert: ${fRes.error.message}`);

    return NextResponse.json({
      ok: true,
      sourceErrors: Object.keys(monitorCap.sourceErrors).length > 0
        ? monitorCap.sourceErrors
        : undefined,
    });
  } catch (err) {
    const handled = handleDCError(err);
    if (handled.status !== 500) return handled;
    console.error("[cron snapshot]", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
