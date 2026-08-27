-- Forecasting tab: versioned projections, per-account inputs, and tab settings.
--
-- The existing forecast-deals / forecast-expansion stores are a single Netlify
-- Blobs map that is overwritten in place. That cannot answer "what did this AM
-- commit for August, and when did they change it" — so projections live here
-- instead, append-only.

-- One row per commitment. NEVER updated: a revision is a new row, and the
-- current value is the newest row for (company, period, metric, kind). The
-- prior values stay as the record of what was committed and by whom.
create table if not exists public.fc_projections (
  id             uuid primary key default gen_random_uuid(),
  hs_company_id  text not null,
  period         date not null,                       -- first day of the month
  metric         text not null check (metric in ('mrr_delta', 'rev_share')),
  kind           text not null default 'projected' check (kind in ('projected', 'actual')),
  amount         numeric not null,
  -- "What must be true" to hit this number, attached to THIS month's projection
  -- rather than to the account, so the per-month record survives.
  note           text,
  created_by     text,
  created_at     timestamptz not null default now(),
  -- A negative projection is a contraction or churn call and must say why.
  constraint fc_projections_negative_needs_note
    check (amount >= 0 or (note is not null and length(btrim(note)) > 0))
);
create index if not exists fc_projections_lookup_idx
  on public.fc_projections (hs_company_id, period, metric, kind, created_at desc);
create index if not exists fc_projections_period_idx on public.fc_projections (period);

-- Per-account inputs behind the Inputs panel. Small and edited in place; the
-- audit trail that matters is on the projections above.
create table if not exists public.fc_account_inputs (
  hs_company_id   text primary key,
  acv             numeric,        -- the client's average contract value
  close_rate      numeric,        -- the CLIENT's own pre-Virio historical close rate, %
  hours_per_week  numeric,        -- AM's estimate of hours spent per week
  notes           text,           -- how the expansion plan gets hit, or why churn is likely
  updated_by      text,
  updated_at      timestamptz not null default now()
);

-- Tab settings that were left open on the call: the hours-vs-MRR flag threshold,
-- monthly/quarterly view, and the update cadence. Configurable so they can be
-- set once decided rather than shipped hardcoded.
create table if not exists public.fc_settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table public.fc_projections     enable row level security;
alter table public.fc_account_inputs  enable row level security;
alter table public.fc_settings        enable row level security;

drop policy if exists fc_projections_virio on public.fc_projections;
create policy fc_projections_virio on public.fc_projections
  for all to authenticated
  using ((auth.jwt() ->> 'email') like '%@virio.ai')
  with check ((auth.jwt() ->> 'email') like '%@virio.ai');

drop policy if exists fc_account_inputs_virio on public.fc_account_inputs;
create policy fc_account_inputs_virio on public.fc_account_inputs
  for all to authenticated
  using ((auth.jwt() ->> 'email') like '%@virio.ai')
  with check ((auth.jwt() ->> 'email') like '%@virio.ai');

drop policy if exists fc_settings_virio on public.fc_settings;
create policy fc_settings_virio on public.fc_settings
  for all to authenticated
  using ((auth.jwt() ->> 'email') like '%@virio.ai')
  with check ((auth.jwt() ->> 'email') like '%@virio.ai');

notify pgrst, 'reload schema';
