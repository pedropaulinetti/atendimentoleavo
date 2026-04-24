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
