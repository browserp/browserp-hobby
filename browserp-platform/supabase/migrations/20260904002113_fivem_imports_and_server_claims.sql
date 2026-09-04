-- Reviewed FiveM imports and server-ownership claims. Raw upstream payloads,
-- network endpoints, player identifiers and Discord OAuth tokens are never stored.
begin;

-- Public, immutable image copies; uploads are restricted to the server-only storage boundary.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('server-media','server-media',true,2097152,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

insert into public.permissions(key,description) values
 ('scrapers.manage','Review, import and refresh external server listings.'),
 ('servers.claims.review','Review and decide requests to claim an unclaimed server.')
on conflict(key) do nothing;
insert into public.staff_role_permissions(role_key,permission_key)
 select r.key,p.key from public.staff_roles r cross join public.permissions p
 where r.key in ('owner','administrator') and p.key in ('scrapers.manage','servers.claims.review')
on conflict do nothing;

create table public.fivem_import_candidates (
 id uuid primary key default extensions.gen_random_uuid(),
 join_code text not null unique check(join_code ~ '^[a-z0-9]{6,12}$'),
 candidate jsonb not null check(jsonb_typeof(candidate)='object' and octet_length(candidate::text)<=60000),
 status text not null default 'pending' check(status in ('pending','published','dismissed')),
 server_id uuid references public.servers(id) on delete set null,
 version bigint not null default 1 check(version>0),
 created_by uuid references public.profiles(id) on delete set null,
 reviewed_by uuid references public.profiles(id) on delete set null,
 review_reason text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index fivem_import_candidates_status_idx on public.fivem_import_candidates(status,updated_at desc,id);
create table public.server_import_sources (
 server_id uuid primary key references public.servers(id) on delete cascade,
 provider text not null default 'cfx' check(provider='cfx'),
 join_code text not null unique check(join_code ~ '^[a-z0-9]{6,12}$'),
 source_url text not null,
 logo_url text,
 banner_url text,
 keywords text[] not null default '{}',
 imported_by uuid references public.profiles(id) on delete set null,
 imported_at timestamptz not null default now(),
 last_checked_at timestamptz,
 next_refresh_at timestamptz not null default now(),
 last_error_at timestamptz
);
create index server_import_sources_refresh_idx on public.server_import_sources(next_refresh_at,server_id);
create table public.server_claim_requests (
 id uuid primary key default extensions.gen_random_uuid(),
 server_id uuid not null references public.servers(id) on delete cascade,
 claimant_id uuid references public.profiles(id) on delete set null,
 message text not null check(char_length(message) between 20 and 2000),
 evidence_url text,
 community_url text,
 status text not null default 'pending' check(status in ('pending','approved','denied','superseded')),
 verification_status text not null default 'pending_check' check(verification_status in ('pending_check','verified','not_owner','unavailable','needs_discord')),
 discord_user_id text,
 guild_id text,
 guild_name text,
 verified_at timestamptz,
 verification_checked_at timestamptz,
 version bigint not null default 1 check(version>0),
 request_id text not null,
 reviewed_by uuid references public.profiles(id) on delete set null,
 reviewed_at timestamptz,
 decision_reason text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(claimant_id,request_id)
);
create unique index server_claim_requests_pending_idx on public.server_claim_requests(server_id,claimant_id) where status='pending';
create index server_claim_requests_staff_idx on public.server_claim_requests(status,verification_status,created_at desc,id);
create index server_claim_requests_claimant_idx on public.server_claim_requests(claimant_id,created_at desc,id);
alter table public.fivem_import_candidates enable row level security;
alter table public.server_import_sources enable row level security;
alter table public.server_claim_requests enable row level security;
revoke all on public.fivem_import_candidates,public.server_import_sources,public.server_claim_requests from public,anon,authenticated,service_role;
-- All access uses narrowly scoped functions. No direct Data API write surface.

create or replace function private.import_actor_allowed(p_actor_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.staff_memberships m
 join auth.users u on u.id=m.user_id and u.deleted_at is null and not coalesce(u.is_anonymous,false)
 join auth.identities i on i.user_id=m.user_id and i.provider='discord'
 join private.discord_owner_allowlist a on a.discord_user_id=coalesce(i.provider_id,i.identity_data->>'provider_id',i.identity_data->>'sub') and a.role_key=m.role_key and a.enabled
 where m.user_id=p_actor_id and m.status='active'
 and 1=(select count(*) from auth.identities i2 where i2.user_id=m.user_id)
 and coalesce((select o.allowed from public.staff_permission_overrides o where o.user_id=m.user_id and o.permission_key=p_permission),
 exists(select 1 from public.staff_role_permissions rp where rp.role_key=m.role_key and rp.permission_key=p_permission)));
$$;
revoke all on function private.import_actor_allowed(uuid,text) from public,anon,authenticated,service_role;

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
 if d->>'accessType' is not null and d->>'accessType' not in ('public','allowlisted','application') then raise exception 'Invalid access type'; end if;
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

create or replace function public.service_stage_fivem_candidate(p_actor_id uuid,p_candidate jsonb,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb; c public.fivem_import_candidates%rowtype; s public.servers%rowtype;
begin
 if not private.import_actor_allowed(p_actor_id,'scrapers.manage') then raise exception 'Scraper permission required' using errcode='42501'; end if;
 if char_length(coalesce(p_request_id,'')) not between 8 and 120 then raise exception 'A valid request identifier is required'; end if;
 d:=private.fivem_candidate_validate(p_candidate,false);
 -- Source identity is authoritative; detect older owner-created rows using the same Cfx code.
 select * into s from public.servers where platform_id='fivem' and lower(rtrim(cfx_join_url,'/'))=d->>'joinUrl' order by created_at limit 1;
 insert into public.fivem_import_candidates(join_code,candidate,created_by,server_id,status)
 values(d->>'joinCode',d,p_actor_id,s.id,case when s.id is not null then 'published' else 'pending' end)
 on conflict(join_code) do update set candidate=excluded.candidate,updated_at=now(),version=public.fivem_import_candidates.version+1
 returning * into c;
 return jsonb_build_object('id',c.id,'joinCode',c.join_code,'status',c.status,'version',c.version,'candidate',c.candidate,'serverId',c.server_id,'createdAt',c.created_at,'updatedAt',c.updated_at);
end;
$$;

create or replace function public.staff_fivem_candidates(p_status text default 'all',p_query text default '',p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if (select auth.uid()) is null or not public.has_staff_permission('scrapers.manage') then raise exception 'Scraper permission required' using errcode='42501'; end if;
 if p_status not in ('all','pending','published','dismissed') or char_length(coalesce(p_query,''))>200 or p_limit not between 1 and 100 or p_offset not between 0 and 10000 then raise exception 'Invalid scraper filters'; end if;
 with matched as (select c.* from public.fivem_import_candidates c where (p_status='all' or c.status=p_status) and (nullif(btrim(p_query),'') is null or position(lower(btrim(p_query)) in lower(concat_ws(' ',c.join_code,c.candidate->>'name',c.candidate->>'description')))>0)),
 page as(select * from matched order by updated_at desc,id limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'joinCode',c.join_code,'status',c.status,'version',c.version,'candidate',c.candidate,'serverId',c.server_id,'createdAt',c.created_at,'updatedAt',c.updated_at) order by c.updated_at desc,c.id) from page c),'[]'::jsonb),'total',(select count(*) from matched)) into result;
 return result;
end;
$$;

create or replace function public.staff_fivem_candidate(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.fivem_import_candidates%rowtype;
begin
 if (select auth.uid()) is null or not public.has_staff_permission('scrapers.manage') then raise exception 'Scraper permission required' using errcode='42501'; end if;
 select * into c from public.fivem_import_candidates where id=p_id;
 if not found then return null; end if;
 return jsonb_build_object('id',c.id,'joinCode',c.join_code,'status',c.status,'version',c.version,'candidate',c.candidate,'serverId',c.server_id,'createdAt',c.created_at,'updatedAt',c.updated_at);
end;
$$;

create or replace function public.staff_publish_fivem_candidate(p_id uuid,p_expected_version bigint,p_data jsonb,p_reason text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); c public.fivem_import_candidates%rowtype; s public.servers%rowtype; d jsonb; k text; slug_text text; result jsonb; reason_text text:=btrim(coalesce(p_reason,''));
begin
 if actor is null or not public.has_staff_permission('scrapers.manage') then raise exception 'Scraper permission required' using errcode='42501'; end if;
 if char_length(reason_text) not between 5 and 500 or char_length(coalesce(p_request_id,'')) not between 8 and 120 then raise exception 'Provide a review reason and request identifier'; end if;
 select after_state into result from public.staff_audit_events where actor_id=actor and action='fivem.import.published' and target_id=p_id::text and request_id=p_request_id order by id desc limit 1;
 if result is not null then return result; end if;
 select * into c from public.fivem_import_candidates where id=p_id for update;
 if not found then raise exception 'Candidate not found'; end if;
 if p_expected_version is null or c.version<>p_expected_version then raise exception 'This candidate changed; refresh before publishing' using errcode='40001'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>30000 then raise exception 'Invalid reviewed fields'; end if;
 for k in select jsonb_object_keys(p_data) loop
  if not(k=any(array['name','description','region','language','framework','accessType','discordUrl','websiteUrl','bannerUrl','logoUrl','tags','keywords'])) then raise exception 'Unexpected reviewed field'; end if;
 end loop;
 d:=private.fivem_candidate_validate(c.candidate||p_data,true);
 -- Serialize by Cfx source and then lock an existing server. Imports never overwrite owned metadata.
 perform pg_advisory_xact_lock(hashtextextended('browserp.fivem.'||c.join_code,0));
 select * into s from public.servers where platform_id='fivem' and lower(rtrim(cfx_join_url,'/'))=d->>'joinUrl' order by created_at limit 1 for update;
 if s.id is null and c.server_id is not null then select * into s from public.servers where id=c.server_id for update; end if;
 if s.id is not null and s.owner_id is not null then raise exception 'This server already has an owner; imports cannot overwrite it' using errcode='40001'; end if;
 if s.id is not null and not exists(select 1 from public.server_import_sources where server_id=s.id and join_code=c.join_code) then raise exception 'This listing already exists; review it in Moderation instead of importing a duplicate' using errcode='40001'; end if;
 if s.id is null then
  slug_text:=left(trim(both '-' from regexp_replace(lower(d->>'name'),'[^a-z0-9]+','-','g')),78);
  if char_length(slug_text)<3 then slug_text:='fivem-server'; end if;
  slug_text:=slug_text||'-'||c.join_code;
  if exists(select 1 from public.servers where slug=slug_text) then slug_text:='fivem-'||c.join_code||'-'||substr(c.id::text,1,8); end if;
  insert into public.servers(owner_id,platform_id,name,slug,description,region,language,framework,community_url,website_url,cfx_join_url,access_type,status,verified,theme_start,theme_end,published_at)
  values(null,'fivem',d->>'name',slug_text,d->>'description',d->>'region',d->>'language',d->>'framework',d->>'discordUrl',d->>'websiteUrl',d->>'joinUrl',d->>'accessType','published',false,'#b85d24','#ef9346',now()) returning * into s;
 else
  if s.status in ('suspended','rejected','archived') then raise exception 'Restore this listing through Moderation before importing updates'; end if;
  update public.servers set name=d->>'name',description=d->>'description',region=d->>'region',language=d->>'language',framework=d->>'framework',community_url=d->>'discordUrl',website_url=d->>'websiteUrl',access_type=d->>'accessType',status='published',published_at=coalesce(published_at,now()),updated_at=now() where id=s.id returning * into s;
 end if;
 insert into public.server_import_sources(server_id,join_code,source_url,logo_url,banner_url,keywords,imported_by)
 values(s.id,c.join_code,d->>'sourceUrl',d->>'logoUrl',d->>'bannerUrl',array(select jsonb_array_elements_text(d->'keywords')),actor)
 on conflict(server_id) do update set logo_url=excluded.logo_url,banner_url=excluded.banner_url,keywords=excluded.keywords;
 delete from public.server_tags where server_id=s.id and source='system';
 insert into public.server_tags(server_id,tag,source,relevance_score) select s.id,value,'system',60 from (select distinct lower(btrim(value)) value from jsonb_array_elements_text(d->'tags')) t on conflict(server_id,tag) do nothing;
 if d->>'players' is not null and d->>'capacity' is not null and d->>'online' is not null and (d->>'checkedAt')::timestamptz between now()-interval '10 minutes' and now()+interval '1 minute' then
  insert into public.server_status_snapshots(server_id,online,players,capacity,provider_status,checked_at) values(s.id,(d->>'online')::boolean,(d->>'players')::int,(d->>'capacity')::int,'cfx',(d->>'checkedAt')::timestamptz);
  update public.server_import_sources set last_checked_at=(d->>'checkedAt')::timestamptz,next_refresh_at=now()+interval '60 seconds' where server_id=s.id;
 end if;
 update public.fivem_import_candidates set candidate=d,status='published',server_id=s.id,reviewed_by=actor,review_reason=reason_text,version=version+1,updated_at=now() where id=c.id returning * into c;
 result:=jsonb_build_object('id',c.id,'serverId',s.id,'slug',s.slug,'status','published','version',c.version);
 insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state,metadata) values(actor,'fivem.import.published','fivem_candidate',c.id::text,reason_text,p_request_id,result,jsonb_build_object('serverId',s.id,'joinCode',c.join_code));
 return result;
end;
$$;

create or replace function public.staff_dismiss_fivem_candidate(p_id uuid,p_expected_version bigint,p_reason text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); c public.fivem_import_candidates%rowtype; result jsonb; reason_text text:=btrim(coalesce(p_reason,''));
begin
 if actor is null or not public.has_staff_permission('scrapers.manage') then raise exception 'Scraper permission required' using errcode='42501'; end if;
 if char_length(reason_text) not between 5 and 500 or char_length(coalesce(p_request_id,'')) not between 8 and 120 then raise exception 'Provide a review reason and request identifier'; end if;
 select after_state into result from public.staff_audit_events where actor_id=actor and action='fivem.import.dismissed' and target_id=p_id::text and request_id=p_request_id order by id desc limit 1;
 if result is not null then return result; end if;
 select * into c from public.fivem_import_candidates where id=p_id for update;
 if not found then raise exception 'Candidate not found'; end if;
 if p_expected_version is null or c.version<>p_expected_version then raise exception 'This candidate changed; refresh before dismissing' using errcode='40001'; end if;
 if c.server_id is not null then raise exception 'An imported server must be managed in Moderation'; end if;
 update public.fivem_import_candidates set status='dismissed',reviewed_by=actor,review_reason=reason_text,version=version+1,updated_at=now() where id=c.id returning * into c;
 result:=jsonb_build_object('id',c.id,'status',c.status,'version',c.version);
 insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state) values(actor,'fivem.import.dismissed','fivem_candidate',c.id::text,reason_text,p_request_id,result);
 return result;
end;
$$;

create or replace function public.service_fivem_sources(p_server_id uuid default null,p_due_only boolean default false,p_limit integer default 25)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select s.id as "serverId",i.join_code as "joinCode",s.slug,i.last_checked_at as "lastCheckedAt",i.next_refresh_at as "nextRefreshAt" from public.server_import_sources i join public.servers s on s.id=i.server_id where s.status='published' and s.age_rating<>'adult' and (p_server_id is null or s.id=p_server_id) and (not coalesce(p_due_only,false) or i.next_refresh_at<=now()) order by i.next_refresh_at,s.id limit least(greatest(coalesce(p_limit,25),1),100)) x;
$$;
create or replace function public.service_claim_fivem_refresh(p_join_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare claimed uuid;
begin
 update public.server_import_sources i set next_refresh_at=now()+interval '60 seconds' from public.servers s where s.id=i.server_id and s.status='published' and s.age_rating<>'adult' and i.join_code=p_join_code and i.next_refresh_at<=now() returning i.server_id into claimed;
 return claimed is not null;
end;
$$;
create or replace function public.service_refresh_fivem_snapshot(p_join_code text,p_online boolean,p_players integer,p_capacity integer,p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; last_seen timestamptz;
begin
 if p_online is null or p_players is null or p_capacity is null or p_players not between 0 and 100000 or p_capacity not between 0 and 100000 or p_players>p_capacity or p_observed_at is null or not isfinite(p_observed_at) or p_observed_at not between now()-interval '10 minutes' and now()+interval '1 minute' then raise exception 'A current verified player observation is required'; end if;
 select i.server_id,i.last_checked_at into sid,last_seen from public.server_import_sources i join public.servers s on s.id=i.server_id where i.join_code=p_join_code and s.status='published' and s.age_rating<>'adult' for update of i;
 if sid is null then raise exception 'Unknown published FiveM import'; end if;
 if last_seen is not null and p_observed_at<=last_seen then return jsonb_build_object('serverId',sid,'checkedAt',last_seen,'unchanged',true); end if;
 insert into public.server_status_snapshots(server_id,online,players,capacity,provider_status,checked_at) values(sid,p_online,p_players,p_capacity,'cfx',p_observed_at);
 update public.server_import_sources set last_checked_at=p_observed_at,next_refresh_at=greatest(next_refresh_at,now()+interval '60 seconds'),last_error_at=null where server_id=sid;
 delete from public.server_status_snapshots where server_id=sid and provider_status='cfx' and checked_at<now()-interval '30 days';
 return jsonb_build_object('serverId',sid,'checkedAt',p_observed_at,'online',p_online,'players',p_players,'capacity',p_capacity);
end;
$$;

create or replace function public.service_mark_fivem_unavailable(p_join_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 update public.server_import_sources i set last_error_at=now(),next_refresh_at=greatest(next_refresh_at,now()+interval '60 seconds') from public.servers s where s.id=i.server_id and s.status='published' and i.join_code=p_join_code returning i.server_id into sid;
 return sid is not null;
end;
$$;

create or replace function public.public_server_import_details(p_server_ids uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('serverId',s.id,'imported',i.server_id is not null,'claimable',s.owner_id is null,'joinCode',i.join_code,'logoUrl',i.logo_url,'bannerUrl',i.banner_url,'keywords',coalesce(to_jsonb(i.keywords),'[]'::jsonb),'lastCheckedAt',i.last_checked_at,'statusUnavailable',i.last_error_at is not null and (i.last_checked_at is null or i.last_error_at>=i.last_checked_at))),'[]'::jsonb)
 from public.servers s left join public.server_import_sources i on i.server_id=s.id
 where s.id=any(p_server_ids[1:100]) and s.status='published' and s.age_rating<>'adult';
$$;

create or replace function private.server_claim_json(c public.server_claim_requests,p_staff boolean default false)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'serverId',c.server_id,'serverName',s.name,'serverSlug',s.slug,'status',c.status,'verificationStatus',case when c.verification_status='verified' and c.community_url is distinct from s.community_url then 'unavailable' else c.verification_status end,'guildName',c.guild_name,'verifiedAt',case when c.community_url is not distinct from s.community_url then c.verified_at end,'version',c.version,'message',c.message,'evidenceUrl',c.evidence_url,'decisionReason',c.decision_reason,'createdAt',c.created_at,'updatedAt',c.updated_at)
 ||case when p_staff then jsonb_build_object('claimantId',c.claimant_id,'claimantName',p.display_name,'discordUserId',c.discord_user_id,'guildId',c.guild_id,'communityUrl',c.community_url,'reviewedBy',c.reviewed_by,'reviewedAt',c.reviewed_at,'verificationCheckedAt',c.verification_checked_at) else '{}'::jsonb end
 from public.servers s left join public.profiles p on p.id=c.claimant_id where s.id=c.server_id;
$$;
revoke all on function private.server_claim_json(public.server_claim_requests,boolean) from public,anon,authenticated,service_role;

create or replace function public.member_server_claim(p_server_id uuid,p_message text,p_evidence_url text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); s public.servers%rowtype; c public.server_claim_requests%rowtype; note text:=btrim(coalesce(p_message,'')); evidence text:=nullif(btrim(coalesce(p_evidence_url,'')),''); has_discord boolean;
begin
 if actor is null or not exists(select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=actor and u.deleted_at is null and not coalesce(u.is_anonymous,false)) then raise exception 'Sign in to request a server claim' using errcode='42501'; end if;
 if exists(select 1 from public.security_bans b where b.user_id=actor and b.target_type='account' and b.revoked_at is null and b.starts_at<=now() and (b.ends_at is null or b.ends_at>now())) then raise exception 'This account cannot request a server claim' using errcode='42501'; end if;
 if char_length(note) not between 20 and 2000 or char_length(coalesce(p_request_id,'')) not between 8 and 120 then raise exception 'Explain your connection to the server (20 to 2000 characters)'; end if;
 if evidence is not null and (char_length(evidence)>1000 or evidence !~* '^https://[^/@[:space:]]+([/?][^[:space:]]*)?$') then raise exception 'Evidence must use a valid HTTPS link'; end if;
 select * into c from public.server_claim_requests where claimant_id=actor and request_id=p_request_id;
 if found then if c.server_id<>p_server_id or c.message<>note or c.evidence_url is distinct from evidence then raise exception 'This request identifier was already used'; end if; return private.server_claim_json(c); end if;
 perform pg_advisory_xact_lock(hashtextextended('browserp.server-claim.'||actor::text,0));
 select * into s from public.servers where id=p_server_id for update;
 if not found or s.status<>'published' or s.age_rating='adult' then raise exception 'This server is unavailable'; end if;
 if s.owner_id is not null then raise exception 'This server already has an owner'; end if;
 select * into c from public.server_claim_requests where server_id=s.id and claimant_id=actor and status='pending';
 if found then return private.server_claim_json(c); end if;
 if (select count(*) from public.server_claim_requests where claimant_id=actor and created_at>now()-interval '24 hours')>=5 then raise exception 'You can submit up to five claim requests per day'; end if;
 select exists(select 1 from auth.identities where user_id=actor and provider='discord') into has_discord;
 insert into public.server_claim_requests(server_id,claimant_id,message,evidence_url,community_url,request_id,verification_status)
 values(s.id,actor,note,evidence,s.community_url,p_request_id,case when has_discord then 'pending_check' else 'needs_discord' end) returning * into c;
 return private.server_claim_json(c);
end;
$$;

create or replace function public.member_server_claims(p_server_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); result jsonb;
begin
 if actor is null then raise exception 'Sign in to view your claims' using errcode='42501'; end if;
 select jsonb_build_object('items',coalesce(jsonb_agg(private.server_claim_json(c) order by c.created_at desc),'[]'::jsonb),'total',count(*)) into result from (select * from public.server_claim_requests where claimant_id=actor and (p_server_id is null or server_id=p_server_id) order by created_at desc limit 100) c;
 return result;
end;
$$;

create or replace function public.service_verify_server_claim(p_claim_id uuid,p_user_id uuid,p_discord_user_id text,p_guild_id text,p_community_url text,p_is_owner boolean,p_guild_name text default null,p_status text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.server_claim_requests%rowtype; s public.servers%rowtype; state text;
begin
 select * into c from public.server_claim_requests where id=p_claim_id for update;
 if not found or c.claimant_id is distinct from p_user_id then raise exception 'Claimant does not match this request' using errcode='42501'; end if;
 if c.status<>'pending' then raise exception 'This claim was already reviewed' using errcode='40001'; end if;
 select * into s from public.servers where id=c.server_id;
 if p_is_owner is not null then
  if coalesce(p_discord_user_id,'') !~ '^[0-9]{17,22}$' or coalesce(p_guild_id,'') !~ '^[0-9]{17,22}$' or not exists(select 1 from auth.identities where user_id=p_user_id and provider='discord' and coalesce(provider_id,identity_data->>'provider_id',identity_data->>'sub')=p_discord_user_id) then raise exception 'Discord identity does not match the claimant' using errcode='42501'; end if;
  if p_community_url is null or p_community_url !~* '^https://((www[.])?discord[.]gg/[a-z0-9_-]{2,100}/?|(www[.])?discord(app)?[.]com/invite/[a-z0-9_-]{2,100}/?)$' or p_community_url is distinct from s.community_url then raise exception 'The linked Discord invite changed; request a new verification' using errcode='40001'; end if;
 end if;
 if p_status is not null and p_status not in ('needs_discord','unavailable','not_owner','verified') then raise exception 'Invalid verification status'; end if;
 state:=case when p_is_owner is true then 'verified' when p_is_owner is false then 'not_owner' when p_status='needs_discord' then 'needs_discord' else 'unavailable' end;
 if char_length(coalesce(p_guild_name,''))>100 or coalesce(p_guild_name,'') ~ '[[:cntrl:]]' then raise exception 'Invalid Discord guild name'; end if;
 update public.server_claim_requests set community_url=s.community_url,verification_status=state,discord_user_id=case when p_is_owner is not null then p_discord_user_id else null end,guild_id=case when p_is_owner is not null then p_guild_id else null end,guild_name=case when p_is_owner is not null then nullif(btrim(p_guild_name),'') else null end,verified_at=case when state='verified' then now() else null end,verification_checked_at=now(),version=version+1,updated_at=now() where id=c.id returning * into c;
 return private.server_claim_json(c);
end;
$$;

create or replace function public.staff_server_claims(p_status text default 'pending',p_verification text default 'all',p_query text default '',p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if (select auth.uid()) is null or not public.has_staff_permission('servers.claims.review') then raise exception 'Claim-review permission required' using errcode='42501'; end if;
 if p_status not in ('all','pending','approved','denied','superseded') or p_verification not in ('all','unverified','pending_check','verified','not_owner','unavailable','needs_discord') or char_length(coalesce(p_query,''))>200 or p_limit not between 1 and 100 or p_offset not between 0 and 10000 then raise exception 'Invalid claim filters'; end if;
 with matched as(select c.* from public.server_claim_requests c join public.servers s on s.id=c.server_id left join public.profiles p on p.id=c.claimant_id where (p_status='all' or c.status=p_status) and (p_verification='all' or (case when c.verification_status='verified' and c.community_url is distinct from s.community_url then 'unavailable' else c.verification_status end)=p_verification or (p_verification='unverified' and (c.verification_status<>'verified' or c.community_url is distinct from s.community_url))) and (nullif(btrim(p_query),'') is null or position(lower(btrim(p_query)) in lower(concat_ws(' ',s.name,s.slug,p.display_name,c.message,c.guild_name,c.discord_user_id)))>0)),
 page as(select * from matched order by created_at desc,id limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(private.server_claim_json(c,true) order by c.created_at desc,c.id) from page c),'[]'::jsonb),'total',(select count(*) from matched),'counts',(select jsonb_build_object('pending',count(*)filter(where status='pending'),'verifiedPending',count(*)filter(where status='pending' and verification_status='verified' and community_url is not distinct from (select s.community_url from public.servers s where s.id=server_id)),'approved',count(*)filter(where status='approved'),'denied',count(*)filter(where status='denied'),'superseded',count(*)filter(where status='superseded')) from public.server_claim_requests)) into result;
 return result;
end;
$$;

create or replace function public.staff_decide_server_claim(p_id uuid,p_expected_version bigint,p_decision text,p_reason text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); c public.server_claim_requests%rowtype; s public.servers%rowtype; sid uuid; result jsonb; reason_text text:=btrim(coalesce(p_reason,''));
begin
 if actor is null or not public.has_staff_permission('servers.claims.review') then raise exception 'Claim-review permission required' using errcode='42501'; end if;
 if p_decision not in ('approve','deny') or char_length(reason_text) not between 5 and 500 or char_length(coalesce(p_request_id,'')) not between 8 and 120 then raise exception 'Provide a decision, review reason and request identifier'; end if;
 select after_state into result from public.staff_audit_events where actor_id=actor and action='server.claim.'||p_decision and target_id=p_id::text and request_id=p_request_id order by id desc limit 1;
 if result is not null then return result; end if;
 select server_id into sid from public.server_claim_requests where id=p_id;
 if sid is null then raise exception 'Claim not found'; end if;
 -- Every reviewer locks the server first, so competing requests cannot both win.
 select * into s from public.servers where id=sid for update;
 select * into c from public.server_claim_requests where id=p_id for update;
 if p_expected_version is null or c.version<>p_expected_version or c.status<>'pending' then raise exception 'This claim changed; refresh before deciding' using errcode='40001'; end if;
 if p_decision='approve' then
  if s.owner_id is not null or s.status<>'published' then raise exception 'This server is already claimed or unavailable' using errcode='40001'; end if;
  if c.claimant_id is null or not exists(select 1 from auth.users where id=c.claimant_id and deleted_at is null and not coalesce(is_anonymous,false)) then raise exception 'The claimant account is unavailable'; end if;
  if exists(select 1 from public.security_bans b where b.user_id=c.claimant_id and b.target_type='account' and b.revoked_at is null and b.starts_at<=now() and (b.ends_at is null or b.ends_at>now())) then raise exception 'The claimant account is restricted'; end if;
  -- Discord ownership is evidence, never an automatic server-ownership grant.
  update public.servers set owner_id=c.claimant_id,updated_at=now() where id=s.id;
  update public.server_claim_requests set status='superseded',decision_reason='Another ownership request was approved.',reviewed_by=actor,reviewed_at=now(),version=version+1,updated_at=now() where server_id=s.id and id<>c.id and status='pending';
 end if;
 update public.server_claim_requests set status=case when p_decision='approve' then 'approved' else 'denied' end,reviewed_by=actor,reviewed_at=now(),decision_reason=reason_text,version=version+1,updated_at=now() where id=c.id returning * into c;
 result:=private.server_claim_json(c,true);
 insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state,metadata) values(actor,'server.claim.'||p_decision,'server_claim',c.id::text,reason_text,p_request_id,jsonb_build_object('ownerId',s.owner_id,'status','pending'),result,jsonb_build_object('serverId',s.id,'verificationStatus',result->>'verificationStatus'));
 return result;
end;
$$;

-- Apply freshness before public search filters, facets, ranking and overview totals.
-- Only imported FiveM sources change; manually maintained listings retain their existing status behavior.
create or replace view private.effective_server_status with(security_invoker=true) as
 select s.id as server_id,
  case when i.server_id is not null and (i.last_checked_at is null or i.last_checked_at<now()-interval '5 minutes' or (i.last_error_at is not null and i.last_error_at>=i.last_checked_at)) then false else coalesce(x.online,false) end as online,
  case when i.server_id is not null and (i.last_checked_at is null or i.last_checked_at<now()-interval '5 minutes' or (i.last_error_at is not null and i.last_error_at>=i.last_checked_at)) then null else coalesce(x.players,0) end as players,
  case when i.server_id is not null and (i.last_checked_at is null or i.last_checked_at<now()-interval '5 minutes' or (i.last_error_at is not null and i.last_error_at>=i.last_checked_at)) then null else coalesce(x.capacity,0) end as capacity
 from public.servers s left join public.server_import_sources i on i.server_id=s.id
 left join lateral (select ss.online,ss.players,ss.capacity from public.server_status_snapshots ss where ss.server_id=s.id and (i.server_id is null or ss.provider_status='cfx') order by ss.checked_at desc,ss.id desc limit 1) x on true;
revoke all on private.effective_server_status from public,anon,authenticated,service_role;

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
      where word <> '' and strpos(lower(regexp_replace(replace(replace(coalesce(concat_ws(' ',d.name,d.description,d.platform_name,d.region,d.language,d.framework,d.tags::text),''),'-',' '),'_',' '),'\s+',' ','g')), word) = 0
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

create or replace function public.public_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'servers', (select count(*) from public.servers where status = 'published' and age_rating <> 'adult'),
    'online', (select count(distinct s.id) from public.servers s join private.effective_server_status x on x.server_id=s.id and x.online where s.status='published' and s.age_rating <> 'adult'),
    'verified', (select count(*) from public.servers where status='published' and verified and age_rating <> 'adult'),
    'players', (select coalesce(sum(x.players),0) from public.servers s join private.effective_server_status x on x.server_id=s.id where s.status='published' and s.age_rating <> 'adult'),
    'pendingReviews', 0,
    'boostsToday', (select coalesce(sum(amount),0) from public.boosts where boost_date=timezone('utc', now())::date),
    'toolRunsToday', (select count(*) from public.tool_events where occurred_on=timezone('utc', now())::date),
    'moderationHealth', 'Operational'
  );
$$;

revoke execute on function public.search_server_directory(text,text,text,text,boolean,boolean,boolean,text,integer),public.search_public_directory(jsonb),public.public_overview() from public;
grant execute on function public.search_server_directory(text,text,text,text,boolean,boolean,boolean,text,integer),public.search_public_directory(jsonb),public.public_overview() to anon,authenticated;

revoke execute on function public.service_stage_fivem_candidate(uuid,jsonb,text),public.service_fivem_sources(uuid,boolean,integer),public.service_claim_fivem_refresh(text),public.service_mark_fivem_unavailable(text),public.service_refresh_fivem_snapshot(text,boolean,integer,integer,timestamptz),public.service_verify_server_claim(uuid,uuid,text,text,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.service_stage_fivem_candidate(uuid,jsonb,text),public.service_fivem_sources(uuid,boolean,integer),public.service_claim_fivem_refresh(text),public.service_mark_fivem_unavailable(text),public.service_refresh_fivem_snapshot(text,boolean,integer,integer,timestamptz),public.service_verify_server_claim(uuid,uuid,text,text,text,boolean,text,text) to service_role;
revoke execute on function public.staff_fivem_candidates(text,text,integer,integer),public.staff_fivem_candidate(uuid),public.staff_dismiss_fivem_candidate(uuid,bigint,text,text),public.staff_publish_fivem_candidate(uuid,bigint,jsonb,text,text),public.member_server_claim(uuid,text,text,text),public.member_server_claims(uuid),public.staff_server_claims(text,text,text,integer,integer),public.staff_decide_server_claim(uuid,bigint,text,text,text) from public,anon,service_role;
grant execute on function public.staff_fivem_candidates(text,text,integer,integer),public.staff_fivem_candidate(uuid),public.staff_dismiss_fivem_candidate(uuid,bigint,text,text),public.staff_publish_fivem_candidate(uuid,bigint,jsonb,text,text),public.member_server_claim(uuid,text,text,text),public.member_server_claims(uuid),public.staff_server_claims(text,text,text,integer,integer),public.staff_decide_server_claim(uuid,bigint,text,text,text) to authenticated;
revoke execute on function public.public_server_import_details(uuid[]) from public;
grant execute on function public.public_server_import_details(uuid[]) to anon,authenticated,service_role;
commit;
