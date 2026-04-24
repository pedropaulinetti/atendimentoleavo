import { icFetch } from "./client";
import { getResolvedAdmins } from "./admins";
import { getTeamsById } from "./teams";
import * as cache from "./cache";
import { computeAlertLevel } from "@/lib/monitor/severity";
import { MAX_AGE_MINUTES } from "@/lib/monitor/constants";
import type { Conversation } from "@/lib/monitor/types";
import type {
  ICConversation, ICConversationWithParts,
} from "./types";

const CONCURRENCY = 10;
const IC_COLOR = "#6366f1";

async function mapWithConcurrency<T, R>(items: T[], fn: (x: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function contactName(c: ICConversation): string {
  return c.contacts.contacts[0]?.name
    ?? c.contacts.contacts[0]?.email
    ?? c.source.author?.name
    ?? c.source.author?.email
    ?? "Sem nome";
}

function buildLastMessage(c: ICConversation): string | null {
  const raw = c.source.body?.trim();
  if (!raw) return null;
  return raw.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").slice(0, 240);
}

async function resolveHumanAdminReplyAt(
  conv: ICConversation,
  botIds: Set<string>,
): Promise<number | null> {
  const cached = cache.get(conv.id, conv.updated_at);
  if (cached) return cached.lastHumanAdminReplyAt;

  const full = await icFetch<ICConversationWithParts>("GET", `/conversations/${conv.id}`);
  const parts = full.conversation_parts?.parts ?? [];
  let lastHuman: number | null = null;
  for (const p of parts) {
    if (p.author?.type === "admin" && !botIds.has(p.author.id)) {
      if (lastHuman === null || p.created_at > lastHuman) lastHuman = p.created_at;
    }
  }
  cache.set(conv.id, { updatedAt: conv.updated_at, lastHumanAdminReplyAt: lastHuman });
  return lastHuman;
}

export async function fetchAndMapIntercomConversations(now: number): Promise<Conversation[]> {
  const workspaceId = process.env.INTERCOM_WORKSPACE_ID;
  const [{ botIds, namesById: adminsById }, teamsById] = await Promise.all([
    getResolvedAdmins(),
    getTeamsById(),
  ]);

  const search = await icFetch<{ conversations: ICConversation[] }>(
    "POST",
    "/conversations/search",
    {
      query: { field: "state", operator: "=", value: "open" },
      pagination: { per_page: 150 },
    },
  );

  const opens = search.conversations.filter(c => c.state === "open");

  const groupB = opens.filter(c => {
    const lcr = c.statistics.last_contact_reply_at;
    const lar = c.statistics.last_admin_reply_at;
    return lcr !== null && lar !== null && lar > lcr;
  });

  const humanReplyByConvId = new Map<string, number | null>();
  await mapWithConcurrency(groupB, async (c) => {
    const v = await resolveHumanAdminReplyAt(c, botIds);
    humanReplyByConvId.set(c.id, v);
  });

  const mapped: Conversation[] = [];
  for (const c of opens) {
    const lcr = c.statistics.last_contact_reply_at;
    if (lcr === null) continue;

    const effectiveAdminReply = humanReplyByConvId.has(c.id)
      ? humanReplyByConvId.get(c.id)!
      : null;

    const { level, minutosParada } = computeAlertLevel({
      lastReceivedMessageDate: new Date(lcr * 1000).toISOString(),
      lastSendedMessageDate: effectiveAdminReply
        ? new Date(effectiveAdminReply * 1000).toISOString()
        : null,
      now,
    });

    if (level === "ok" || level === "respondida") continue;
    if (minutosParada > MAX_AGE_MINUTES) continue;

    mapped.push({
      id: `ic:${c.id}`,
      source: "intercom",
      name: contactName(c),
      level,
      minutosParada,
      attendantName: c.admin_assignee_id ? (adminsById.get(c.admin_assignee_id) ?? "Atendente") : "Sem atendente",
      departmentName: c.team_assignee_id ? (teamsById.get(c.team_assignee_id) ?? "Intercom") : "Intercom",
      departmentColor: IC_COLOR,
      lastMessage: buildLastMessage(c),
      externalUrl: workspaceId
        ? `https://app.intercom.com/a/apps/${workspaceId}/inbox/conversation/${c.id}`
        : undefined,
    });
  }

  return mapped;
}
