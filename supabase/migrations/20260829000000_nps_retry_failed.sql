create or replace function public.nps_pending(
  p_secret text, p_period date, p_include_failed boolean default false
)
returns setof public.nps_sends
language plpgsql security definer set search_path = public as $$
begin
  perform public.nps_assert_job(p_secret);
  return query
  select * from public.nps_sends
   where period = p_period
     and (status = 'pending' or (p_include_failed and status = 'failed'));
end; $$;

-- A retried row goes back to pending so nps_mark_sent, which only promotes
-- pending rows, can settle it.
create or replace function public.nps_mark_sent(
  p_secret text, p_id uuid, p_status text, p_error text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.nps_assert_job(p_secret);
  if p_status not in ('sent','failed') then raise exception 'bad status'; end if;
  update public.nps_sends
     set status = p_status,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         send_error = p_error
   where id = p_id and status in ('pending','failed');
end; $$;

revoke all on function public.nps_pending(text, date, boolean) from public;
grant execute on function public.nps_pending(text, date, boolean) to anon, authenticated;
notify pgrst, 'reload schema';
