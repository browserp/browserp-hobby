-- Canonical game-specific filters. Counts represent distinct matching published servers.
-- Taxonomy aliases mirror public/discovery-model.js; raw listing metadata stays intact.
begin;

create or replace function private.discovery_normal(p_value text)
returns text language sql immutable parallel safe set search_path='' as $$
 select trim(lower(regexp_replace(replace(replace(coalesce(p_value,''),'-',' '),'_',' '),'\s+',' ','g')));
$$;
create or replace function private.discovery_taxonomy()
returns jsonb language sql immutable parallel safe set search_path='' as $$
 select '{"fivem":{"mode":{"vmenu":"vmenu","v menu":"vmenu","esx":"esx","es extended":"esx","qbcore":"qbcore","qb core":"qbcore","qb":"qbcore","qbox":"qbox","qbx":"qbox","qbx core":"qbox","vrp":"vrp","v rp":"vrp","ox core":"ox core","oxcore":"ox core","standalone":"standalone","stand alone":"standalone"},"feature":{"serious rp":"serious rp","serious roleplay":"serious rp","seriousrp":"serious rp","seriousroleplay":"serious rp","semi serious rp":"semi serious rp","semi serious roleplay":"semi serious rp","semiserious":"semi serious rp","semi serious":"semi serious rp","custom cars":"custom cars","custom vehicles":"custom cars","customcars":"custom cars","customvehicles":"custom cars","economy":"economy","economy rp":"economy","police rp":"police rp","law enforcement":"police rp","leo":"police rp","police roleplay":"police rp","ems":"ems","medical rp":"ems","emergency medical services":"ems","civilian life":"civilian life","civilian rp":"civilian life","player owned businesses":"player owned businesses","player businesses":"player owned businesses","playerownedbusinesses":"player owned businesses","housing":"housing","player housing":"housing","custom maps":"custom maps","custom interiors":"custom maps","mlo":"custom maps","mlos":"custom maps","racing":"racing","public safety":"public safety"}},"redm":{"mode":{"vorp":"vorp","vorp core":"vorp","redem rp":"redem rp","redem:rp":"redem rp","redem":"redem rp","redemrp":"redem rp","rsg":"rsg","rsg core":"rsg","rsgcore":"rsg","qbr":"qbr","qbr core":"qbr","standalone":"standalone","stand alone":"standalone"},"feature":{"serious rp":"serious rp","serious roleplay":"serious rp","seriousrp":"serious rp","seriousroleplay":"serious rp","semi serious rp":"semi serious rp","semi serious roleplay":"semi serious rp","semi serious":"semi serious rp","outlaw rp":"outlaw rp","outlaws":"outlaw rp","outlaw roleplay":"outlaw rp","lawmen":"lawmen","lawman":"lawmen","sheriff":"lawmen","law enforcement":"lawmen","ranching":"ranching","ranches":"ranching","horses":"horses","horse training":"horses","horse breeding":"horses","hunting":"hunting","crafting":"crafting","economy":"economy","player owned businesses":"player owned businesses","player businesses":"player owned businesses","frontier life":"frontier life","western rp":"frontier life","western roleplay":"frontier life","housing":"housing","homesteads":"housing"}},"minecraft":{"mode":{"survival":"survival","smp":"smp","survival multiplayer":"smp","towny":"towny","skyblock":"skyblock","sky block":"skyblock","factions":"factions","faction":"factions","creative":"creative","roleplay":"roleplay","rp":"roleplay","pixelmon":"pixelmon","prison":"prison","hardcore":"hardcore"},"feature":{"java":"java","java edition":"java","bedrock":"bedrock","bedrock edition":"bedrock","crossplay":"crossplay","cross play":"crossplay","java bedrock":"crossplay","java and bedrock":"crossplay","modded":"modded","mods":"modded","modpack":"modded","vanilla":"vanilla","economy":"economy","land claims":"land claims","land claiming":"land claims","claims":"land claims","grief prevention":"land claims","pve":"pve","player versus environment":"pve","pvp":"pvp","player versus player":"pvp","quests":"quests","questing":"quests","custom worlds":"custom worlds","custom world":"custom worlds","voice chat":"voice chat","proximity chat":"voice chat"}},"roblox":{"mode":{"city rp":"city rp","city roleplay":"city rp","town rp":"city rp","town roleplay":"city rp","emergency rp":"emergency rp","emergency services rp":"emergency rp","emergency services":"emergency rp","emergency roleplay":"emergency rp","police rp":"emergency rp","police roleplay":"emergency rp","military rp":"military rp","military roleplay":"military rp","school rp":"school rp","school roleplay":"school rp","fantasy rp":"fantasy rp","fantasy roleplay":"fantasy rp","family rp":"family rp","family roleplay":"family rp","animal rp":"animal rp","animal roleplay":"animal rp","hangout":"hangout","social hangout":"hangout","social":"hangout"},"feature":{"private servers":"private servers","private server":"private servers","public servers":"public servers","public server":"public servers","voice chat":"voice chat","vc":"voice chat","custom avatars":"custom avatars","custom avatar":"custom avatars","vehicles":"vehicles","driving":"vehicles","housing":"housing","houses":"housing","jobs":"jobs","careers":"jobs","events":"events","community events":"events","mobile friendly":"mobile friendly","mobile":"mobile friendly","controller support":"controller support","console support":"controller support"}}}'::jsonb;
$$;
create or replace function private.discovery_game_value(p_platform text,p_kind text,p_value text)
returns text language sql immutable parallel safe set search_path='' as $$
 select coalesce(private.discovery_taxonomy()#>>array[p_platform,p_kind,private.discovery_normal(p_value)],
  case when p_kind='access' then case private.discovery_normal(p_value) when 'whitelisted' then 'allowlisted' when 'whitelist' then 'allowlisted' when 'allowlist' then 'allowlisted' when 'open' then 'public' when 'open access' then 'public' when 'application required' then 'application' end end,
  private.discovery_normal(p_value));
$$;
create or replace function private.discovery_game_values(p_platform text,p_kind text,p_framework text,p_tags jsonb)
returns text[] language sql immutable parallel safe set search_path='' as $$
 with candidates as (
  select private.discovery_game_value(p_platform,p_kind,p_framework) value where p_kind='mode' and nullif(trim(p_framework),'') is not null
  union all
  select private.discovery_game_value(p_platform,p_kind,t.value) from jsonb_array_elements_text(coalesce(p_tags,'[]'::jsonb)) t(value)
  where p_kind='feature' or (p_kind='mode' and (p_platform in ('minecraft','roblox') or nullif(trim(p_framework),'') is null) and (private.discovery_taxonomy()->p_platform->'mode')?private.discovery_normal(t.value))
 ) select coalesce(array_agg(distinct value order by value)filter(where value<>''),'{}'::text[]) from candidates;
$$;
create or replace function private.discovery_alias_words(p_platform text,p_modes text[],p_features text[])
returns text language sql immutable parallel safe set search_path='' as $$
 select string_agg(alias,' ') from (
  select e.key alias from jsonb_each_text(coalesce(private.discovery_taxonomy()->p_platform->'mode','{}'::jsonb)) e where e.value=any(p_modes)
  union
  select e.key alias from jsonb_each_text(coalesce(private.discovery_taxonomy()->p_platform->'feature','{}'::jsonb)) e where e.value=any(p_features)
 ) aliases;
$$;
revoke execute on function private.discovery_normal(text),private.discovery_taxonomy(),private.discovery_game_value(text,text,text),private.discovery_game_values(text,text,text,jsonb),private.discovery_alias_words(text,text[],text[]) from public,anon,authenticated,service_role;

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
      private.discovery_game_values(s.platform_id,'mode',s.framework,tags.tags) as mode_values,
      private.discovery_game_values(s.platform_id,'feature',s.framework,tags.tags) as feature_values,
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
      case when (coalesce(p_filters->>'mode','all')='all' or private.discovery_game_value(d.platform_id,'mode',p_filters->>'mode')=any(d.mode_values)) then null else 'mode' end,
      case when (coalesce(p_filters->>'feature','all')='all' or private.discovery_game_value(d.platform_id,'feature',p_filters->>'feature')=any(d.feature_values)) then null else 'feature' end,
      case when (coalesce(p_filters->>'access','all')='all' or private.discovery_game_value(d.platform_id,'access',p_filters->>'access')=private.discovery_game_value(d.platform_id,'access',d.access_type)) then null else 'access' end,
      case when (coalesce(p_filters->>'language','all') = 'all' or lower(regexp_replace(replace(replace(coalesce(d.language,''),'-',' '),'_',' '),'\s+',' ','g')) = lower(regexp_replace(replace(replace(coalesce(p_filters->>'language',''),'-',' '),'_',' '),'\s+',' ','g'))) then null else 'language' end,
      case when (coalesce(p_filters->>'online','false') <> 'true' or d.online) then null else 'online' end,
      case when (coalesce(p_filters->>'verified','false') <> 'true' or d.verified) then null else 'verified' end,
      case when (coalesce(p_filters->>'beginner','false') <> 'true' or d.beginner_friendly) then null else 'beginner' end
    ], null) as mismatches
    from directory d
    where not exists (
      select 1 from regexp_split_to_table(trim(lower(regexp_replace(replace(replace(coalesce(p_filters->>'query',''),'-',' '),'_',' '),'\s+',' ','g'))), '\s+') word
      where word <> '' and strpos(lower(regexp_replace(replace(replace(coalesce(concat_ws(' ',d.name,d.description,d.platform_name,d.region,d.language,d.framework,d.tags::text,(select array_to_string(i.keywords,' ') from public.server_import_sources i where i.server_id=d.id),private.discovery_alias_words(d.platform_id,d.mode_values,d.feature_values)),''),'-',' '),'_',' '),'\s+',' ','g')), word) = 0
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
    select 'region'::text as key, initcap(private.discovery_normal(d.region)) as value, count(distinct d.id)::integer as count from checked d where mismatches <@ array['region','mode','feature','access','language','online','verified','beginner']::text[] and nullif(d.region,'') is not null group by initcap(private.discovery_normal(d.region))
    union all
    select 'mode'::text as key, t.value, count(distinct d.id)::integer as count from checked d cross join lateral unnest(d.mode_values) t(value) where mismatches <@ array['mode']::text[] group by t.value
    union all
    select 'feature'::text as key, t.value as value, count(distinct d.id)::integer as count from checked d cross join lateral unnest(d.feature_values) t(value) where mismatches <@ array['feature']::text[] group by t.value
    union all
    select 'access'::text as key, private.discovery_game_value(d.platform_id,'access',d.access_type) as value, count(distinct d.id)::integer as count from checked d where mismatches <@ array['access']::text[] and nullif(d.access_type,'') is not null group by private.discovery_game_value(d.platform_id,'access',d.access_type)
    union all
    select 'language'::text as key, initcap(private.discovery_normal(d.language)) as value, count(distinct d.id)::integer as count from checked d where mismatches <@ array['language']::text[] and nullif(d.language,'') is not null group by initcap(private.discovery_normal(d.language))
    union all
    select 'online'::text as key, 'true'::text as value, count(distinct d.id)::integer as count from checked d where mismatches <@ array['online']::text[] and d.online group by 'true'::text
    union all
    select 'verified'::text as key, 'true'::text as value, count(distinct d.id)::integer as count from checked d where mismatches <@ array['verified']::text[] and d.verified group by 'true'::text
    union all
    select 'beginner'::text as key, 'true'::text as value, count(distinct d.id)::integer as count from checked d where mismatches <@ array['beginner']::text[] and d.beginner_friendly group by 'true'::text
  ), facet_groups as (
    select key, jsonb_agg(jsonb_build_object('value',value,'count',count) order by count desc,value) as options
    from facet_counts group by key
  )
  select jsonb_build_object(
    'servers', coalesce((select jsonb_agg(to_jsonb(page) - 'mismatches' - 'mode_values' - 'feature_values') from page),'[]'::jsonb),
    'total', (select count(*) from matched),
    'facets', coalesce((select jsonb_object_agg(key,options) from facet_groups),'{}'::jsonb)
  );
$$;

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
        concat_ws(' ', d.name, d.description, d.platform_name, d.region, d.language, d.framework, d.tags::text, (select array_to_string(i.keywords,' ') from public.server_import_sources i where i.server_id=d.id), private.discovery_alias_words(d.platform_id,private.discovery_game_values(d.platform_id,'mode',d.framework,d.tags),private.discovery_game_values(d.platform_id,'feature',d.framework,d.tags)))
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

commit;
