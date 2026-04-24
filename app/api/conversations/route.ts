import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { captureMonitor } from "@/lib/monitor/snapshot";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { snapshot, conversations, sourceErrors, allFailed, capturedAt } =
    await captureMonitor();

  if (conversations.length === 0 && allFailed) {
    return NextResponse.json(
      { error: "ALL_SOURCES_FAILED", sourceErrors },
      { status: 503 },
    );
  }

  return NextResponse.json({
    conversations,
    updatedAt: capturedAt,
    stats: {
      avgMinutos: snapshot.avgMinutos,
      maxMinutos: snapshot.maxMinutos,
      byDepartment: snapshot.byDepartment,
    },
    sourceErrors: Object.keys(sourceErrors).length > 0 ? sourceErrors : undefined,
  });
}
