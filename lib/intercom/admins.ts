import { icFetch } from "./client";
import type { ICAdmin } from "./types";

const TTL_MS = 60 * 60 * 1000;
const BOT_NAME_PATTERN = /fin|operator|bot/i;

let cache: { value: Set<string>; expiresAt: number } | null = null;

export function __resetCache() { cache = null; }

export async function getBotAdminIds(): Promise<Set<string>> {
  const envIds = (process.env.INTERCOM_BOT_ADMIN_IDS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (envIds.length > 0) return new Set(envIds);

  if (cache && Date.now() < cache.expiresAt) return cache.value;

  try {
    const res = await icFetch<{ admins: ICAdmin[] }>("GET", "/admins");
    const botIds = new Set(
      res.admins
        .filter(a => BOT_NAME_PATTERN.test(a.name))
        .map(a => a.id),
    );
    cache = { value: botIds, expiresAt: Date.now() + TTL_MS };
    return botIds;
  } catch {
    return cache?.value ?? new Set<string>();
  }
}
