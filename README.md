# Atendimento Dashboard

Dashboard pro time de atendimento da UOS. Dois painéis:

- **Monitor** — lista conversas do pipeline onde o cliente foi o último a falar e passou de 3/10/30 min sem resposta. Atualiza a cada 10s, bipe ao virar vermelho.
- **Funil** — quantos leads em cada etapa + tempo médio + destaque pra deals parados > 7 dias. Atualiza a cada 30s.
- **Dashboard** — tendência das métricas do Monitor e do Funil ao longo do tempo (24h / 7d / 30d / 90d). Snapshots automáticos a cada 15 min via Vercel Cron, retidos por 90 dias (pruning semanal domingo 03:00 UTC).

Stack: Next.js 15 + TypeScript + Tailwind + shadcn/ui + Supabase (auth) + TanStack Query + Vitest/MSW/Playwright.

## Pré-requisitos

- Node 20+
- `pnpm` (instala via `curl -fsSL https://get.pnpm.io/install.sh | sh -`)
- Conta no [Supabase](https://supabase.com) (grátis)
- Token da API Data Crazy
- Conta na [Vercel](https://vercel.com) pra deploy

## Setup local

```bash
pnpm install
cp .env.local.example .env.local
# abra .env.local e preencha as vars (veja seção abaixo)
pnpm user:create seu@email.com suaSenha   # cria primeiro usuário
pnpm dev
```

Abra http://localhost:3000 → redireciona pra `/login` → entra com o usuário criado → vê `/monitor`.

## Variáveis de ambiente

```
DATACRAZY_TOKEN=dc_...                         # JWT da API Data Crazy
PIPELINE_ID=d6635f08-506e-4504-8a4d-bb79b04c8b49  # Pipeline alvo (hardcoded)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...               # Usada por scripts admin + cron endpoints (nunca exposta no cliente; NUNCA prefixar com NEXT_PUBLIC_)
CRON_SECRET=<hex-32>                           # Valida requests do Vercel Cron. Gerar: openssl rand -hex 32
```

- `SUPABASE_URL` e `ANON_KEY`: dashboard Supabase → Project Settings → API
- `SERVICE_ROLE_KEY`: mesma tela, **rotacione se vazar** — dá acesso total ao banco

- `INTERCOM_ENABLED=true` liga a fonte Intercom no Monitor. Se `false` ou ausente, Intercom é ignorado silenciosamente.
- `INTERCOM_TOKEN`: Access Token em Intercom → Settings → Developer Hub → seu app → Authentication.
- `INTERCOM_WORKSPACE_ID`: app_id do workspace, usado pra montar os deep-links.
- `INTERCOM_BOT_ADMIN_IDS`: opcional, lista separada por vírgula dos admin IDs que são bot/Fin. Se vazio, tenta detectar pelos nomes em `/admins`.

## Testes

```bash
pnpm vitest run         # unit + integration (25 testes)
pnpm test:e2e           # end-to-end (Playwright, requer E2E_EMAIL + E2E_PASSWORD em .env.local)
```

## Deploy (Vercel)

```bash
pnpm dlx vercel@latest login
pnpm dlx vercel@latest link
# Adicione as env vars no dashboard da Vercel (ou via CLI):
pnpm dlx vercel@latest env add DATACRAZY_TOKEN production
pnpm dlx vercel@latest env add PIPELINE_ID production
pnpm dlx vercel@latest env add NEXT_PUBLIC_SUPABASE_URL production
pnpm dlx vercel@latest env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
pnpm dlx vercel@latest env add SUPABASE_SERVICE_ROLE_KEY production
pnpm dlx vercel@latest env add CRON_SECRET production
pnpm dlx vercel@latest --prod
```

### Dashboard de métricas — setup inicial

Antes do primeiro deploy com histórico:

1. **Aplicar migration no Supabase**: copiar o SQL em [supabase/migrations/20260424120000_metrics_snapshots.sql](supabase/migrations/20260424120000_metrics_snapshots.sql) e executar no Supabase → SQL Editor. Cria as tabelas `monitor_snapshots` e `funil_snapshots` com RLS habilitada (select liberado pra `authenticated`, escrita só pelo service role).
2. **Setar `CRON_SECRET`** na Vercel (Production env). `SUPABASE_SERVICE_ROLE_KEY` também precisa existir em Production — antes era só usada por script CLI, agora é dependência de runtime dos endpoints de cron.
3. **`vercel.json`** no repo já configura 2 crons: snapshot a cada 15 min, pruning semanal.
4. A página `/dashboard` fica vazia até o primeiro snapshot rodar (~15 min depois do deploy).

Depois do primeiro deploy, volte no Supabase → Authentication → URL Configuration e adicione a URL da Vercel em "Redirect URLs".

## ⚠ Som de alerta

`public/sounds/alert.mp3` é um **placeholder vazio**. Substitua por um bipe real (~400ms) antes de prod:
- [Online Tone Generator](https://onlinetonegenerator.com/) — 800Hz, 400ms, export MP3
- Ou [pixabay.com/sound-effects/search/beep/](https://pixabay.com/sound-effects/search/beep/)

```bash
# Depois de baixar:
mv ~/Downloads/beep.mp3 public/sounds/alert.mp3
git add public/sounds/alert.mp3
git commit -m "chore: add real alert sound"
```

## Estrutura

```
app/
  (dashboard)/
    layout.tsx           Header + OfflineBanner
    monitor/page.tsx     Painel 1
    funil/page.tsx       Painel 2
  login/                 Supabase Auth
  api/
    conversations/       proxy DC + severity calculation
    deals/               proxy DC + pagination + metrics
    pipeline-stages/     stages cache (5min TTL)
components/              shadcn + app-specific
lib/
  datacrazy/             API client + types + cache
  monitor/               computeAlertLevel
  funil/                 metrics + date presets
  supabase/              SSR clients + middleware
tests/                   Vitest + MSW + Playwright
docs/                    Specs e planos
scripts/create-user.ts   Admin user creation
```

## Configuração além do código (one-time)

Thresholds estão hardcoded em `lib/monitor/severity.ts` (3/10/30 min) e `lib/funil/metrics.ts` (stuck > 7 dias). Mudar no código + PR.

Pipeline é lido de `PIPELINE_ID`. Trocar = trocar env var em todos os ambientes.
