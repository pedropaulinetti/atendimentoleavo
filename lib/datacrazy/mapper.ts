import { dcFetch } from "./client";
import { getStages, handleDCError } from "./pipeline";
import { computeAlertLevel } from "@/lib/monitor/severity";
import { MAX_AGE_MINUTES } from "@/lib/monitor/constants";
import type { DCConversation } from "./types";
import type { Conversation } from "@/lib/monitor/types";

type DCMessage = {
  body?: string;
  received?: boolean;
  attachments?: Array<{ type?: string; mimeType?: string }>;
  createdAt?: string;
};

async function fetchReceivedPreview(convId: string): Promise<string | null> {
  try {
    const msgsRes = await dcFetch<{ messages?: DCMessage[] }>(
      `/conversations/${convId}/messages`,
      { take: 20 },
    );
    const list = msgsRes.messages ?? [];
    const lastReceived = list.find(m => m.received === true);
    if (!lastReceived) return null;
    const body = (lastReceived.body ?? "").trim();
    if (body) return body.replace(/\s+/g, " ").slice(0, 240);
    if (lastReceived.attachments && lastReceived.attachments.length > 0) {
      const att = lastReceived.attachments[0];
      const type = (att.type || att.mimeType || "").toLowerCase();
      if (type.includes("audio")) return "🎤 Áudio";
      if (type.includes("image")) return "🖼️ Imagem";
      if (type.includes("video")) return "🎥 Vídeo";
      if (type.includes("document") || type.includes("pdf")) return "📎 Documento";
      return "📎 Anexo";
    }
    return "(mensagem sem texto)";
  } catch {
    return null;
  }
}

export async function fetchAndMapDCConversations(now: number): Promise<Conversation[]> {
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

  const alerted = res.data
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
      const baselinePreview = rawBody ? rawBody.replace(/\s+/g, " ").slice(0, 240) : null;
      return {
        id: `dc:${c.id}`,
        rawId: c.id,
        source: "datacrazy" as const,
        name: c.name,
        level, minutosParada, attendantName,
        departmentName: c.currentDepartment?.name ?? "—",
        departmentColor: c.currentDepartment?.color ?? "#666",
        lastMessage: baselinePreview,
      };
    })
    .filter(c => c.level !== "ok" && c.level !== "respondida")
    .filter(c => c.minutosParada <= MAX_AGE_MINUTES);

  // N+1 preview enrichment: fetch last-received message body per alert conversation.
  // Matches the behavior in the current inline route logic (app/api/conversations/route.ts:60-91).
  const enriched = await Promise.all(
    alerted.map(async c => {
      const preview = await fetchReceivedPreview(c.rawId);
      const { rawId, ...rest } = c;
      return { ...rest, lastMessage: preview ?? c.lastMessage };
    }),
  );

  return enriched as Conversation[];
}

export { handleDCError };
