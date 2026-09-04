-- A second nudge to everyone this month's survey reached who has not answered.
--
-- The reminder RE-USES the original row and its token. Nothing new is inserted:
-- the response-rate denominator is the number of surveys DELIVERED, and nudging
-- someone is not another survey. A late answer therefore lands on the send it
-- belongs to, carrying the segment snapshot taken at send time, exactly as if
-- they had clicked the first email.

alter table public.nps_sends
  add column if not exists reminded_at       timestamptz,
  add column if not exists reminder_attempts int not null default 0,
  add column if not exists reminder_error    text;

-- Who is eligible: the survey actually reached them, they have not answered,
-- and we have not already nudged them. Test rows are excluded — they are
-- Melissa's own address and are filtered out of every metric anyway.
-- p_include_failed re-opens rows whose reminder was REJECTED (the same escape
-- hatch as nps_pending's retry flag), never rows whose reminder went out.
create or replace function public.nps_reminder_audience(
  p_secret text, p_period date, p_include_failed boolean default false
)
returns setof public.nps_sends
language plpgsql security definer set search_path = public as $$
begin
  perform public.nps_assert_job(p_secret);
  return query
  select * from public.nps_sends
   where period = p_period
     and status = 'sent'
     and responded_at is null
     and score is null
     and hs_company_id <> '__TEST__'
     and (reminder_attempts = 0 or (p_include_failed and reminder_error is not null))
   order by company_name;
end; $$;

-- Claim a reminder BEFORE its email is attempted, the same way the first send
-- claims its row. p_attempts is the count the caller saw when it built the
-- audience, so the update is a compare-and-set: a second run, or a second pass
-- of the same run, finds the count moved on and is refused. The claim is also
-- refused if the answer arrived in between — which is the whole point of asking
-- again at claim time rather than trusting the list.
create or replace function public.nps_claim_reminder(
  p_secret text, p_id uuid, p_attempts int
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  claimed int;
begin
  perform public.nps_assert_job(p_secret);
  update public.nps_sends
     set reminder_attempts = reminder_attempts + 1,
         reminded_at       = now(),
         reminder_error    = null
   where id = p_id
     and status = 'sent'
     and responded_at is null
     and reminder_attempts = p_attempts;
  get diagnostics claimed = row_count;
  return claimed > 0;
end; $$;

-- A claimed reminder that the transport then rejected. The attempt still counts
-- (so nothing re-sends by accident); the error is what ?remind=1&retry=1 looks
-- for, and what the failure shows up as if it is never retried.
create or replace function public.nps_mark_reminder_failed(
  p_secret text, p_id uuid, p_error text
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.nps_assert_job(p_secret);
  update public.nps_sends set reminder_error = p_error where id = p_id;
end; $$;

revoke all on function public.nps_reminder_audience(text, date, boolean)  from public;
revoke all on function public.nps_claim_reminder(text, uuid, int)         from public;
revoke all on function public.nps_mark_reminder_failed(text, uuid, text)  from public;

grant execute on function public.nps_reminder_audience(text, date, boolean) to anon, authenticated;
grant execute on function public.nps_claim_reminder(text, uuid, int)        to anon, authenticated;
grant execute on function public.nps_mark_reminder_failed(text, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
