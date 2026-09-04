-- Cfx join codes are globally unique. Keep existing FiveM records and APIs while
-- storing an explicit immutable platform for reviewed FiveM and RedM imports.
alter table public.fivem_import_candidates add column platform text not null default 'fivem' check(platform in ('fivem','redm'));
alter table public.server_import_sources add column platform text not null default 'fivem' check(platform in ('fivem','redm'));
update public.fivem_import_candidates set candidate=candidate||jsonb_build_object('platform',platform);
alter table public.fivem_import_candidates add constraint cfx_candidate_platform_matches check(candidate->>'platform'=platform);
create index cfx_candidates_platform_status_idx on public.fivem_import_candidates(platform,status,updated_at desc,id);

create or replace function private.cfx_candidate_validate(p_platform text,p_data jsonb,p_publishing boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare d jsonb;
begin
 if p_platform is null or p_platform not in ('fivem','redm') then raise exception 'Invalid Cfx platform'; end if;
 if p_data->>'platform' is distinct from p_platform then raise exception 'Candidate platform does not match this importer'; end if;
 -- Keep the existing strict link, field, image, content-length and count validation.
 d:=private.fivem_candidate_validate(p_data-'platform',p_publishing);
 return d||jsonb_build_object('platform',p_platform);
end;
$$;
revoke all on function private.cfx_candidate_validate(text,jsonb,boolean) from public,anon,authenticated,service_role;


create or replace function public.service_stage_cfx_candidate(p_platform text,p_actor_id uuid,p_candidate jsonb,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb; c public.fivem_import_candidates%rowtype; s public.servers%rowtype;
begin
 if p_platform is null or p_platform not in ('fivem','redm') then raise exception 'Invalid Cfx platform'; end if;
 if not private.import_actor_allowed(p_actor_id,'scrapers.manage') then raise exception 'Scraper permission required' using errcode='42501'; end if;
 if char_length(coalesce(p_request_id,'')) not between 8 and 120 then raise exception 'A valid request identifier is required'; end if;
 d:=private.cfx_candidate_validate(p_platform,p_candidate,false);
 -- Source identity is authoritative; detect older owner-created rows using the same Cfx code.
 select * into s from public.servers where platform_id=p_platform and lower(rtrim(cfx_join_url,'/'))=d->>'joinUrl' order by created_at limit 1;
 insert into public.fivem_import_candidates(platform,join_code,candidate,created_by,server_id,status)
 values(p_platform,d->>'joinCode',d,p_actor_id,s.id,case when s.id is not null then 'published' else 'pending' end)
 on conflict(join_code) do update set candidate=excluded.candidate,updated_at=now(),version=public.fivem_import_candidates.version+1
 where public.fivem_import_candidates.platform=excluded.platform
 returning * into c;
 if c.id is null then raise exception 'This Cfx join code belongs to a different platform'; end if;
 return jsonb_build_object('id',c.id,'platform',c.platform,'joinCode',c.join_code,'status',c.status,'version',c.version,'candidate',c.candidate,'serverId',c.server_id,'createdAt',c.created_at,'updatedAt',c.updated_at);
end;
$$;


create or replace function public.staff_cfx_candidates(p_platform text,p_status text default 'all',p_query text default '',p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_platform is null or p_platform not in ('fivem','redm') then raise exception 'Invalid Cfx platform'; end if;
 if (select auth.uid()) is null or not public.has_staff_permission('scrapers.manage') then raise exception 'Scraper permission required' using errcode='42501'; end if;
 if p_status not in ('all','pending','published','dismissed') or char_length(coalesce(p_query,''))>200 or p_limit not between 1 and 100 or p_offset not between 0 and 10000 then raise exception 'Invalid scraper filters'; end if;
 with matched as (select c.* from public.fivem_import_candidates c where c.platform=p_platform and (p_status='all' or c.status=p_status) and (nullif(btrim(p_query),'') is null or position(lower(btrim(p_query)) in lower(concat_ws(' ',c.join_code,c.candidate->>'name',c.candidate->>'description')))>0)),
 page as(select * from matched order by updated_at desc,id limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'platform',c.platform,'joinCode',c.join_code,'status',c.status,'version',c.version,'candidate',c.candidate,'serverId',c.server_id,'createdAt',c.created_at,'updatedAt',c.updated_at) order by c.updated_at desc,c.id) from page c),'[]'::jsonb),'total',(select count(*) from matched)) into result;
 return result;
end;
$$;


create or replace function public.staff_cfx_candidate(p_platform text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.fivem_import_candidates%rowtype;
begin
 if p_platform is null or p_platform not in ('fivem','redm') then raise exception 'Invalid Cfx platform'; end if;
 if (select auth.uid()) is null or not public.has_staff_permission('scrapers.manage') then raise exception 'Scraper permission required' using errcode='42501'; end if;
 select * into c from public.fivem_import_candidates where id=p_id and platform=p_platform;
 if not found then return null; end if;
 return jsonb_build_object('id',c.id,'platform',c.platform,'joinCode',c.join_code,'status',c.status,'version',c.version,'candidate',c.candidate,'serverId',c.server_id,'createdAt',c.created_at,'updatedAt',c.updated_at);
end;
$$;


create or replace function public.staff_publish_cfx_candidate(p_platform text,p_id uuid,p_expected_version bigint,p_data jsonb,p_reason text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); c public.fivem_import_candidates%rowtype; s public.servers%rowtype; d jsonb; k text; slug_text text; result jsonb; reason_text text:=btrim(coalesce(p_reason,''));
begin
 if p_platform is null or p_platform not in ('fivem','redm') then raise exception 'Invalid Cfx platform'; end if;
 if actor is null or not public.has_staff_permission('scrapers.manage') then raise exception 'Scraper permission required' using errcode='42501'; end if;
 if char_length(reason_text) not between 5 and 500 or char_length(coalesce(p_request_id,'')) not between 8 and 120 then raise exception 'Provide a review reason and request identifier'; end if;
 select after_state into result from public.staff_audit_events where actor_id=actor and action=p_platform||'.import.published' and target_id=p_id::text and request_id=p_request_id order by id desc limit 1;
 if result is not null then return result; end if;
 select * into c from public.fivem_import_candidates where id=p_id and platform=p_platform for update;
 if not found then raise exception 'Candidate not found'; end if;
 if p_expected_version is null or c.version<>p_expected_version then raise exception 'This candidate changed; refresh before publishing' using errcode='40001'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>30000 then raise exception 'Invalid reviewed fields'; end if;
 for k in select jsonb_object_keys(p_data) loop
  if not(k=any(array['name','description','region','language','framework','accessType','discordUrl','websiteUrl','bannerUrl','logoUrl','tags','keywords'])) then raise exception 'Unexpected reviewed field'; end if;
 end loop;
 d:=private.cfx_candidate_validate(p_platform,c.candidate||p_data,true);
 -- Serialize by Cfx source and then lock an existing server. Imports never overwrite owned metadata.
 perform pg_advisory_xact_lock(hashtextextended('browserp.cfx.'||c.join_code,0));
 select * into s from public.servers where platform_id=p_platform and lower(rtrim(cfx_join_url,'/'))=d->>'joinUrl' order by created_at limit 1 for update;
 if s.id is null and c.server_id is not null then select * into s from public.servers where id=c.server_id and platform_id=p_platform for update; end if;
 if s.id is not null and s.owner_id is not null then raise exception 'This server already has an owner; imports cannot overwrite it' using errcode='40001'; end if;
 if s.id is not null and not exists(select 1 from public.server_import_sources where server_id=s.id and join_code=c.join_code and platform=p_platform) then raise exception 'This listing already exists; review it in Moderation instead of importing a duplicate' using errcode='40001'; end if;
 if s.id is null then
  slug_text:=left(trim(both '-' from regexp_replace(lower(d->>'name'),'[^a-z0-9]+','-','g')),78);
  if char_length(slug_text)<3 then slug_text:=p_platform||'-server'; end if;
  slug_text:=slug_text||'-'||c.join_code;
  if exists(select 1 from public.servers where slug=slug_text) then slug_text:=p_platform||'-'||c.join_code||'-'||substr(c.id::text,1,8); end if;
  insert into public.servers(owner_id,platform_id,name,slug,description,region,language,framework,community_url,website_url,cfx_join_url,access_type,status,verified,theme_start,theme_end,published_at)
  values(null,p_platform,d->>'name',slug_text,d->>'description',d->>'region',d->>'language',d->>'framework',d->>'discordUrl',d->>'websiteUrl',d->>'joinUrl',d->>'accessType','published',false,case when p_platform='redm' then '#9d3039' else '#b85d24' end,case when p_platform='redm' then '#ef737b' else '#ef9346' end,now()) returning * into s;
 else
  if s.status in ('suspended','rejected','archived') then raise exception 'Restore this listing through Moderation before importing updates'; end if;
  update public.servers set name=d->>'name',description=d->>'description',region=d->>'region',language=d->>'language',framework=d->>'framework',community_url=d->>'discordUrl',website_url=d->>'websiteUrl',access_type=d->>'accessType',status='published',published_at=coalesce(published_at,now()),updated_at=now() where id=s.id returning * into s;
 end if;
 insert into public.server_import_sources(platform,server_id,join_code,source_url,logo_url,banner_url,keywords,imported_by)
 values(p_platform,s.id,c.join_code,d->>'sourceUrl',d->>'logoUrl',d->>'bannerUrl',array(select jsonb_array_elements_text(d->'keywords')),actor)
 on conflict(server_id) do update set logo_url=excluded.logo_url,banner_url=excluded.banner_url,keywords=excluded.keywords;
 delete from public.server_tags where server_id=s.id and source='system';
 insert into public.server_tags(server_id,tag,source,relevance_score) select s.id,value,'system',60 from (select distinct lower(btrim(value)) value from jsonb_array_elements_text(d->'tags')) t on conflict(server_id,tag) do nothing;
 if d->>'players' is not null and d->>'capacity' is not null and d->>'online' is not null and (d->>'checkedAt')::timestamptz between now()-interval '5 minutes' and now()+interval '1 minute' then
  insert into public.server_status_snapshots(server_id,online,players,capacity,provider_status,checked_at) values(s.id,(d->>'online')::boolean,(d->>'players')::int,(d->>'capacity')::int,'cfx',(d->>'checkedAt')::timestamptz);
  update public.server_import_sources set last_checked_at=(d->>'checkedAt')::timestamptz,next_refresh_at=now()+interval '60 seconds' where server_id=s.id;
 end if;
 update public.fivem_import_candidates set candidate=d,status='published',server_id=s.id,reviewed_by=actor,review_reason=reason_text,version=version+1,updated_at=now() where id=c.id returning * into c;
 result:=jsonb_build_object('id',c.id,'serverId',s.id,'slug',s.slug,'status','published','version',c.version);
 insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state,metadata) values(actor,p_platform||'.import.published',p_platform||'_candidate',c.id::text,reason_text,p_request_id,result,jsonb_build_object('serverId',s.id,'joinCode',c.join_code));
 return result;
end;
$$;


create or replace function public.staff_dismiss_cfx_candidate(p_platform text,p_id uuid,p_expected_version bigint,p_reason text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); c public.fivem_import_candidates%rowtype; result jsonb; reason_text text:=btrim(coalesce(p_reason,''));
begin
 if p_platform is null or p_platform not in ('fivem','redm') then raise exception 'Invalid Cfx platform'; end if;
 if actor is null or not public.has_staff_permission('scrapers.manage') then raise exception 'Scraper permission required' using errcode='42501'; end if;
 if char_length(reason_text) not between 5 and 500 or char_length(coalesce(p_request_id,'')) not between 8 and 120 then raise exception 'Provide a review reason and request identifier'; end if;
 select after_state into result from public.staff_audit_events where actor_id=actor and action=p_platform||'.import.dismissed' and target_id=p_id::text and request_id=p_request_id order by id desc limit 1;
 if result is not null then return result; end if;
 select * into c from public.fivem_import_candidates where id=p_id and platform=p_platform for update;
 if not found then raise exception 'Candidate not found'; end if;
 if p_expected_version is null or c.version<>p_expected_version then raise exception 'This candidate changed; refresh before dismissing' using errcode='40001'; end if;
 if c.server_id is not null then raise exception 'An imported server must be managed in Moderation'; end if;
 update public.fivem_import_candidates set status='dismissed',reviewed_by=actor,review_reason=reason_text,version=version+1,updated_at=now() where id=c.id returning * into c;
 result:=jsonb_build_object('id',c.id,'status',c.status,'version',c.version);
 insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state) values(actor,p_platform||'.import.dismissed',p_platform||'_candidate',c.id::text,reason_text,p_request_id,result);
 return result;
end;
$$;


create or replace function public.service_cfx_sources(p_platform text,p_server_id uuid default null,p_due_only boolean default false,p_limit integer default 25)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select s.id as "serverId",i.platform,i.join_code as "joinCode",s.slug,i.last_checked_at as "lastCheckedAt",i.next_refresh_at as "nextRefreshAt" from public.server_import_sources i join public.servers s on s.id=i.server_id where (p_platform is null or i.platform=p_platform) and s.platform_id=i.platform and s.status='published' and s.age_rating<>'adult' and (p_server_id is null or s.id=p_server_id) and (not coalesce(p_due_only,false) or i.next_refresh_at<=now()) order by i.next_refresh_at,s.id limit least(greatest(coalesce(p_limit,25),1),100)) x;
$$;


create or replace function public.service_claim_cfx_refresh(p_platform text,p_join_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare claimed uuid;
begin
 if p_platform is null or p_platform not in ('fivem','redm') then raise exception 'Invalid Cfx platform'; end if;
 update public.server_import_sources i set next_refresh_at=now()+interval '60 seconds' from public.servers s where s.id=i.server_id and s.status='published' and s.age_rating<>'adult' and i.join_code=p_join_code and i.platform=p_platform and s.platform_id=p_platform and i.next_refresh_at<=now() returning i.server_id into claimed;
 return claimed is not null;
end;
$$;


create or replace function public.service_refresh_cfx_snapshot(p_platform text,p_join_code text,p_online boolean,p_players integer,p_capacity integer,p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; last_seen timestamptz;
begin
 if p_platform is null or p_platform not in ('fivem','redm') then raise exception 'Invalid Cfx platform'; end if;
 if p_online is null or p_players is null or p_capacity is null or p_players not between 0 and 100000 or p_capacity not between 0 and 100000 or p_players>p_capacity or p_observed_at is null or not isfinite(p_observed_at) or p_observed_at not between now()-interval '5 minutes' and now()+interval '1 minute' then raise exception 'A current verified player observation is required'; end if;
 select i.server_id,i.last_checked_at into sid,last_seen from public.server_import_sources i join public.servers s on s.id=i.server_id where i.join_code=p_join_code and i.platform=p_platform and s.platform_id=p_platform and s.status='published' and s.age_rating<>'adult' for update of i;
 if sid is null then raise exception 'Unknown published Cfx import'; end if;
 if last_seen is not null and p_observed_at<=last_seen then return jsonb_build_object('serverId',sid,'checkedAt',last_seen,'unchanged',true); end if;
 insert into public.server_status_snapshots(server_id,online,players,capacity,provider_status,checked_at) values(sid,p_online,p_players,p_capacity,'cfx',p_observed_at);
 update public.server_import_sources set last_checked_at=p_observed_at,next_refresh_at=greatest(next_refresh_at,now()+interval '60 seconds'),last_error_at=null where server_id=sid;
 delete from public.server_status_snapshots where server_id=sid and provider_status='cfx' and checked_at<now()-interval '30 days';
 return jsonb_build_object('serverId',sid,'checkedAt',p_observed_at,'online',p_online,'players',p_players,'capacity',p_capacity);
end;
$$;


create or replace function public.service_mark_cfx_unavailable(p_platform text,p_join_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 if p_platform is null or p_platform not in ('fivem','redm') then raise exception 'Invalid Cfx platform'; end if;
 update public.server_import_sources i set last_error_at=now(),next_refresh_at=greatest(next_refresh_at,now()+interval '60 seconds') from public.servers s where s.id=i.server_id and s.status='published' and i.join_code=p_join_code and i.platform=p_platform and s.platform_id=p_platform returning i.server_id into sid;
 return sid is not null;
end;
$$;


create or replace function public.service_stage_fivem_candidate(p_actor_id uuid,p_candidate jsonb,p_request_id text)
returns jsonb language sql security definer set search_path='' as $$
 select public.service_stage_cfx_candidate('fivem',p_actor_id,jsonb_build_object('platform','fivem')||p_candidate,p_request_id);
$$;


create or replace function public.staff_fivem_candidates(p_status text default 'all',p_query text default '',p_limit integer default 25,p_offset integer default 0)
returns jsonb language sql security definer set search_path='' as $$
 select public.staff_cfx_candidates('fivem',p_status,p_query,p_limit,p_offset);
$$;


create or replace function public.staff_fivem_candidate(p_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select public.staff_cfx_candidate('fivem',p_id);
$$;


create or replace function public.staff_publish_fivem_candidate(p_id uuid,p_expected_version bigint,p_data jsonb,p_reason text,p_request_id text)
returns jsonb language sql security definer set search_path='' as $$
 select public.staff_publish_cfx_candidate('fivem',p_id,p_expected_version,p_data,p_reason,p_request_id);
$$;


create or replace function public.staff_dismiss_fivem_candidate(p_id uuid,p_expected_version bigint,p_reason text,p_request_id text)
returns jsonb language sql security definer set search_path='' as $$
 select public.staff_dismiss_cfx_candidate('fivem',p_id,p_expected_version,p_reason,p_request_id);
$$;


create or replace function public.service_fivem_sources(p_server_id uuid default null,p_due_only boolean default false,p_limit integer default 25)
returns jsonb language sql security definer set search_path='' as $$
 select public.service_cfx_sources('fivem',p_server_id,p_due_only,p_limit);
$$;


create or replace function public.service_claim_fivem_refresh(p_join_code text)
returns boolean language sql security definer set search_path='' as $$
 select public.service_claim_cfx_refresh('fivem',p_join_code);
$$;


create or replace function public.service_refresh_fivem_snapshot(p_join_code text,p_online boolean,p_players integer,p_capacity integer,p_observed_at timestamptz)
returns jsonb language sql security definer set search_path='' as $$
 select public.service_refresh_cfx_snapshot('fivem',p_join_code,p_online,p_players,p_capacity,p_observed_at);
$$;


create or replace function public.service_mark_fivem_unavailable(p_join_code text)
returns boolean language sql security definer set search_path='' as $$
 select public.service_mark_cfx_unavailable('fivem',p_join_code);
$$;


create or replace function public.public_server_import_details(p_server_ids uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('serverId',s.id,'platform',s.platform_id,'imported',i.server_id is not null,'claimable',s.owner_id is null,'joinCode',i.join_code,'logoUrl',i.logo_url,'bannerUrl',i.banner_url,'websiteUrl',s.website_url,'keywords',coalesce(to_jsonb(i.keywords),'[]'::jsonb),'lastCheckedAt',i.last_checked_at,'statusUnavailable',i.last_error_at is not null and (i.last_checked_at is null or i.last_error_at>=i.last_checked_at))),'[]'::jsonb)
 from public.servers s left join public.server_import_sources i on i.server_id=s.id
 where s.id=any(p_server_ids[1:100]) and s.status='published' and s.age_rating<>'adult';
$$;

revoke all on function public.service_stage_cfx_candidate(text,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.service_stage_cfx_candidate(text,uuid,jsonb,text) to service_role;

revoke all on function public.staff_cfx_candidates(text,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.staff_cfx_candidates(text,text,text,integer,integer) to authenticated;

revoke all on function public.staff_cfx_candidate(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.staff_cfx_candidate(text,uuid) to authenticated;

revoke all on function public.staff_publish_cfx_candidate(text,uuid,bigint,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.staff_publish_cfx_candidate(text,uuid,bigint,jsonb,text,text) to authenticated;

revoke all on function public.staff_dismiss_cfx_candidate(text,uuid,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.staff_dismiss_cfx_candidate(text,uuid,bigint,text,text) to authenticated;

revoke all on function public.service_cfx_sources(text,uuid,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.service_cfx_sources(text,uuid,boolean,integer) to service_role;

revoke all on function public.service_claim_cfx_refresh(text,text) from public,anon,authenticated,service_role;
grant execute on function public.service_claim_cfx_refresh(text,text) to service_role;

revoke all on function public.service_refresh_cfx_snapshot(text,text,boolean,integer,integer,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.service_refresh_cfx_snapshot(text,text,boolean,integer,integer,timestamptz) to service_role;

revoke all on function public.service_mark_cfx_unavailable(text,text) from public,anon,authenticated,service_role;
grant execute on function public.service_mark_cfx_unavailable(text,text) to service_role;
