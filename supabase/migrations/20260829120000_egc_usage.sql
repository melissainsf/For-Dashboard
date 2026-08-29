-- EGC usage board: one row per EGC publisher, with their real last-active time.
--
-- The dashboard talks to Supabase straight from the browser on the anon key, but
-- the only trustworthy login signal lives in the `auth` schema, which PostgREST
-- does not expose. So this is a SECURITY DEFINER function that reaches into
-- auth, aggregates, and hands back only what the tab renders — no service-role
-- key, matching how the NPS survey was built.
--
-- On "last active": auth.users.last_sign_in_at alone OVERSTATES absence. A
-- session refreshes without a fresh sign-in, so someone using the product daily
-- can look weeks idle. Measured against real data, two of ten EGC publishers
-- read as multiple days more silent by sign-in than they actually were. The
-- later of sign-in and session activity is the honest number.

drop function if exists public.egc_usage();

create function public.egc_usage()
returns table (
  company_id      uuid,
  company_name    text,
  seats           int,
  user_id         uuid,
  person          text,
  email           text,
  last_active     timestamptz,
  hours_silent    int,
  last_post       date,
  posts_30d       int,
  published_30d   int,
  ignored_30d     int,
  surfaced_30d    int,
  li_connected    boolean,
  li_broken       boolean
)
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
    select u.id, u.email::text as email, u.company_id,
           btrim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,''))::text as person,
           c.name::text as company_name, c.seats::int as seats
      from public.users u
      join public.user_companies c on c.id = u.company_id
     where u.tier = 'software'
       and c.is_active
       -- Virio's own workspace and the seeded test company are not clients.
       and c.name not in ('Virio', 'Fake Pipe Co')
       and coalesce(u.is_internal, false) = false
       and coalesce(u.is_test_user, false) = false
       and coalesce(u.is_active, true)
  ),
  d30 as (
    -- There is NO reject action in the product. A publisher either publishes a
    -- proposal or it expires unactioned, so publishing is the only positive
    -- client signal that exists.
    --
    -- The handful of rows reading 'rejected from feed' / 'negative' / 'bulk
    -- hidden from feed' are NOT clients declining anything: they carry
    -- created_by_session_id and trigger_source values from our own pipeline
    -- (outlier_rewrite, abm, monitor, file_upload), and cluster on the backlog
    -- cleanup date. Counting them as rejections would have reported our
    -- pipeline's behaviour as the client's.
    --
    -- So every dismissal except auto_expired_unactioned is ours, and is counted
    -- in neither bucket.
    select d.user_id,
           count(*) filter (where d.status = 'published') as published,
           count(*) filter (where d.status = 'dismissed'
                              and d.dismissed_reason = 'auto_expired_unactioned') as ignored
      from public.drafts d
     where d.updated_at > now() - interval '30 days'
     group by d.user_id
  ),
  act as (
    select p.*,
           greatest(
             au.last_sign_in_at,
             (select max(greatest(s.updated_at, coalesce(s.refreshed_at, s.updated_at)))
                from auth.sessions s where s.user_id = p.id)
           ) as last_active
      from pub p
      join auth.users au on au.id = p.id
  )
  select a.company_id,
         a.company_name,
         a.seats,
         a.id,
         nullif(a.person, '')::text,
         a.email,
         a.last_active,
         case when a.last_active is null then null
              else floor(extract(epoch from (now() - a.last_active)) / 3600)::int end,
         (select max(lp.published_at)::date from public.lineage_posts lp where lp.user_id = a.id),
         (select count(*)::int from public.lineage_posts lp
           where lp.user_id = a.id and lp.published_at > now() - interval '30 days'),
         coalesce(d.published,0)::int,
         coalesce(d.ignored,0)::int,                                        -- expired unread
         (coalesce(d.published,0) + coalesce(d.ignored,0))::int,            -- surfaced
         exists (select 1 from public.linkedin_auth la
                  where la.user_id = a.id and la.disconnected_at is null),
         exists (select 1 from public.linkedin_auth la
                  where la.user_id = a.id
                    and (la.disconnected_at is not null
                         or la.token_revoked_at is not null
                         or la.token_expires_at < now()))
    from act a
    left join d30 d on d.user_id = a.id
   order by a.company_name, a.person;
end;
$$;

revoke all on function public.egc_usage() from public, anon;
grant execute on function public.egc_usage() to authenticated;

notify pgrst, 'reload schema';
