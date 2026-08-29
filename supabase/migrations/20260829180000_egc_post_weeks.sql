-- Weekly published volume across the EGC book, zero-filled.
--
-- The zero-fill is the whole point. Grouping published_at by week returns only
-- the six weeks that have posts, and plotting those six draws a smooth climb.
-- The truth over 13 weeks is six weeks of nothing, then 1, 0, 1, 2, 2, 7, 7 —
-- a book that only started publishing in mid-July. Dropping the empty weeks
-- would flatter us.
--
-- The final bucket is the current week and is therefore partial; the tab renders
-- it at reduced opacity rather than letting it read as a real dip.

create or replace function public.egc_post_weeks()
returns table (week date, posts int)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Same gate as every RLS policy on this dashboard's tables.
  if coalesce(auth.jwt() ->> 'email', '') not like '%@virio.ai' then
    raise exception 'unauthorized';
  end if;

  return query
  with pub as (
    select u.id
      from public.users u
      join public.user_companies c on c.id = u.company_id
     where u.tier = 'software' and c.is_active
       and c.name not in ('Virio', 'Fake Pipe Co')
       and coalesce(u.is_internal, false) = false
       and coalesce(u.is_test_user, false) = false
       and coalesce(u.is_active, true)
  ),
  wks as (
    select generate_series(
             date_trunc('week', now() - interval '12 weeks'),
             date_trunc('week', now()),
             interval '1 week')::date as wk
  )
  select w.wk,
         (select count(*)::int from public.lineage_posts lp
           where lp.user_id in (select id from pub)
             and lp.published_at >= w.wk
             and lp.published_at <  w.wk + interval '1 week')
    from wks w
   order by w.wk;
end;
$$;

revoke all on function public.egc_post_weeks() from public, anon;
grant execute on function public.egc_post_weeks() to authenticated;

notify pgrst, 'reload schema';
