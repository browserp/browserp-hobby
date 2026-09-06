-- Recognise only the complete name's terminal RP spacing variant. Do not turn
-- descriptions/tags into aliases, remove arbitrary spaces, or add fuzzy matches.
begin;
create or replace function private.directory_joined_rp_match(p_name text,p_query text)
returns boolean language sql immutable parallel safe set search_path='' as $$
 with words as(select private.discovery_normal(p_name) name,private.discovery_normal(p_query) query)
 select coalesce((name ~ '^[a-z0-9]{3,} rp$' and query ~ '^[a-z0-9]{3,}rp$' and replace(name,' ','')=query)
   or (query ~ '^[a-z0-9]{3,} rp$' and name ~ '^[a-z0-9]{3,}rp$' and replace(query,' ','')=name),false) from words;
$$;
revoke all on function private.directory_joined_rp_match(text,text) from public,anon,authenticated,service_role;

-- Preserve the complete existing filtering, facets, projection and sorting.
-- Refuse changed source rather than replacing a newer search implementation.
do $migration$
declare source text; needle text; replacement text;
begin
 source:=pg_get_functiondef('public.search_public_directory(jsonb)'::regprocedure);
 needle:='word) = 0';
 replacement:='word) = 0 and not private.directory_joined_rp_match(d.name,word)';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Directory query matching changed; review before applying joined RP names'; end if;
 execute replace(source,needle,replacement);
 source:=pg_get_functiondef('public.search_server_directory(text,text,text,text,boolean,boolean,boolean,text,integer)'::regprocedure);
 needle:='nullif(trim(coalesce(p_query, '''')), '''') is null or';
 replacement:=needle||' private.directory_joined_rp_match(d.name,p_query) or';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Server query matching changed; review before applying joined RP names'; end if;
 execute replace(source,needle,replacement);
 source:=pg_get_functiondef('private.directory_name_relevance(text,text)'::regprocedure);
 needle:='when name=query then 3';
 replacement:='when name=query or private.directory_joined_rp_match(name,query) then 3';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Name ordering changed; review before applying joined RP names'; end if;
 execute replace(source,needle,replacement);
end;
$migration$;
notify pgrst, 'reload schema';
commit;
