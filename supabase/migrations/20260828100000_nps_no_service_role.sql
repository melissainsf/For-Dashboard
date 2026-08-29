-- Remove the need for a Supabase service-role key.
--
-- The survey link is clicked by a client who is not signed in, so that write
-- cannot go through the dashboard's "authenticated @virio.ai" RLS policy. The
-- first cut reached for the service-role key, which bypasses RLS entirely and
-- would have been the first full-access database credential in Netlify. Emmett
-- (CTO) declined it, correctly.
--
-- Instead, three SECURITY DEFINER functions each do exactly one thing and are
-- called with the PUBLIC anon key. Nothing in Netlify can read or write the
-- database at large: the respondent path can only touch its own row, and the
-- monthly job's two functions are gated on a shared secret that grants nothing
-- beyond recording that month's sends.

-- Secret store for the job. RLS on with no policies, so anon and authenticated
-- cannot read it; only the SECURITY DEFINER functions below can.
create table if not exists public.nps_config (
  key   text primary key,
  value text not null
);
alter table public.nps_config enable row level security;

-- Public respondent path. Scoped to one row by an unguessable token, and can
-- only ever touch score/comment/responded_at — it cannot list rows, read
-- another account's answers, or write any other column.
create or replace function public.nps_submit_response(
  p_token   text,
  p_score   int  default null,
  p_comment text default null
)
returns table (ok boolean, out_score int, out_comment text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.nps_sends%rowtype;
begin
  select * into r from public.nps_sends where token = p_token and status = 'sent';
  if not found then
    return query select false, null::int, null::text;
    return;
  end if;

  if p_score is not null then
    if p_score < 0 or p_score > 10 then
      return query select false, null::int, null::text;
      return;
    end if;
    -- A re-click may correct the score; responded_at keeps the FIRST reply so
    -- response-time reporting stays honest.
    update public.nps_sends
       set score = p_score,
           responded_at = coalesce(responded_at, now())
     where id = r.id;
  end if;

  if p_comment is not null then
    update public.nps_sends set comment = nullif(btrim(p_comment), '') where id = r.id;
  end if;

  select * into r from public.nps_sends where id = r.id;
  return query select true, r.score, r.comment;
end;
$$;

-- Monthly job: claim this period's rows. Idempotent — re-running never
-- double-inserts, so nobody is emailed twice.
create or replace function public.nps_record_sends(p_secret text, p_rows jsonb)
returns setof public.nps_sends
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.nps_assert_job(p_secret);
  return query
  insert into public.nps_sends (
    period, hs_company_id, company_name, hs_contact_id, contact_email,
    contact_name, product, vertical, stage, pilot_status, am, mrr, status, token
  )
  select x.period, x.hs_company_id, x.company_name, x.hs_contact_id, x.contact_email,
         x.contact_name, x.product, x.vertical, x.stage, x.pilot_status, x.am, x.mrr,
         x.status, x.token
    from jsonb_to_recordset(p_rows) as x(
      period date, hs_company_id text, company_name text, hs_contact_id text,
      contact_email text, contact_name text, product text, vertical text,
      stage text, pilot_status text, am text, mrr numeric, status text, token text
    )
  on conflict (period, hs_company_id, contact_key) do nothing
  returning *;
end;
$$;

-- Monthly job: the rows still waiting to be emailed for a period, plus the
-- promotion to sent/failed once Resend answers.
create or replace function public.nps_pending(p_secret text, p_period date)
returns setof public.nps_sends
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.nps_assert_job(p_secret);
  return query
  select * from public.nps_sends where period = p_period and status = 'pending';
end;
$$;

create or replace function public.nps_mark_sent(
  p_secret text, p_id uuid, p_status text, p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.nps_assert_job(p_secret);
  if p_status not in ('sent', 'failed') then
    raise exception 'bad status';
  end if;
  update public.nps_sends
     set status = p_status,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         send_error = p_error
   where id = p_id and status = 'pending';
end;
$$;

create or replace function public.nps_assert_job(p_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
begin
  select value into expected from public.nps_config where key = 'job_secret';
  if expected is null or expected = '' or p_secret is distinct from expected then
    raise exception 'unauthorized';
  end if;
end;
$$;

revoke all on function public.nps_submit_response(text, int, text) from public;
revoke all on function public.nps_record_sends(text, jsonb)        from public;
revoke all on function public.nps_pending(text, date)              from public;
revoke all on function public.nps_mark_sent(text, uuid, text, text) from public;
revoke all on function public.nps_assert_job(text)                 from public, anon, authenticated;

grant execute on function public.nps_submit_response(text, int, text)   to anon, authenticated;
grant execute on function public.nps_record_sends(text, jsonb)          to anon, authenticated;
grant execute on function public.nps_pending(text, date)                to anon, authenticated;
grant execute on function public.nps_mark_sent(text, uuid, text, text)  to anon, authenticated;

notify pgrst, 'reload schema';
