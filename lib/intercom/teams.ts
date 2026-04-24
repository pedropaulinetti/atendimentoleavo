import { icFetch } from "./client";
import type { ICTeam } from "./types";

const TTL_MS = 60 * 60 * 1000;
let cache: { value: Map<string, string>; expiresAt: number } | null = null;

export function __resetCache() { cache = null; }

export async function getTeamsById(): Promise<Map<string, string>> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;
  try {
    const res = await icFetch<{ teams: ICTeam[] }>("GET", "/teams");
    const map = new Map(res.teams.map(t => [t.id, t.name]));
    cache = { value: map, expiresAt: Date.now() + TTL_MS };
    return map;
  } catch {
    return cache?.value ?? new Map();
  }
}
