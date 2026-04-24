# Métricas Históricas — Fase 1 (MVP) — Design Spec

- **Date:** 2026-04-24
- **Status:** Draft
- **Owner:** Pedro Paulinetti

## 1. Problem

O dashboard atual (Monitor e Funil) é 100% live: cada carregamento da página busca dados da Data Crazy API e calcula métricas on-the-fly. Nada é persistido. Consequências:

- Não é possível ver **tendência** das métricas ao longo do tempo (ex: "o tempo médio de espera subiu ou caiu esta semana?").
- Não é possível fazer **consulta pontual no passado** ("quantas críticas tinha ontem às 15h?").
- Não é possível gerar **relatórios** de período.

Esta spec cobre apenas a Fase 1 do plano maior de historização. Fases 2 e 3 são spec-ed separadamente.

## 2. Goals / Non-goals

### Goals

- Persistir periodicamente as métricas **que já existem hoje** nas telas Monitor e Funil em uma base Postgres (Supabase).
- Expor uma nova página `/historico` com gráficos de tendência para janelas de 24h / 7d / 30d / 90d.
- Reusar a lógica de cálculo que já existe nas rotas `/api/conversations` e `/api/deals` — zero duplicação.
- Persistir apenas agregados; zero PII adicional além do que já trafega no request live.
- Retenção automática de 90 dias (pruning semanal).

### Non-goals (Fase 1)

- Métricas novas que exigem chamadas adicionais à Data Crazy (tempo de primeira resposta, SLA, produtividade por atendente, taxa de conversão por etapa, valor em pipeline por etapa). **→ Fase 2.**
- Exportação Excel/PDF. **→ Fase 3.**
- Seletor de data arbitrária (date picker), gráficos customizados por usuário. **→ Fase 3.**
- Drill-down de snapshot para a lista de conversas/deals que compunham aquele momento. **→ Fase 3.**
- Embutir gráfico de tendência dentro das páginas `/monitor` e `/funil` — elas continuam dedicadas à visão live.
- Alerta sobre mudança de tendência (ex: "média subiu X%").

## 3. Scope & constraints

### Deploy target

Vercel (conforme README atual). Vercel Cron Jobs usado como trigger (2 crons disponíveis no plano Hobby, ambos consumidos por esta feature: snapshot + pruning).

### Granularidade

Snapshot a cada **15 minutos** → ~96 snapshots/dia por origem (Monitor e Funil) → ~192 linhas/dia no total → ~17.000 linhas em 90 dias. Trivial pro Postgres.

### Retenção

**90 dias**, suportando o range máximo da tela (90d). Pruning semanal roda domingo 03:00 UTC.

### Janela do snapshot do Funil

Snapshot não filtra por data (diferente de `/api/deals` que exige `from/to`). Captura **o estado do pipeline naquele instante** — todos os deals `in_process`. A UI live continua aceitando filtro arbitrário; a captura histórica é sempre "agora".

### Autenticação

- Cron endpoints: header `Authorization: Bearer $CRON_SECRET`.
- `/api/metrics/history`: usuário autenticado (mesmo padrão das rotas existentes).
- Página `/historico`: protegida pelo `middleware.ts` já existente.

## 4. Data model

Duas tabelas novas em Supabase, via migration SQL versionada em `supabase/migrations/`.

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
  by_department jsonb not null  -- [{ name, color, count }, ...]
);
create index on monitor_snapshots (captured_at desc);

create table funil_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default now(),
  total_deals int not null,
  total_stuck int not null,
  avg_stage_days numeric(8,2) not null,
  active_stages int not null,
  stages jsonb not null  -- [{ id, name, index, count, avgMs, stuck }, ...]
);
create index on funil_snapshots (captured_at desc);
```

**Por que JSONB pra `by_department` e `stages`:** o conjunto é variável (Data Crazy pode adicionar/renomear) e a consulta dos gráficos é sempre série temporal com N buckets pequenos. Tabelas filhas não trariam ganho e aumentariam complexidade.

**RLS:**
- `select` permitido a `authenticated`.
- `insert` / `update` / `delete` bloqueados pra qualquer role que não seja `service_role`. Escrita vem exclusivamente dos cron endpoints usando service role.

## 5. Architecture

```
Vercel Cron (15min)         Vercel Cron (semanal)
      │                            │
      ▼                            ▼
POST /api/cron/            POST /api/cron/
  snapshot-metrics           prune-metrics
      │                            │
      ▼                            ▼
captureMonitorSnapshot()   DELETE ... WHERE
captureFunilSnapshot()     captured_at < now() - 90d
      │
      │   (reusadas também por
      │    /api/conversations e
      │    /api/deals)
      ▼
Data Crazy API  ─→  computa agregados  ─→  INSERT em Supabase
```

```
UI: /historico
  │
  ▼
GET /api/metrics/history?source=monitor|funil&range=24h|7d|30d|90d
  │
  ▼
Supabase SELECT + downsampling server-side (≤200 pontos)
  │
  ▼
shadcn/ui charts (recharts) renderiza line charts
```

## 6. Code layout

**Novos arquivos:**

```
supabase/migrations/
  20260424120000_metrics_snapshots.sql    # cria tabelas, índices, RLS

lib/monitor/
  snapshot.ts                              # captureMonitorSnapshot(): Promise<MonitorSnapshot>

lib/funil/
  snapshot.ts                              # captureFunilSnapshot(opts?: {from, to}): Promise<FunilSnapshot>

lib/metrics/
  downsample.ts                            # downsample(points, targetCount) — bucket by time

app/api/cron/
  snapshot-metrics/route.ts                # GET, valida CRON_SECRET, chama os 2 capture, insere 2 rows
  prune-metrics/route.ts                   # GET, valida CRON_SECRET, deleta > 90d

app/api/metrics/
  history/route.ts                         # GET ?source=&range=, retorna points downsampled

app/(dashboard)/historico/
  page.tsx                                 # Página com range toggle + charts

components/historico/
  RangeToggle.tsx                          # 24h / 7d / 30d / 90d
  MonitorTrendChart.tsx                    # chart empilhado críticas/atenção/verde
  MonitorTimingCharts.tsx                  # tempo médio + maior espera (2 charts lado a lado)
  FunilTrendChart.tsx                      # leads total over time
  FunilDetailCharts.tsx                    # stuck + avg days

components/ui/
  chart.tsx                                # componente shadcn/ui chart (scaffolded)

vercel.json                                # crons config
```

**Arquivos modificados:**

```
app/api/conversations/route.ts             # refatora pra usar captureMonitorSnapshot()
app/api/deals/route.ts                     # refatora pra usar captureFunilSnapshot({from, to})
components/shared/HeaderNav.tsx            # adiciona link "Histórico"
package.json                               # adiciona recharts
.env.local.example                         # documenta CRON_SECRET
README.md                                  # documenta nova página, cron, env vars
```

## 7. Key interfaces

```ts
// lib/monitor/snapshot.ts
export interface MonitorSnapshot {
  total: number;
  countRed: number;
  countYellow: number;
  countGreen: number;
  avgMinutos: number;
  maxMinutos: number;
  byDepartment: Array<{ name: string; color: string; count: number }>;
}
export async function captureMonitorSnapshot(): Promise<MonitorSnapshot>;

// lib/funil/snapshot.ts
export interface FunilStageSnapshot {
  id: string; name: string; index: number;
  count: number; avgMs: number; stuck: number;
}
export interface FunilSnapshot {
  totalDeals: number;
  totalStuck: number;
  avgStageDays: number;
  activeStages: number;
  stages: FunilStageSnapshot[];
}
export async function captureFunilSnapshot(
  opts?: { from: string; to: string }
): Promise<FunilSnapshot>;

// /api/metrics/history response
interface HistoryResponse {
  points: Array<{
    capturedAt: string;  // ISO
    // monitor fields if source=monitor, funil fields if source=funil
    [key: string]: unknown;
  }>;
  downsampled: boolean;
  sourceCount: number;  // quantos snapshots reais agregaram
}
```

## 8. Downsampling

Alvo fixo de **≤200 pontos** no response. Regra por range:

| Range | Pontos nativos | Bucket   | Pontos retornados |
|-------|----------------|----------|-------------------|
| 24h   | ~96            | nativo   | ~96               |
| 7d    | ~672           | 1h       | ~168              |
| 30d   | ~2.880         | 4h       | ~180              |
| 90d   | ~8.640         | 24h      | 90                |

Agregação dentro do bucket:
- Contadores (`total`, `countRed`, `countStuck`, etc): **média** do bucket.
- Tempos (`avgMinutos`, `avgStageDays`): **média**.
- Máximos (`maxMinutos`): **máximo do bucket**.
- `byDepartment` / `stages` (JSONB): usa o **último** snapshot do bucket (simplificação aceita pra MVP).

## 9. Error handling

- **Data Crazy falha no cron snapshot:** endpoint retorna 503. Nenhuma linha inserida. Vercel loga como cron falho. Resultado: gap de 15 min no gráfico. Preferível a dado errado.
- **Supabase insert falha:** endpoint retorna 500, mesma consequência.
- **Range inválido em `/api/metrics/history`:** 400.
- **Source inválido:** 400.
- **Sem snapshots no range** (ex: pós-deploy recente): endpoint retorna `{ points: [], downsampled: false, sourceCount: 0 }`. UI mostra card "Histórico começando a ser coletado, volte em ~15 min".

## 10. Testing strategy

Vitest + MSW, mesmo padrão de `tests/api/*.test.ts` existentes.

- `tests/lib/monitor-snapshot.test.ts` — `captureMonitorSnapshot()` com mock Data Crazy; valida cálculo.
- `tests/lib/funil-snapshot.test.ts` — `captureFunilSnapshot()` com e sem filtro de data.
- `tests/lib/downsample.test.ts` — função pura: buckets corretos, média correta, max correto, ≤200 pontos.
- `tests/api/cron-snapshot.test.ts` — rejeita sem CRON_SECRET; insere ambas tabelas; não insere se DC falha.
- `tests/api/cron-prune.test.ts` — rejeita sem CRON_SECRET; deleta só linhas > 90d.
- `tests/api/metrics-history.test.ts` — valida source/range, retorna array vazio sem crash, auth.
- **Refatoração** das rotas `/api/conversations` e `/api/deals`: testes existentes continuam passando (viram teste de integração lib + rota).

Página `/historico` validada manualmente com `pnpm dev` depois de rodar o cron localmente via curl (sem teste RTL de recharts por custo/benefício).

## 11. Configuration

**Env vars novas:**

```
CRON_SECRET=<random 32 bytes>         # valida requests do Vercel Cron
# SUPABASE_SERVICE_ROLE_KEY já existe — agora também usada pelo cron
```

`.env.local.example` atualizado. README atualizado explicando como gerar.

**`vercel.json`:**

```json
{
  "crons": [
    { "path": "/api/cron/snapshot-metrics", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/prune-metrics",    "schedule": "0 3 * * 0" }
  ]
}
```

**Migration:** aplicada via `supabase db push` (CLI) ou painel Supabase SQL Editor.

## 12. UI — página `/historico`

Rota: `app/(dashboard)/historico/page.tsx`. Protegida pelo middleware existente.

Layout:

- Título + subtítulo.
- Toggle de range (`RangeToggle`): 24h / 7d / 30d / 90d. Estado mantido em query param `?range=7d`.
- Seção **Monitor**:
  - `MonitorTrendChart`: area chart empilhado (críticas vermelho, atenção âmbar, verde).
  - `MonitorTimingCharts`: grid 2 colunas com line chart de `avgMinutos` e `maxMinutos`.
- Seção **Funil**:
  - `FunilTrendChart`: line chart de `totalDeals`.
  - `FunilDetailCharts`: grid 2 colunas com `totalStuck` e `avgStageDays`.

Estado vazio (nenhum snapshot no range): Card centralizado com mensagem explicativa.

Link "Histórico" adicionado no `HeaderNav` entre Monitor e Funil.

## 13. Risks / open questions

1. **Schema drift da Data Crazy** — se renomearem campos de departamento/stage, snapshots antigos ficam com nomes órfãos. Aceito pra MVP; documentar como known issue.
2. **Cron miss** — se Vercel não disparar o cron (instabilidade, deploy rolling), aparece gap de 15 min no gráfico. Aceitável.
3. **Timezone** — `captured_at` sempre UTC; render no cliente em `America/Sao_Paulo`. Testar em edge cases de DST quando rolar (Brasil não usa mais, baixo risco).
4. **Vercel Hobby plan limita 2 crons** — exatamente os 2 que estamos usando. Se a Fase 2 adicionar mais crons, precisaremos avaliar Pro plan ou consolidar.
5. **Downsampling agregado por "último do bucket" em campos JSONB** — perde resolução em dias com grandes mudanças de departamento. Aceito pra MVP; pode virar "agregação de distribuição" na Fase 3 se necessário.

## 14. Out of scope (reafirmando)

- Fase 2: métricas novas (primeira resposta, SLA, produtividade, conversão, pipeline value).
- Fase 3: date picker arbitrário, exportação Excel/PDF, drill-down de snapshot.
- Alertas automáticos sobre tendências.
- Snapshot com identidade (deal_id, conversation_id) — só agregados.
