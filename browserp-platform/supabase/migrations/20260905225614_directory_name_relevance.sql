-- A name search should find that community before incidental description text.
-- Explicit player/newest/trending/uptime sorts and all visibility/filter rules stay intact.
begin;

create or replace function private.directory_name_relevance(p_name text, p_query text)
returns integer language sql immutable parallel safe set search_path='' as $$
  with words as (select private.discovery_normal(p_name) as name, private.discovery_normal(p_query) as query)
  select case
    when query='' then 0
    when name=query then 3
    when strpos(name,query)=1 then 2
    when not exists(select 1 from regexp_split_to_table(query,'\s+') word where strpos(name,word)=0) then 1
    else 0 end
  from words;
$$;
revoke all on function private.directory_name_relevance(text,text) from public,anon,authenticated,service_role;

-- Preserve the current directory's full projection, freshness, facets and ACLs.
-- Refuse to apply if its expected ordering has changed since review.
do $migration$
declare
  source text := pg_get_functiondef('public.search_public_directory(jsonb)'::regprocedure);
  previous text := E'    order by\n      case when p_filters->>''sort'' = ''players'' then players end desc nulls last,';
  replacement text := E'    order by\n      case when coalesce(p_filters->>''sort'',''recommended'') = ''recommended'' then private.directory_name_relevance(name,p_filters->>''query'') else 0 end desc,\n      case when p_filters->>''sort'' = ''players'' then players end desc nulls last,';
begin
  if (length(source)-length(replace(source,previous,'')))/length(previous) <> 1 then
    raise exception 'Directory ordering changed; review before applying name relevance';
  end if;
  execute replace(source,previous,replacement);
end;
$migration$;

commit;
