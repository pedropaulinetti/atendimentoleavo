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

    // For each alert conversation, fetch last RECEIVED message body (client's actual ask).
    // conversations/{id}/messages returns messages DESC by createdAt; we find first with received=true.
    type DCMessage = {
      body?: string;
      received?: boolean;
      attachments?: Array<{ type?: string; mimeType?: string }>;
      createdAt?: string;
    };
    const withPreview = await Promise.all(
      enriched.map(async c => {
        try {
          const msgsRes = await dcFetch<{ messages?: DCMessage[] }>(
            `/conversations/${c.id}/messages`,
            { take: 20 }
          );
          const list = msgsRes.messages ?? [];
          const lastReceived = list.find(m => m.received === true);
          let preview: string | null = null;
          if (lastReceived) {
            const body = (lastReceived.body ?? "").trim();
            if (body) {
              preview = body.replace(/\s+/g, " ").slice(0, 240);
            } else if (lastReceived.attachments && lastReceived.attachments.length > 0) {
              const att = lastReceived.attachments[0];
              const type = (att.type || att.mimeType || "").toLowerCase();
              if (type.includes("audio")) preview = "🎤 Áudio";
              else if (type.includes("image")) preview = "🖼️ Imagem";
              else if (type.includes("video")) preview = "🎥 Vídeo";
              else if (type.includes("document") || type.includes("pdf")) preview = "📎 Documento";
              else preview = "📎 Anexo";
            } else {
              preview = "(mensagem sem texto)";
            }
          }
          return { ...c, lastMessage: preview };
        } catch {
          return c; // fallback keeps whatever was in c.lastMessage
        }
      })
    );

    const avgMinutos = withPreview.length
      ? withPreview.reduce((sum, c) => sum + c.minutosParada, 0) / withPreview.length
      : 0;
    const maxMinutos = withPreview.length
      ? Math.max(...withPreview.map(c => c.minutosParada))
      : 0;

    const byDepartmentMap = new Map<string, { name: string; color: string; count: number }>();
    for (const c of withPreview) {
      const key = c.departmentName;
      const hit = byDepartmentMap.get(key);
      if (hit) hit.count += 1;
      else byDepartmentMap.set(key, { name: c.departmentName, color: c.departmentColor, count: 1 });
    }
    const byDepartment = Array.from(byDepartmentMap.values()).sort((a, b) => b.count - a.count);

    return NextResponse.json({
      conversations: withPreview,
      updatedAt: new Date().toISOString(),
      stats: { avgMinutos, maxMinutos, byDepartment },
    });
  } catch (err) { return handleDCError(err); }
}
