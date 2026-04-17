import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dcFetch } from "@/lib/datacrazy/client";
import { getStages, handleDCError } from "@/lib/datacrazy/pipeline";
import { groupDealsByStage, computeStageMetrics } from "@/lib/funil/metrics";
import type { DCDeal } from "@/lib/datacrazy/types";

const MAX_PAGES = 5;
const PAGE_SIZE = 500;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "from/to required" }, { status: 400 });

  try {
    const stages = await getStages();
    const stageIdSet = new Set(stages.map(s => s.id));
    const all: DCDeal[] = [];
    let skip = 0;
    let pages = 0;
    let truncated = false;

    for (; pages < MAX_PAGES; pages++) {
      const res = await dcFetch<{ count: number; data: DCDeal[] }>("/businesses", {
        take: PAGE_SIZE, skip,
        filter: { status: "in_process", createdAtGreaterOrEqual: from, createdAtLessOrEqual: to },
      });
      all.push(...res.data.filter(d => stageIdSet.has(d.stageId)));
      if (res.data.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
      if (pages + 1 === MAX_PAGES) truncated = true;
    }
    if (truncated) console.warn(`[deals] pagination ceiling hit: ${MAX_PAGES} pages`);

    const grouped = groupDealsByStage(all, stages);
    const now = Date.now();
    const stageData = stages.map(s => ({
      stage: s,
      metrics: computeStageMetrics(grouped.get(s.id) ?? [], now),
      deals: (grouped.get(s.id) ?? []).map(d => ({
        id: d.id, name: d.name, createdAt: d.createdAt,
        lastMovedAt: d.lastMovedAt, value: d.value,
      })),
    }));

    return NextResponse.json({ stages: stageData, truncated, total: all.length });
  } catch (err) { return handleDCError(err); }
}
