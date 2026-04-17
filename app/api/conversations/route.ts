import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dcFetch } from "@/lib/datacrazy/client";
import { computeAlertLevel } from "@/lib/monitor/severity";
import { getStages, handleDCError } from "@/lib/datacrazy/pipeline";
import type { DCConversation } from "@/lib/datacrazy/types";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const stages = await getStages();
    const stageIds = stages.map(s => s.id).join(",");
    const res = await dcFetch<{ data: DCConversation[] }>("/conversations", {
      take: 200,
      filter: { stages: stageIds, opened: true },
    });
    const now = Date.now();

    const enriched = res.data
      .filter(c => !c.isGroup)
      .map(c => {
        const { level, minutosParada } = computeAlertLevel({
          lastReceivedMessageDate: c.lastReceivedMessageDate ?? null,
          lastSendedMessageDate: c.lastSendedMessageDate ?? null,
          now,
        });
        const firstAttendant = c.attendants?.[0];
        const attendantName = firstAttendant?.name ?? (firstAttendant ? "Atendente" : "Sem atendente");
        return {
          id: c.id, name: c.name, level, minutosParada, attendantName,
          departmentName: c.currentDepartment?.name ?? "—",
          departmentColor: c.currentDepartment?.color ?? "#666",
        };
      })
      .filter(c => c.level !== "ok" && c.level !== "respondida")
      .sort((a, b) => b.minutosParada - a.minutosParada);

    return NextResponse.json({ conversations: enriched, updatedAt: new Date().toISOString() });
  } catch (err) { return handleDCError(err); }
}
