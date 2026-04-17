type Entry<T> = { value: T; expiresAt: number };
const store = new Map<string, Entry<unknown>>();

export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await loader();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

export function invalidateCache(key?: string) {
  if (key) store.delete(key); else store.clear();
}
