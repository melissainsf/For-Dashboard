-- Product Request Tracker schema.
--
-- The tracker UI (Product Request Tracker tab in index.html) and its
-- `pr-ask-images` storage bucket shipped without these two tables, so every
-- save failed with:
--   Could not find the table 'public.pr_requests' in the schema cache
--
-- One request (a feature ask or a bug) has many customer "asks" — one row per
-- customer who reported it, carrying that customer's detail and screenshots.

create table if not exists public.pr_requests (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  type         text not null default 'feature' check (type in ('feature', 'bug')),
  severity     text check (severity in ('Urgent', 'High', 'Medium', 'Low')),
  status       text not null default 'open' check (status in ('open', 'shipped')),
  shipped_date date,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.pr_asks (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.pr_requests(id) on delete cascade,
  hs_company_id text not null,                  -- HubSpot company id
  company_name  text,
  product       text,
  detail        text,
  source        text not null default 'manual',
  images        text[] not null default '{}',   -- paths in the pr-ask-images bucket
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists pr_asks_request_id_idx on public.pr_asks (request_id);
create index if not exists pr_requests_status_idx on public.pr_requests (status);

-- Same access rule as portfolio_focs and the pr-ask-images bucket:
-- any signed-in Virio account can read and write.
alter table public.pr_requests enable row level security;
alter table public.pr_asks     enable row level security;

drop policy if exists pr_requests_virio on public.pr_requests;
create policy pr_requests_virio on public.pr_requests
  for all to authenticated
  using       ((auth.jwt() ->> 'email') like '%@virio.ai')
  with check  ((auth.jwt() ->> 'email') like '%@virio.ai');

drop policy if exists pr_asks_virio on public.pr_asks;
create policy pr_asks_virio on public.pr_asks
  for all to authenticated
  using       ((auth.jwt() ->> 'email') like '%@virio.ai')
  with check  ((auth.jwt() ->> 'email') like '%@virio.ai');

notify pgrst, 'reload schema';
