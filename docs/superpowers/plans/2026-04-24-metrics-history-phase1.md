# Métricas Históricas Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir Monitor+Funil a cada 15 min em Supabase, podar >90 dias semanalmente e expor uma página `/historico` com gráficos de tendência 24h/7d/30d/90d.

**Architecture:** Dois cron endpoints (Vercel Cron) chamam funções puras de captura (`captureMonitorSnapshot`, `captureFunilSnapshot`) que também são usadas pelas rotas live (`/api/conversations`, `/api/deals`). Escrita vai via Supabase service-role. Leitura histórica passa por um endpoint que agrega com downsampling server-side (≤200 pontos) antes de servir aos charts.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase Postgres + RLS, `@supabase/ssr` + `@supabase/supabase-js` (service-role), recharts via shadcn/ui chart, Vitest + MSW.

**Spec:** `docs/superpowers/specs/2026-04-24-metrics-history-phase1-design.md`

---

## Task Order & Milestones

1. **Task 1** — Migration + admin Supabase client + env scaffolding → *Checkpoint: `supabase db push` cria tabelas com RLS*
2. **Tasks 2–3** — Extrair `captureMonitorSnapshot` e `captureFunilSnapshot` como libs puras (TDD) e refatorar rotas live pra usar → *Checkpoint: testes existentes passam; libs têm seus próprios testes*
3. **Task 4** — Lib `downsample` (pura, TDD)
4. **Tasks 5–6** — Endpoints de cron (snapshot + prune) com testes
5. **Task 7** — Endpoint `/api/metrics/history` com testes
6. **Tasks 8–10** — Página `/historico`: setup recharts/chart, componentes, nav link
7. **Task 11** — `vercel.json`, env docs, README, verificação final

---

## File Structure

```
supabase/migrations/
  20260424120000_metrics_snapshots.sql

lib/
  monitor/snapshot.ts                          # captureMonitorSnapshot()
  funil/snapshot.ts                            # captureFunilSnapshot({from?,to?})
  metrics/downsample.ts                        # downsample(points, bucketMs, aggregators)
  supabase/admin.ts                            # createAdminClient() usando service role

app/
  api/
    conversations/route.ts                     # [MODIFY] usa captureMonitorSnapshot + devolve lista
    deals/route.ts                             # [MODIFY] usa captureFunilSnapshot({from,to})
    cron/snapshot-metrics/route.ts             # NEW
    cron/prune-metrics/route.ts                # NEW
    metrics/history/route.ts                   # NEW
  (dashboard)/historico/page.tsx               # NEW

components/
  historico/
    RangeToggle.tsx
    MonitorTrendChart.tsx
    MonitorTimingCharts.tsx
    FunilTrendChart.tsx
    FunilDetailCharts.tsx
    EmptyState.tsx
  shared/HeaderNav.tsx                         # [MODIFY] adiciona Histórico
  ui/chart.tsx                                 # shadcn chart (scaffolded)

tests/
  lib/monitor-snapshot.test.ts
  lib/funil-snapshot.test.ts
  lib/downsample.test.ts
  api/cron-snapshot.test.ts
  api/cron-prune.test.ts
  api/metrics-history.test.ts

vercel.json                                    # NEW
.env.local.example                             # [MODIFY]
README.md                                      # [MODIFY]
package.json                                   # [MODIFY] add recharts
```

---

## Task 1: Supabase migration + admin client + env scaffolding

**Files:**
- Create: `supabase/migrations/20260424120000_metrics_snapshots.sql`
- Create: `lib/supabase/admin.ts`
- Modify: `.env.local.example`

- [ ] **Step 1: Criar a migration**

Arquivo `supabase/migrations/20260424120000_metrics_snapshots.sql`:

```sql
create table monitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default now(),
  total int not null,
  count_red int not null,
  count_yellow int not null,
  count_green int not null,
  avg_minutos numeric(8,2) not null,
  max_minutos numeric(8,2) not null,
  by_department jsonb not null
);
create index monitor_snapshots_captured_at_idx
  on monitor_snapshots (captured_at desc);

create table funil_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default now(),
  total_deals int not null,
  total_stuck int not null,
  avg_stage_days numeric(8,2) not null,
  active_stages int not null,
  stages jsonb not null
);
create index funil_snapshots_captured_at_idx
  on funil_snapshots (captured_at desc);

alter table monitor_snapshots enable row level security;
create policy "monitor_snapshots_select_authenticated"
  on monitor_snapshots for select
  to authenticated
  using (true);

alter table funil_snapshots enable row level security;
create policy "funil_snapshots_select_authenticated"
  on funil_snapshots for select
  to authenticated
  using (true);
```

- [ ] **Step 2: Aplicar a migration no Supabase**

Via Supabase CLI (se `supabase` instalado):
```bash
supabase db push
```
Alternativa: copiar o SQL e colar no painel Supabase → SQL Editor → Run.
Expected: `monitor_snapshots` e `funil_snapshots` visíveis em Table Editor, cada uma com RLS enabled e 1 policy de select.

- [ ] **Step 3: Criar o admin client (service role)**

Arquivo `lib/supabase/admin.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
```

- [ ] **Step 4: Atualizar `.env.local.example`**

Adicionar no fim:
```
# Cron secret (used by Vercel Cron headers + route guards). Generate: openssl rand -hex 32
CRON_SECRET=
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260424120000_metrics_snapshots.sql \
        lib/supabase/admin.ts \
        .env.local.example
git commit -m "feat(metrics): supabase migration + admin client for metric snapshots"
```

---

## Task 2: Extract `captureMonitorSnapshot` lib (TDD)

**Files:**
- Create: `lib/monitor/snapshot.ts`
- Create: `tests/lib/monitor-snapshot.test.ts`
- Modify: `app/api/conversations/route.ts`

- [ ] **Step 1: Escrever o teste falho**

Arquivo `tests/lib/monitor-snapshot.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer();
beforeAll(() => {
  process.env.DATACRAZY_TOKEN = "test";
  process.env.PIPELINE_ID = "p1";
  server.listen();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(async () => {
  const { invalidateCache } = await import("@/lib/datacrazy/cache");
  invalidateCache();
});

describe("captureMonitorSnapshot", () => {
  it("aggregates alert levels, avg/max minutos, and by-department breakdown", async () => {
    const now = Date.now();
    const min = (m: number) => new Date(now - m * 60_000).toISOString();
    server.use(
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => HttpResponse.json({ data: [{ id: "s1", name: "A", index: 0 }] })),
      http.get("https://api.g1.datacrazy.io/api/v1/conversations",
        () => HttpResponse.json({ data: [
          { id: "a", isGroup: false, name: "A", attendants: [],
            currentDepartment: { id: "d1", name: "Vendas", color: "#f00" },
            lastReceivedMessageDate: min(40), lastSendedMessageDate: null }, // vermelho
          { id: "b", isGroup: false, name: "B", attendants: [],
            currentDepartment: { id: "d1", name: "Vendas", color: "#f00" },
            lastReceivedMessageDate: min(20), lastSendedMessageDate: null }, // amarelo
          { id: "c", isGroup: false, name: "C", attendants: [],
            currentDepartment: { id: "d2", name: "Suporte", color: "#0f0" },
            lastReceivedMessageDate: min(5), lastSendedMessageDate: null }, // verdeAlerta
          { id: "d", isGroup: false, name: "D", attendants: [],
            currentDepartment: null,
            lastReceivedMessageDate: min(1), lastSendedMessageDate: null }, // ok (descartado)
        ] })),
    );

    const { captureMonitorSnapshot } = await import("@/lib/monitor/snapshot");
    const snap = await captureMonitorSnapshot();

    expect(snap.total).toBe(3);
    expect(snap.countRed).toBe(1);
    expect(snap.countYellow).toBe(1);
    expect(snap.countGreen).toBe(1);
    expect(snap.maxMinutos).toBeGreaterThanOrEqual(40);
    expect(snap.maxMinutos).toBeLessThan(41);
    expect(snap.avgMinutos).toBeGreaterThan(15);
    const vendas = snap.byDepartment.find(d => d.name === "Vendas");
    expect(vendas?.count).toBe(2);
    expect(snap.byDepartment[0].count).toBeGreaterThanOrEqual(
      snap.byDepartment[snap.byDepartment.length - 1].count
    ); // ordenado desc por count
  });

  it("returns zeros when no conversations are in alert", async () => {
    server.use(
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => HttpResponse.json({ data: [{ id: "s1", name: "A", index: 0 }] })),
      http.get("https://api.g1.datacrazy.io/api/v1/conversations",
        () => HttpResponse.json({ data: [] })),
    );
    const { captureMonitorSnapshot } = await import("@/lib/monitor/snapshot");
    const snap = await captureMonitorSnapshot();
    expect(snap.total).toBe(0);
    expect(snap.avgMinutos).toBe(0);
    expect(snap.maxMinutos).toBe(0);
    expect(snap.byDepartment).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm vitest run tests/lib/monitor-snapshot.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/monitor/snapshot'`.

- [ ] **Step 3: Implementar `captureMonitorSnapshot`**

Arquivo `lib/monitor/snapshot.ts`:

```ts
import { dcFetch } from "@/lib/datacrazy/client";
import { getStages } from "@/lib/datacrazy/pipeline";
import { computeAlertLevel } from "@/lib/monitor/severity";
import type { DCConversation } from "@/lib/datacrazy/types";

const MAX_AGE_MINUTES = 72 * 60;

export interface MonitorAlertItem {
  id: string;
  name: string;
  level: "vermelho" | "amarelo" | "verdeAlerta";
  minutosParada: number;
  attendantName: string;
  departmentName: string;
  departmentColor: string;
  lastMessage: string | null;
}

export interface MonitorSnapshot {
  total: number;
  countRed: number;
  countYellow: number;
  countGreen: number;
  avgMinutos: number;
  maxMinutos: number;
  byDepartment: Array<{ name: string; color: string; count: number }>;
}

export interface MonitorCapture {
  snapshot: MonitorSnapshot;
  alerts: MonitorAlertItem[]; // lista completa (UI live usa isto)
  capturedAt: string;
}

export async function captureMonitor(): Promise<MonitorCapture> {
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

  const alerts: MonitorAlertItem[] = res.data
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
    .filter((c): c is MonitorAlertItem =>
      c.level !== "ok" && c.level !== "respondida")
    .filter(c => c.minutosParada <= MAX_AGE_MINUTES)
    .sort((a, b) => a.minutosParada - b.minutosParada);

  const snapshot: MonitorSnapshot = {
    total: alerts.length,
    countRed: alerts.filter(a => a.level === "vermelho").length,
    countYellow: alerts.filter(a => a.level === "amarelo").length,
    countGreen: alerts.filter(a => a.level === "verdeAlerta").length,
    avgMinutos: alerts.length
      ? alerts.reduce((s, a) => s + a.minutosParada, 0) / alerts.length
      : 0,
    maxMinutos: alerts.length ? Math.max(...alerts.map(a => a.minutosParada)) : 0,
    byDepartment: (() => {
      const m = new Map<string, { name: string; color: string; count: number }>();
      for (const a of alerts) {
        const hit = m.get(a.departmentName);
        if (hit) hit.count += 1;
        else m.set(a.departmentName, { name: a.departmentName, color: a.departmentColor, count: 1 });
      }
      return Array.from(m.values()).sort((x, y) => y.count - x.count);
    })(),
  };

  return { snapshot, alerts, capturedAt: new Date().toISOString() };
}

export async function captureMonitorSnapshot(): Promise<MonitorSnapshot> {
  return (await captureMonitor()).snapshot;
}
```

- [ ] **Step 4: Rodar o teste**

```bash
pnpm vitest run tests/lib/monitor-snapshot.test.ts
```
Expected: PASS (2 testes).

- [ ] **Step 5: Refatorar `/api/conversations` pra usar `captureMonitor`**

Substituir todo o corpo do `try { ... }` de `app/api/conversations/route.ts` por:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { captureMonitor } from "@/lib/monitor/snapshot";
import { handleDCError } from "@/lib/datacrazy/pipeline";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const { snapshot, alerts, capturedAt } = await captureMonitor();
    const { countRed, countYellow, countGreen, ...rest } = snapshot;
    void countRed; void countYellow; void countGreen; // contagens derivadas já vêm via alerts
    return NextResponse.json({
      conversations: alerts,
      updatedAt: capturedAt,
      stats: {
        avgMinutos: rest.avgMinutos,
        maxMinutos: rest.maxMinutos,
        byDepartment: rest.byDepartment,
      },
    });
  } catch (err) { return handleDCError(err); }
}
```

- [ ] **Step 6: Rodar todos os testes**

```bash
pnpm vitest run
```
Expected: PASS em tudo, incluindo `tests/api/conversations.test.ts` existente.

- [ ] **Step 7: Commit**

```bash
git add lib/monitor/snapshot.ts tests/lib/monitor-snapshot.test.ts app/api/conversations/route.ts
git commit -m "refactor(monitor): extract captureMonitor snapshot lib, route delegates"
```

---

## Task 3: Extract `captureFunilSnapshot` lib (TDD)

**Files:**
- Create: `lib/funil/snapshot.ts`
- Create: `tests/lib/funil-snapshot.test.ts`
- Modify: `app/api/deals/route.ts`

- [ ] **Step 1: Escrever o teste falho**

Arquivo `tests/lib/funil-snapshot.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer();
beforeAll(() => {
  process.env.DATACRAZY_TOKEN = "test";
  process.env.PIPELINE_ID = "p1";
  server.listen();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(async () => {
  const { invalidateCache } = await import("@/lib/datacrazy/cache");
  invalidateCache();
});

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

describe("captureFunilSnapshot", () => {
  it("aggregates deals per stage, stuck counts, avg days, active stages", async () => {
    server.use(
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => HttpResponse.json({ data: [
          { id: "s1", name: "Novo", index: 0 },
          { id: "s2", name: "Qualificado", index: 1 },
        ] })),
      http.get("https://api.g1.datacrazy.io/api/v1/businesses",
        () => HttpResponse.json({ count: 3, data: [
          { id: "d1", name: "A", stageId: "s1", status: "in_process",
            createdAt: daysAgo(2), lastMovedAt: daysAgo(2), value: 100 },
          { id: "d2", name: "B", stageId: "s1", status: "in_process",
            createdAt: daysAgo(10), lastMovedAt: daysAgo(10), value: 200 },  // stuck
          { id: "d3", name: "C", stageId: "s2", status: "in_process",
            createdAt: daysAgo(1), lastMovedAt: daysAgo(1), value: 50 },
        ] })),
    );
    const { captureFunilSnapshot } = await import("@/lib/funil/snapshot");
    const snap = await captureFunilSnapshot();
    expect(snap.totalDeals).toBe(3);
    expect(snap.totalStuck).toBe(1);
    expect(snap.activeStages).toBe(2);
    expect(snap.stages).toHaveLength(2);
    const s1 = snap.stages.find(s => s.id === "s1")!;
    expect(s1.count).toBe(2);
    expect(s1.stuck).toBe(1);
    expect(snap.avgStageDays).toBeGreaterThan(0);
  });

  it("respects optional from/to filter", async () => {
    server.use(
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => HttpResponse.json({ data: [{ id: "s1", name: "Novo", index: 0 }] })),
      http.get("https://api.g1.datacrazy.io/api/v1/businesses", ({ request }) => {
        const u = new URL(request.url);
        const filter = u.searchParams.get("filter") ?? "";
        expect(filter).toContain("createdAtGreaterOrEqual");
        return HttpResponse.json({ count: 0, data: [] });
      }),
    );
    const { captureFunilSnapshot } = await import("@/lib/funil/snapshot");
    await captureFunilSnapshot({ from: "2026-01-01", to: "2026-12-31" });
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm vitest run tests/lib/funil-snapshot.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implementar `captureFunilSnapshot`**

Arquivo `lib/funil/snapshot.ts`:

```ts
import { dcFetch } from "@/lib/datacrazy/client";
import { getStages } from "@/lib/datacrazy/pipeline";
import { groupDealsByStage, computeStageMetrics } from "@/lib/funil/metrics";
import type { DCDeal } from "@/lib/datacrazy/types";

const MAX_PAGES = 5;
const PAGE_SIZE = 500;

export interface FunilStageSnapshot {
  id: string; name: string; index: number; color?: string;
  count: number; avgMs: number; stuck: number;
}

export interface FunilSnapshot {
  totalDeals: number;
  totalStuck: number;
  avgStageDays: number;
  activeStages: number;
  stages: FunilStageSnapshot[];
}

export interface FunilCapture {
  snapshot: FunilSnapshot;
  deals: Array<DCDeal & { stageId: string }>;
  truncated: boolean;
  capturedAt: string;
}

export async function captureFunil(
  opts?: { from: string; to: string }
): Promise<FunilCapture> {
  const stages = await getStages();
  const stageIdSet = new Set(stages.map(s => s.id));
  const dateFilter = opts
    ? { createdAtGreaterOrEqual: opts.from, createdAtLessOrEqual: opts.to }
    : {};

  const all: DCDeal[] = [];
  let skip = 0;
  let pages = 0;
  let truncated = false;
  for (; pages < MAX_PAGES; pages++) {
    const res = await dcFetch<{ count: number; data: DCDeal[] }>("/businesses", {
      take: PAGE_SIZE, skip,
      filter: { status: "in_process", ...dateFilter },
    });
    all.push(...res.data.filter(d => stageIdSet.has(d.stageId)));
    if (res.data.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
    if (pages + 1 === MAX_PAGES) truncated = true;
  }

  const grouped = groupDealsByStage(all, stages);
  const now = Date.now();
  const stageSnapshots: FunilStageSnapshot[] = stages.map(s => {
    const m = computeStageMetrics(grouped.get(s.id) ?? [], now);
    return {
      id: s.id, name: s.name, index: s.index, color: s.color,
      count: m.count, avgMs: m.avgTimeInStageMs, stuck: m.stuckCount,
    };
  });

  const totalDeals = stageSnapshots.reduce((sum, s) => sum + s.count, 0);
  const totalStuck = stageSnapshots.reduce((sum, s) => sum + s.stuck, 0);
  const weighted = stageSnapshots.reduce(
    (acc, s) => ({ sum: acc.sum + s.avgMs * s.count, n: acc.n + s.count }),
    { sum: 0, n: 0 }
  );
  const avgStageDays = weighted.n > 0 ? weighted.sum / weighted.n / 86_400_000 : 0;
  const activeStages = stageSnapshots.filter(s => s.count > 0).length;

  return {
    snapshot: { totalDeals, totalStuck, avgStageDays, activeStages, stages: stageSnapshots },
    deals: all,
    truncated,
    capturedAt: new Date().toISOString(),
  };
}

export async function captureFunilSnapshot(
  opts?: { from: string; to: string }
): Promise<FunilSnapshot> {
  return (await captureFunil(opts)).snapshot;
}
```

- [ ] **Step 4: Rodar os testes**

```bash
pnpm vitest run tests/lib/funil-snapshot.test.ts
```
Expected: PASS (2 testes).

- [ ] **Step 5: Refatorar `/api/deals` pra usar `captureFunil`**

Substituir `app/api/deals/route.ts` inteiro por:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { captureFunil } from "@/lib/funil/snapshot";
import { handleDCError } from "@/lib/datacrazy/pipeline";
import { groupDealsByStage } from "@/lib/funil/metrics";
import { getStages } from "@/lib/datacrazy/pipeline";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "from/to required" }, { status: 400 });

  try {
    const { snapshot, deals, truncated } = await captureFunil({ from, to });
    const stages = await getStages();
    const grouped = groupDealsByStage(deals, stages);

    const stageData = snapshot.stages.map(s => ({
      stage: { id: s.id, name: s.name, index: s.index, color: s.color },
      metrics: { count: s.count, avgTimeInStageMs: s.avgMs, stuckCount: s.stuck },
      deals: (grouped.get(s.id) ?? []).map(d => ({
        id: d.id, name: d.name, createdAt: d.createdAt,
        lastMovedAt: d.lastMovedAt, value: d.value,
      })),
    }));

    if (truncated) console.warn(`[deals] pagination ceiling hit`);

    return NextResponse.json({ stages: stageData, truncated, total: snapshot.totalDeals });
  } catch (err) { return handleDCError(err); }
}
```

- [ ] **Step 6: Rodar todos os testes**

```bash
pnpm vitest run
```
Expected: PASS em tudo, incluindo `tests/api/deals.test.ts` existente.

- [ ] **Step 7: Commit**

```bash
git add lib/funil/snapshot.ts tests/lib/funil-snapshot.test.ts app/api/deals/route.ts
git commit -m "refactor(funil): extract captureFunil snapshot lib, route delegates"
```

---

## Task 4: Lib `downsample` (TDD, função pura)

**Files:**
- Create: `lib/metrics/downsample.ts`
- Create: `tests/lib/downsample.test.ts`

- [ ] **Step 1: Escrever o teste falho**

Arquivo `tests/lib/downsample.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { downsample, pickBucketMs } from "@/lib/metrics/downsample";

describe("pickBucketMs", () => {
  it("maps ranges to bucket sizes", () => {
    expect(pickBucketMs("24h")).toBe(0);           // 0 = sem bucket, resolução nativa
    expect(pickBucketMs("7d")).toBe(60 * 60_000);  // 1h
    expect(pickBucketMs("30d")).toBe(4 * 60 * 60_000); // 4h
    expect(pickBucketMs("90d")).toBe(24 * 60 * 60_000); // 1d
  });
});

describe("downsample", () => {
  const base = new Date("2026-04-24T00:00:00Z").getTime();
  const make = (n: number, step: number, extras: (i: number) => Record<string, number>) =>
    Array.from({ length: n }, (_, i) => ({
      capturedAt: new Date(base + i * step).toISOString(),
      ...extras(i),
    }));

  it("returns points unchanged when bucketMs is 0", () => {
    const pts = make(5, 60_000, i => ({ total: i }));
    const out = downsample(pts, 0, { total: "avg" });
    expect(out).toEqual(pts);
  });

  it("buckets and averages counts within bucketMs=1h", () => {
    const pts = make(4, 15 * 60_000, i => ({ total: i + 1 })); // 4 pontos em 1h: 1,2,3,4
    const out = downsample(pts, 60 * 60_000, { total: "avg" });
    expect(out).toHaveLength(1);
    expect(out[0].total).toBe(2.5);
  });

  it("takes max for `max` aggregator", () => {
    const pts = make(3, 10 * 60_000, i => ({ maxMin: [5, 20, 7][i] }));
    const out = downsample(pts, 60 * 60_000, { maxMin: "max" });
    expect(out[0].maxMin).toBe(20);
  });

  it("takes last-in-bucket for `last` aggregator", () => {
    const pts = make(3, 10 * 60_000, i => ({ total: i + 1 }))
      .map((p, i) => ({ ...p, payload: [`a`, `b`, `c`][i] }));
    const out = downsample(pts, 60 * 60_000, { payload: "last" });
    expect(out[0].payload).toBe("c");
  });

  it("keeps capturedAt as the bucket start", () => {
    const pts = make(4, 15 * 60_000, i => ({ total: 1 }));
    const out = downsample(pts, 60 * 60_000, { total: "avg" });
    expect(new Date(out[0].capturedAt).getTime()).toBe(base);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm vitest run tests/lib/downsample.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implementar `downsample`**

Arquivo `lib/metrics/downsample.ts`:

```ts
export type Aggregator = "avg" | "max" | "last";

export type Range = "24h" | "7d" | "30d" | "90d";

export function pickBucketMs(range: Range): number {
  switch (range) {
    case "24h": return 0;
    case "7d": return 60 * 60_000;
    case "30d": return 4 * 60 * 60_000;
    case "90d": return 24 * 60 * 60_000;
  }
}

type Point = { capturedAt: string } & Record<string, unknown>;

export function downsample<T extends Point>(
  points: T[],
  bucketMs: number,
  aggregators: Partial<Record<keyof T, Aggregator>>
): T[] {
  if (bucketMs <= 0 || points.length === 0) return points;
  const buckets = new Map<number, T[]>();
  for (const p of points) {
    const t = new Date(p.capturedAt).getTime();
    const key = Math.floor(t / bucketMs) * bucketMs;
    const list = buckets.get(key);
    if (list) list.push(p); else buckets.set(key, [p]);
  }
  const keysSorted = Array.from(buckets.keys()).sort((a, b) => a - b);
  return keysSorted.map(k => {
    const bucket = buckets.get(k)!;
    const out: Record<string, unknown> = { capturedAt: new Date(k).toISOString() };
    for (const field in aggregators) {
      const agg = aggregators[field as keyof T]!;
      const values = bucket.map(p => p[field as keyof T]);
      if (agg === "avg") {
        const nums = values.filter((v): v is number => typeof v === "number");
        out[field] = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      } else if (agg === "max") {
        const nums = values.filter((v): v is number => typeof v === "number");
        out[field] = nums.length ? Math.max(...nums) : 0;
      } else if (agg === "last") {
        out[field] = values[values.length - 1];
      }
    }
    return out as T;
  });
}
```

- [ ] **Step 4: Rodar os testes**

```bash
pnpm vitest run tests/lib/downsample.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/metrics/downsample.ts tests/lib/downsample.test.ts
git commit -m "feat(metrics): pure downsample() with avg/max/last aggregators"
```

---

## Task 5: Cron endpoint `/api/cron/snapshot-metrics` (TDD)

**Files:**
- Create: `app/api/cron/snapshot-metrics/route.ts`
- Create: `tests/api/cron-snapshot.test.ts`

- [ ] **Step 1: Escrever o teste falho**

Arquivo `tests/api/cron-snapshot.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { NextRequest } from "next/server";

const insertSpy = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: (row: unknown) => {
        insertSpy(table, row);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

const server = setupServer();
beforeAll(() => {
  process.env.DATACRAZY_TOKEN = "test";
  process.env.PIPELINE_ID = "p1";
  process.env.CRON_SECRET = "topsecret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://x";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
  server.listen();
});
afterEach(() => { server.resetHandlers(); insertSpy.mockClear(); });
afterAll(() => server.close());
beforeEach(async () => {
  const { invalidateCache } = await import("@/lib/datacrazy/cache");
  invalidateCache();
});

function dcHandlersOk() {
  server.use(
    http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
      () => HttpResponse.json({ data: [{ id: "s1", name: "A", index: 0 }] })),
    http.get("https://api.g1.datacrazy.io/api/v1/conversations",
      () => HttpResponse.json({ data: [] })),
    http.get("https://api.g1.datacrazy.io/api/v1/businesses",
      () => HttpResponse.json({ count: 0, data: [] })),
  );
}

describe("GET /api/cron/snapshot-metrics", () => {
  it("rejects without CRON_SECRET", async () => {
    const { GET } = await import("@/app/api/cron/snapshot-metrics/route");
    const res = await GET(new NextRequest("http://x/api/cron/snapshot-metrics"));
    expect(res.status).toBe(401);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("inserts into both tables when authorized and DC succeeds", async () => {
    dcHandlersOk();
    const { GET } = await import("@/app/api/cron/snapshot-metrics/route");
    const req = new NextRequest("http://x/api/cron/snapshot-metrics", {
      headers: { authorization: "Bearer topsecret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(2);
    const tables = insertSpy.mock.calls.map(c => c[0]).sort();
    expect(tables).toEqual(["funil_snapshots", "monitor_snapshots"]);
  });

  it("does not insert when Data Crazy fails", async () => {
    server.use(
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => new HttpResponse(null, { status: 401 })),
    );
    const { GET } = await import("@/app/api/cron/snapshot-metrics/route");
    const req = new NextRequest("http://x/api/cron/snapshot-metrics", {
      headers: { authorization: "Bearer topsecret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(503);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm vitest run tests/api/cron-snapshot.test.ts
```
Expected: FAIL (route não existe).

- [ ] **Step 3: Implementar o endpoint**

Arquivo `app/api/cron/snapshot-metrics/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { captureMonitorSnapshot } from "@/lib/monitor/snapshot";
import { captureFunilSnapshot } from "@/lib/funil/snapshot";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleDCError } from "@/lib/datacrazy/pipeline";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const [monitor, funil] = await Promise.all([
      captureMonitorSnapshot(),
      captureFunilSnapshot(),
    ]);

    const db = createAdminClient();
    const mRes = await db.from("monitor_snapshots").insert({
      total: monitor.total,
      count_red: monitor.countRed,
      count_yellow: monitor.countYellow,
      count_green: monitor.countGreen,
      avg_minutos: monitor.avgMinutos,
      max_minutos: monitor.maxMinutos,
      by_department: monitor.byDepartment,
    });
    if (mRes.error) throw new Error(`monitor_snapshots insert: ${mRes.error.message}`);

    const fRes = await db.from("funil_snapshots").insert({
      total_deals: funil.totalDeals,
      total_stuck: funil.totalStuck,
      avg_stage_days: funil.avgStageDays,
      active_stages: funil.activeStages,
      stages: funil.stages,
    });
    if (fRes.error) throw new Error(`funil_snapshots insert: ${fRes.error.message}`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const handled = handleDCError(err);
    if (handled.status !== 500) return handled;
    console.error("[cron snapshot]", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Rodar os testes**

```bash
pnpm vitest run tests/api/cron-snapshot.test.ts
```
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/snapshot-metrics/route.ts tests/api/cron-snapshot.test.ts
git commit -m "feat(metrics): cron endpoint to persist monitor+funil snapshots"
```

---

## Task 6: Cron endpoint `/api/cron/prune-metrics` (TDD)

**Files:**
- Create: `app/api/cron/prune-metrics/route.ts`
- Create: `tests/api/cron-prune.test.ts`

- [ ] **Step 1: Escrever o teste falho**

Arquivo `tests/api/cron-prune.test.ts`:

```ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";

const deleteSpy = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      delete: () => ({
        lt: (column: string, value: string) => {
          deleteSpy(table, column, value);
          return Promise.resolve({ error: null, count: 0 });
        },
      }),
    }),
  }),
}));

beforeAll(() => {
  process.env.CRON_SECRET = "topsecret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://x";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
});

describe("GET /api/cron/prune-metrics", () => {
  it("rejects without CRON_SECRET", async () => {
    const { GET } = await import("@/app/api/cron/prune-metrics/route");
    const res = await GET(new NextRequest("http://x/api/cron/prune-metrics"));
    expect(res.status).toBe(401);
  });

  it("deletes rows older than 90 days from both tables", async () => {
    deleteSpy.mockClear();
    const { GET } = await import("@/app/api/cron/prune-metrics/route");
    const req = new NextRequest("http://x/api/cron/prune-metrics", {
      headers: { authorization: "Bearer topsecret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(deleteSpy).toHaveBeenCalledTimes(2);
    const tables = deleteSpy.mock.calls.map(c => c[0]).sort();
    expect(tables).toEqual(["funil_snapshots", "monitor_snapshots"]);
    const cutoff = new Date(deleteSpy.mock.calls[0][2]);
    const ninetyDaysAgo = Date.now() - 90 * 86_400_000;
    expect(Math.abs(cutoff.getTime() - ninetyDaysAgo)).toBeLessThan(10_000);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm vitest run tests/api/cron-prune.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implementar o endpoint**

Arquivo `app/api/cron/prune-metrics/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const RETENTION_DAYS = 90;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const db = createAdminClient();

  const m = await db.from("monitor_snapshots").delete().lt("captured_at", cutoff);
  if (m.error) return NextResponse.json({ error: m.error.message }, { status: 500 });

  const f = await db.from("funil_snapshots").delete().lt("captured_at", cutoff);
  if (f.error) return NextResponse.json({ error: f.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, cutoff });
}
```

- [ ] **Step 4: Rodar os testes**

```bash
pnpm vitest run tests/api/cron-prune.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/prune-metrics/route.ts tests/api/cron-prune.test.ts
git commit -m "feat(metrics): cron endpoint to prune snapshots older than 90d"
```

---

## Task 7: Endpoint `/api/metrics/history` (TDD)

**Files:**
- Create: `app/api/metrics/history/route.ts`
- Create: `tests/api/metrics-history.test.ts`

- [ ] **Step 1: Escrever o teste falho**

Arquivo `tests/api/metrics-history.test.ts`:

```ts
import { describe, it, expect, beforeAll, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  }),
}));

let fakeRows: Array<Record<string, unknown>> = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        gte: () => ({
          order: () => Promise.resolve({ data: fakeRows, error: null }),
        }),
      }),
    }),
  }),
}));

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://x";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
});
beforeEach(() => { fakeRows = []; });

describe("GET /api/metrics/history", () => {
  it("returns 400 for invalid source", async () => {
    const { GET } = await import("@/app/api/metrics/history/route");
    const res = await GET(new NextRequest("http://x/api/metrics/history?source=foo&range=7d"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid range", async () => {
    const { GET } = await import("@/app/api/metrics/history/route");
    const res = await GET(new NextRequest("http://x/api/metrics/history?source=monitor&range=1y"));
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: null } }) },
      }),
    }));
    const { GET } = await import("@/app/api/metrics/history/route");
    const res = await GET(new NextRequest("http://x/api/metrics/history?source=monitor&range=7d"));
    expect(res.status).toBe(401);
    vi.doUnmock("@/lib/supabase/server");
    vi.resetModules();
  });

  it("returns empty points array when no rows", async () => {
    fakeRows = [];
    const { GET } = await import("@/app/api/metrics/history/route");
    const res = await GET(new NextRequest("http://x/api/metrics/history?source=monitor&range=7d"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.points).toEqual([]);
    expect(json.sourceCount).toBe(0);
  });

  it("maps monitor rows to snake_case-free points", async () => {
    fakeRows = [
      {
        captured_at: new Date().toISOString(),
        total: 3, count_red: 1, count_yellow: 1, count_green: 1,
        avg_minutos: 12.5, max_minutos: 40,
        by_department: [{ name: "Vendas", color: "#f00", count: 2 }],
      },
    ];
    const { GET } = await import("@/app/api/metrics/history/route");
    const res = await GET(new NextRequest("http://x/api/metrics/history?source=monitor&range=24h"));
    const json = await res.json();
    expect(json.points[0].total).toBe(3);
    expect(json.points[0].countRed).toBe(1);
    expect(json.points[0].avgMinutos).toBe(12.5);
    expect(json.points[0].byDepartment).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm vitest run tests/api/metrics-history.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implementar o endpoint**

Arquivo `app/api/metrics/history/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { downsample, pickBucketMs, type Range } from "@/lib/metrics/downsample";

const RANGES: Range[] = ["24h", "7d", "30d", "90d"];
const RANGE_MS: Record<Range, number> = {
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

type Source = "monitor" | "funil";

const MONITOR_AGG = {
  total: "avg", countRed: "avg", countYellow: "avg", countGreen: "avg",
  avgMinutos: "avg", maxMinutos: "max", byDepartment: "last",
} as const;

const FUNIL_AGG = {
  totalDeals: "avg", totalStuck: "avg", avgStageDays: "avg",
  activeStages: "avg", stages: "last",
} as const;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const source = req.nextUrl.searchParams.get("source") as Source | null;
  const range = req.nextUrl.searchParams.get("range") as Range | null;
  if (source !== "monitor" && source !== "funil") {
    return NextResponse.json({ error: "invalid source" }, { status: 400 });
  }
  if (!range || !RANGES.includes(range)) {
    return NextResponse.json({ error: "invalid range" }, { status: 400 });
  }

  const since = new Date(Date.now() - RANGE_MS[range]).toISOString();
  const db = createAdminClient();
  const table = source === "monitor" ? "monitor_snapshots" : "funil_snapshots";
  const { data, error } = await db
    .from(table)
    .select("*")
    .gte("captured_at", since)
    .order("captured_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map(r =>
    source === "monitor" ? toMonitorPoint(r) : toFunilPoint(r)
  );
  const bucketMs = pickBucketMs(range);
  const aggregators = source === "monitor" ? MONITOR_AGG : FUNIL_AGG;
  const points = downsample(rows, bucketMs, aggregators as never);

  return NextResponse.json({
    points,
    downsampled: bucketMs > 0 && rows.length > points.length,
    sourceCount: rows.length,
  });
}

function toMonitorPoint(r: Record<string, unknown>) {
  return {
    capturedAt: r.captured_at as string,
    total: r.total as number,
    countRed: r.count_red as number,
    countYellow: r.count_yellow as number,
    countGreen: r.count_green as number,
    avgMinutos: Number(r.avg_minutos),
    maxMinutos: Number(r.max_minutos),
    byDepartment: r.by_department as Array<{ name: string; color: string; count: number }>,
  };
}

function toFunilPoint(r: Record<string, unknown>) {
  return {
    capturedAt: r.captured_at as string,
    totalDeals: r.total_deals as number,
    totalStuck: r.total_stuck as number,
    avgStageDays: Number(r.avg_stage_days),
    activeStages: r.active_stages as number,
    stages: r.stages,
  };
}
```

- [ ] **Step 4: Rodar os testes**

```bash
pnpm vitest run tests/api/metrics-history.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/metrics/history/route.ts tests/api/metrics-history.test.ts
git commit -m "feat(metrics): history endpoint with server-side downsampling"
```

---

## Task 8: Instalar recharts + scaffold shadcn chart

**Files:**
- Modify: `package.json`
- Create: `components/ui/chart.tsx`

- [ ] **Step 1: Adicionar recharts**

```bash
pnpm add recharts
```
Expected: `recharts` adicionado a `dependencies` em `package.json`.

- [ ] **Step 2: Scaffolding do componente `chart` do shadcn**

Tentar via CLI:
```bash
pnpm dlx shadcn@latest add chart
```
Se o CLI falhar (versões de shadcn variam), cair pra arquivo manual baseado no template oficial: https://ui.shadcn.com/docs/components/chart → copiar o conteúdo pra `components/ui/chart.tsx` sem modificar a API (`ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`).

- [ ] **Step 3: Smoke check de typecheck**

```bash
pnpm tsc --noEmit
```
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml components/ui/chart.tsx
git commit -m "chore(ui): add recharts + shadcn chart primitives"
```

---

## Task 9: Componentes da página `/historico`

**Files:**
- Create: `components/historico/RangeToggle.tsx`
- Create: `components/historico/EmptyState.tsx`
- Create: `components/historico/MonitorTrendChart.tsx`
- Create: `components/historico/MonitorTimingCharts.tsx`
- Create: `components/historico/FunilTrendChart.tsx`
- Create: `components/historico/FunilDetailCharts.tsx`

- [ ] **Step 1: `RangeToggle.tsx`**

```tsx
"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const RANGES = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
] as const;

export function RangeToggle({ active }: { active: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <div className="inline-flex rounded-md border bg-white p-0.5 shadow-sm">
      {RANGES.map(r => (
        <Button
          key={r.value}
          variant="ghost"
          size="sm"
          onClick={() => {
            const next = new URLSearchParams(sp);
            next.set("range", r.value);
            router.replace(`${pathname}?${next.toString()}`);
          }}
          className={cn(
            "h-8 rounded-sm px-3 text-sm",
            active === r.value ? "bg-zinc-100 font-medium" : "text-zinc-500"
          )}
        >
          {r.label}
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `EmptyState.tsx`**

```tsx
import { Card } from "@/components/ui/card";
import { LineChart } from "lucide-react";

export function EmptyState() {
  return (
    <Card className="p-12 text-center">
      <div className="flex flex-col items-center gap-3">
        <LineChart className="size-10 text-zinc-300" />
        <div>
          <p className="font-medium text-zinc-900">
            Ainda não há dados históricos para este período.
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Volte em alguns minutos — snapshots são coletados a cada 15 min.
          </p>
        </div>
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: `MonitorTrendChart.tsx`**

```tsx
"use client";
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Card } from "@/components/ui/card";

interface Point {
  capturedAt: string;
  countRed: number;
  countYellow: number;
  countGreen: number;
}

export function MonitorTrendChart({ points }: { points: Point[] }) {
  const data = points.map(p => ({
    ...p,
    time: new Date(p.capturedAt).toLocaleString("pt-BR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
  }));
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-medium text-zinc-700">Em alerta ao longo do tempo</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="time" fontSize={10} tickMargin={8} />
            <YAxis fontSize={10} />
            <Tooltip />
            <Area type="monotone" dataKey="countRed"    stackId="1" stroke="#ef4444" fill="#fecaca" />
            <Area type="monotone" dataKey="countYellow" stackId="1" stroke="#f59e0b" fill="#fde68a" />
            <Area type="monotone" dataKey="countGreen"  stackId="1" stroke="#10b981" fill="#a7f3d0" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: `MonitorTimingCharts.tsx`**

```tsx
"use client";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Card } from "@/components/ui/card";

interface Point { capturedAt: string; avgMinutos: number; maxMinutos: number; }

function TimeChart({ title, points, dataKey, color }: {
  title: string; points: Point[]; dataKey: "avgMinutos" | "maxMinutos"; color: string;
}) {
  const data = points.map(p => ({
    ...p,
    time: new Date(p.capturedAt).toLocaleString("pt-BR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
  }));
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-medium text-zinc-700">{title}</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="time" fontSize={10} tickMargin={8} />
            <YAxis fontSize={10} unit=" min" />
            <Tooltip />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function MonitorTimingCharts({ points }: { points: Point[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <TimeChart title="Tempo médio de espera"    points={points} dataKey="avgMinutos" color="#27272a" />
      <TimeChart title="Maior espera do período" points={points} dataKey="maxMinutos" color="#ef4444" />
    </div>
  );
}
```

- [ ] **Step 5: `FunilTrendChart.tsx` e `FunilDetailCharts.tsx`**

`FunilTrendChart.tsx`:
```tsx
"use client";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Card } from "@/components/ui/card";

interface Point { capturedAt: string; totalDeals: number; }

export function FunilTrendChart({ points }: { points: Point[] }) {
  const data = points.map(p => ({
    ...p,
    time: new Date(p.capturedAt).toLocaleString("pt-BR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
  }));
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-medium text-zinc-700">Leads no pipeline ao longo do tempo</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="time" fontSize={10} tickMargin={8} />
            <YAxis fontSize={10} />
            <Tooltip />
            <Line type="monotone" dataKey="totalDeals" stroke="#2563eb" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
```

`FunilDetailCharts.tsx`:
```tsx
"use client";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Card } from "@/components/ui/card";

interface Point { capturedAt: string; totalStuck: number; avgStageDays: number; }

function DetailChart({ title, points, dataKey, color, unit }: {
  title: string; points: Point[]; dataKey: keyof Point; color: string; unit?: string;
}) {
  const data = points.map(p => ({
    ...p,
    time: new Date(p.capturedAt).toLocaleString("pt-BR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
  }));
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-medium text-zinc-700">{title}</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="time" fontSize={10} tickMargin={8} />
            <YAxis fontSize={10} unit={unit} />
            <Tooltip />
            <Line type="monotone" dataKey={dataKey as string} stroke={color} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function FunilDetailCharts({ points }: { points: Point[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <DetailChart title="Parados > 7 dias"           points={points} dataKey="totalStuck"   color="#ef4444" />
      <DetailChart title="Tempo médio nas etapas"    points={points} dataKey="avgStageDays" color="#27272a" unit=" d" />
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

```bash
pnpm tsc --noEmit
```
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add components/historico/
git commit -m "feat(historico): chart and range-toggle components"
```

---

## Task 10: Página `/historico` + link na navegação

**Files:**
- Create: `app/(dashboard)/historico/page.tsx`
- Modify: `components/shared/HeaderNav.tsx`

- [ ] **Step 1: Página `/historico`**

Arquivo `app/(dashboard)/historico/page.tsx`:

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { RangeToggle } from "@/components/historico/RangeToggle";
import { EmptyState } from "@/components/historico/EmptyState";
import { MonitorTrendChart } from "@/components/historico/MonitorTrendChart";
import { MonitorTimingCharts } from "@/components/historico/MonitorTimingCharts";
import { FunilTrendChart } from "@/components/historico/FunilTrendChart";
import { FunilDetailCharts } from "@/components/historico/FunilDetailCharts";

type Range = "24h" | "7d" | "30d" | "90d";
const VALID: Range[] = ["24h", "7d", "30d", "90d"];

export default function HistoricoPage() {
  const sp = useSearchParams();
  const raw = sp.get("range");
  const range: Range = VALID.includes(raw as Range) ? (raw as Range) : "7d";

  const monitor = useQuery({
    queryKey: ["history", "monitor", range],
    queryFn: async () => {
      const r = await fetch(`/api/metrics/history?source=monitor&range=${range}`);
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json() as Promise<{ points: any[]; sourceCount: number }>;
    },
  });
  const funil = useQuery({
    queryKey: ["history", "funil", range],
    queryFn: async () => {
      const r = await fetch(`/api/metrics/history?source=funil&range=${range}`);
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json() as Promise<{ points: any[]; sourceCount: number }>;
    },
  });

  const isLoading = monitor.isLoading || funil.isLoading;
  const hasError = monitor.error || funil.error;
  const noData =
    (monitor.data?.sourceCount ?? 0) === 0 && (funil.data?.sourceCount ?? 0) === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Histórico</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Tendência das métricas ao longo do tempo
          </p>
        </div>
        <RangeToggle active={range} />
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      )}

      {hasError && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Falha ao carregar histórico. Tentando novamente…
        </Card>
      )}

      {!isLoading && !hasError && noData && <EmptyState />}

      {!isLoading && !hasError && !noData && (
        <>
          <section className="space-y-4">
            <h2 className="text-lg font-medium text-zinc-900">Monitor</h2>
            <MonitorTrendChart points={monitor.data?.points ?? []} />
            <MonitorTimingCharts points={monitor.data?.points ?? []} />
          </section>
          <section className="space-y-4">
            <h2 className="text-lg font-medium text-zinc-900">Funil</h2>
            <FunilTrendChart points={funil.data?.points ?? []} />
            <FunilDetailCharts points={funil.data?.points ?? []} />
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Adicionar link no `HeaderNav`**

Editar `components/shared/HeaderNav.tsx`, substituir o array `NAV_LINKS`:

```ts
const NAV_LINKS = [
  { href: "/monitor",   label: "Monitor" },
  { href: "/funil",     label: "Funil" },
  { href: "/historico", label: "Histórico" },
] as const;
```

- [ ] **Step 3: Typecheck + dev boot**

```bash
pnpm tsc --noEmit
pnpm dev
```
Abrir `http://localhost:3000/historico`. Esperado com base vazia: EmptyState renderiza corretamente. Alternar range na toggle muda o query param. Ctrl+C pra parar.

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/historico/ components/shared/HeaderNav.tsx
git commit -m "feat(historico): new page with trend charts and range toggle"
```

---

## Task 11: `vercel.json`, docs, smoke test local e verificação final

**Files:**
- Create: `vercel.json`
- Modify: `README.md`

- [ ] **Step 1: Criar `vercel.json`**

```json
{
  "crons": [
    { "path": "/api/cron/snapshot-metrics", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/prune-metrics",    "schedule": "0 3 * * 0" }
  ]
}
```

- [ ] **Step 2: Atualizar `README.md`**

Adicionar uma seção nova **"Histórico de métricas"** depois da seção de painéis existentes, documentando:
- Snapshots automáticos a cada 15 min (Vercel Cron)
- Pruning semanal (domingo 03:00 UTC)
- `CRON_SECRET` novo em env vars (gerar com `openssl rand -hex 32`)
- `SUPABASE_SERVICE_ROLE_KEY` precisa existir também em produção na Vercel
- Migration a ser aplicada em Supabase antes do primeiro deploy: `supabase/migrations/20260424120000_metrics_snapshots.sql`
- Página `/historico` só mostra dados depois que o cron rodou ao menos uma vez

- [ ] **Step 3: Smoke test manual do cron local**

```bash
pnpm dev
# em outro terminal:
curl -i -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)" \
  http://localhost:3000/api/cron/snapshot-metrics
```
Expected: `HTTP/1.1 200 OK` + `{"ok":true}`. Checar no Supabase Table Editor que apareceu uma linha em `monitor_snapshots` e outra em `funil_snapshots`.

Também: testar sem header →
```bash
curl -i http://localhost:3000/api/cron/snapshot-metrics
```
Expected: `HTTP/1.1 401`.

- [ ] **Step 4: Smoke test da página**

Com ao menos 1 snapshot gravado, abrir `http://localhost:3000/historico` — deve mostrar charts com 1 ponto cada. Alternar range entre 24h/7d/30d/90d mantém o mesmo ponto (ok, ainda tem pouca densidade).

- [ ] **Step 5: Rodar toda a suíte**

```bash
pnpm vitest run
```
Expected: 100% dos testes passam.

- [ ] **Step 6: Build de produção local**

```bash
pnpm build
```
Expected: sem erros de typecheck nem de lint que quebrem o build.

- [ ] **Step 7: Commit e sinalizar pronto pra deploy**

```bash
git add vercel.json README.md
git commit -m "chore(metrics): vercel.json crons config + README update"
```

**Checklist pré-deploy (não é código, é processo):**
- [ ] Migration aplicada no Supabase de produção.
- [ ] Env var `CRON_SECRET` gerada e setada no projeto Vercel (Production).
- [ ] Env var `SUPABASE_SERVICE_ROLE_KEY` setada no projeto Vercel (Production) — antes estava só local.
- [ ] Deploy.
- [ ] Aguardar 15 min → conferir no Supabase se snapshot entrou.
- [ ] Abrir `/historico` e confirmar primeiro ponto aparece.
