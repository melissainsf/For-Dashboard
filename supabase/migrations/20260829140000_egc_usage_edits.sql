-- EGC usage board: add the edit signal.
--
-- "How much they have to edit the copy is a signal on quality." Two things are
-- true about that in this database:
--
--   1. HOW OFTEN is recorded and trustworthy. lineage_posts.differs_from_original
--      is set by the product at publish time and is populated on every one of
--      the 1,224 rows — no nulls. It corroborates against the collaborative
--      edit log: across EGC posts in the last 120 days, posts flagged unedited
--      average 2.1 yjs updates and posts flagged edited average 14.7.
--
--   2. HOW MUCH is not recoverable. The originally generated text is not kept
--      anywhere. drafts.content is edited in place, and drafts.publish_content
--      is a copy taken at publish time — of 1,197 published drafts carrying
--      both, 1,194 are byte-identical, so there is no before/after to diff.
--      Byte volume in draft_yjs_updates does not substitute: unedited posts
--      range 1.0k–12.2k bytes and edited ones 2.5k–16.4k, overlapping almost
--      completely and confounded with post length.
--
-- So this measures the rate, not the depth. Reporting a depth we cannot compute
-- would be the same mistake as counting our own pipeline's dismissals as client
-- rejections. 90-day counts ride along because the 30-day EGC denominator is
-- around 18 posts across the whole book — too thin to read a percentage from.

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
  edited_30d      int,
  posts_90d       int,
  edited_90d      int,
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
  ed as (
    -- One pass over the published posts for both windows and the edit flag,
    -- so the counts can never disagree about which posts they are counting.
    select lp.user_id,
           max(lp.published_at)::date as last_post,
           count(*) filter (where lp.published_at > now() - interval '30 days')::int as posts_30d,
           count(*) filter (where lp.published_at > now() - interval '30 days'
                              and lp.differs_from_original)::int as edited_30d,
           count(*) filter (where lp.published_at > now() - interval '90 days')::int as posts_90d,
           count(*) filter (where lp.published_at > now() - interval '90 days'
                              and lp.differs_from_original)::int as edited_90d
      from public.lineage_posts lp
     group by lp.user_id
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
         e.last_post,
         coalesce(e.posts_30d,0),
         coalesce(d.published,0)::int,
         coalesce(d.ignored,0)::int,                                        -- expired unread
         (coalesce(d.published,0) + coalesce(d.ignored,0))::int,            -- surfaced
         coalesce(e.edited_30d,0),
         coalesce(e.posts_90d,0),
         coalesce(e.edited_90d,0),
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
