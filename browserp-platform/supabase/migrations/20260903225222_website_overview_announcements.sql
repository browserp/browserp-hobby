-- Current registered-account cohorts and a permission-scoped announcement CMS.
-- Cohorts describe accounts still registered now, not historical site visitors.
begin;

insert into public.permissions (key, description) values
  ('website.overview.read', 'Read aggregate website and registered-account statistics.'),
  ('announcements.manage', 'Draft, schedule, publish and archive public announcements.')
on conflict (key) do update set description = excluded.description;

insert into public.staff_role_permissions (role_key, permission_key)
select key, 'website.overview.read' from public.staff_roles
on conflict (role_key, permission_key) do nothing;
insert into public.staff_role_permissions (role_key, permission_key) values
  ('owner', 'announcements.manage'), ('administrator', 'announcements.manage')
on conflict (role_key, permission_key) do nothing;

create or replace function public.staff_website_overview(p_range text default '30d')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_today date := (v_now at time zone 'UTC')::date;
  v_range text := lower(btrim(coalesce(p_range, '30d')));
  v_start date;
  v_first date;
  v_bucket_days integer := 1;
  v_total bigint;
  v_baseline bigint;
  v_new bigint;
  v_series jsonb;
begin
  -- has_staff_permission enforces the Discord allowlist and configured MFA.
  if (select auth.uid()) is null or not public.has_staff_permission('website.overview.read') then
    raise exception 'Website overview permission required' using errcode = '42501';
  end if;
  if v_range not in ('30d', '90d', '180d', '1y', 'max') then
    raise exception 'Choose 30d, 90d, 180d, 1y or max' using errcode = '22023';
  end if;

  select count(*), min((u.created_at at time zone 'UTC')::date)
    into v_total, v_first
  from auth.users u
  where u.deleted_at is null and not coalesce(u.is_anonymous, false)
    and u.created_at <= v_now;

  v_start := case v_range
    when '30d' then v_today - 29
    when '90d' then v_today - 89
    when '180d' then v_today - 179
    when '1y' then (v_today - interval '1 year')::date + 1
    else coalesce(v_first, v_today)
  end;
  v_bucket_days := case v_range
    when '1y' then 7
    when 'max' then greatest(1, ceil((v_today - v_start + 1) / 366.0)::integer)
    else 1
  end;

  select count(*) into v_baseline
  from auth.users u
  where u.deleted_at is null and not coalesce(u.is_anonymous, false)
    and u.created_at < (v_start::timestamp at time zone 'UTC');

  -- Aggregate the source once. Zero-filled bounded buckets keep long histories
  -- responsive without dropping registrations or estimating any totals.
  with registrations as (
    select ((u.created_at at time zone 'UTC')::date - v_start) / v_bucket_days as bucket,
      count(*) as registrations
    from auth.users u
    where u.deleted_at is null and not coalesce(u.is_anonymous, false)
      and u.created_at >= (v_start::timestamp at time zone 'UTC')
      and u.created_at <= v_now
    group by 1
  ), buckets as (
    select i as bucket, v_start + i * v_bucket_days as start_date,
      least(v_today, v_start + (i + 1) * v_bucket_days - 1) as end_date,
      coalesce(r.registrations, 0) as new_users
    from generate_series(0, (v_today - v_start) / v_bucket_days) i
    left join registrations r on r.bucket = i
  ), totals as (
    select *, v_baseline + sum(new_users) over (order by bucket) as total_users
    from buckets
  )
  select coalesce(sum(new_users), 0), coalesce(jsonb_agg(jsonb_build_object(
    'date', start_date, 'endDate', end_date,
    'newUsers', new_users, 'totalUsers', total_users
  ) order by bucket), '[]'::jsonb)
  into v_new, v_series from totals;

  return jsonb_build_object(
    'generatedAt', v_now,
    'metrics', jsonb_build_object(
      'totalUsers', v_total,
      'publishedServers', (select count(*) from public.servers where status = 'published' and age_rating <> 'adult'),
      'publishedBlogs', (select count(*) from public.blog_posts where status = 'published' and published_at <= v_now),
      'activeStaff', (select count(distinct sm.user_id)
        from public.staff_memberships sm
        join auth.users u on u.id = sm.user_id and u.deleted_at is null and not coalesce(u.is_anonymous, false)
        join auth.identities i on i.user_id = sm.user_id and i.provider = 'discord'
        join private.discord_owner_allowlist a
          on a.discord_user_id = coalesce(i.provider_id, i.identity_data->>'provider_id', i.identity_data->>'sub')
          and a.enabled and a.role_key = sm.role_key
        where sm.status = 'active' and 1 = (select count(*) from auth.identities x where x.user_id = sm.user_id))
    ),
    'users', jsonb_build_object(
      'range', v_range, 'startDate', v_start, 'endDate', v_today,
      'granularity', case v_bucket_days when 1 then 'day' when 7 then 'week' else 'interval' end,
      'bucketDays', v_bucket_days, 'baseline', v_baseline, 'total', v_total,
      'newUsers', v_new, 'series', v_series,
      'definition', 'Currently registered accounts by registration date; excludes deleted and anonymous accounts. Not website visitors.'
    ),
    'permissions', jsonb_build_object(
      'manageRoles', public.has_staff_permission('staff.manage')
        and public.has_staff_permission('staff.permissions.manage')
        and exists(select 1 from public.staff_memberships where user_id = (select auth.uid()) and role_key = 'owner' and status = 'active'),
      'manageBlogs', public.has_staff_permission('blogs.manage'),
      'manageAnnouncements', public.has_staff_permission('announcements.manage')
    )
  );
end;
$$;
revoke all on function public.staff_website_overview(text) from public, anon, service_role;
grant execute on function public.staff_website_overview(text) to authenticated;

create table private.site_announcements (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 1 and 1000),
  level text not null default 'info' check (level in ('info', 'success', 'warning')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (ends_at is null or ends_at > starts_at),
  check (title !~ '[<>[:cntrl:]]'),
  check (body !~ '[<>]' and regexp_replace(body, E'[\n\r\t]', '', 'g') !~ '[[:cntrl:]]')
);
create index site_announcements_published_idx
  on private.site_announcements (starts_at desc, published_at desc) where status = 'published';
alter table private.site_announcements enable row level security;
revoke all on table private.site_announcements from public, anon, authenticated, service_role;

create or replace function public.staff_announcement_control()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.has_staff_permission('announcements.manage') then
    raise exception 'Announcement management permission required' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'title', a.title, 'body', a.body, 'level', a.level,
    'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
    'version', a.version, 'publishedAt', a.published_at, 'updatedAt', a.updated_at
  ) order by a.updated_at desc), '[]'::jsonb)
  from private.site_announcements a);
end;
$$;

create or replace function public.staff_mutate_announcement(
  p_id uuid, p_action text, p_title text, p_body text, p_level text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_expected_version bigint,
  p_reason text, p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_level text := lower(btrim(coalesce(p_level, 'info')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_now timestamptz := statement_timestamp();
  v_start timestamptz := coalesce(p_starts_at, v_now);
  v_before jsonb;
  v_result jsonb;
  v_existing private.site_announcements%rowtype;
  v_saved private.site_announcements%rowtype;
begin
  if v_actor is null or not public.has_staff_permission('announcements.manage') then
    raise exception 'Announcement management permission required' using errcode = '42501';
  end if;
  if v_action not in ('save', 'publish', 'archive') or char_length(v_reason) not between 5 and 500 then
    raise exception 'Choose an announcement action and provide a reason between 5 and 500 characters' using errcode = '22023';
  end if;
  if p_request_id is null or p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'A unique request ID is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_request_id, 0));
  select a.after_state into v_result from public.staff_audit_events a
  where a.actor_id = v_actor and a.request_id = p_request_id and a.action = 'announcement.' || v_action;
  if v_result is not null then return v_result; end if;

  if p_id is not null then
    select * into v_existing from private.site_announcements where id = p_id for update;
    if v_existing.id is null then raise exception 'Announcement not found' using errcode = 'P0002'; end if;
    if p_expected_version is distinct from v_existing.version then
      raise exception 'Announcement changed since it was loaded. Reload before saving.' using errcode = '40001';
    end if;
    v_before := to_jsonb(v_existing);
  elsif v_action = 'archive' or p_expected_version is not null then
    raise exception 'Choose an existing announcement' using errcode = '22023';
  end if;

  if v_action in ('save', 'publish') and (
    char_length(v_title) not between 3 and 120 or v_title ~ '[<>[:cntrl:]]'
    or char_length(v_body) not between 1 and 1000 or v_body ~ '[<>]'
    or regexp_replace(v_body, E'[\n\r\t]', '', 'g') ~ '[[:cntrl:]]'
    or v_level not in ('info', 'success', 'warning')
    or not isfinite(v_start) or (p_ends_at is not null and (not isfinite(p_ends_at) or p_ends_at <= v_start))
  ) then raise exception 'Use bounded plain text and a valid announcement schedule' using errcode = '22023'; end if;

  if p_id is null then
    insert into private.site_announcements(title, body, level, status, starts_at, ends_at, created_by, updated_by, published_at)
    values(v_title, v_body, v_level, case v_action when 'publish' then 'published' else 'draft' end,
      v_start, p_ends_at, v_actor, v_actor, case when v_action = 'publish' then v_now end)
    returning * into v_saved;
  else
    update private.site_announcements set
      title = case when v_action = 'archive' then title else v_title end,
      body = case when v_action = 'archive' then body else v_body end,
      level = case when v_action = 'archive' then level else v_level end,
      starts_at = case when v_action = 'archive' then starts_at else v_start end,
      ends_at = case when v_action = 'archive' then ends_at else p_ends_at end,
      status = case v_action when 'publish' then 'published' when 'archive' then 'archived' else 'draft' end,
      published_at = case when v_action = 'publish' then v_now else published_at end,
      updated_at = v_now, updated_by = v_actor, version = version + 1
    where id = p_id returning * into v_saved;
  end if;
  v_result := jsonb_build_object(
    'id', v_saved.id, 'title', v_saved.title, 'body', v_saved.body, 'level', v_saved.level,
    'status', v_saved.status, 'startsAt', v_saved.starts_at, 'endsAt', v_saved.ends_at,
    'version', v_saved.version, 'publishedAt', v_saved.published_at, 'updatedAt', v_saved.updated_at
  );
  insert into public.staff_audit_events(actor_id, action, target_type, target_id, reason, request_id, before_state, after_state)
  values(v_actor, 'announcement.' || v_action, 'announcement', v_saved.id::text, v_reason, p_request_id, v_before, v_result);
  return v_result;
end;
$$;

-- The only anonymous surface is a bounded projection of currently public text.
create or replace function public.public_active_announcements()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'title', a.title, 'body', a.body, 'level', a.level,
    'startsAt', a.starts_at, 'endsAt', a.ends_at, 'publishedAt', a.published_at
  ) order by a.starts_at desc, a.published_at desc), '[]'::jsonb)
  from (
    select id, title, body, level, starts_at, ends_at, published_at
    from private.site_announcements
    where status = 'published' and published_at <= statement_timestamp()
      and starts_at <= statement_timestamp()
      and (ends_at is null or ends_at > statement_timestamp())
    order by starts_at desc, published_at desc
    limit 5
  ) a;
$$;

revoke all on function public.staff_announcement_control(),
  public.staff_mutate_announcement(uuid,text,text,text,text,timestamptz,timestamptz,bigint,text,text)
  from public, anon, service_role;
grant execute on function public.staff_announcement_control(),
  public.staff_mutate_announcement(uuid,text,text,text,text,timestamptz,timestamptz,bigint,text,text)
  to authenticated;
revoke all on function public.public_active_announcements() from public;
grant execute on function public.public_active_announcements() to anon, authenticated, service_role;

commit;
