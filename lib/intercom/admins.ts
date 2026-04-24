import { icFetch } from "./client";
import type { ICAdmin } from "./types";

const TTL_MS = 60 * 60 * 1000;
const BOT_NAME_PATTERN = /fin|operator|bot/i;

interface ResolvedAdmins {
  botIds: Set<string>;
  namesById: Map<string, string>;
}

let cache: { value: ResolvedAdmins; expiresAt: number } | null = null;

export function __resetCache() { cache = null; }

export async function getResolvedAdmins(): Promise<ResolvedAdmins> {
  const envIds = (process.env.INTERCOM_BOT_ADMIN_IDS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);

  if (cache && Date.now() < cache.expiresAt) {
    if (envIds.length > 0) {
      return { ...cache.value, botIds: new Set(envIds) };
    }
    return cache.value;
  }

  try {
    const res = await icFetch<{ admins: ICAdmin[] }>("GET", "/admins");
    const namesById = new Map(res.admins.map(a => [a.id, a.name]));
    const botIds = envIds.length > 0
      ? new Set(envIds)
      : new Set(res.admins.filter(a => BOT_NAME_PATTERN.test(a.name)).map(a => a.id));
    const resolved: ResolvedAdmins = { botIds, namesById };
    cache = { value: resolved, expiresAt: Date.now() + TTL_MS };
    return resolved;
  } catch {
    if (cache) return cache.value;
    return { botIds: new Set(envIds), namesById: new Map() };
  }
}

export async function getBotAdminIds(): Promise<Set<string>> {
  return (await getResolvedAdmins()).botIds;
}
