-- Staff-reviewed imports may have conflicting access evidence. Preserve that uncertainty
-- explicitly; do not silently classify them as public or require an invented allowlist.
-- Owner submission constraints and metadata validation retain their existing choices.
begin;

alter table public.servers drop constraint servers_access_type_check;
alter table public.servers add constraint servers_access_type_check
 check (access_type in ('public','allowlisted','application','unknown'));

create or replace function private.fivem_candidate_validate(p_data jsonb,p_publishing boolean default false)
returns jsonb language plpgsql immutable set search_path='' as $$
declare d jsonb:=p_data; k text; v text; a jsonb; e jsonb; code text;
begin
 if d is null or jsonb_typeof(d)<>'object' or octet_length(d::text)>60000 then raise exception 'Invalid FiveM candidate'; end if;
 for k in select jsonb_object_keys(d) loop
  if not(k=any(array['joinCode','name','description','region','language','framework','accessType','discordUrl','websiteUrl','joinUrl','tags','keywords','bannerUrl','logoUrl','players','capacity','online','checkedAt','warnings','evidence','sourceUrl'])) then raise exception 'Unexpected FiveM candidate field: %',k; end if;
 end loop;
 code:=lower(coalesce(d->>'joinCode',''));
 if code !~ '^[a-z0-9]{6,12}$' or d->>'joinUrl' is distinct from 'https://cfx.re/join/'||code then raise exception 'The FiveM join link must match its source code'; end if;
 if coalesce(d->>'sourceUrl','') not in ('https://frontend.cfx-services.net/api/servers/single/'||code,'https://servers-frontend.fivem.net/api/servers/single/'||code,'https://servers.fivem.net/servers/detail/'||code) then raise exception 'Invalid FiveM source URL'; end if;
 for k in select unnest(array['name','description','region','language','framework','accessType','discordUrl','websiteUrl','joinUrl','bannerUrl','logoUrl','checkedAt','sourceUrl']) loop
  if d?k and jsonb_typeof(d->k) not in ('string','null') then raise exception 'Invalid candidate text field'; end if;
  v:=nullif(btrim(d->>k),'');
  if v ~ '[[:cntrl:]]' and k<>'description' then raise exception 'Invalid control characters'; end if;
  if char_length(v)>(case k when 'description' then 3000 when 'name' then 80 when 'region' then 60 when 'language' then 60 when 'framework' then 80 when 'accessType' then 20 else 1000 end) then raise exception 'Candidate text is too long'; end if;
  d:=jsonb_set(d,array[k],coalesce(to_jsonb(v),'null'::jsonb));
 end loop;
 if nullif(d->>'discordUrl','') is not null and d->>'discordUrl' !~* '^https://(discord[.]gg/[a-z0-9_-]{2,100}|discord[.]com/invite/[a-z0-9_-]{2,100})$' then raise exception 'The Discord field must contain a Discord invite'; end if;
 for k in select unnest(array['websiteUrl','bannerUrl','logoUrl']) loop
  v:=d->>k;
  if v is not null and (v !~* '^https://[^/@[:space:]]+([/?][^[:space:]]*)?$' or v ~* '^https://(discord[.]gg|discord[.]com|cfx[.]re)([/?]|$)') then raise exception 'Invalid website or image URL'; end if;
 end loop;
 if d->>'accessType' is not null and d->>'accessType' not in ('public','allowlisted','application','unknown') then raise exception 'Invalid access type'; end if;
 for k in select unnest(array['tags','keywords']) loop
  a:=coalesce(d->k,'[]'::jsonb);
  if jsonb_typeof(a)<>'array' or jsonb_array_length(a)>30 then raise exception 'Too many tags or keywords'; end if;
  for e in select value from jsonb_array_elements(a) loop
   v:=e#>>'{}';
   if jsonb_typeof(e)<>'string' or char_length(v) not between 2 and 40 or v ~* '(https?://|www[.]|discord[.]|cfx[.]|[<>[:cntrl:]])' then raise exception 'Tags and keywords must be short text, never links'; end if;
  end loop;
  d:=jsonb_set(d,array[k],a);
 end loop;
 for k in select unnest(array['warnings','evidence']) loop
  a:=coalesce(d->k,'[]'::jsonb);
  if jsonb_typeof(a)<>'array' or jsonb_array_length(a)>80 then raise exception 'Invalid source evidence'; end if;
  for e in select value from jsonb_array_elements(a) loop
   if jsonb_typeof(e)<>'object' or octet_length(e::text)>4500 then raise exception 'Invalid source evidence'; end if;
   if exists(select 1 from jsonb_each(e) x where x.key<>all(case when k='warnings' then array['code','field','severity','message'] else array['field','source','value','confidence'] end) or (jsonb_typeof(x.value) not in ('string','number','boolean','null') and not(k='evidence' and x.key='value' and jsonb_typeof(x.value)='array'))) then raise exception 'Unexpected source evidence field'; end if;
   if k='evidence' and jsonb_typeof(e->'value')='array' then
    if jsonb_array_length(e->'value')>30 or exists(select 1 from jsonb_array_elements(e->'value') x where jsonb_typeof(x)<>'string' or char_length(x#>>'{}')>40) then raise exception 'Invalid source evidence values'; end if;
   end if;
  end loop;
  d:=jsonb_set(d,array[k],a);
 end loop;
 for k in select unnest(array['players','capacity']) loop
  if d?k and jsonb_typeof(d->k)<>'null' and (jsonb_typeof(d->k)<>'number' or (d->>k) !~ '^[0-9]{1,6}$' or (d->>k)::int>100000) then raise exception 'Invalid live player counts'; end if;
 end loop;
 if d?'online' and jsonb_typeof(d->'online') not in ('boolean','null') then raise exception 'Invalid live status'; end if;
 if (d->>'players')::int is not null and (d->>'capacity')::int is not null and (d->>'players')::int>(d->>'capacity')::int then raise exception 'Player count exceeds capacity'; end if;
 if d->>'checkedAt' is not null and (d->>'checkedAt' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' or not isfinite((d->>'checkedAt')::timestamptz)) then raise exception 'Invalid observation date'; end if;
 if p_publishing then
  for k in select unnest(array['bannerUrl','logoUrl']) loop
   v:=d->>k;
   if v is not null and v !~ '^https://kywabzfgjoqiznnxygbq[.]supabase[.]co/storage/v1/object/public/server-media/[a-z0-9]{6,12}/[a-f0-9]{16,64}[.](png|jpg|jpeg|webp|gif)$' then raise exception 'Import images into approved server media before publishing'; end if;
  end loop;
 end if;
 if p_publishing and (char_length(coalesce(d->>'name','')) not between 3 and 80 or char_length(coalesce(d->>'description','')) not between 40 and 3000 or char_length(coalesce(d->>'region','')) not between 2 and 60 or char_length(coalesce(d->>'language','')) not between 2 and 60 or d->>'accessType' is null) then raise exception 'Review the name, description, region, language and access before publishing'; end if;
 return d;
end;
$$;
revoke all on function private.fivem_candidate_validate(jsonb,boolean) from public,anon,authenticated,service_role;

commit;
