import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { captureFunil } from "@/lib/funil/snapshot";
import { getStages, handleDCError } from "@/lib/datacrazy/pipeline";
import { groupDealsByStage } from "@/lib/funil/metrics";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "from/to required" }, { status: 400 });

  try {
    const { snapshot, deals, truncated } = await captureFunil({ from, to });
    const stages = await getStages();
    const grouped = groupDealsByStage(deals, stages);
    const stageById = new Map(stages.map(s => [s.id, s]));

    const stageData = snapshot.stages.map(s => ({
      stage: stageById.get(s.id)!,
      metrics: { count: s.count, avgTimeInStageMs: s.avgMs, stuckCount: s.stuck },
      deals: (grouped.get(s.id) ?? []).map(d => ({
        id: d.id, name: d.name, createdAt: d.createdAt,
        lastMovedAt: d.lastMovedAt, value: d.value,
      })),
    }));

    if (truncated) console.warn(`[deals] pagination ceiling hit`);

    return NextResponse.json({ stages: stageData, truncated, total: snapshot.totalDeals });
  } catch (err) { return handleDCError(err); }
}
