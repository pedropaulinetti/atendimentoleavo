# Monitor — Merge Data Crazy + Intercom

**Status:** Design approved (2026-04-24)
**Scope:** Only the Monitor panel. Funil stays unchanged.

## Problem

The Monitor panel today lists conversations from a single source (Data Crazy). The team also uses Intercom for a disjoint set of channels/customers. They need a single global list sorted by wait time so the attendant can always act on the oldest-waiting conversation, regardless of which tool it lives in.

Constraints shaping the design:

- Monitor polls every 10s. Intercom REST rate limit is 83 req / 10s per workspace.
- Bot replies (Fin/Operator) must NOT count as a human response — the customer is still waiting.
- Intercom and Data Crazy conversations are disjoint (different channels), no identity merging needed.
- Serverless deploy target (Vercel): per-request handler, no persistent in-process state guaranteed.

## Non-goals

- Intercom conversations in the Funil panel.
- Webhook-based ingestion (polling + cache is sufficient for current volume).
- Cross-source identity resolution (same customer across both tools).
- Filtering Intercom by team/inbox/tag (all `state: open` is the initial scope).
- Persistent cache (Redis/Upstash) — RAM only, promote later if hit rate observably insufficient.

## Architecture

```
[Monitor UI]
   │ useQuery("conversations") @ 10s
   ▼
GET /api/conversations
   │
   ├─► fetchDatacrazy()  ──► DC API (existing)
   └─► fetchIntercom()   ──► Intercom API (new)
         │
         ▼  Promise.allSettled → normalize → merge → sort by minutosParada asc
         ▼
   { conversations, updatedAt, stats, sourceErrors? }
```

Key choices:

- **Server-side merge** in the existing `/api/conversations` route. One cache key on the client, one loading state, one refetch interval. Client stays dumb.
- **`Promise.allSettled`** around the two source fetches: a failure in one source returns the other's data plus a `sourceErrors` flag to the UI. Only both-failing returns 5xx.
- **New module `lib/intercom/`** mirrors `lib/datacrazy/` structure: `client.ts`, `mapper.ts`, `types.ts`, `cache.ts`.
- **`lib/monitor/types.ts`** introduces the unified `Conversation` shape. Both source mappers produce this type; the route handler no longer returns source-specific shapes.

## Unified `Conversation` shape

```typescript
// lib/monitor/types.ts (new)
export type ConversationSource = "datacrazy" | "intercom";

export interface Conversation {
  id: string;                     // prefixed: "dc:<uuid>" or "ic:<id>" — disambiguates across sources
  source: ConversationSource;
  name: string;                   // contact name
  level: AlertLevel;              // vermelho | amarelo | verdeAlerta (ok/respondida already filtered)
  minutosParada: number;
  attendantName: string;          // "Sem atendente" fallback
  departmentName: string;         // DC: current department | IC: team name or "Intercom" if unassigned
  departmentColor: string;        // DC: dept color | IC: fixed configurable default (#6366f1)
  lastMessage: string | null;     // preview capped at 240 chars
  externalUrl?: string;           // deep-link into DC or Intercom inbox
}
```

Design notes:

- **`id` is prefixed** to avoid collisions between sources (defensive; UUIDs rarely collide across systems but debugging is clearer).
- **`externalUrl`** lets the card act as a link out to the source tool — clicking opens the conversation in the right product. Badge tells which; link closes the loop.
- **Intercom `departmentName` = team name** when assigned, `"Intercom"` otherwise. This makes the `stats.byDepartment` aggregate work uniformly across sources with no special-case code in the route.
- Existing `DCConversation` type stays inside `lib/datacrazy/` untouched; `Conversation` becomes the lingua franca of the Monitor going forward.

## Intercom adapter

### Structure
```
lib/intercom/
  client.ts    // fetch wrapper (auth, timeout, typed errors — mirrors lib/datacrazy/client.ts)
  types.ts     // ICConversation, ICAdmin, ICConversationPart shapes
  mapper.ts    // ICConversation → Conversation
  cache.ts     // in-memory map, process-level
  admins.ts    // bot-admin identification
```

### Fetch strategy

Primary call per poll:

```
POST /conversations/search
{
  "query": { "field": "state", "operator": "=", "value": "open" },
  "pagination": { "per_page": 150 }
}
```

One call returns all open conversations with their `statistics` block populated (`last_contact_reply_at`, `last_admin_reply_at`, `waiting_since`).

### Bot-aware waiting-time logic

Because Intercom classifies Fin/Operator as "admin" in `statistics.last_admin_reply_at`, we can't trust that field alone — bot replies would incorrectly stop the timer.

**Split conversations into two groups:**

**Group A — "obviously waiting"** (`last_contact_reply_at > last_admin_reply_at` OR `last_admin_reply_at` is null):
- Customer was the last to speak. No ambiguity. Compute `minutosParada` directly from `last_contact_reply_at`. No extra fetch.

**Group B — "admin replied last"** (`last_admin_reply_at > last_contact_reply_at`):
- Need to verify the last admin wasn't a bot. Steps:
  1. Check in-memory cache keyed by `{convId, conv.updated_at}`. Cache entry stores `lastHumanAdminReplyAt: number | null`. On hit → reuse, no extra fetch.
  2. On miss → `GET /conversations/{id}`. Walk `conversation_parts.parts` backwards, find the most recent part where `part.part_type === "comment"` (or similar reply type) and `part.author.type === "admin"` and `part.author.id ∉ botAdminIds`.
  3. If found AND its timestamp is newer than `last_contact_reply_at` → conversation is "respondida" (human admin has replied) → EXCLUDE from Monitor.
  4. Otherwise (no human reply, or human reply is older than last contact message) → treat as still waiting. Compute `minutosParada` from `last_contact_reply_at`.
  5. Store result in cache.

**Concurrency guard**: a simple `p-limit` (or manual semaphore) caps parallel `GET /conversations/{id}` at 10. On HTTP 429, abort remaining fetches, return what was resolved, flag `sourceErrors.intercom = "rate_limit_partial"`.

### Bot-admin identification

Source of truth for bot IDs, in priority order:

1. **`INTERCOM_BOT_ADMIN_IDS` env var** (comma-separated). Explicit and reliable. Preferred.
2. **Fallback — fetch `/admins`** and flag admins whose `name` matches `/fin|operator|bot/i`. Less reliable but avoids a hard configuration gate at first setup.

`lib/intercom/admins.ts` caches the bot-id set for 1h (stale-while-revalidate). Admins rarely change and wrong classification is self-correcting on the next refresh.

### In-memory cache

```typescript
// lib/intercom/cache.ts — module-level Map
const partsCache = new Map<string, {
  updatedAt: number;                   // Intercom conv.updated_at
  lastHumanAdminReplyAt: number | null;
}>();
```

Eviction: size-capped at e.g. 500 entries (LRU on insert) to avoid unbounded growth in long-running server processes. On Vercel, cold starts reset the cache — accepted tradeoff. Hit rate in warm instances is high because most conversations don't change `updated_at` between 10s polls; Group B cache misses in steady state are typically 0–3 per poll.

## Handler-level merge (`app/api/conversations/route.ts`)

Pseudocode (Portuguese identifiers kept to match the existing route):

```typescript
const [dcResult, icResult] = await Promise.allSettled([
  fetchDatacrazyConversations(),            // existing logic, refactored to return Conversation[]
  process.env.INTERCOM_ENABLED === "true"
    ? fetchIntercomConversations()
    : Promise.resolve([]),
]);

const sourceErrors: Record<string, string> = {};
const conversations: Conversation[] = [];

if (dcResult.status === "fulfilled") conversations.push(...dcResult.value);
else sourceErrors.datacrazy = mapErrorCode(dcResult.reason);

if (icResult.status === "fulfilled") conversations.push(...icResult.value);
else sourceErrors.intercom = mapErrorCode(icResult.reason);

if (conversations.length === 0 && Object.keys(sourceErrors).length === 2) {
  return NextResponse.json({ error: "ALL_SOURCES_FAILED", sourceErrors }, { status: 503 });
}

conversations.sort((a, b) => a.minutosParada - b.minutosParada);  // asc, matches existing Monitor behavior

return NextResponse.json({
  conversations,
  updatedAt: new Date().toISOString(),
  stats: computeStats(conversations),       // avgMinutos, maxMinutos, byDepartment
  sourceErrors: Object.keys(sourceErrors).length > 0 ? sourceErrors : undefined,
});
```

Aggregate stats (`computeStats`) operate on the unified shape, so Intercom conversations with `departmentName = team name` naturally join the `byDepartment` breakdown without special cases.

**Note on refactor**: the current handler constructs Data Crazy conversations inline. That enrichment logic moves into `lib/datacrazy/mapper.ts` so the route handler becomes a thin merger. Note that DC enrichment is **not a pure mapping**: today the route does an N+1 `GET /conversations/{id}/messages` per alert conversation to build the `lastMessage` preview, plus attachment-type fallbacks (`"Áudio"`, `"Imagem"`, etc.). The new structure is:

- `lib/datacrazy/mapper.ts` exports `fetchAndMapDCConversations()` — async, performs the search + N+1 message fetches, returns `Conversation[]`. The name makes the side effects explicit.
- Same pattern on the IC side: `lib/intercom/mapper.ts` exports `fetchAndMapIntercomConversations()` (also async, does the search + conditional parts fetches described above).

Both return `Conversation[]` directly; the route handler just merges and sorts.

**Severity thresholds — shared source of truth**: Intercom conversations reuse `computeAlertLevel` from `lib/monitor/severity.ts` by synthesizing its inputs from Intercom timestamps: `lastReceivedMessageDate = last_contact_reply_at`, `lastSendedMessageDate = lastHumanAdminReplyAt` (bot-filtered, may be null). This keeps the 3/10/30 min thresholds defined in one place — if product changes them tomorrow, both sources update together.

**`MAX_AGE_MINUTES` cap applies to both sources**: the 72h cap (`lib/monitor/constants.ts` or continue inline at the route level) filters ancient abandoned conversations from Intercom too. Otherwise long-running open IC threads (which exist in some workspaces) would dominate the top of the list.

## UI changes

Scoped to `components/monitor/ConversationList.tsx`.

**Interface** (line ~12):
```typescript
interface Conversation {
  id: string; source: "datacrazy" | "intercom";
  name: string; level: "vermelho" | "amarelo" | "verdeAlerta";
  minutosParada: number; attendantName: string;
  departmentName: string; departmentColor: string;
  lastMessage: string | null;
  externalUrl?: string;
}
```
Query return type adds `sourceErrors?: { datacrazy?: string; intercom?: string }`.

**Source badge** — small monospaced pill inline with the name, no strong color:
```tsx
<div className="flex items-center gap-2">
  <p className="font-medium text-zinc-900 leading-tight">{c.name}</p>
  <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
    {c.source === "datacrazy" ? "DC" : "IC"}
  </Badge>
</div>
```

**Clickable card** — wrap `<Card>` in `<a href={c.externalUrl} target="_blank" rel="noreferrer">` when `externalUrl` exists. Existing `hover:shadow-md` signals affordance.

**Partial-error banner** — above the stat grid, rendered only when `sourceErrors` has a key:
```tsx
{data.sourceErrors?.intercom && (
  <Card className="border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
    Intercom indisponível — mostrando só Data Crazy. Tentando novamente…
  </Card>
)}
```
Symmetric for `sourceErrors.datacrazy`.

**No changes needed to:**
- `BigStat` components and their computation (total/red/yellow/green/avg/max).
- "Por departamento" card — works unchanged since the aggregate is computed server-side on the unified shape.
- Sound-alert logic — `currentReds` can contain `dc:` and `ic:` IDs; the beep fires on any new vermelho regardless of source.
- `getInitials` — works for any name string.
- TanStack Query config (key, interval).

## Error handling & observability

- **`IntercomError`** class mirrors `DataCrazyError` with codes `UNAUTHORIZED | RATE_LIMIT | TIMEOUT | SERVER_ERROR | UNKNOWN`.
- **Per-call timeout**: 5s (matches `dcFetch`). Per-request budget ~12s (search + up to 10 parallel part fetches) — well under Vercel's 25s function limit.
- **Partial failure**: one source down → 200 with `sourceErrors` flag set. Both down → 503.
- **Auth failure** (401) propagates as today — user needs to log in again.
- **Logging**: `console.warn` on `sourceErrors`; `console.info` on cache hit/miss ratio (useful to validate cache behavior in production). No new APM dependency.

## Env vars

Additions to `.env.local.example`:
```
INTERCOM_TOKEN=tok:...              # Intercom Access Token. ROTATE if exposed in chat/logs.
INTERCOM_WORKSPACE_ID=abc123de      # app_id, used to build externalUrl
INTERCOM_BOT_ADMIN_IDS=             # optional, comma-separated. Admins classified as bots.
INTERCOM_ENABLED=true               # kill-switch: "false" = skip IC fetch, no error
```

`INTERCOM_ENABLED` lets ops disable Intercom without a redeploy during incidents.

## Testing

**Unit (new):**
- `tests/lib/intercom-client.test.ts` — auth header, timeout, error code mapping (401/429/5xx/network).
- `tests/lib/intercom-mapper.test.ts`:
  - customer last to speak → `minutosParada` correct, no parts fetched
  - human admin replied → conversation excluded (not returned)
  - bot replied (admin id ∈ `botAdminIds`) → conversation still appears as waiting, timer measured from `last_contact_reply_at`
  - `updated_at` unchanged → cache hit, no part fetch
  - `state: closed` / `state: snoozed` → filtered out
  - no assignee → `attendantName = "Sem atendente"`, `departmentName = "Intercom"`
  - `externalUrl` built correctly from `workspaceId` + `conv.id`

**Integration (expand `tests/api/conversations.test.ts`):**
- Both sources fulfilled → merged and sorted by `minutosParada` asc; each item has `source`.
- Intercom returns 429 → only DC returned, `sourceErrors.intercom === "rate_limit"`.
- DC returns 500 + Intercom ok → only IC returned, `sourceErrors.datacrazy` set.
- Both fail → 503 with `sourceErrors`.
- `INTERCOM_ENABLED=false` → IC never called (verified via MSW handler-not-invoked), no `sourceErrors.intercom`.

**E2E**: no new tests. Playwright suite is source-agnostic and remains valid.

## Out of scope (explicit YAGNI)

- Webhooks for real-time ingestion.
- Redis/Upstash persistent cache.
- Cross-source identity merging.
- Intercom in Funil.
- Team/inbox/tag filtering in Intercom.

## Key decisions summary

| # | Decision | Reason |
|---|----------|--------|
| 1 | Merge server-side in `/api/conversations` | Single cache key, one loading state, cheaper client |
| 2 | Only Monitor, Funil untouched | Intercom has no native pipeline/stage concept |
| 3 | Unified list sorted by wait time + `DC`/`IC` badge + clickable card | Global ordering preserves the Monitor's purpose; badge tells attendant which tool to open |
| 4 | Parts fetch to ignore bot replies (not `waiting_since` / `statistics` alone) | User requirement: only human replies stop the timer |
| 5 | In-memory cache by `{convId, updated_at}`, concurrency capped at 10 | Keeps N+1 sub-critical vs rate limit; accepts cold-start cost on Vercel |
| 6 | `INTERCOM_ENABLED` kill-switch | Ops lever during incidents without redeploy |
| 7 | `Promise.allSettled` + `sourceErrors` for partial failure | One source down doesn't black out the whole Monitor |
