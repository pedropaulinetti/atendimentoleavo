interface Entry {
  updatedAt: number;
  lastHumanAdminReplyAt: number | null;
}

const MAX = 500;
const store = new Map<string, Entry>();

export function get(convId: string, updatedAt: number): Entry | null {
  const hit = store.get(convId);
  if (!hit) return null;
  if (hit.updatedAt !== updatedAt) { store.delete(convId); return null; }
  return hit;
}

export function set(convId: string, entry: Entry): void {
  if (store.size >= MAX && !store.has(convId)) {
    const firstKey = store.keys().next().value;
    if (firstKey) store.delete(firstKey);
  }
  store.set(convId, entry);
}

export function __reset() { store.clear(); }
