-- NPS surveys: one row per person we intended to survey, per month.
--
-- The row is written when the monthly job RUNS, not when someone replies, so the
-- response-rate denominator is a fact rather than a guess. Accounts we could not
-- survey get a row too (status 'skipped_no_foc' / 'skipped_no_email') — that is
-- what makes the coverage gap visible in the tab instead of silently flattering
-- the response rate.
--
-- Segments (product, vertical, stage, pilot_status, am, mrr) are SNAPSHOT at send
-- time and never rewritten. An account that converts in October must not
-- retroactively turn its September pilot-stage score into a converted score —
-- same reasoning as fc_projections being append-only.

create table if not exists public.nps_sends (
  id             uuid primary key default gen_random_uuid(),
  period         date not null,                    -- first day of the survey month
  hs_company_id  text not null,
  company_name   text,
  hs_contact_id  text,                             -- null when nobody was surveyable
  contact_email  text,
  contact_name   text,

  -- Segment snapshot, taken from HubSpot at send time.
  product        text,                             -- 'EGC' | 'Full Service' (tierOf)
  vertical       text,
  stage          text,
  pilot_status   text,
  am             text,
  mrr            numeric,

  -- 'pending' is written BEFORE the email leaves, so a job that dies mid-run
  -- leaves an observable stuck row rather than silently re-sending on retry.
  -- Duplicating a survey to a client is worse than missing one, so the row is
  -- always claimed first and promoted to 'sent' only once Resend accepts it.
  status         text not null check (status in (
                   'pending', 'sent', 'failed', 'skipped_no_foc', 'skipped_no_email')),
  send_error     text,
  token          text unique,                      -- unguessable; only on sendable rows
  sent_at        timestamptz,

  score          int check (score between 0 and 10),
  comment        text,
  responded_at   timestamptz,                      -- first response; never overwritten

  created_at     timestamptz not null default now(),

  -- A row that claims a score must have been a real send.
  constraint nps_sends_score_needs_send
    check (score is null or status = 'sent'),
  -- 'skipped_no_foc' means nobody on the account is labelled, so there is no
  -- contact to point at. 'skipped_no_email' DOES know who the Face of Content
  -- is — it keeps the contact id, both so the gap panel can name the person and
  -- so two email-less FOCs at one company stay distinct rows under the unique
  -- index below (they would otherwise both key on an empty contact and collide).
  constraint nps_sends_no_foc_has_no_contact
    check (status <> 'skipped_no_foc' or hs_contact_id is null)
);

-- Idempotency: re-running the monthly job must never double-send. The generated
-- column exists because a unique index on an expression cannot be an upsert target.
alter table public.nps_sends
  add column if not exists contact_key text
  generated always as (coalesce(hs_contact_id, '')) stored;

create unique index if not exists nps_sends_period_company_contact_idx
  on public.nps_sends (period, hs_company_id, contact_key);
create index if not exists nps_sends_period_idx on public.nps_sends (period desc);
create index if not exists nps_sends_company_idx on public.nps_sends (hs_company_id);

-- Same access rule as portfolio_focs, pr_requests and fc_projections: any
-- signed-in Virio account reads and writes. Respondents are NOT authenticated —
-- their score arrives through the nps-respond function on the service role key,
-- so no anon policy is granted here.
alter table public.nps_sends enable row level security;

drop policy if exists nps_sends_virio on public.nps_sends;
create policy nps_sends_virio on public.nps_sends
  for all to authenticated
  using       ((auth.jwt() ->> 'email') like '%@virio.ai')
  with check  ((auth.jwt() ->> 'email') like '%@virio.ai');

notify pgrst, 'reload schema';
