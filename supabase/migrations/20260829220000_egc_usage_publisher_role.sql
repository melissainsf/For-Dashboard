-- EGC usage board: not every seat is a publisher.
--
-- Brandon Ray at Othello carries is_manager — he oversees Jared's content and
-- was never going to post himself. Alex Perez at Thrad has posts_content off,
-- so nothing is written for him at all. Holding either to a publishing metric
-- measures a job they do not have, and Brandon was the worst "never posted"
-- case on the board because of it.
--
-- The two flags are returned rather than filtered here. These seats still
-- belong on the tab: their logins matter, and Brandon's numbers turn out to be
-- the finding rather than noise. 1,121 drafts have been generated under his
-- user id, 838 of them expired unread since 2 June and 127 more are sitting in
-- proposal status today. None of them overlap with Jared's by title, so this is
-- not a shared queue — it is content written for someone who does not publish.

drop function if exists public.egc_usage();

create function public.egc_usage()
returns table (
  company_id      uuid,
  company_name    text,
  seats           int,
  user_id         uuid,
  person          text,
  email           text,
  is_manager      boolean,
  posts_content   boolean,
  last_active     timestamptz,
  hours_silent    int,
  seat_added      date,
  seat_days       int,
  first_post      date,
  last_post       date,
  posts_30d       int,
  published_30d   int,
  ignored_30d     int,
  surfaced_30d    int,
  edited_30d      int,
  edits_30d       int,
  posts_90d       int,
  edited_90d      int,
  edits_90d       int,
  edit_min_90d    numeric,
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
    select u.id, u.email::text as email, u.company_id, u.created_at as seat_at,
           -- Default posts_content to true: an unset flag on an EGC seat means
           -- a publisher nobody has configured, not a manager.
           coalesce(u.is_manager, false) as is_manager,
           coalesce(u.posts_content, true) as posts_content,
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
    -- client signal that exists. Every dismissal except auto_expired_unactioned
    -- is our own pipeline (outlier_rewrite, abm, monitor, file_upload) and is
    -- counted in neither bucket.
    select d.user_id,
           count(*) filter (where d.status = 'published') as published,
           count(*) filter (where d.status = 'dismissed'
                              and d.dismissed_reason = 'auto_expired_unactioned') as ignored
      from public.drafts d
     where d.updated_at > now() - interval '30 days'
     group by d.user_id
  ),
  posts as (
    select lp.id, lp.draft_id, lp.user_id, lp.published_at
      from public.lineage_posts lp
     where lp.user_id in (select id from pub)
       and lp.published_at > now() - interval '90 days'
  ),
  cli as (
    -- Saved changes made by the client. Virio service accounts write into
    -- client drafts (165 edits across 113 Othello drafts alone); counting them
    -- would report our own work as theirs.
    select p.id as post_id, y.created_at
      from posts p
      join public.draft_yjs_updates y on y.draft_id = p.draft_id
      join public.users eu on eu.id = y.user_id
     where not y.is_checkpoint
       and coalesce(eu.is_internal, false) = false
  ),
  gaps as (
    select post_id, created_at,
           created_at - lag(created_at) over (partition by post_id order by created_at) as gap
      from cli
  ),
  per_post as (
    select g.post_id,
           count(*)::int as edits,
           coalesce(extract(epoch from sum(g.gap) filter (where g.gap < interval '5 minutes')) / 60.0, 0) as active_min
      from gaps g
     group by g.post_id
  ),
  ed as (
    select p.user_id,
           count(*) filter (where p.published_at > now() - interval '30 days')::int as posts_30d,
           count(*) filter (where p.published_at > now() - interval '30 days'
                              and coalesce(pp.edits,0) > 0)::int as edited_30d,
           coalesce(sum(pp.edits) filter (where p.published_at > now() - interval '30 days'),0)::int as edits_30d,
           count(*)::int as posts_90d,
           count(*) filter (where coalesce(pp.edits,0) > 0)::int as edited_90d,
           coalesce(sum(pp.edits),0)::int as edits_90d,
           round(coalesce(sum(pp.active_min),0)::numeric, 1) as edit_min_90d
      from posts p
      left join per_post pp on pp.post_id = p.id
     group by p.user_id
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
         a.is_manager,
         a.posts_content,
         a.last_active,
         case when a.last_active is null then null
              else floor(extract(epoch from (now() - a.last_active)) / 3600)::int end,
         a.seat_at::date,
         case when a.seat_at is null then null
              else floor(extract(epoch from (now() - a.seat_at)) / 86400)::int end,
         -- Both unwindowed: time to value is measured from kickoff, and "never
         -- posted" vs "last posted five months ago" are different conversations.
         (select min(lp.published_at)::date from public.lineage_posts lp where lp.user_id = a.id),
         (select max(lp.published_at)::date from public.lineage_posts lp where lp.user_id = a.id),
         coalesce(e.posts_30d,0),
         coalesce(d.published,0)::int,
         coalesce(d.ignored,0)::int,                                        -- expired unread
         (coalesce(d.published,0) + coalesce(d.ignored,0))::int,            -- surfaced
         coalesce(e.edited_30d,0),
         coalesce(e.edits_30d,0),
         coalesce(e.posts_90d,0),
         coalesce(e.edited_90d,0),
         coalesce(e.edits_90d,0),
         coalesce(e.edit_min_90d,0),
         exists (select 1 from public.linkedin_auth la
                  where la.user_id = a.id and la.disconnected_at is null),
         exists (select 1 from public.linkedin_auth la
                  where la.user_id = a.id
                    and (la.disconnected_at is not null
                         or la.token_revoked_at is not null
                         or la.token_expires_at < now()))
    from act a
    left join d30 d on d.user_id = a.id
    left join ed  e on e.user_id = a.id
   order by a.company_name, a.person;
end;
$$;

revoke all on function public.egc_usage() from public, anon;
grant execute on function public.egc_usage() to authenticated;

notify pgrst, 'reload schema';
