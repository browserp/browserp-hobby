-- A published listing may expose only its staff-reviewed HTTPS community link.
-- Unreviewed submissions remain private to the owner and authorised staff.
begin;

create or replace function public.search_server_directory(
  p_slug text,
  p_query text default '',
  p_platform text default 'all',
  p_region text default 'all',
  p_online boolean default false,
  p_verified boolean default false,
  p_beginner boolean default false,
  p_sort text default 'recommended',
  p_limit integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with directory as (
    select
      s.id, s.name, s.slug, s.platform_id, p.name as platform_name, p.short_name as platform_short,
      s.description, s.region, s.language, s.framework, s.verified, s.beginner_friendly,
      case when s.community_url ~* '^https://' then s.community_url else null end as community_url,
      s.quality_score::float8 as quality_score, s.engagement_score::float8 as engagement_score,
      s.theme_start, s.theme_end, s.created_at,
      coalesce(latest.online, false) as online,
      coalesce(latest.players, 0) as players,
      coalesce(latest.capacity, 0) as capacity,
      coalesce(uptime.uptime_percent, 0)::float8 as uptime_percent,
      least(coalesce(boosts.boost_score, 0), 100)::float8 as boost_score,
      coalesce(tags.tags, '[]'::jsonb) as tags,
      (
        s.quality_score * .28 + s.engagement_score * .22 +
        coalesce(uptime.uptime_percent, 0) * .18 +
        case when coalesce(latest.capacity, 0) > 0 then least(latest.players::numeric / latest.capacity, 1) * 100 else 0 end * .18 +
        case when s.verified then 100 else 0 end * .08 +
        least(coalesce(boosts.boost_score, 0), 100) * .06
      )::float8 as discovery_score
    from public.servers s
    join public.platforms p on p.id = s.platform_id and p.enabled
    left join lateral (
      select ss.online, ss.players, ss.capacity
      from public.server_status_snapshots ss
      where ss.server_id = s.id
      order by ss.checked_at desc limit 1
    ) latest on true
    left join lateral (
      select round(100 * avg(case when ss.online then 1 else 0 end), 2) as uptime_percent
      from public.server_status_snapshots ss
      where ss.server_id = s.id and ss.checked_at >= timezone('utc', now()) - interval '30 days'
    ) uptime on true
    left join lateral (
      select sum(b.amount)::numeric as boost_score
      from public.boosts b
      where b.server_id = s.id and b.created_at >= timezone('utc', now()) - interval '7 days'
    ) boosts on true
    left join lateral (
      select jsonb_agg(st.tag order by st.relevance_score desc, st.tag) as tags
      from public.server_tags st where st.server_id = s.id
    ) tags on true
    where s.status = 'published'
      and s.age_rating <> 'adult'
      and (nullif(trim(coalesce(p_slug, '')), '') is null or s.slug = lower(trim(p_slug)))
  ), filtered as (
    select * from directory d
    where (coalesce(p_platform, 'all') = 'all' or d.platform_id = p_platform)
      and (coalesce(p_region, 'all') = 'all' or d.region = p_region)
      and (not coalesce(p_online, false) or d.online)
      and (not coalesce(p_verified, false) or d.verified)
      and (not coalesce(p_beginner, false) or d.beginner_friendly)
      and (
        nullif(trim(coalesce(p_query, '')), '') is null or
        concat_ws(' ', d.name, d.description, d.platform_name, d.region, d.language, d.framework, d.tags::text)
          ilike '%' || replace(replace(trim(p_query), '%', '\%'), '_', '\_') || '%'
      )
  ), ordered as (
    select * from filtered
    order by
      case when p_sort = 'players' then players end desc nulls last,
      case when p_sort = 'trending' then engagement_score end desc nulls last,
      case when p_sort = 'newest' then extract(epoch from created_at) end desc nulls last,
      case when p_sort = 'uptime' then uptime_percent end desc nulls last,
      case when p_sort = 'boosted' then boost_score end desc nulls last,
      discovery_score desc,
      name asc
    limit least(greatest(coalesce(p_limit, 30), 1), 100)
  )
  select coalesce(jsonb_agg(to_jsonb(ordered)), '[]'::jsonb) from ordered;
$$;

revoke all on function public.search_server_directory(text,text,text,text,boolean,boolean,boolean,text,integer) from public;
grant execute on function public.search_server_directory(text,text,text,text,boolean,boolean,boolean,text,integer) to anon, authenticated;

comment on function public.search_server_directory(text,text,text,text,boolean,boolean,boolean,text,integer)
  is 'Returns a published server by slug or searches the directory, including its reviewed HTTPS community link.';

-- Preserve the live eight-argument contract until every client uses clean slug lookup.
create or replace function public.search_server_directory(
  p_query text default '',
  p_platform text default 'all',
  p_region text default 'all',
  p_online boolean default false,
  p_verified boolean default false,
  p_beginner boolean default false,
  p_sort text default 'recommended',
  p_limit integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.search_server_directory(
    null::text,
    p_query,
    p_platform,
    p_region,
    p_online,
    p_verified,
    p_beginner,
    p_sort,
    p_limit
  );
$$;

revoke all on function public.search_server_directory(text,text,text,boolean,boolean,boolean,text,integer) from public;
grant execute on function public.search_server_directory(text,text,text,boolean,boolean,boolean,text,integer) to anon, authenticated;

comment on function public.search_server_directory(text,text,text,boolean,boolean,boolean,text,integer)
  is 'Compatibility directory search returning only published listings and reviewed HTTPS community links.';

commit;
