-- Post history for every company that has ever held an EGC seat, active or not.
--
-- egc_usage() returns only ACTIVE companies, which is right for a usage board
-- but leaves a churned account with no post history to compute time to value
-- from. HubSpot's first_post_date cannot fill the gap: it is maintained by hand
-- and is null on four of the five live EGC accounts, and null on VitalBenefits
-- too. This is the only source that can say whether a churned account ever
-- published — and for VitalBenefits the answer is the whole story: one seat
-- created 3 June, zero posts, churned 31 July on "Adoption Challenges".
create or replace function public.egc_company_posts()
returns table (company_name text, seats int, first_post date, last_post date, posts_all_time int)
language plpgsql security definer set search_path = public
as $$
begin
  -- Same gate as every RLS policy on this dashboard's tables.
  if coalesce(auth.jwt() ->> 'email', '') not like '%@virio.ai' then
    raise exception 'unauthorized';
  end if;

  return query
  select c.name::text,
         count(distinct u.id)::int,
         min(lp.published_at)::date,
         max(lp.published_at)::date,
         count(lp.*)::int
    from public.user_companies c
    join public.users u on u.company_id = c.id and u.tier = 'software'
    left join public.lineage_posts lp on lp.user_id = u.id
   where c.name not in ('Virio', 'Fake Pipe Co')
     and coalesce(u.is_internal, false) = false
     and coalesce(u.is_test_user, false) = false
   group by c.name;
end;
$$;

revoke all on function public.egc_company_posts() from public, anon;
grant execute on function public.egc_company_posts() to authenticated;

notify pgrst, 'reload schema';
