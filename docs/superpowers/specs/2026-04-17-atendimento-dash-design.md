# Atendimento Dashboard — Design Spec

- **Date:** 2026-04-17
- **Status:** Draft
- **Owner:** Pedro Paulinetti

## 1. Problem

A equipe de atendimento da UOS trabalha em um pipeline específico (`d6635f08-506e-4504-8a4d-bb79b04c8b49`) dentro do CRM Data Crazy. Hoje não há visibilidade centralizada de duas coisas:

1. **Conversas paradas** — clientes que enviaram mensagem mas ainda não foram respondidos pelo time.
2. **Tempo dos leads no funil** — quantas pessoas estão em cada etapa e há quanto tempo estão paradas ali.

Supervisores precisam abrir o CRM e varrer manualmente, o que é lento e dá margem pra alertas passarem batido.

## 2. Goals / Non-goals

### Goals

- Publicar uma web app acessível via URL para 1–5 supervisores
- **Painel 1 (Monitor):** listar em tempo quase-real conversas onde o cliente foi o último a falar e há mais de 3 minutos sem resposta, com três níveis de severidade por tempo e alerta sonoro em casos críticos
- **Painel 2 (Funil):** mostrar contagem e tempo médio dos leads em cada etapa da pipeline, com filtro de período ajustável e drill-down por etapa
- Manter o token da API Data Crazy exclusivamente no servidor

### Non-goals

- Responder ou atuar nas conversas pelo dashboard (somente leitura)
- Suportar múltiplas pipelines (v1 só o pipeline fixo)
- Notificações além de som (sem email, webhook, push)
- Histórico/analytics retroativo além do que a API Data Crazy retorna
- Auto-cadastro de usuários ou roles/permissões granulares

## 3. Scope & constraints

### Pipeline alvo

- ID hardcoded em env var: `d6635f08-506e-4504-8a4d-bb79b04c8b49`
- O conjunto de etapas vem de `GET /api/v1/pipelines/{id}/stages`

### Usuários

- 1–5 supervisores, login individual
- Criação de usuários manual (via dashboard Supabase ou script admin)

### Integrações

- **Data Crazy API** (`https://api.g1.datacrazy.io/api/v1`) — Bearer JWT via env var
- **Supabase** — Auth + Postgres (tier grátis)
- **Vercel** — hosting do Next.js

### Dados que a API fornece (relevantes)

- `/conversations` — `lastReceivedMessageDate`, `lastSendedMessageDate`, `isGroup`, `currentDepartment`, `attendants[]`, `contact.externalInfo.pipelineIds/stageIds`
- `/businesses` — `stageId`, `lastMovedAt`, `status`, `createdAt`, `value`, `name`
- `/pipelines/{id}/stages` — lista de etapas do pipeline
- `/users` — resolve ID de atendente para nome

### Thresholds fixos (v1)

- **Monitor:** 3 min (verde-alerta), 10 min (amarelo), 30 min (vermelho com som)
- **Funil:** deal "parado" se `agora - lastMovedAt > 7 dias`
- **Polling:** Monitor 10s; Funil 30s

## 4. Architecture

Next.js 15 fullstack, deploy Vercel. Supabase para Auth + Postgres.

```
┌──────────────────────────────────────────────┐
│           Next.js 15 (App Router)            │
│                                              │
│  /app                                        │
│   ├─ /login         → Supabase Auth          │
│   ├─ /monitor       → Painel 1 (polling 10s) │
│   ├─ /funil         → Painel 2 (polling 30s) │
│   └─ /api                                    │
│       ├─ /auth/*    → Supabase callbacks     │
│       ├─ /conversations → proxy Data Crazy   │
│       ├─ /deals         → proxy Data Crazy   │
│       └─ /pipeline-stages                    │
│                                              │
│  Supabase (Auth + Postgres)                  │
│  DATACRAZY_TOKEN em env var (server-only)    │
└──────────────────────────────────────────────┘
                    │
                    ▼ HTTPS (Bearer token)
        api.g1.datacrazy.io/api/v1/*
```

### Stack

- **Framework:** Next.js 15 (App Router)
- **UI:** TailwindCSS + shadcn/ui
- **Data layer:** TanStack Query (polling + cache client-side)
- **Auth + DB:** Supabase (`@supabase/ssr`, `@supabase/supabase-js`)
- **Testes:** Vitest + MSW + Playwright
- **Deploy:** Vercel
- **Package manager:** pnpm

## 5. Authentication

- Login com email/senha via Supabase Auth
- Sessão por cookie httpOnly gerenciada pelo `@supabase/ssr`
- Middleware do Next.js valida sessão em todas as rotas exceto `/login` e `/api/auth/*`
- Usuários criados via script admin (`pnpm user:create email senha`) que chama `supabase.auth.admin.createUser`
- Sem roles — qualquer usuário logado vê tudo

## 6. API proxy layer

### Módulo `lib/datacrazy.ts` (server-only)

Funções tipadas com:
- Injeção automática do header `Authorization: Bearer ${DATACRAZY_TOKEN}`
- Timeout de 10s
- 1 retry em 5xx/429 (backoff 1s)
- Erros tipados (`DataCrazyError` com `code` — `UNAUTHORIZED`, `RATE_LIMIT`, `TIMEOUT`, `SERVER_ERROR`)

### Rotas internas

| Rota | Chamada upstream | Notas |
|---|---|---|
| `GET /api/conversations` | `GET /conversations?filter[stages]=<ids>&filter[opened]=true&take=200` | `filter[opened]=true` é a fonte canônica de "conversa aberta" (sem re-filtragem client-side); `stages` vêm do cache de pipeline |
| `GET /api/deals?from&to` | `GET /businesses?filter[status]=in_process&filter[createdAtGreaterOrEqual]=<from>&filter[createdAtLessOrEqual]=<to>&take=500` | pagina até 5 páginas (2500 deals), filtra em memória por `stageId ∈ pipeline` |
| `GET /api/pipeline-stages` | `GET /pipelines/{PIPELINE_ID}/stages` | cache em memória TTL 5min |

### Cache

- **Stages do pipeline:** memória, TTL 5 min
- **Users (para resolver nomes de atendentes):** memória, TTL 5 min
- **Conversations/deals:** sem cache no servidor

## 7. Painel 1 — Monitor de conversas paradas

### Rota: `/monitor`

### Algoritmo de severidade (server-side)

```
para cada conversa aberta do pipeline, isGroup=false:
  se lastReceivedMessageDate é null → level = "respondida" (oculta)
  se lastReceivedMessageDate > lastSendedMessageDate (ou lastSended null):
    minutos = (now - lastReceivedMessageDate) / 60s
    se minutos > 30: level = "vermelho"
    senão se minutos > 10: level = "amarelo"
    senão se minutos > 3: level = "verdeAlerta"
    senão: level = "ok" (oculta)
  senão:
    level = "respondida" (oculta)
```

O servidor retorna já com `level` e `minutosParada` calculados — cliente só renderiza. Isto evita bugs de clock drift no browser.

### UI

```
┌────────────────────────────────────────────────────────────┐
│  Atendimento — Monitor                [user@x.com] [sair] │
├────────────────────────────────────────────────────────────┤
│  [Monitor] [Funil]                                         │
├────────────────────────────────────────────────────────────┤
│  🔴 2 críticas    🟡 5 atenção    🟢 3 verde-alerta       │
│                              Última atualização: 14:22:31  │
├────────────────────────────────────────────────────────────┤
│  🔴  João Silva        38 min sem resposta    Ana — Vendas │
│  🔴  Maria Costa       31 min sem resposta    Pedro — Vendas│
│  🟡  Carlos Lima       14 min sem resposta    Ana — Vendas │
│  ...                                                       │
└────────────────────────────────────────────────────────────┘
```

- Ordenado por `minutosParada` descendente
- Oculta `ok` e `respondida`
- Não clicável (somente visual — time age direto no CRM)

### Polling e som

- TanStack Query `refetchInterval: 10000`
- Client mantém `Set<conversationId>` das que já estão em `vermelho`
- Transição `!vermelho → vermelho` dispara `new Audio('/sounds/alert.mp3').play()`
- Toggle de mute no header (persistido em `localStorage`, default: som ligado)
- Primeiro render: banner "Clique pra ativar sons" até primeira interação do usuário (autoplay policy)

### Resolução de nomes

- `attendants[0].id` → `/api/v1/users` (cache 5 min)
- `currentDepartment.name` já vem na conversa

### Estados de UI

- Loading inicial: skeleton
- Erro: banner "Atualização falhou, tentando em 10s" — mantém última lista
- Lista vazia: ilustração + "Nenhuma conversa precisa de atenção"

## 8. Painel 2 — Funil

### Rota: `/funil`

### Pipeline de dados (server)

1. Carrega stages do pipeline (cache 5 min)
2. `GET /businesses` com filtros de data + `status=in_process`
3. Paginação até 5 páginas (2500 deals max; warning se estourar)
4. Filtra em memória: `stageId ∈ stages do pipeline`
5. Agrupa por `stageId` e computa métricas

### Métricas por etapa

- **count** — número de deals
- **avgTimeInStageMs** — média de `now - lastMovedAt` (usa `createdAt` como fallback se `lastMovedAt` for null)
- **stuckCount** — deals com `now - lastMovedAt > 7 dias`

### UI

```
┌──────────────────────────────────────────────────────────┐
│  [Monitor] [Funil]                                       │
├──────────────────────────────────────────────────────────┤
│  Período: [Hoje▾] [7 dias] [Mês] [Custom]    47 leads   │
├──────────────────────────────────────────────────────────┤
│  ┌─ Qualificação ──────────────┐  18 leads               │
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  Tempo médio: 2d 4h     │
│  └─────────────────────────────┘                         │
│                                                          │
│  ┌─ Proposta ──────────────────┐  12 leads               │
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓          │  Tempo médio: 4d 12h    │
│  └─────────────────────────────┘                         │
│                                                          │
│  ┌─ Negociação ────────────────┐  9 leads    ⚠ 3 parados│
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓                │  Tempo médio: 8d 3h     │
│  └─────────────────────────────┘                         │
│                                                          │
│  [▼ Expandir etapa]                                      │
└──────────────────────────────────────────────────────────┘
```

### Filtro de data

- Componente shadcn `DateRangePicker`
- Atalhos: Hoje / Últimos 7 dias / Mês corrente / Custom
- Default: **Últimos 30 dias**
- Estado serializado na URL (`?from=...&to=...`) — compartilhável e persistente a reload

### Drill-down por etapa

Clicando numa etapa, expande tabela dos deals:

| Nome | Tempo na etapa | Criado em | Valor |
|---|---|---|---|
| João Silva | 12 dias | 2026-03-20 | R$ 4.200 |
| Maria Costa | 3 dias | 2026-04-10 | R$ 2.800 |

### Polling

- `refetchInterval: 30000` (funil muda devagar)
- Sem som, sem animação de alerta

## 9. Error handling & edge cases

| Camada | Falha | Comportamento |
|---|---|---|
| Supabase | sessão expirada | redirect `/login?from=<rota>` |
| Data Crazy 401 | token inválido | banner "Token Data Crazy inválido — contate o admin"; log server |
| Data Crazy 429 | rate limit | 1 retry em 1s; se falhar, mantém dado anterior + toast |
| Data Crazy 5xx / timeout | instabilidade | mantém último snapshot; header exibe "Tentando reconectar…" |
| Navegador offline | `navigator.onLine=false` | pausa polling; banner "Sem conexão" |

### Edge cases tratados

1. Conversa sem `lastReceivedMessageDate` → nunca entra como "parada"
2. Conversa com `isGroup: true` → ignorada no Painel 1
3. Deal sem `lastMovedAt` → usa `createdAt` como fallback
4. Pipeline sem etapas → "Pipeline sem etapas configuradas"
5. `> 500` deals: paginação server-side, max 5 páginas, warning se atingir teto
6. Cálculo de tempo é server-side, protege contra clock drift do cliente
7. Atendente deletado (ID não resolve) → mostra "Atendente removido"
8a. Conversa sem atendente (`attendants` vazio) → mostra "Sem atendente" (ainda aparece na lista se atingir o threshold)
8. Autoplay policy bloqueia som → banner "Clique pra ativar sons"

## 10. Security

- `DATACRAZY_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` só em env vars server
- Headers default: `X-Frame-Options: DENY`, CSP básica
- Todas as rotas `/api/*` (exceto `/api/auth/*`) checam sessão Supabase
- Sem CORS aberto — apenas origem própria

## 11. Testing

### Filosofia

Focar em lógica de negócio que pode quebrar silenciosamente. Sem testes de renderização visual.

### Unit (Vitest)

- `computeAlertLevel({ lastReceivedMessageDate, lastSendedMessageDate, now })` — fronteiras 3/10/30 min, casos nulos
- `groupDealsByStage(deals, stages)`
- `computeStageMetrics(deals, now)` — fronteira de 7 dias para stuck
- `resolveDateRangePreset("today"|"week"|"month")`

### Integration (Vitest + MSW)

Mock de `api.g1.datacrazy.io`:
- `/api/conversations` retorna lista filtrada corretamente
- DC 401 → nosso endpoint retorna 503
- Sem sessão Supabase → 401
- `/api/deals` agrega multi-página
- `/api/deals` no teto de 5 páginas emite warning no log (edge case #5 da Seção 9)

### E2E (Playwright, 1 fluxo)

1. Login com usuário de teste (Supabase local)
2. `/monitor` mostra dados mockados
3. Navega `/funil`, vê barras
4. Logout → volta pro login

### Não testado

- Visual regression (Storybook, Chromatic)
- Internal do Supabase Auth
- Som (frágil em CI)

### Execução

- `pnpm test` — Vitest
- `pnpm test:e2e` — Playwright + Supabase local
- CI: `test` em PR; `test:e2e` em merge pra main

## 12. Environment variables

```
# Server-only
DATACRAZY_TOKEN=dc_eyJhbGciOi...   # JWT da API Data Crazy
PIPELINE_ID=d6635f08-506e-4504-8a4d-bb79b04c8b49
SUPABASE_SERVICE_ROLE_KEY=...       # para criação de usuários via script

# Público (NEXT_PUBLIC_)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## 13. Open questions

Nenhuma no momento. Thresholds, polling intervals, pipeline ID, escopo de painéis, stack e hosting estão todos definidos.

## 14. Future considerations (out of scope for v1)

- Suporte a múltiplas pipelines (dropdown)
- Notificações push / email / webhook (Slack)
- Histórico de alertas (log de quando cada conversa entrou em vermelho)
- Métricas agregadas por atendente (tempo médio de resposta)
- Thresholds configuráveis por usuário
- Modo "monitor de parede" (tela cheia, sem header)
