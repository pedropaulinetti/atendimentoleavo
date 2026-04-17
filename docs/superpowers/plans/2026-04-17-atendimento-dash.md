# Atendimento Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js 15 web dashboard with two panels (Monitor de conversas paradas + Funil de leads) consuming the Data Crazy API, authenticated via Supabase, for 1–5 supervisors on a fixed pipeline.

**Architecture:** Next.js 15 App Router fullstack on Vercel. Server-side API routes proxy Data Crazy (token stays in env). Supabase handles auth (email/senha) and sessions. TanStack Query polls the backend (10s Monitor, 30s Funil). Severity/metrics are computed server-side for clock-drift safety.

**Tech Stack:** Next.js 15, TypeScript, TailwindCSS, shadcn/ui, TanStack Query, Supabase (`@supabase/ssr`), Vitest, MSW, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-04-17-atendimento-dash-design.md`

---

## Task Order & Milestones

1. **Tasks 1–3** — Project scaffold, Supabase wiring, login gate → *Deploy checkpoint: login works*
2. **Tasks 4–6** — Data Crazy client, pure logic (severity + metrics), API routes → *Checkpoint: curl returns real data*
3. **Tasks 7–8** — Monitor UI → *Checkpoint: cores + som OK*
4. **Tasks 9–10** — Funil UI → *Checkpoint: barras + filtros OK*
5. **Tasks 11–13** — Error UX, security headers, E2E, docs → *Final checkpoint: prod-ready*

---

## File Structure

```
atendimento-dash/
├── app/
│   ├── layout.tsx                    # Root layout com QueryClient + Supabase
│   ├── page.tsx                      # Redirect pra /monitor
│   ├── login/
│   │   ├── page.tsx                  # Form de login
│   │   └── actions.ts                # Server action de login
│   ├── (dashboard)/
│   │   ├── layout.tsx                # Header + tabs (requer sessão)
│   │   ├── monitor/page.tsx          # Painel 1
│   │   └── funil/page.tsx            # Painel 2
│   └── api/
│       ├── conversations/route.ts    # Proxy DC + severity
│       ├── deals/route.ts            # Proxy DC + métricas
│       └── pipeline-stages/route.ts  # Cache stages
├── components/
│   ├── ui/                           # shadcn components
│   ├── monitor/
│   │   ├── ConversationList.tsx      # client component, render
│   │   ├── SummaryBadges.tsx         # contadores
│   │   └── SoundToggle.tsx           # botão mute
│   ├── funil/
│   │   ├── StageBar.tsx              # barra por etapa
│   │   ├── DateRangePicker.tsx       # filtro de data
│   │   └── DealsDrawer.tsx           # drill-down
│   └── shared/
│       ├── Header.tsx
│       ├── ErrorBanner.tsx
│       └── OfflineBanner.tsx
├── lib/
│   ├── datacrazy/
│   │   ├── client.ts                 # fetch wrapper + tipos de erro
│   │   ├── types.ts                  # tipos do DC
│   │   └── cache.ts                  # cache em memória (stages + users)
│   ├── monitor/
│   │   └── severity.ts               # computeAlertLevel
│   ├── funil/
│   │   ├── metrics.ts                # groupDealsByStage, computeStageMetrics
│   │   └── dateRange.ts              # resolveDateRangePreset
│   └── supabase/
│       ├── server.ts                 # createServerClient
│       └── middleware.ts             # refresh session
├── scripts/
│   └── create-user.ts                # script admin p/ criar usuário
├── tests/
│   ├── lib/
│   │   ├── severity.test.ts
│   │   ├── metrics.test.ts
│   │   └── dateRange.test.ts
│   ├── api/
│   │   ├── conversations.test.ts
│   │   └── deals.test.ts
│   └── e2e/
│       └── login-flow.spec.ts
├── public/sounds/alert.mp3
├── middleware.ts                     # protege rotas
├── .env.local.example
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vitest.config.ts
├── playwright.config.ts
└── README.md
```

---

## Task 1: Project scaffold + dependencies

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.gitignore`, `.env.local.example`

- [ ] **Step 1: Inicializa projeto Next.js**

Run (já dentro de `/Users/pedropaulinetti/Desktop/UOS/Atendimento/DASH UX`):
```bash
pnpm create next-app@latest . --ts --tailwind --app --no-src-dir --no-import-alias --use-pnpm --eslint
```
Aceita sobrescrever/mergear arquivos no diretório. Se perguntar sobre Turbopack, aceita.

- [ ] **Step 2: Instala dependências do app**

```bash
pnpm add @supabase/ssr @supabase/supabase-js @tanstack/react-query zod clsx tailwind-merge class-variance-authority lucide-react date-fns react-day-picker@8
```

- [ ] **Step 3: Instala dev dependencies**

```bash
pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom msw @playwright/test tsx
```

- [ ] **Step 4: Inicializa shadcn/ui**

```bash
pnpm dlx shadcn@latest init -d
```
Aceita defaults (New York style, zinc, CSS variables).

- [ ] **Step 5: Instala componentes shadcn que o app vai usar**

```bash
pnpm dlx shadcn@latest add button card input label toast skeleton badge popover calendar
```

- [ ] **Step 6: Cria `.env.local.example`**

```
DATACRAZY_TOKEN=dc_...
PIPELINE_ID=d6635f08-506e-4504-8a4d-bb79b04c8b49
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

- [ ] **Step 7: Valida o build**

Run: `pnpm build`
Expected: build OK, sem erros de tipo.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js 15 + Tailwind + shadcn + deps"
```

---

## Task 2: Supabase client + middleware de sessão

**Files:**
- Create: `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/middleware.ts`, `middleware.ts`

- [ ] **Step 1: `lib/supabase/server.ts`** — client para Server Components / Route Handlers / Server Actions

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // called from Server Component — middleware handles refresh
          }
        },
      },
    }
  );
}
```

- [ ] **Step 2: `lib/supabase/client.ts`** — browser client

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 3: `lib/supabase/middleware.ts`** — session refresh

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path === "/login" ||
    path.startsWith("/api/auth") ||
    path.startsWith("/_next") ||
    path === "/favicon.ico";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", path);
    return NextResponse.redirect(url);
  }

  return response;
}
```

- [ ] **Step 4: `middleware.ts` (root)**

```ts
import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sounds/).*)"],
};
```

- [ ] **Step 5: Valida**

Run: `pnpm build`
Expected: build OK. Acessar `/` sem env vars Supabase dá erro esperado; OK.

- [ ] **Step 6: Commit**

```bash
git add lib/supabase middleware.ts && git commit -m "feat(auth): supabase ssr clients + route protection middleware"
```

---

## Task 3: Página de login + script de criação de usuário

**Files:**
- Create: `app/login/page.tsx`, `app/login/actions.ts`, `scripts/create-user.ts`
- Modify: `package.json` (adiciona script `user:create`)

- [ ] **Step 1: `app/login/actions.ts`**

```ts
"use server";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function login(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const from = String(formData.get("from") ?? "/monitor");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Email ou senha inválidos" };

  redirect(from);
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 2: `app/login/page.tsx`**

```tsx
import { login } from "./actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ from?: string; error?: string }> }) {
  const { from = "/monitor", error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <form action={login} className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow">
        <h1 className="text-2xl font-semibold">Atendimento — Login</h1>
        <input type="hidden" name="from" value={from} />
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">Senha</Label>
          <Input id="password" name="password" type="password" required />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full">Entrar</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: `scripts/create-user.ts`**

```ts
import { createClient } from "@supabase/supabase-js";

const [, , email, password] = process.argv;
if (!email || !password) {
  console.error("Usage: pnpm user:create <email> <password>");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (error) { console.error(error); process.exit(1); }
console.log("Usuário criado:", data.user?.email);
```

- [ ] **Step 4: Adiciona script em `package.json`**

```json
"scripts": {
  ...
  "user:create": "tsx --env-file=.env.local scripts/create-user.ts"
}
```

- [ ] **Step 5: Valida build**

Run: `pnpm build`
Expected: build OK.

- [ ] **Step 6: Commit**

```bash
git add app/login scripts package.json && git commit -m "feat(auth): login page + user creation script"
```

---

## Task 4: Data Crazy client + tipos + cache

**Files:**
- Create: `lib/datacrazy/types.ts`, `lib/datacrazy/client.ts`, `lib/datacrazy/cache.ts`
- Test: `tests/lib/datacrazy-client.test.ts`

- [ ] **Step 1: `lib/datacrazy/types.ts`**

```ts
export type DataCrazyErrorCode =
  | "UNAUTHORIZED" | "RATE_LIMIT" | "TIMEOUT" | "SERVER_ERROR" | "UNKNOWN";

export class DataCrazyError extends Error {
  constructor(public code: DataCrazyErrorCode, public status: number, message: string) {
    super(message);
  }
}

export interface DCConversation {
  id: string;
  isGroup: boolean;
  name: string;
  lastReceivedMessageDate: string | null;
  lastSendedMessageDate: string | null;
  attendants: Array<{ id: string }>;
  currentDepartment: { id: string; name: string; color: string } | null;
  contact?: { externalInfo?: { pipelineIds?: string[]; stageIds?: string[] } };
}

export interface DCDeal {
  id: string;
  name: string;
  stageId: string;
  status: "won" | "in_process" | "lost";
  createdAt: string;
  lastMovedAt: string | null;
  value: number | null;
}

export interface DCPipelineStage {
  id: string;
  name: string;
  order: number;
  pipelineId: string;
}

export interface DCUser {
  id: string;
  name: string;
  email?: string;
}
```

- [ ] **Step 2: Write failing test `tests/lib/datacrazy-client.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { dcFetch } from "@/lib/datacrazy/client";
import { DataCrazyError } from "@/lib/datacrazy/types";

const server = setupServer();
beforeAll(() => { process.env.DATACRAZY_TOKEN = "test"; server.listen(); });
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("dcFetch", () => {
  it("returns JSON on 200", async () => {
    server.use(http.get("https://api.g1.datacrazy.io/api/v1/ping",
      () => HttpResponse.json({ ok: true })));
    expect(await dcFetch("/ping")).toEqual({ ok: true });
  });

  it("throws UNAUTHORIZED on 401", async () => {
    server.use(http.get("https://api.g1.datacrazy.io/api/v1/ping",
      () => new HttpResponse(null, { status: 401 })));
    await expect(dcFetch("/ping")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("retries once on 5xx then succeeds", async () => {
    let hits = 0;
    server.use(http.get("https://api.g1.datacrazy.io/api/v1/ping", () => {
      hits++;
      if (hits === 1) return new HttpResponse(null, { status: 503 });
      return HttpResponse.json({ ok: true });
    }));
    expect(await dcFetch("/ping")).toEqual({ ok: true });
    expect(hits).toBe(2);
  });
});
```

- [ ] **Step 3: Run test — expect fail**

Run: `pnpm vitest run tests/lib/datacrazy-client.test.ts`
Expected: FAIL (`dcFetch` não existe).

- [ ] **Step 4: Implementa `lib/datacrazy/client.ts`**

```ts
import { DataCrazyError } from "./types";

const BASE = "https://api.g1.datacrazy.io/api/v1";
const TIMEOUT_MS = 10_000;
const RETRY_BACKOFF_MS = 1_000;

function mapError(status: number): DataCrazyError {
  if (status === 401) return new DataCrazyError("UNAUTHORIZED", status, "Token Data Crazy inválido");
  if (status === 429) return new DataCrazyError("RATE_LIMIT", status, "Rate limit atingido");
  if (status >= 500) return new DataCrazyError("SERVER_ERROR", status, "Erro no Data Crazy");
  return new DataCrazyError("UNKNOWN", status, `HTTP ${status}`);
}

async function doFetch(url: string, init: RequestInit) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally { clearTimeout(t); }
}

export async function dcFetch<T = unknown>(
  path: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const token = process.env.DATACRAZY_TOKEN;
  if (!token) throw new DataCrazyError("UNAUTHORIZED", 0, "DATACRAZY_TOKEN ausente");

  const url = new URL(BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object") url.searchParams.set(k, JSON.stringify(v));
    else url.searchParams.set(k, String(v));
  }

  const init: RequestInit = {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };

  let attempts = 0;
  while (true) {
    attempts++;
    let res: Response;
    try {
      res = await doFetch(url.toString(), init);
    } catch (err) {
      if (attempts === 1) { await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS)); continue; }
      throw new DataCrazyError("TIMEOUT", 0, "Timeout ou erro de rede");
    }

    if (res.ok) return res.json() as Promise<T>;
    if ((res.status === 429 || res.status >= 500) && attempts === 1) {
      await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
      continue;
    }
    throw mapError(res.status);
  }
}
```

- [ ] **Step 5: Run test — expect pass**

Run: `pnpm vitest run tests/lib/datacrazy-client.test.ts`
Expected: PASS.

- [ ] **Step 6: Implementa `lib/datacrazy/cache.ts` (TTL em memória)**

```ts
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
```

- [ ] **Step 7: Commit**

```bash
git add lib/datacrazy tests/lib/datacrazy-client.test.ts && git commit -m "feat(dc): typed client with retry + error mapping + ttl cache"
```

---

## Task 5: Lógica pura do Monitor (severity)

**Files:**
- Create: `lib/monitor/severity.ts`
- Test: `tests/lib/severity.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { computeAlertLevel } from "@/lib/monitor/severity";

const now = new Date("2026-04-17T14:00:00Z").getTime();
const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

describe("computeAlertLevel", () => {
  it("returns respondida when lastReceived is null", () => {
    expect(computeAlertLevel({
      lastReceivedMessageDate: null, lastSendedMessageDate: minsAgo(5), now,
    })).toEqual({ level: "respondida", minutosParada: 0 });
  });

  it("returns respondida when team replied after client", () => {
    expect(computeAlertLevel({
      lastReceivedMessageDate: minsAgo(20), lastSendedMessageDate: minsAgo(5), now,
    })).toEqual({ level: "respondida", minutosParada: 0 });
  });

  it("returns ok when client sent < 3 min ago", () => {
    expect(computeAlertLevel({
      lastReceivedMessageDate: minsAgo(2), lastSendedMessageDate: minsAgo(10), now,
    }).level).toBe("ok");
  });

  it.each([
    [4, "verdeAlerta"], [10.5, "amarelo"], [31, "vermelho"],
    [3.01, "verdeAlerta"], [10.01, "amarelo"], [30.01, "vermelho"],
  ])("minutes %f → %s", (m, level) => {
    expect(computeAlertLevel({
      lastReceivedMessageDate: minsAgo(m), lastSendedMessageDate: null, now,
    }).level).toBe(level);
  });

  it("boundaries: exactly 3, 10, 30 stay in lower bucket", () => {
    const cases: [number, string][] = [[3, "ok"], [10, "verdeAlerta"], [30, "amarelo"]];
    for (const [m, level] of cases) {
      expect(computeAlertLevel({
        lastReceivedMessageDate: minsAgo(m), lastSendedMessageDate: null, now,
      }).level).toBe(level);
    }
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm vitest run tests/lib/severity.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/monitor/severity.ts`**

```ts
export type AlertLevel = "vermelho" | "amarelo" | "verdeAlerta" | "ok" | "respondida";

export interface SeverityInput {
  lastReceivedMessageDate: string | null;
  lastSendedMessageDate: string | null;
  now: number;
}

export function computeAlertLevel(i: SeverityInput): { level: AlertLevel; minutosParada: number } {
  if (!i.lastReceivedMessageDate) return { level: "respondida", minutosParada: 0 };
  const received = new Date(i.lastReceivedMessageDate).getTime();
  const sended = i.lastSendedMessageDate ? new Date(i.lastSendedMessageDate).getTime() : 0;
  if (sended >= received) return { level: "respondida", minutosParada: 0 };

  const minutosParada = (i.now - received) / 60_000;
  let level: AlertLevel = "ok";
  if (minutosParada > 30) level = "vermelho";
  else if (minutosParada > 10) level = "amarelo";
  else if (minutosParada > 3) level = "verdeAlerta";
  return { level, minutosParada };
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm vitest run tests/lib/severity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/monitor tests/lib/severity.test.ts && git commit -m "feat(monitor): computeAlertLevel with 3/10/30 min thresholds"
```

---

## Task 6: Lógica pura do Funil + API routes

**Files:**
- Create: `lib/funil/metrics.ts`, `lib/funil/dateRange.ts`, `app/api/conversations/route.ts`, `app/api/deals/route.ts`, `app/api/pipeline-stages/route.ts`
- Test: `tests/lib/metrics.test.ts`, `tests/lib/dateRange.test.ts`, `tests/api/conversations.test.ts`, `tests/api/deals.test.ts`

### 6.1 — Pure funnel logic (TDD)

- [ ] **Step 1: Write failing tests `tests/lib/metrics.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { groupDealsByStage, computeStageMetrics } from "@/lib/funil/metrics";
import type { DCDeal } from "@/lib/datacrazy/types";

const now = new Date("2026-04-17T00:00:00Z").getTime();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

const deal = (id: string, stageId: string, moved: string | null, created = daysAgo(30)): DCDeal =>
  ({ id, name: id, stageId, status: "in_process", createdAt: created, lastMovedAt: moved, value: null });

describe("groupDealsByStage", () => {
  it("ignores deals with stageId not in known stages", () => {
    const stages = [{ id: "s1" }, { id: "s2" }] as any;
    const deals = [deal("a", "s1", daysAgo(1)), deal("b", "sX", daysAgo(1))];
    const g = groupDealsByStage(deals, stages);
    expect(g.get("s1")?.length).toBe(1);
    expect(g.get("s2")?.length).toBe(0);
    expect(g.has("sX")).toBe(false);
  });
});

describe("computeStageMetrics", () => {
  it("uses createdAt fallback when lastMovedAt null", () => {
    const deals = [deal("a", "s1", null, daysAgo(5))];
    const m = computeStageMetrics(deals, now);
    expect(m.count).toBe(1);
    expect(Math.round(m.avgTimeInStageMs / 86_400_000)).toBe(5);
  });

  it("flags deals >7 days as stuck", () => {
    const deals = [deal("a", "s1", daysAgo(3)), deal("b", "s1", daysAgo(8)), deal("c", "s1", daysAgo(10))];
    expect(computeStageMetrics(deals, now).stuckCount).toBe(2);
  });

  it("boundary: exactly 7 days is NOT stuck", () => {
    const deals = [deal("a", "s1", daysAgo(7))];
    expect(computeStageMetrics(deals, now).stuckCount).toBe(0);
  });

  it("empty list returns zeros", () => {
    expect(computeStageMetrics([], now)).toEqual({ count: 0, avgTimeInStageMs: 0, stuckCount: 0 });
  });
});
```

- [ ] **Step 2: Write failing tests `tests/lib/dateRange.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resolveDateRangePreset } from "@/lib/funil/dateRange";

const ref = new Date("2026-04-17T15:30:00Z");

describe("resolveDateRangePreset", () => {
  it("today = start and end of day", () => {
    const r = resolveDateRangePreset("today", ref);
    expect(r.from).toBe("2026-04-17T00:00:00.000Z");
    expect(r.to).toBe("2026-04-17T23:59:59.999Z");
  });

  it("week = last 7 days ending today", () => {
    const r = resolveDateRangePreset("week", ref);
    expect(r.from).toBe("2026-04-10T00:00:00.000Z");
    expect(r.to).toBe("2026-04-17T23:59:59.999Z");
  });

  it("30d = last 30 days ending today", () => {
    const r = resolveDateRangePreset("30d", ref);
    expect(r.from).toBe("2026-03-18T00:00:00.000Z");
    expect(r.to).toBe("2026-04-17T23:59:59.999Z");
  });

  it("month = current month", () => {
    const r = resolveDateRangePreset("month", ref);
    expect(r.from).toBe("2026-04-01T00:00:00.000Z");
  });
});
```

- [ ] **Step 3: Run — expect fail** — `pnpm vitest run tests/lib/metrics.test.ts tests/lib/dateRange.test.ts`

- [ ] **Step 4: Implement `lib/funil/metrics.ts`**

```ts
import type { DCDeal, DCPipelineStage } from "@/lib/datacrazy/types";

const STUCK_THRESHOLD_MS = 7 * 86_400_000;

export function groupDealsByStage(deals: DCDeal[], stages: Pick<DCPipelineStage, "id">[]) {
  const map = new Map<string, DCDeal[]>();
  for (const s of stages) map.set(s.id, []);
  for (const d of deals) {
    const bucket = map.get(d.stageId);
    if (bucket) bucket.push(d);
  }
  return map;
}

export interface StageMetrics { count: number; avgTimeInStageMs: number; stuckCount: number; }

export function computeStageMetrics(deals: DCDeal[], now: number): StageMetrics {
  if (deals.length === 0) return { count: 0, avgTimeInStageMs: 0, stuckCount: 0 };
  let sum = 0, stuck = 0;
  for (const d of deals) {
    const anchor = d.lastMovedAt ?? d.createdAt;
    const age = now - new Date(anchor).getTime();
    sum += age;
    if (age > STUCK_THRESHOLD_MS) stuck++;
  }
  return { count: deals.length, avgTimeInStageMs: sum / deals.length, stuckCount: stuck };
}
```

- [ ] **Step 5: Implement `lib/funil/dateRange.ts`**

```ts
export type DatePreset = "today" | "week" | "30d" | "month" | "custom";
export interface DateRange { from: string; to: string; }

function startOfDay(d: Date) { const x = new Date(d); x.setUTCHours(0,0,0,0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setUTCHours(23,59,59,999); return x; }

export function resolveDateRangePreset(
  p: Exclude<DatePreset, "custom">,
  ref = new Date(),
): DateRange {
  const to = endOfDay(ref).toISOString();
  if (p === "today") return { from: startOfDay(ref).toISOString(), to };
  if (p === "week") {
    const d = new Date(ref); d.setUTCDate(d.getUTCDate() - 7);
    return { from: startOfDay(d).toISOString(), to };
  }
  if (p === "30d") {
    const d = new Date(ref); d.setUTCDate(d.getUTCDate() - 30);
    return { from: startOfDay(d).toISOString(), to };
  }
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  return { from: d.toISOString(), to };
}
```

- [ ] **Step 6: Run — expect pass**

Run: `pnpm vitest run tests/lib/metrics.test.ts tests/lib/dateRange.test.ts`
Expected: PASS.

### 6.2 — API routes

- [ ] **Step 7: `app/api/pipeline-stages/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dcFetch } from "@/lib/datacrazy/client";
import { cached } from "@/lib/datacrazy/cache";
import { DataCrazyError } from "@/lib/datacrazy/types";
import type { DCPipelineStage } from "@/lib/datacrazy/types";

const PIPELINE_ID = process.env.PIPELINE_ID!;

export async function getStages(): Promise<DCPipelineStage[]> {
  return cached(`stages:${PIPELINE_ID}`, 5 * 60_000, async () => {
    const res = await dcFetch<{ data: DCPipelineStage[] } | DCPipelineStage[]>(`/pipelines/${PIPELINE_ID}/stages`);
    return Array.isArray(res) ? res : res.data;
  });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const stages = await getStages();
    return NextResponse.json({ stages });
  } catch (err) {
    return handleDCError(err);
  }
}

export function handleDCError(err: unknown) {
  if (err instanceof DataCrazyError) {
    const status = err.code === "UNAUTHORIZED" ? 503 :
                   err.code === "RATE_LIMIT" ? 429 :
                   err.code === "TIMEOUT" ? 504 : 502;
    return NextResponse.json({ error: err.code, message: err.message }, { status });
  }
  console.error("Unexpected error:", err);
  return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
}
```

- [ ] **Step 8: `app/api/conversations/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dcFetch } from "@/lib/datacrazy/client";
import { computeAlertLevel } from "@/lib/monitor/severity";
import { cached } from "@/lib/datacrazy/cache";
import { getStages, handleDCError } from "@/app/api/pipeline-stages/route";
import type { DCConversation, DCUser } from "@/lib/datacrazy/types";

async function getUsersMap(): Promise<Map<string, string>> {
  return cached("users:map", 5 * 60_000, async () => {
    const res = await dcFetch<{ data: DCUser[] } | DCUser[]>("/users");
    const list = Array.isArray(res) ? res : res.data;
    return new Map(list.map(u => [u.id, u.name]));
  });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const stages = await getStages();
    const stageIds = stages.map(s => s.id).join(",");
    const res = await dcFetch<{ data: DCConversation[] }>("/conversations", {
      take: 200,
      filter: { stages: stageIds, opened: true },
    });
    const users = await getUsersMap();
    const now = Date.now();

    const enriched = res.data
      .filter(c => !c.isGroup)
      .map(c => {
        const { level, minutosParada } = computeAlertLevel({
          lastReceivedMessageDate: c.lastReceivedMessageDate,
          lastSendedMessageDate: c.lastSendedMessageDate,
          now,
        });
        const attendantId = c.attendants?.[0]?.id;
        const attendantName = attendantId
          ? (users.get(attendantId) ?? "Atendente removido")
          : "Sem atendente";
        return {
          id: c.id, name: c.name, level, minutosParada, attendantName,
          departmentName: c.currentDepartment?.name ?? "—",
          departmentColor: c.currentDepartment?.color ?? "#666",
        };
      })
      .filter(c => c.level !== "ok" && c.level !== "respondida")
      .sort((a, b) => b.minutosParada - a.minutosParada);

    return NextResponse.json({ conversations: enriched, updatedAt: new Date().toISOString() });
  } catch (err) { return handleDCError(err); }
}
```

- [ ] **Step 9: `app/api/deals/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dcFetch } from "@/lib/datacrazy/client";
import { getStages, handleDCError } from "@/app/api/pipeline-stages/route";
import { groupDealsByStage, computeStageMetrics } from "@/lib/funil/metrics";
import type { DCDeal } from "@/lib/datacrazy/types";

const MAX_PAGES = 5;
const PAGE_SIZE = 500;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "from/to required" }, { status: 400 });

  try {
    const stages = await getStages();
    const stageIdSet = new Set(stages.map(s => s.id));
    const all: DCDeal[] = [];
    let skip = 0;
    let pages = 0;
    let truncated = false;

    for (; pages < MAX_PAGES; pages++) {
      const res = await dcFetch<{ count: number; data: DCDeal[] }>("/businesses", {
        take: PAGE_SIZE, skip,
        filter: { status: "in_process", createdAtGreaterOrEqual: from, createdAtLessOrEqual: to },
      });
      all.push(...res.data.filter(d => stageIdSet.has(d.stageId)));
      if (res.data.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
      if (pages + 1 === MAX_PAGES) truncated = true;
    }
    if (truncated) console.warn(`[deals] pagination ceiling hit: ${MAX_PAGES} pages`);

    const grouped = groupDealsByStage(all, stages);
    const now = Date.now();
    const stageData = stages.map(s => ({
      stage: s,
      metrics: computeStageMetrics(grouped.get(s.id) ?? [], now),
      deals: (grouped.get(s.id) ?? []).map(d => ({
        id: d.id, name: d.name, createdAt: d.createdAt,
        lastMovedAt: d.lastMovedAt, value: d.value,
      })),
    }));

    return NextResponse.json({ stages: stageData, truncated, total: all.length });
  } catch (err) { return handleDCError(err); }
}
```

- [ ] **Step 10: Integration test `tests/api/conversations.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  }),
}));

const server = setupServer();
beforeAll(() => {
  process.env.DATACRAZY_TOKEN = "test";
  process.env.PIPELINE_ID = "p1";
  server.listen();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

import { GET } from "@/app/api/conversations/route";

describe("GET /api/conversations", () => {
  it("returns enriched, sorted list excluding ok/respondida", async () => {
    server.use(
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => HttpResponse.json({ data: [{ id: "s1", name: "A", order: 1, pipelineId: "p1" }] })),
      http.get("https://api.g1.datacrazy.io/api/v1/conversations",
        () => HttpResponse.json({ data: [
          { id: "c-red", isGroup: false, name: "Red", attendants: [{ id: "u1" }],
            currentDepartment: { id: "d1", name: "Vendas", color: "#f00" },
            lastReceivedMessageDate: new Date(Date.now() - 40 * 60_000).toISOString(),
            lastSendedMessageDate: null },
          { id: "c-ok", isGroup: false, name: "OK", attendants: [],
            currentDepartment: null,
            lastReceivedMessageDate: new Date(Date.now() - 1 * 60_000).toISOString(),
            lastSendedMessageDate: null },
        ] })),
      http.get("https://api.g1.datacrazy.io/api/v1/users",
        () => HttpResponse.json({ data: [{ id: "u1", name: "Ana" }] }))
    );
    const res = await GET();
    const json = await res.json();
    expect(json.conversations.length).toBe(1);
    expect(json.conversations[0].level).toBe("vermelho");
    expect(json.conversations[0].attendantName).toBe("Ana");
  });

  it("returns 503 on DC 401", async () => {
    server.use(http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
      () => new HttpResponse(null, { status: 401 })));
    const res = await GET();
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 11: Integration test `tests/api/deals.test.ts`** (com caso do teto de 5 páginas)

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}));

const server = setupServer();
beforeAll(() => {
  process.env.DATACRAZY_TOKEN = "test";
  process.env.PIPELINE_ID = "p1";
  server.listen();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

import { GET } from "@/app/api/deals/route";

function makeDeal(i: number) {
  return { id: `d${i}`, name: `Deal ${i}`, stageId: "s1", status: "in_process",
    createdAt: new Date().toISOString(), lastMovedAt: new Date().toISOString(), value: 100 };
}

describe("GET /api/deals", () => {
  it("aggregates pages and marks truncated at 5-page ceiling", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.use(
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => HttpResponse.json({ data: [{ id: "s1", name: "A", order: 1, pipelineId: "p1" }] })),
      http.get("https://api.g1.datacrazy.io/api/v1/businesses",
        () => HttpResponse.json({ count: 9999, data: Array.from({ length: 500 }, (_, i) => makeDeal(i)) })),
    );
    const req = new NextRequest("http://x/api/deals?from=2026-01-01&to=2026-12-31");
    const res = await GET(req);
    const json = await res.json();
    expect(json.truncated).toBe(true);
    expect(json.total).toBe(2500);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

- [ ] **Step 12: `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: ["tests/setup.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

- [ ] **Step 13: `tests/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 14: Run all unit + integration**

Run: `pnpm vitest run`
Expected: all tests pass.

- [ ] **Step 15: Commit**

```bash
git add -A && git commit -m "feat(api): proxy routes + pure funnel logic + integration tests"
```

---

## Task 7: Monitor UI — layout + lista

**Files:**
- Create: `app/(dashboard)/layout.tsx`, `app/(dashboard)/monitor/page.tsx`, `components/monitor/ConversationList.tsx`, `components/monitor/SummaryBadges.tsx`, `components/shared/Header.tsx`, `components/shared/QueryProvider.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: `components/shared/QueryProvider.tsx`**

```tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 5000 } },
  }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 2: Modifica `app/layout.tsx`** — envolve em QueryProvider

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "@/components/shared/QueryProvider";

export const metadata: Metadata = { title: "Atendimento", description: "Monitor e Funil" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body><QueryProvider>{children}</QueryProvider></body>
    </html>
  );
}
```

- [ ] **Step 3: `app/page.tsx`** — redireciona pra /monitor

```tsx
import { redirect } from "next/navigation";
export default function Home() { redirect("/monitor"); }
```

- [ ] **Step 4: `components/shared/Header.tsx`**

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";

export async function Header() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <header className="flex items-center justify-between border-b px-6 py-3">
      <nav className="flex gap-4">
        <Link href="/monitor" className="font-medium hover:underline">Monitor</Link>
        <Link href="/funil" className="font-medium hover:underline">Funil</Link>
      </nav>
      <div className="flex items-center gap-3 text-sm text-zinc-600">
        <span>{user?.email}</span>
        <form action={logout}><Button variant="ghost" size="sm">Sair</Button></form>
      </div>
    </header>
  );
}
```

- [ ] **Step 5: `app/(dashboard)/layout.tsx`**

```tsx
import { Header } from "@/components/shared/Header";
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <><Header /><main className="p-6">{children}</main></>;
}
```

- [ ] **Step 6: `components/monitor/SummaryBadges.tsx`**

```tsx
interface Props { red: number; yellow: number; green: number; updatedAt?: string; }
export function SummaryBadges({ red, yellow, green, updatedAt }: Props) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-white p-4">
      <div className="flex gap-6">
        <span className="font-medium">🔴 {red} críticas</span>
        <span className="font-medium">🟡 {yellow} atenção</span>
        <span className="font-medium">🟢 {green} verde-alerta</span>
      </div>
      {updatedAt && (
        <span className="text-xs text-zinc-500">
          Última atualização: {new Date(updatedAt).toLocaleTimeString("pt-BR")}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 7: `components/monitor/ConversationList.tsx`** (client, polling)

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { SummaryBadges } from "./SummaryBadges";
import { Skeleton } from "@/components/ui/skeleton";

interface Conversation {
  id: string; name: string; level: "vermelho"|"amarelo"|"verdeAlerta";
  minutosParada: number; attendantName: string; departmentName: string; departmentColor: string;
}

const LEVEL_STYLES = {
  vermelho: "border-l-4 border-red-500 bg-red-50",
  amarelo: "border-l-4 border-yellow-500 bg-yellow-50",
  verdeAlerta: "border-l-4 border-green-500 bg-green-50",
};
const LEVEL_ICON = { vermelho: "🔴", amarelo: "🟡", verdeAlerta: "🟢" };

function formatMinutes(m: number) {
  if (m < 60) return `${Math.floor(m)} min sem resposta`;
  return `${Math.floor(m / 60)}h ${Math.floor(m % 60)}min sem resposta`;
}

export function ConversationList({ soundEnabled }: { soundEnabled: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => {
      const r = await fetch("/api/conversations");
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json() as Promise<{ conversations: Conversation[]; updatedAt: string }>;
    },
    refetchInterval: 10_000,
  });

  const prevReds = useRef<Set<string>>(new Set());
  const [audio] = useState(() => typeof Audio !== "undefined" ? new Audio("/sounds/alert.mp3") : null);

  useEffect(() => {
    if (!data) return;
    const currentReds = new Set(data.conversations.filter(c => c.level === "vermelho").map(c => c.id));
    if (soundEnabled && audio) {
      for (const id of currentReds) {
        if (!prevReds.current.has(id)) { audio.play().catch(() => {}); break; }
      }
    }
    prevReds.current = currentReds;
  }, [data, soundEnabled, audio]);

  if (isLoading) return <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16"/>)}</div>;
  if (error) return <div className="rounded border border-red-300 bg-red-50 p-4 text-sm">Atualização falhou. Tentando novamente…</div>;
  if (!data) return null;

  const counts = {
    red: data.conversations.filter(c => c.level === "vermelho").length,
    yellow: data.conversations.filter(c => c.level === "amarelo").length,
    green: data.conversations.filter(c => c.level === "verdeAlerta").length,
  };

  return (
    <div className="space-y-4">
      <SummaryBadges {...counts} updatedAt={data.updatedAt} />
      {data.conversations.length === 0 ? (
        <div className="rounded-lg border bg-white p-12 text-center text-zinc-500">
          Nenhuma conversa precisa de atenção
        </div>
      ) : (
        <ul className="space-y-2">
          {data.conversations.map(c => (
            <li key={c.id} className={`flex items-center justify-between rounded p-4 ${LEVEL_STYLES[c.level]}`}>
              <div className="flex items-center gap-3">
                <span className="text-lg">{LEVEL_ICON[c.level]}</span>
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-sm text-zinc-600">{formatMinutes(c.minutosParada)}</p>
                </div>
              </div>
              <div className="text-right text-sm">
                <p>{c.attendantName}</p>
                <p className="text-zinc-500" style={{ color: c.departmentColor }}>{c.departmentName}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 8: `app/(dashboard)/monitor/page.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { ConversationList } from "@/components/monitor/ConversationList";
import { Button } from "@/components/ui/button";

export default function MonitorPage() {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("monitor-sound");
    if (saved === "on") setSoundEnabled(true);
  }, []);

  const activate = () => { setActivated(true); setSoundEnabled(true); localStorage.setItem("monitor-sound", "on"); };
  const toggle = () => { const v = !soundEnabled; setSoundEnabled(v); localStorage.setItem("monitor-sound", v ? "on" : "off"); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Monitor de conversas paradas</h1>
        {!activated ? (
          <Button onClick={activate} variant="outline">Clique para ativar sons</Button>
        ) : (
          <Button onClick={toggle} variant="outline">{soundEnabled ? "🔔 Som ligado" : "🔕 Mutado"}</Button>
        )}
      </div>
      <ConversationList soundEnabled={soundEnabled} />
    </div>
  );
}
```

- [ ] **Step 9: Coloca um som placeholder**

Run:
```bash
mkdir -p public/sounds
# um beep curto; baixa algo simples ou gera via: https://github.com/anars/blank-audio
# por ora, placeholder vazio:
touch public/sounds/alert.mp3
```
(Substituir por arquivo real antes de deploy — anota no README.)

- [ ] **Step 10: Valida build**

Run: `pnpm build`
Expected: build OK.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat(monitor): panel UI with polling, colors, and sound toggle"
```

---

## Task 8: Manual QA do Monitor (checkpoint)

- [ ] **Step 1: Cria conta Supabase**
  - https://supabase.com/dashboard → New Project
  - Copia `URL` e `anon key` + `service_role` pra `.env.local`

- [ ] **Step 2: Cria usuário admin**

Run: `pnpm user:create voce@exemplo.com senha123`
Expected: "Usuário criado: voce@exemplo.com"

- [ ] **Step 3: Inicia dev server**

Run: `pnpm dev`
Expected: ready em http://localhost:3000

- [ ] **Step 4: Testa fluxo**
  - Acessa `/` → redireciona `/login`
  - Login com credenciais criadas → chega em `/monitor`
  - Vê lista (ou vazia) com dados reais da Data Crazy
  - Verifica badge de contadores
  - Testa logout

- [ ] **Step 5: Testa falha de token**
  - Troca `DATACRAZY_TOKEN` por algo inválido → vê banner de erro
  - Restaura

- [ ] **Step 6: Commit se ajustar algo**

---

## Task 9: Funil UI — barras + filtros

**Files:**
- Create: `components/funil/StageBar.tsx`, `components/funil/DateRangePicker.tsx`, `components/funil/StageList.tsx`, `app/(dashboard)/funil/page.tsx`

- [ ] **Step 1: `components/funil/DateRangePicker.tsx`** (client, preset + custom)

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { resolveDateRangePreset } from "@/lib/funil/dateRange";

export function DateRangePicker() {
  const router = useRouter();
  const sp = useSearchParams();
  const current = sp.get("preset") ?? "30d";

  function setPreset(p: "today" | "week" | "30d" | "month") {
    const r = resolveDateRangePreset(p);
    const q = new URLSearchParams({ preset: p, from: r.from, to: r.to });
    router.push(`/funil?${q.toString()}`);
  }

  const LABELS = { today: "Hoje", week: "7 dias", "30d": "30 dias", month: "Mês" };

  return (
    <div className="flex gap-2">
      {(["today", "week", "30d", "month"] as const).map(p => (
        <Button
          key={p}
          variant={current === p ? "default" : "outline"}
          size="sm"
          onClick={() => setPreset(p)}
        >
          {LABELS[p]}
        </Button>
      ))}
    </div>
  );
}

// Note: spec mentions "Custom" range — deferred to v2 (react-day-picker already installed if needed).
```

- [ ] **Step 2: `components/funil/StageBar.tsx`**

```tsx
interface Props {
  name: string;
  count: number;
  maxCount: number;
  avgDays: number;
  stuckCount: number;
}

export function StageBar({ name, count, maxCount, avgDays, stuckCount }: Props) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium">{name}</h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold">{count} leads</span>
          {stuckCount > 0 && <span className="text-red-600">⚠ {stuckCount} parados</span>}
        </div>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full bg-zinc-900 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Tempo médio na etapa: {avgDays.toFixed(1)} dias
      </p>
    </div>
  );
}
```

- [ ] **Step 3: `components/funil/StageList.tsx`** (client, polling)

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { resolveDateRangePreset } from "@/lib/funil/dateRange";
import { StageBar } from "./StageBar";
import { Skeleton } from "@/components/ui/skeleton";

interface StageData {
  stage: { id: string; name: string; order: number };
  metrics: { count: number; avgTimeInStageMs: number; stuckCount: number };
  deals: { id: string; name: string; createdAt: string; lastMovedAt: string | null; value: number | null }[];
}

export function StageList() {
  const sp = useSearchParams();
  const preset = (sp.get("preset") ?? "30d") as "today"|"week"|"30d"|"month";
  const range = resolveDateRangePreset(preset);
  const from = sp.get("from") ?? range.from;
  const to = sp.get("to") ?? range.to;

  const { data, isLoading, error } = useQuery({
    queryKey: ["deals", from, to],
    queryFn: async () => {
      const q = new URLSearchParams({ from, to });
      const r = await fetch(`/api/deals?${q}`);
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json() as Promise<{ stages: StageData[]; total: number; truncated: boolean }>;
    },
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-24"/>)}</div>;
  if (error) return <div className="rounded border border-red-300 bg-red-50 p-4 text-sm">Falha ao carregar. Tentando novamente…</div>;
  if (!data) return null;

  const maxCount = Math.max(1, ...data.stages.map(s => s.metrics.count));
  const sorted = [...data.stages].sort((a, b) => a.stage.order - b.stage.order);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span>{data.total} leads no período</span>
        {data.truncated && <span className="text-amber-600">⚠ Exibindo apenas 2500 leads (truncado)</span>}
      </div>
      {sorted.length === 0 ? (
        <div className="rounded-lg border bg-white p-12 text-center text-zinc-500">
          Nenhum lead criado neste período
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map(s => (
            <StageBar
              key={s.stage.id}
              name={s.stage.name}
              count={s.metrics.count}
              maxCount={maxCount}
              avgDays={s.metrics.avgTimeInStageMs / 86_400_000}
              stuckCount={s.metrics.stuckCount}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `app/(dashboard)/funil/page.tsx`**

```tsx
import { DateRangePicker } from "@/components/funil/DateRangePicker";
import { StageList } from "@/components/funil/StageList";

export default function FunilPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Funil</h1>
        <DateRangePicker />
      </div>
      <StageList />
    </div>
  );
}
```

- [ ] **Step 5: Build + manual check**

Run: `pnpm build && pnpm dev`
Verifica: `/funil` mostra as etapas com contagem e tempo; troca os presets.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(funil): stage bars + date preset filter + polling"
```

---

## Task 10: Drill-down — lista de deals por etapa

**Files:**
- Create: `components/funil/DealsDrawer.tsx`
- Modify: `components/funil/StageList.tsx` (clique na barra abre drawer)

- [ ] **Step 1: `components/funil/DealsDrawer.tsx`**

```tsx
"use client";
import { differenceInDays, parseISO } from "date-fns";

interface Deal { id: string; name: string; createdAt: string; lastMovedAt: string | null; value: number | null; }

export function DealsDrawer({ stageName, deals, onClose }: { stageName: string; deals: Deal[]; onClose: () => void; }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{stageName}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-900">✕</button>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase text-zinc-500">
            <tr><th className="pb-2">Nome</th><th>Tempo</th><th>Valor</th></tr>
          </thead>
          <tbody>
            {deals.map(d => {
              const anchor = parseISO(d.lastMovedAt ?? d.createdAt);
              const days = differenceInDays(new Date(), anchor);
              return (
                <tr key={d.id} className="border-b">
                  <td className="py-2">{d.name}</td>
                  <td className={days > 7 ? "text-red-600" : ""}>{days} dias</td>
                  <td>{d.value ? `R$ ${d.value.toLocaleString("pt-BR")}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Modifica `StageList.tsx`** — adiciona estado e clique

Patch relevante no topo:
```tsx
import { useState } from "react";
import { DealsDrawer } from "./DealsDrawer";
```
Dentro do componente, antes do return:
```tsx
const [openStageId, setOpenStageId] = useState<string | null>(null);
const openStage = sorted.find(s => s.stage.id === openStageId);
```
Wrapping cada `StageBar` com botão:
```tsx
<button key={s.stage.id} onClick={() => setOpenStageId(s.stage.id)} className="w-full text-left">
  <StageBar ... />
</button>
```
E no final do JSX:
```tsx
{openStage && (
  <DealsDrawer
    stageName={openStage.stage.name}
    deals={openStage.deals}
    onClose={() => setOpenStageId(null)}
  />
)}
```

- [ ] **Step 3: Build + manual**

Run: `pnpm build && pnpm dev`
Verifica: clicar em etapa abre drawer com lista de deals; clicar fora fecha.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(funil): drill-down drawer with per-stage deals"
```

---

## Task 11: Offline banner + CSP headers + shared error UX

**Files:**
- Create: `components/shared/OfflineBanner.tsx`
- Modify: `next.config.mjs` (headers), `app/(dashboard)/layout.tsx`

- [ ] **Step 1: `components/shared/OfflineBanner.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener("online", on); addEventListener("offline", off);
    return () => { removeEventListener("online", on); removeEventListener("offline", off); };
  }, []);
  if (online) return null;
  return <div className="bg-amber-500 p-2 text-center text-sm text-white">Sem conexão — tentando reconectar…</div>;
}
```

- [ ] **Step 2: Inclui no layout do dashboard**

Modifica `app/(dashboard)/layout.tsx`:
```tsx
import { Header } from "@/components/shared/Header";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <><OfflineBanner /><Header /><main className="p-6">{children}</main></>;
}
```

- [ ] **Step 3: Security headers em `next.config.mjs`**

```js
const nextConfig = {
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};
export default nextConfig;
```

- [ ] **Step 4: Build + tests**

Run: `pnpm build && pnpm vitest run`
Expected: tudo OK.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: offline banner + security headers"
```

---

## Task 12: E2E (Playwright)

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/login-flow.spec.ts`

- [ ] **Step 1: `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 60_000 },
});
```

- [ ] **Step 2: `tests/e2e/login-flow.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL!;
const PASSWORD = process.env.E2E_PASSWORD!;

test("login → monitor → funil → logout", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/monitor/);

  await page.getByRole("link", { name: "Funil" }).click();
  await expect(page).toHaveURL(/\/funil/);

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 3: Adiciona script `test:e2e`**

```json
"scripts": {
  "test:e2e": "playwright test"
}
```

- [ ] **Step 4: Instala browsers do Playwright**

Run: `pnpm dlx playwright install chromium`

- [ ] **Step 5: Prepara `.env.local`** com `E2E_EMAIL` + `E2E_PASSWORD` de um user de teste.

- [ ] **Step 6: Roda E2E**

Run: `pnpm test:e2e`
Expected: 1 spec passando.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "test(e2e): login → monitor → funil golden path"
```

---

## Task 13: README + deploy na Vercel

**Files:**
- Create/Modify: `README.md`

- [ ] **Step 1: `README.md`**

```markdown
# Atendimento Dashboard

Monitor de conversas paradas + funil de leads para o time de atendimento.
Next.js 15 + Supabase + Data Crazy API.

## Dev

```bash
pnpm install
cp .env.local.example .env.local  # preenche as vars
pnpm user:create email senha      # cria primeiro usuário
pnpm dev
```

## Env vars

Veja `.env.local.example`.

## Testes

```bash
pnpm vitest run   # unit + integration
pnpm test:e2e     # e2e (requer dev server + user de teste)
```

## Deploy (Vercel)

1. `vercel link` → aponta pro projeto
2. Configura env vars no dashboard Vercel (as mesmas do `.env.local`)
3. `vercel --prod`

## Pipeline

Hardcoded em `PIPELINE_ID`. Mudar em: env var + Supabase.

## Som de alerta

Substituir `public/sounds/alert.mp3` por arquivo real de ~400ms.
```

- [ ] **Step 2: Deploy**

Run:
```bash
pnpm dlx vercel@latest login
pnpm dlx vercel@latest link
pnpm dlx vercel@latest env add DATACRAZY_TOKEN production
pnpm dlx vercel@latest env add PIPELINE_ID production
pnpm dlx vercel@latest env add NEXT_PUBLIC_SUPABASE_URL production
pnpm dlx vercel@latest env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
pnpm dlx vercel@latest env add SUPABASE_SERVICE_ROLE_KEY production
pnpm dlx vercel@latest --prod
```

- [ ] **Step 3: Substituir som placeholder**

Arquivo `public/sounds/alert.mp3` precisa ser um bipe real (~400ms). Sugestões:
- Gerar em https://onlinetonegenerator.com/ (800Hz, 400ms, export MP3)
- Ou baixar de https://pixabay.com/sound-effects/search/beep/
- Commit o arquivo: `git add public/sounds/alert.mp3 && git commit -m "chore: add real alert sound"`

- [ ] **Step 4: Smoke test na URL de produção**
  - Login OK?
  - `/monitor` carrega?
  - `/funil` carrega com preset default "30 dias"?
  - Som toca (após clicar "Ativar sons" e quando uma conversa vira vermelha)?
  - Header tem `X-Frame-Options: DENY` (checar via `curl -I`)?

- [ ] **Step 5: Final commit**

```bash
git add README.md && git commit -m "docs: README + deploy instructions"
```

---

## Done

Todos checkpoints passados: deploy em produção, 1–5 users conseguem logar, ambos painéis funcionam com dados reais do pipeline `d6635f08-506e-4504-8a4d-bb79b04c8b49`, polling + som funcionando.
