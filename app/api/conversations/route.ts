import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dcFetch } from "@/lib/datacrazy/client";
import { computeAlertLevel } from "@/lib/monitor/severity";
import { getStages, handleDCError } from "@/lib/datacrazy/pipeline";
import type { DCConversation } from "@/lib/datacrazy/types";

const MAX_AGE_MINUTES = 72 * 60; // 72h cap — ignore ancient abandoned conversations

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const INSTANCE_ID = process.env.INSTANCE_ID;
    const stages = await getStages();
    const stageIds = stages.map(s => s.id).join(",");
    const res = await dcFetch<{ data: DCConversation[] }>("/conversations", {
      take: 200,
      filter: {
        stages: stageIds,
        opened: true,
        ...(INSTANCE_ID ? { instances: INSTANCE_ID } : {}),
      },
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
        const rawBody = c.lastMessage?.body?.trim() ?? "";
        const lastMessage = rawBody ? rawBody.replace(/\s+/g, " ").slice(0, 240) : null;
        return {
          id: c.id, name: c.name, level, minutosParada, attendantName,
          departmentName: c.currentDepartment?.name ?? "—",
          departmentColor: c.currentDepartment?.color ?? "#666",
          lastMessage,
        };
      })
      .filter(c => c.level !== "ok" && c.level !== "respondida")
      .filter(c => c.minutosParada <= MAX_AGE_MINUTES)
      .sort((a, b) => a.minutosParada - b.minutosParada);

    const avgMinutos = enriched.length
      ? enriched.reduce((sum, c) => sum + c.minutosParada, 0) / enriched.length
      : 0;
    const maxMinutos = enriched.length
      ? Math.max(...enriched.map(c => c.minutosParada))
      : 0;

    const byDepartmentMap = new Map<string, { name: string; color: string; count: number }>();
    for (const c of enriched) {
      const key = c.departmentName;
      const hit = byDepartmentMap.get(key);
      if (hit) hit.count += 1;
      else byDepartmentMap.set(key, { name: c.departmentName, color: c.departmentColor, count: 1 });
    }
    const byDepartment = Array.from(byDepartmentMap.values()).sort((a, b) => b.count - a.count);

    return NextResponse.json({
      conversations: enriched,
      updatedAt: new Date().toISOString(),
      stats: { avgMinutos, maxMinutos, byDepartment },
    });
  } catch (err) { return handleDCError(err); }
}
