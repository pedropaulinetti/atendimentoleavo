# Monitor — Intercom Merge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `/api/conversations` endpoint and Monitor UI to merge conversations from Data Crazy and Intercom into a single unified list ordered by wait time, respecting bot-exclusion rules for Intercom.

**Architecture:** Server-side merge via `Promise.allSettled` in the existing route. Both sources normalize to a unified `Conversation` shape. Intercom adapter uses a split-group strategy (one search call for obviously-waiting conversations, per-conversation parts fetch only for admin-replied ones with aggressive in-memory caching) to honor the "bots don't stop the timer" rule while staying under the 83 req/10s Intercom rate limit. Partial failures return 200 with a `sourceErrors` flag; both-failures return 503.

**Tech Stack:** Next.js 15, TypeScript, Intercom REST API 2.x (`POST /conversations/search`, `GET /conversations/{id}`, `GET /admins`), Vitest + MSW for tests. No new npm dependencies — concurrency cap implemented inline.

**Spec:** [docs/superpowers/specs/2026-04-24-monitor-intercom-merge-design.md](../specs/2026-04-24-monitor-intercom-merge-design.md)

---

## File Structure

**Create:**
- `lib/monitor/types.ts` — unified `Conversation`, `ConversationSource`, re-export `AlertLevel`.
- `lib/monitor/constants.ts` — `MAX_AGE_MINUTES = 72 * 60`.
- `lib/datacrazy/mapper.ts` — `fetchAndMapDCConversations()`: extracts enrichment currently inline in the route.
- `lib/intercom/types.ts` — `ICConversation`, `ICAdmin`, `ICConversationPart`, `IntercomError`.
- `lib/intercom/client.ts` — `icFetch()` mirror of `dcFetch`, with Intercom auth headers + error mapping.
- `lib/intercom/admins.ts` — `getBotAdminIds()` with 1h cache, env-first, `/admins` fallback.
- `lib/intercom/cache.ts` — in-memory parts cache keyed by `{convId, updatedAt}`.
- `lib/intercom/mapper.ts` — `fetchAndMapIntercomConversations()`: search + split-group + concurrency-capped parts fetch.
- `tests/lib/intercom-client.test.ts`
- `tests/lib/intercom-mapper.test.ts`

**Modify:**
- `app/api/conversations/route.ts` — becomes a thin merger: `Promise.allSettled([fetchAndMapDC, fetchAndMapIC])`, compute stats on unified shape, return `sourceErrors`.
- `components/monitor/ConversationList.tsx` — add `source` / `externalUrl` / `sourceErrors` to types, render badge, wrap card in `<a>`, render partial-failure banner.
- `tests/api/conversations.test.ts` — add merge, partial-failure, disabled-IC, both-fail cases.
- `.env.local.example` — add Intercom env vars.
- `README.md` — short section about Intercom env vars (mirrors existing Data Crazy section).

---

## Phase 1 — Foundation: unified shape + DC mapper extraction

Goal of this phase: no user-facing change. Extract existing DC enrichment into a reusable mapper producing the unified `Conversation` shape, verified by the existing test suite passing unchanged.

### Task 1: Introduce `lib/monitor/types.ts`

**Files:**
- Create: `lib/monitor/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
import type { AlertLevel } from "./severity";
export type { AlertLevel };

export type ConversationSource = "datacrazy" | "intercom";

export interface Conversation {
  id: string;
  source: ConversationSource;
  name: string;
  level: Exclude<AlertLevel, "ok" | "respondida">;
  minutosParada: number;
  attendantName: string;
  departmentName: string;
  departmentColor: string;
  lastMessage: string | null;
  externalUrl?: string;
}

export interface ConversationsResponse {
  conversations: Conversation[];
  updatedAt: string;
  stats: {
    avgMinutos: number;
    maxMinutos: number;
    byDepartment: { name: string; color: string; count: number }[];
  };
  sourceErrors?: Partial<Record<ConversationSource, string>>;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS (no usages yet).

- [ ] **Step 3: Commit**

```bash
git add lib/monitor/types.ts
git commit -m "feat(monitor): add unified Conversation shape"
```

### Task 2: Extract `MAX_AGE_MINUTES` constant

**Files:**
- Create: `lib/monitor/constants.ts`

- [ ] **Step 1: Create constants file**

```typescript
export const MAX_AGE_MINUTES = 72 * 60;
```

- [ ] **Step 2: Commit**

```bash
git add lib/monitor/constants.ts
git commit -m "feat(monitor): extract MAX_AGE_MINUTES constant"
```

### Task 3: Extract Data Crazy enrichment into mapper (pure refactor)

**Files:**
- Create: `lib/datacrazy/mapper.ts`
- Modify: `app/api/conversations/route.ts` (remove inline enrichment, call mapper)
- Test: `tests/api/conversations.test.ts` (existing, must still pass)

- [ ] **Step 1: Read the current inline enrichment in the route**

Run: `grep -n "enriched" app/api/conversations/route.ts`
Purpose: confirm current shape; you will move lines 29-50 (approx) into the mapper.

- [ ] **Step 2: Create `lib/datacrazy/mapper.ts`**

```typescript
import { dcFetch } from "./client";
import { getStages, handleDCError } from "./pipeline";
import { computeAlertLevel } from "@/lib/monitor/severity";
import { MAX_AGE_MINUTES } from "@/lib/monitor/constants";
import type { DCConversation } from "./types";
import type { Conversation } from "@/lib/monitor/types";

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

  return res.data
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
        id: `dc:${c.id}`,
        source: "datacrazy" as const,
        name: c.name,
        level, minutosParada, attendantName,
        departmentName: c.currentDepartment?.name ?? "—",
        departmentColor: c.currentDepartment?.color ?? "#666",
        lastMessage,
      };
    })
    .filter(c => c.level !== "ok" && c.level !== "respondida")
    .filter(c => c.minutosParada <= MAX_AGE_MINUTES) as Conversation[];
}

export { handleDCError };
```

- [ ] **Step 3: Rewrite `app/api/conversations/route.ts` to call the mapper**

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAndMapDCConversations, handleDCError } from "@/lib/datacrazy/mapper";
import type { Conversation } from "@/lib/monitor/types";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const now = Date.now();
    const conversations: Conversation[] = (await fetchAndMapDCConversations(now))
      .sort((a, b) => a.minutosParada - b.minutosParada);

    const avgMinutos = conversations.length
      ? conversations.reduce((s, c) => s + c.minutosParada, 0) / conversations.length
      : 0;
    const maxMinutos = conversations.length
      ? Math.max(...conversations.map(c => c.minutosParada))
      : 0;

    const byDepartmentMap = new Map<string, { name: string; color: string; count: number }>();
    for (const c of conversations) {
      const key = c.departmentName;
      const hit = byDepartmentMap.get(key);
      if (hit) hit.count += 1;
      else byDepartmentMap.set(key, { name: c.departmentName, color: c.departmentColor, count: 1 });
    }
    const byDepartment = Array.from(byDepartmentMap.values()).sort((a, b) => b.count - a.count);

    return NextResponse.json({
      conversations, updatedAt: new Date().toISOString(),
      stats: { avgMinutos, maxMinutos, byDepartment },
    });
  } catch (err) { return handleDCError(err); }
}
```

Note: this temporarily introduces `id` with `dc:` prefix, which existing tests may assert against. Step 4 verifies.

- [ ] **Step 4: Run existing tests, fix any ID-prefix assertions**

Run: `pnpm vitest run tests/api/conversations.test.ts -v`
Expected: most tests pass. If any assert raw IDs (e.g., `expect(body.conversations[0].id).toBe("c1")`), update them to `"dc:c1"`.

Also check the UI `ConversationList` doesn't do anything with the literal ID. Run: `grep -n "c.id" components/monitor/ConversationList.tsx` — if only used as a React key or in the `Set<string>` for sound alerts, the prefix is transparent.

- [ ] **Step 5: Run the full vitest suite**

Run: `pnpm vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/datacrazy/mapper.ts app/api/conversations/route.ts tests/api/conversations.test.ts
git commit -m "refactor(datacrazy): extract conversation enrichment into mapper"
```

---

## Phase 2 — Intercom client, admins, cache

### Task 4: `lib/intercom/types.ts`

**Files:**
- Create: `lib/intercom/types.ts`

- [ ] **Step 1: Write types**

```typescript
export type IntercomErrorCode =
  | "UNAUTHORIZED" | "RATE_LIMIT" | "TIMEOUT" | "SERVER_ERROR" | "UNKNOWN";

export class IntercomError extends Error {
  constructor(public code: IntercomErrorCode, public status: number, message: string) {
    super(message);
  }
}

export interface ICAdmin {
  id: string;
  type: "admin";
  name: string;
  email?: string;
}

export interface ICConversationStatistics {
  last_contact_reply_at: number | null;
  last_admin_reply_at: number | null;
}

export interface ICConversation {
  id: string;
  state: "open" | "closed" | "snoozed";
  updated_at: number;
  waiting_since: number | null;
  statistics: ICConversationStatistics;
  source: {
    body?: string;
    author?: { name?: string; email?: string };
  };
  contacts: { contacts: Array<{ id: string; name?: string; email?: string }> };
  team_assignee_id: string | null;
  admin_assignee_id: string | null;
}

export interface ICConversationPart {
  type: "conversation_part";
  part_type: string;
  created_at: number;
  author: { type: "admin" | "user" | "bot" | "lead"; id: string; name?: string };
  body?: string | null;
}

export interface ICConversationWithParts extends ICConversation {
  conversation_parts: { parts: ICConversationPart[] };
}

export interface ICTeam {
  id: string;
  name: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/intercom/types.ts
git commit -m "feat(intercom): add API type definitions"
```

### Task 5: `lib/intercom/client.ts`

**Files:**
- Create: `lib/intercom/client.ts`
- Test: `tests/lib/intercom-client.test.ts`

- [ ] **Step 1: Write failing client test (GET happy path)**

`tests/lib/intercom-client.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer();
beforeAll(() => { process.env.INTERCOM_TOKEN = "tok:test"; server.listen(); });
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("icFetch", () => {
  it("sends bearer token and returns JSON", async () => {
    server.use(
      http.get("https://api.intercom.io/admins", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer tok:test");
        return HttpResponse.json({ admins: [{ id: "1", type: "admin", name: "Ana" }] });
      }),
    );
    const { icFetch } = await import("@/lib/intercom/client");
    const res = await icFetch<{ admins: { id: string }[] }>("GET", "/admins");
    expect(res.admins[0].id).toBe("1");
  });

  it("maps 401 to UNAUTHORIZED", async () => {
    server.use(http.get("https://api.intercom.io/admins", () =>
      HttpResponse.json({}, { status: 401 }),
    ));
    const { icFetch } = await import("@/lib/intercom/client");
    const { IntercomError } = await import("@/lib/intercom/types");
    await expect(icFetch("GET", "/admins")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("maps 429 to RATE_LIMIT", async () => {
    server.use(http.get("https://api.intercom.io/admins", () =>
      HttpResponse.json({}, { status: 429 }),
    ));
    const { icFetch } = await import("@/lib/intercom/client");
    await expect(icFetch("GET", "/admins")).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });

  it("POST sends JSON body", async () => {
    server.use(
      http.post("https://api.intercom.io/conversations/search", async ({ request }) => {
        const body = await request.json();
        expect(body).toEqual({ query: { field: "state", operator: "=", value: "open" } });
        return HttpResponse.json({ conversations: [] });
      }),
    );
    const { icFetch } = await import("@/lib/intercom/client");
    await icFetch("POST", "/conversations/search", {
      query: { field: "state", operator: "=", value: "open" },
    });
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm vitest run tests/lib/intercom-client.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/intercom/client.ts`**

```typescript
import { IntercomError, type IntercomErrorCode } from "./types";

const BASE = "https://api.intercom.io";
const TIMEOUT_MS = 5_000;

function mapError(status: number): IntercomError {
  if (status === 401) return new IntercomError("UNAUTHORIZED", status, "Token Intercom inválido");
  if (status === 429) return new IntercomError("RATE_LIMIT", status, "Rate limit Intercom");
  if (status >= 500) return new IntercomError("SERVER_ERROR", status, "Erro servidor Intercom");
  return new IntercomError("UNKNOWN", status, `HTTP ${status}`);
}

export async function icFetch<T = unknown>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const token = process.env.INTERCOM_TOKEN;
  if (!token) throw new IntercomError("UNAUTHORIZED", 0, "INTERCOM_TOKEN ausente");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Intercom-Version": "2.11",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json() as Promise<T>;
    throw mapError(res.status);
  } catch (err) {
    if (err instanceof IntercomError) throw err;
    throw new IntercomError("TIMEOUT", 0, "Timeout ou erro de rede Intercom");
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/lib/intercom-client.test.ts`
Expected: all 4 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/intercom/client.ts tests/lib/intercom-client.test.ts
git commit -m "feat(intercom): add authenticated fetch client with error mapping"
```

### Task 6: `lib/intercom/admins.ts` — bot ID resolution + 1h cache

**Files:**
- Create: `lib/intercom/admins.ts`
- Test: `tests/lib/intercom-admins.test.ts`

- [ ] **Step 1: Write failing test**

`tests/lib/intercom-admins.test.ts`:
```typescript
import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer();
beforeAll(() => { process.env.INTERCOM_TOKEN = "tok:test"; server.listen(); });
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(async () => {
  const mod = await import("@/lib/intercom/admins");
  mod.__resetCache();
  delete process.env.INTERCOM_BOT_ADMIN_IDS;
});

describe("getBotAdminIds", () => {
  it("returns env-configured IDs as a Set, no API call", async () => {
    process.env.INTERCOM_BOT_ADMIN_IDS = "123,456";
    const { getBotAdminIds } = await import("@/lib/intercom/admins");
    const ids = await getBotAdminIds();
    expect(ids.has("123")).toBe(true);
    expect(ids.has("456")).toBe(true);
  });

  it("falls back to /admins name match when env is empty", async () => {
    server.use(http.get("https://api.intercom.io/admins", () =>
      HttpResponse.json({ admins: [
        { id: "1", type: "admin", name: "Ana" },
        { id: "2", type: "admin", name: "Fin AI" },
        { id: "3", type: "admin", name: "Operator" },
      ]})));
    const { getBotAdminIds } = await import("@/lib/intercom/admins");
    const ids = await getBotAdminIds();
    expect(ids.has("1")).toBe(false);
    expect(ids.has("2")).toBe(true);
    expect(ids.has("3")).toBe(true);
  });

  it("caches result for 1h", async () => {
    let calls = 0;
    server.use(http.get("https://api.intercom.io/admins", () => {
      calls++;
      return HttpResponse.json({ admins: [{ id: "9", type: "admin", name: "Fin" }] });
    }));
    const { getBotAdminIds } = await import("@/lib/intercom/admins");
    await getBotAdminIds();
    await getBotAdminIds();
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `pnpm vitest run tests/lib/intercom-admins.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/intercom/admins.ts`:
```typescript
import { icFetch } from "./client";
import type { ICAdmin } from "./types";

const TTL_MS = 60 * 60 * 1000; // 1h
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
    // On failure, behave as if no bots (safe: admin replies will stop timer, worst case false positive on "responded")
    return cache?.value ?? new Set<string>();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/lib/intercom-admins.test.ts`
Expected: all 3 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/intercom/admins.ts tests/lib/intercom-admins.test.ts
git commit -m "feat(intercom): add bot-admin ID resolution with 1h cache"
```

### Task 7: `lib/intercom/cache.ts` — parts cache

**Files:**
- Create: `lib/intercom/cache.ts`

Small enough to skip dedicated tests — behavior is exercised in mapper tests (Task 8).

- [ ] **Step 1: Implement**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add lib/intercom/cache.ts
git commit -m "feat(intercom): add in-memory parts cache"
```

### Task 8: `lib/intercom/mapper.ts` — main Intercom logic

**Files:**
- Create: `lib/intercom/mapper.ts`
- Test: `tests/lib/intercom-mapper.test.ts`

- [ ] **Step 1: Write failing tests (incremental — start with obvious-waiting case)**

`tests/lib/intercom-mapper.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer();
beforeAll(() => {
  process.env.INTERCOM_TOKEN = "tok:test";
  process.env.INTERCOM_WORKSPACE_ID = "ws1";
  server.listen();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(async () => {
  (await import("@/lib/intercom/admins")).__resetCache();
  (await import("@/lib/intercom/cache")).__reset();
  delete process.env.INTERCOM_BOT_ADMIN_IDS;
});

function icConv(overrides: any) {
  return {
    id: "c1", state: "open", updated_at: 1000, waiting_since: null,
    statistics: { last_contact_reply_at: null, last_admin_reply_at: null },
    source: { body: "olá", author: { name: "Cliente" } },
    contacts: { contacts: [{ id: "u1", name: "Cliente", email: "c@x.com" }] },
    team_assignee_id: null, admin_assignee_id: null,
    ...overrides,
  };
}

describe("fetchAndMapIntercomConversations", () => {
  it("maps obviously-waiting conv without fetching parts", async () => {
    const now = 10_000_000;
    const contactReply = (now - 20 * 60_000) / 1000; // 20 min ago → amarelo

    let partsFetched = 0;
    server.use(
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          statistics: { last_contact_reply_at: contactReply, last_admin_reply_at: null },
        })] })),
      http.get("https://api.intercom.io/conversations/:id", () => {
        partsFetched++;
        return HttpResponse.json({});
      }),
    );

    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    const out = await fetchAndMapIntercomConversations(now);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("intercom");
    expect(out[0].id).toBe("ic:c1");
    expect(out[0].level).toBe("amarelo");
    expect(partsFetched).toBe(0);
  });

  it("excludes conv when human admin replied last", async () => {
    const now = 10_000_000;
    const contactReply = (now - 20 * 60_000) / 1000;
    const adminReply = (now - 5 * 60_000) / 1000;

    server.use(
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          statistics: { last_contact_reply_at: contactReply, last_admin_reply_at: adminReply },
        })] })),
      http.get("https://api.intercom.io/conversations/c1", () =>
        HttpResponse.json(icConv({
          statistics: { last_contact_reply_at: contactReply, last_admin_reply_at: adminReply },
          conversation_parts: { parts: [
            { type: "conversation_part", part_type: "comment", created_at: adminReply,
              author: { type: "admin", id: "99", name: "Ana" }, body: "oi" },
          ]},
        }))),
    );

    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    const out = await fetchAndMapIntercomConversations(now);
    expect(out).toHaveLength(0);
  });

  it("keeps conv as waiting when last admin reply is from bot", async () => {
    process.env.INTERCOM_BOT_ADMIN_IDS = "99";
    const now = 10_000_000;
    const contactReply = (now - 20 * 60_000) / 1000;
    const botReply = (now - 5 * 60_000) / 1000;

    server.use(
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          statistics: { last_contact_reply_at: contactReply, last_admin_reply_at: botReply },
        })] })),
      http.get("https://api.intercom.io/conversations/c1", () =>
        HttpResponse.json(icConv({
          conversation_parts: { parts: [
            { type: "conversation_part", part_type: "comment", created_at: botReply,
              author: { type: "admin", id: "99", name: "Fin" }, body: "bot oi" },
          ]},
        }))),
    );

    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    const out = await fetchAndMapIntercomConversations(now);
    expect(out).toHaveLength(1);
    expect(out[0].minutosParada).toBeGreaterThanOrEqual(20);
  });

  it("cache hit skips parts fetch on second call with same updated_at", async () => {
    const now = 10_000_000;
    const contactReply = (now - 20 * 60_000) / 1000;
    const adminReply = (now - 5 * 60_000) / 1000;

    let partsFetched = 0;
    server.use(
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          statistics: { last_contact_reply_at: contactReply, last_admin_reply_at: adminReply },
        })] })),
      http.get("https://api.intercom.io/conversations/c1", () => {
        partsFetched++;
        return HttpResponse.json(icConv({
          conversation_parts: { parts: [
            { type: "conversation_part", part_type: "comment", created_at: adminReply,
              author: { type: "admin", id: "99", name: "Ana" } },
          ]},
        }));
      }),
    );

    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    await fetchAndMapIntercomConversations(now);
    await fetchAndMapIntercomConversations(now);
    expect(partsFetched).toBe(1);
  });

  it("unassigned conv gets 'Sem atendente' and 'Intercom' department", async () => {
    const now = 10_000_000;
    server.use(
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          statistics: { last_contact_reply_at: (now - 15 * 60_000) / 1000, last_admin_reply_at: null },
        })] })),
    );
    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    const out = await fetchAndMapIntercomConversations(now);
    expect(out[0].attendantName).toBe("Sem atendente");
    expect(out[0].departmentName).toBe("Intercom");
  });

  it("builds externalUrl from workspace ID", async () => {
    const now = 10_000_000;
    server.use(
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          statistics: { last_contact_reply_at: (now - 15 * 60_000) / 1000, last_admin_reply_at: null },
        })] })),
    );
    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    const out = await fetchAndMapIntercomConversations(now);
    expect(out[0].externalUrl).toBe("https://app.intercom.com/a/apps/ws1/inbox/conversation/c1");
  });

  it("filters out ancient convs above MAX_AGE_MINUTES", async () => {
    const now = 10_000_000;
    const ancient = (now - 100 * 60 * 60_000) / 1000; // 100h ago
    server.use(
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          statistics: { last_contact_reply_at: ancient, last_admin_reply_at: null },
        })] })),
    );
    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    const out = await fetchAndMapIntercomConversations(now);
    expect(out).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm vitest run tests/lib/intercom-mapper.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/intercom/mapper.ts`**

```typescript
import { icFetch } from "./client";
import { getBotAdminIds } from "./admins";
import * as cache from "./cache";
import { computeAlertLevel } from "@/lib/monitor/severity";
import { MAX_AGE_MINUTES } from "@/lib/monitor/constants";
import type { Conversation } from "@/lib/monitor/types";
import type {
  ICConversation, ICConversationWithParts, ICConversationPart,
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
  const botIds = await getBotAdminIds();

  const search = await icFetch<{ conversations: ICConversation[] }>(
    "POST",
    "/conversations/search",
    {
      query: { field: "state", operator: "=", value: "open" },
      pagination: { per_page: 150 },
    },
  );

  const opens = search.conversations.filter(c => c.state === "open");

  // Group B — admin replied last; needs parts fetch
  const groupB = opens.filter(c => {
    const lcr = c.statistics.last_contact_reply_at;
    const lar = c.statistics.last_admin_reply_at;
    return lcr !== null && lar !== null && lar > lcr;
  });

  // Resolve human admin reply timestamps in parallel (concurrency capped)
  const humanReplyByConvId = new Map<string, number | null>();
  await mapWithConcurrency(groupB, async (c) => {
    const v = await resolveHumanAdminReplyAt(c, botIds);
    humanReplyByConvId.set(c.id, v);
  });

  const mapped: Conversation[] = [];
  for (const c of opens) {
    const lcr = c.statistics.last_contact_reply_at;
    if (lcr === null) continue; // never got a customer message; nothing to wait on

    let effectiveAdminReply: number | null;
    if (humanReplyByConvId.has(c.id)) {
      effectiveAdminReply = humanReplyByConvId.get(c.id)!;
    } else {
      // group A: lar is null or older than lcr → any lar is either null or not meaningful
      effectiveAdminReply = null;
    }

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
      attendantName: "Sem atendente", // Task 9 may enrich with admin name via /admins lookup
      departmentName: "Intercom",      // Task 9 may enrich with team name via /teams lookup
      departmentColor: IC_COLOR,
      lastMessage: buildLastMessage(c),
      externalUrl: workspaceId
        ? `https://app.intercom.com/a/apps/${workspaceId}/inbox/conversation/${c.id}`
        : undefined,
    });
  }

  return mapped;
}
```

Note: `attendantName` and `departmentName` start hard-coded. Task 9 enriches with real team/admin names.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/lib/intercom-mapper.test.ts`
Expected: all 7 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/intercom/mapper.ts tests/lib/intercom-mapper.test.ts
git commit -m "feat(intercom): add fetch-and-map with bot-aware waiting logic"
```

### Task 9: Enrich Intercom `attendantName` and `departmentName` with real names

**Files:**
- Modify: `lib/intercom/mapper.ts`
- Modify: `lib/intercom/admins.ts` (add `getAdminsById` lookup)
- Create: `lib/intercom/teams.ts`
- Test: `tests/lib/intercom-mapper.test.ts` (add cases)

- [ ] **Step 1: Write failing tests**

Append to `tests/lib/intercom-mapper.test.ts`:
```typescript
it("enriches attendantName with admin name when assigned", async () => {
  const now = 10_000_000;
  server.use(
    http.get("https://api.intercom.io/admins", () => HttpResponse.json({ admins: [
      { id: "77", type: "admin", name: "Ana" },
    ]})),
    http.get("https://api.intercom.io/teams", () => HttpResponse.json({ teams: [] })),
    http.post("https://api.intercom.io/conversations/search", () =>
      HttpResponse.json({ conversations: [icConv({
        admin_assignee_id: "77",
        statistics: { last_contact_reply_at: (now - 15 * 60_000) / 1000, last_admin_reply_at: null },
      })] })),
  );
  const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
  const out = await fetchAndMapIntercomConversations(now);
  expect(out[0].attendantName).toBe("Ana");
});

it("enriches departmentName with team name when assigned", async () => {
  const now = 10_000_000;
  server.use(
    http.get("https://api.intercom.io/admins", () => HttpResponse.json({ admins: [] })),
    http.get("https://api.intercom.io/teams", () => HttpResponse.json({ teams: [
      { id: "t1", name: "Suporte" },
    ]})),
    http.post("https://api.intercom.io/conversations/search", () =>
      HttpResponse.json({ conversations: [icConv({
        team_assignee_id: "t1",
        statistics: { last_contact_reply_at: (now - 15 * 60_000) / 1000, last_admin_reply_at: null },
      })] })),
  );
  const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
  const out = await fetchAndMapIntercomConversations(now);
  expect(out[0].departmentName).toBe("Suporte");
});
```

- [ ] **Step 2: Create `lib/intercom/teams.ts`**

```typescript
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
```

- [ ] **Step 3: Extend `lib/intercom/admins.ts` with admin-name map**

Add:
```typescript
export async function getAdminsById(): Promise<Map<string, string>> {
  try {
    const res = await icFetch<{ admins: ICAdmin[] }>("GET", "/admins");
    return new Map(res.admins.map(a => [a.id, a.name]));
  } catch {
    return new Map();
  }
}
```

- [ ] **Step 4: Modify `lib/intercom/mapper.ts` to use the lookups**

Replace the hard-coded `"Sem atendente"` / `"Intercom"` with:
```typescript
import { getAdminsById } from "./admins";
import { getTeamsById } from "./teams";

// inside fetchAndMapIntercomConversations, in parallel with search:
const [botIds, adminsById, teamsById] = await Promise.all([
  getBotAdminIds(), getAdminsById(), getTeamsById(),
]);

// ...when building each mapped conversation:
attendantName: c.admin_assignee_id
  ? (adminsById.get(c.admin_assignee_id) ?? "Atendente")
  : "Sem atendente",
departmentName: c.team_assignee_id
  ? (teamsById.get(c.team_assignee_id) ?? "Intercom")
  : "Intercom",
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/lib/intercom-mapper.test.ts`
Expected: all pass including the two new cases.

- [ ] **Step 6: Commit**

```bash
git add lib/intercom/mapper.ts lib/intercom/admins.ts lib/intercom/teams.ts tests/lib/intercom-mapper.test.ts
git commit -m "feat(intercom): enrich attendant and department from admin/team lookups"
```

---

## Phase 3 — Route handler merge

### Task 10: Merge both sources in `/api/conversations`

**Files:**
- Modify: `app/api/conversations/route.ts`
- Modify: `tests/api/conversations.test.ts`

- [ ] **Step 1: Write failing merge tests**

Append to `tests/api/conversations.test.ts` (add at top-level and imports as needed):
```typescript
describe("GET /api/conversations — multi-source", () => {
  beforeEach(() => {
    process.env.INTERCOM_TOKEN = "tok:test";
    process.env.INTERCOM_WORKSPACE_ID = "ws1";
    process.env.INTERCOM_ENABLED = "true";
  });

  it("merges DC and IC sorted by minutosParada", async () => {
    // DC handlers (stages + conversations) with one conv 5min waiting
    // IC handler with one conv 20min waiting
    // assert: body.conversations has 2 items, ic first (20min), dc second (5min)
    // assert: each has `source` set
  });

  it("returns only DC with sourceErrors.intercom when IC returns 429", async () => {
    // DC normal, IC /conversations/search → 429
    // assert: conversations contains only DC items
    // assert: body.sourceErrors.intercom === "rate_limit"
  });

  it("returns only IC with sourceErrors.datacrazy when DC returns 500", async () => {
    // Inverse of above
  });

  it("returns 503 when both fail", async () => {
    // Both search endpoints 500
    // assert: response.status === 503, body.sourceErrors has both keys
  });

  it("skips IC fetch when INTERCOM_ENABLED=false", async () => {
    process.env.INTERCOM_ENABLED = "false";
    let icCalls = 0;
    server.use(http.post("https://api.intercom.io/conversations/search", () => {
      icCalls++; return HttpResponse.json({ conversations: [] });
    }));
    // DC normal
    // call GET
    // assert: icCalls === 0; no sourceErrors.intercom
  });
});
```

Fill in the handlers using existing DC test patterns as reference ([tests/api/conversations.test.ts](tests/api/conversations.test.ts)). Use realistic timestamps: `Date.now() - minutes * 60_000` then convert for IC to Unix seconds.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm vitest run tests/api/conversations.test.ts`
Expected: new tests FAIL (current route doesn't know about Intercom).

- [ ] **Step 3: Refactor `app/api/conversations/route.ts` to merge**

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAndMapDCConversations, handleDCError } from "@/lib/datacrazy/mapper";
import { fetchAndMapIntercomConversations } from "@/lib/intercom/mapper";
import type { Conversation, ConversationSource } from "@/lib/monitor/types";
import { DataCrazyError } from "@/lib/datacrazy/types";
import { IntercomError } from "@/lib/intercom/types";

function errorCode(err: unknown): string {
  if (err instanceof DataCrazyError || err instanceof IntercomError) {
    return err.code.toLowerCase();
  }
  return "unknown";
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const now = Date.now();
  const icEnabled = process.env.INTERCOM_ENABLED === "true";

  const [dcResult, icResult] = await Promise.allSettled([
    fetchAndMapDCConversations(now),
    icEnabled ? fetchAndMapIntercomConversations(now) : Promise.resolve([] as Conversation[]),
  ]);

  const sourceErrors: Partial<Record<ConversationSource, string>> = {};
  const conversations: Conversation[] = [];

  if (dcResult.status === "fulfilled") conversations.push(...dcResult.value);
  else { sourceErrors.datacrazy = errorCode(dcResult.reason); console.warn("[conversations] datacrazy failed", dcResult.reason); }

  if (icEnabled) {
    if (icResult.status === "fulfilled") conversations.push(...icResult.value);
    else { sourceErrors.intercom = errorCode(icResult.reason); console.warn("[conversations] intercom failed", icResult.reason); }
  }

  if (conversations.length === 0 && Object.keys(sourceErrors).length > 0
      && (dcResult.status === "rejected") && (!icEnabled || icResult.status === "rejected")) {
    return NextResponse.json({ error: "ALL_SOURCES_FAILED", sourceErrors }, { status: 503 });
  }

  conversations.sort((a, b) => a.minutosParada - b.minutosParada);

  const avgMinutos = conversations.length
    ? conversations.reduce((s, c) => s + c.minutosParada, 0) / conversations.length
    : 0;
  const maxMinutos = conversations.length
    ? Math.max(...conversations.map(c => c.minutosParada))
    : 0;

  const byDepartmentMap = new Map<string, { name: string; color: string; count: number }>();
  for (const c of conversations) {
    const key = c.departmentName;
    const hit = byDepartmentMap.get(key);
    if (hit) hit.count += 1;
    else byDepartmentMap.set(key, { name: c.departmentName, color: c.departmentColor, count: 1 });
  }
  const byDepartment = Array.from(byDepartmentMap.values()).sort((a, b) => b.count - a.count);

  return NextResponse.json({
    conversations,
    updatedAt: new Date().toISOString(),
    stats: { avgMinutos, maxMinutos, byDepartment },
    sourceErrors: Object.keys(sourceErrors).length > 0 ? sourceErrors : undefined,
  });
}
```

- [ ] **Step 4: Run full vitest suite**

Run: `pnpm vitest run`
Expected: all pass, including new multi-source tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/conversations/route.ts tests/api/conversations.test.ts
git commit -m "feat(conversations): merge Data Crazy and Intercom with partial-failure handling"
```

---

## Phase 4 — UI

### Task 11: UI — source badge + external link + error banner

**Files:**
- Modify: `components/monitor/ConversationList.tsx`

- [ ] **Step 1: Update `Conversation` interface and fetch type** (around [components/monitor/ConversationList.tsx:12-16](components/monitor/ConversationList.tsx#L12-L16))

Replace the `interface Conversation` block with:
```typescript
interface Conversation {
  id: string; source: "datacrazy" | "intercom";
  name: string; level: "vermelho"|"amarelo"|"verdeAlerta";
  minutosParada: number; attendantName: string;
  departmentName: string; departmentColor: string;
  lastMessage: string | null;
  externalUrl?: string;
}
```

And the fetch Promise generic (around [line 58-66](components/monitor/ConversationList.tsx#L58-L66)):
```typescript
return r.json() as Promise<{
  conversations: Conversation[];
  updatedAt: string;
  stats: { avgMinutos: number; maxMinutos: number; byDepartment: { name: string; color: string; count: number }[] };
  sourceErrors?: { datacrazy?: string; intercom?: string };
}>;
```

- [ ] **Step 2: Add partial-failure banner** immediately before the BigStat grid (around [line 112](components/monitor/ConversationList.tsx#L112)):

```tsx
{(data.sourceErrors?.datacrazy || data.sourceErrors?.intercom) && (
  <Card className="border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
    {data.sourceErrors.datacrazy && !data.sourceErrors.intercom && "Data Crazy indisponível — mostrando só Intercom. Tentando novamente…"}
    {data.sourceErrors.intercom && !data.sourceErrors.datacrazy && "Intercom indisponível — mostrando só Data Crazy. Tentando novamente…"}
    {data.sourceErrors.datacrazy && data.sourceErrors.intercom && "Ambas as fontes indisponíveis. Tentando novamente…"}
  </Card>
)}
```

- [ ] **Step 3: Render source badge inside the card** (inside the name block, around [line 229](components/monitor/ConversationList.tsx#L229)):

```tsx
<div className="flex items-center gap-2">
  <p className="font-medium text-zinc-900 leading-tight truncate">{c.name}</p>
  <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono shrink-0">
    {c.source === "datacrazy" ? "DC" : "IC"}
  </Badge>
</div>
```

- [ ] **Step 4: Wrap card in a link when `externalUrl` is set**

Replace `<li key={c.id}><Card ...>...</Card></li>` with:
```tsx
<li key={c.id}>
  {c.externalUrl ? (
    <a href={c.externalUrl} target="_blank" rel="noreferrer" className="block">
      <Card className={cn(/* same classes */)}>...</Card>
    </a>
  ) : (
    <Card className={cn(/* same classes */)}>...</Card>
  )}
</li>
```

Keep the Card body identical in both branches — consider extracting a `<ConversationCardBody c={c} />` sub-component if the duplication feels off.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Visual smoke test**

Run: `pnpm dev`
- Open http://localhost:3000/monitor
- Confirm existing DC conversations now show the `DC` badge
- If Intercom is configured, confirm IC conversations appear with `IC` badge and the card links to `app.intercom.com`
- Temporarily break `INTERCOM_TOKEN` in `.env.local` (set to `invalid`) and confirm the amber banner appears while DC still renders

- [ ] **Step 7: Commit**

```bash
git add components/monitor/ConversationList.tsx
git commit -m "feat(monitor): render source badge, external link, and partial-failure banner"
```

---

## Phase 5 — Config, docs, ship

### Task 12: Env vars + README

**Files:**
- Modify: `.env.local.example`
- Modify: `README.md`

- [ ] **Step 1: Update `.env.local.example`**

Add at the end:
```
# Intercom (optional — set INTERCOM_ENABLED=true to merge into Monitor)
INTERCOM_ENABLED=false
INTERCOM_TOKEN=tok:...
INTERCOM_WORKSPACE_ID=abc123de
INTERCOM_BOT_ADMIN_IDS=
```

- [ ] **Step 2: Update `README.md` Env vars section**

Under the Intercom-vars section, add:
```
- `INTERCOM_ENABLED=true` liga a fonte Intercom no Monitor. Se `false` ou ausente, Intercom é ignorado silenciosamente.
- `INTERCOM_TOKEN`: Access Token em Intercom → Settings → Developer Hub → seu app → Authentication.
- `INTERCOM_WORKSPACE_ID`: app_id do workspace, usado pra montar os deep-links.
- `INTERCOM_BOT_ADMIN_IDS`: opcional, lista separada por vírgula dos admin IDs que são bot/Fin. Se vazio, tenta detectar pelos nomes em `/admins`.
```

- [ ] **Step 3: Commit**

```bash
git add .env.local.example README.md
git commit -m "docs: add Intercom env var configuration"
```

### Task 13: Final verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm vitest run`
Expected: all pass, zero skips.

- [ ] **Step 2: Run typecheck + lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Run E2E (if credentials present)**

Run: `pnpm test:e2e`
Expected: PASS. The Monitor page still loads and lists conversations (source-agnostic tests).

- [ ] **Step 4: Manual smoke matrix**

With `INTERCOM_ENABLED=true` and valid credentials:
- Monitor shows DC and IC conversations interleaved by wait time.
- Clicking a `DC` card opens Data Crazy; clicking `IC` opens Intercom.
- A real waiting conversation with only bot replies stays in the list.
- A conversation where a human admin has replied disappears within 2 polls.

With `INTERCOM_ENABLED=false`:
- Monitor behaves exactly as before this change.

With `INTERCOM_TOKEN=invalid`:
- Amber banner renders; DC list still works.

- [ ] **Step 5: No commit needed — verification only.**

---

## Rollback

If something breaks in production, the cheapest mitigation is setting `INTERCOM_ENABLED=false` in Vercel env (takes effect on the next request; no redeploy). That fully reverts the Monitor to Data Crazy-only behavior.

If the route refactor itself regresses DC behavior, revert commits in reverse task order; Phase 1 Task 3 is the only commit that changes DC output shape (adds `dc:` ID prefix and `source` field), so reverting Phase 3 Task 10 + Phase 1 Task 3 restores the pre-merge route.
