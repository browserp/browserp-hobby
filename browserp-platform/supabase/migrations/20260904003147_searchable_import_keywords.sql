-- Include reviewed imported keywords in the existing public free-text search.
-- The correlated source lookup is limited to listings already admitted by the
-- published/non-adult/platform checks. Results, filters, facets and ranking are unchanged.
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
      latest.players as players,
      latest.capacity as capacity,
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
    left join private.effective_server_status latest on latest.server_id=s.id
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
        concat_ws(' ', d.name, d.description, d.platform_name, d.region, d.language, d.framework, d.tags::text, (select array_to_string(i.keywords,' ') from public.server_import_sources i where i.server_id=d.id))
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

create or replace function public.search_public_directory(p_filters jsonb default '{}'::jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  with directory as materialized (
    select
      s.id, s.name, s.slug, s.platform_id, p.name as platform_name, p.short_name as platform_short,
      s.description, s.region, s.language, s.framework, s.access_type, s.verified, s.beginner_friendly,
      case when s.community_url ~* '^https://' then s.community_url else null end as community_url,
      s.quality_score::float8 as quality_score, s.engagement_score::float8 as engagement_score,
      s.theme_start, s.theme_end, s.created_at,
      coalesce(latest.online, false) as online,
      latest.players as players,
      latest.capacity as capacity,
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
    left join private.effective_server_status latest on latest.server_id=s.id
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
      and s.platform_id in ('fivem','redm','roblox','minecraft')
  ), checked as materialized (
    select d.*, array_remove(array[
      case when (coalesce(p_filters->>'platform','all') = 'all' or lower(regexp_replace(replace(replace(coalesce(d.platform_id,''),'-',' '),'_',' '),'\s+',' ','g')) = lower(regexp_replace(replace(replace(coalesce(p_filters->>'platform',''),'-',' '),'_',' '),'\s+',' ','g'))) then null else 'platform' end,
      case when (coalesce(p_filters->>'region','all') = 'all' or lower(regexp_replace(replace(replace(coalesce(d.region,''),'-',' '),'_',' '),'\s+',' ','g')) = lower(regexp_replace(replace(replace(coalesce(p_filters->>'region',''),'-',' '),'_',' '),'\s+',' ','g'))) then null else 'region' end,
      case when (coalesce(p_filters->>'mode','all') = 'all' or lower(regexp_replace(replace(replace(coalesce(d.framework,''),'-',' '),'_',' '),'\s+',' ','g')) = lower(regexp_replace(replace(replace(coalesce(p_filters->>'mode',''),'-',' '),'_',' '),'\s+',' ','g'))) then null else 'mode' end,
      case when (coalesce(p_filters->>'feature','all') = 'all' or exists(select 1 from jsonb_array_elements_text(d.tags) t(value) where lower(regexp_replace(replace(replace(coalesce(t.value,''),'-',' '),'_',' '),'\s+',' ','g')) = lower(regexp_replace(replace(replace(coalesce(p_filters->>'feature',''),'-',' '),'_',' '),'\s+',' ','g')))) then null else 'feature' end,
      case when (coalesce(p_filters->>'access','all') = 'all' or lower(regexp_replace(replace(replace(coalesce(d.access_type,''),'-',' '),'_',' '),'\s+',' ','g')) = lower(regexp_replace(replace(replace(coalesce(p_filters->>'access',''),'-',' '),'_',' '),'\s+',' ','g'))) then null else 'access' end,
      case when (coalesce(p_filters->>'language','all') = 'all' or lower(regexp_replace(replace(replace(coalesce(d.language,''),'-',' '),'_',' '),'\s+',' ','g')) = lower(regexp_replace(replace(replace(coalesce(p_filters->>'language',''),'-',' '),'_',' '),'\s+',' ','g'))) then null else 'language' end,
      case when (coalesce(p_filters->>'online','false') <> 'true' or d.online) then null else 'online' end,
      case when (coalesce(p_filters->>'verified','false') <> 'true' or d.verified) then null else 'verified' end,
      case when (coalesce(p_filters->>'beginner','false') <> 'true' or d.beginner_friendly) then null else 'beginner' end
    ], null) as mismatches
    from directory d
    where not exists (
      select 1 from regexp_split_to_table(trim(lower(regexp_replace(replace(replace(coalesce(p_filters->>'query',''),'-',' '),'_',' '),'\s+',' ','g'))), '\s+') word
      where word <> '' and strpos(lower(regexp_replace(replace(replace(coalesce(concat_ws(' ',d.name,d.description,d.platform_name,d.region,d.language,d.framework,d.tags::text,(select array_to_string(i.keywords,' ') from public.server_import_sources i where i.server_id=d.id)),''),'-',' '),'_',' '),'\s+',' ','g')), word) = 0
    )
  ), matched as materialized (
    select * from checked where cardinality(mismatches) = 0
  ), page as (
    select * from matched
    order by
      case when p_filters->>'sort' = 'players' then players end desc nulls last,
      case when p_filters->>'sort' = 'newest' then created_at end desc nulls last,
      case when p_filters->>'sort' = 'trending' then engagement_score end desc nulls last,
      case when p_filters->>'sort' = 'uptime' then uptime_percent end desc nulls last,
      discovery_score desc, id
    limit least(greatest(coalesce((p_filters->>'limit')::integer,24),1),100)
    offset least(greatest(coalesce((p_filters->>'offset')::integer,0),0),1000000)
  ), facet_counts as (
    select 'platform'::text as key, d.platform_id as value, count(distinct d.id)::integer as count from checked d where mismatches <@ array['platform','region','mode','feature','access','language','online','verified','beginner']::text[] and nullif(d.platform_id,'') is not null group by d.platform_id
    union all
    select 'region'::text as key, d.region as value, count(distinct d.id)::integer as count from checked d where mismatches <@ array['region','mode','feature','access','language','online','verified','beginner']::text[] and nullif(d.region,'') is not null group by d.region
    union all
    select 'mode'::text as key, d.framework as value, count(distinct d.id)::integer as count from checked d where mismatches <@ array['mode']::text[] and nullif(d.framework,'') is not null group by d.framework
    union all
    select 'feature'::text as key, t.value as value, count(distinct d.id)::integer as count from checked d cross join lateral jsonb_array_elements_text(d.tags) t(value) where mismatches <@ array['feature']::text[] group by t.value
    union all
    select 'access'::text as key, d.access_type as value, count(distinct d.id)::integer as count from checked d where mismatches <@ array['access']::text[] and nullif(d.access_type,'') is not null group by d.access_type
    union all
    select 'language'::text as key, d.language as value, count(distinct d.id)::integer as count from checked d where mismatches <@ array['language']::text[] and nullif(d.language,'') is not null group by d.language
    union all
    select 'online'::text as key, 'true'::text as value, count(distinct d.id)::integer as count from checked d where mismatches <@ array['online']::text[] and d.online group by 'true'::text
    union all
    select 'verified'::text as key, 'true'::text as value, count(distinct d.id)::integer as count from checked d where mismatches <@ array['verified']::text[] and d.verified group by 'true'::text
    union all
    select 'beginner'::text as key, 'true'::text as value, count(distinct d.id)::integer as count from checked d where mismatches <@ array['beginner']::text[] and d.beginner_friendly group by 'true'::text
  ), facet_groups as (
    select key, jsonb_agg(jsonb_build_object('value',value,'count',count) order by value) as options
    from facet_counts group by key
  )
  select jsonb_build_object(
    'servers', coalesce((select jsonb_agg(to_jsonb(page) - 'mismatches') from page),'[]'::jsonb),
    'total', (select count(*) from matched),
    'facets', coalesce((select jsonb_object_agg(key,options) from facet_groups),'{}'::jsonb)
  );
$$;

commit;
