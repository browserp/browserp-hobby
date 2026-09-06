-- Prerequisite: reviewed_owner_listing_updates. Retain existing catalog and researched keywords.
begin;
insert into public.server_tag_catalog(key,label,group_name,sort_order) values
('economy','Economy','Features',100),
('serious-roleplay','Serious RP','Features',101),
('semi-serious','Semi-serious RP','Features',102),
('beginner-friendly','Beginner friendly','Features',103),
('custom-clothing','Custom clothing','Features',104),
('custom-cars','Custom vehicles','Features',105),
('custom-jobs','Custom jobs','Features',106),
('player-businesses','Player businesses','Features',107),
('housing','Housing','Features',108),
('police','Police','Features',109),
('ems','EMS','Features',110),
('gangs','Gangs','Features',111),
('civilian-jobs','Civilian jobs','Features',112),
('outlaw-rp','Outlaw RP','Features',113),
('lawmen','Lawmen','Features',114),
('ranching','Ranching','Features',115),
('horses','Horses','Features',116),
('hunting','Hunting','Features',117),
('crafting','Crafting','Features',118),
('java','Java Edition','Features',119),
('bedrock','Bedrock Edition','Features',120),
('crossplay','Crossplay','Features',121),
('modded','Modded','Features',122),
('vanilla','Vanilla','Features',123),
('land-claims','Land claims','Features',124),
('pve','PvE','Features',125),
('pvp','PvP','Features',126),
('quests','Quests','Features',127),
('custom-worlds','Custom worlds','Features',128),
('voice-chat','Voice chat','Features',129),
('events','Community events','Features',130),
('custom-avatars','Custom avatars','Features',131),
('vehicles','Vehicles','Features',132),
('jobs','Jobs','Features',133),
('mobile-friendly','Mobile friendly','Features',134),
('controller-support','Controller support','Features',135)
on conflict(key) do nothing;

create or replace function private.listing_feature_keys(p_platform text)
returns text[] language sql immutable set search_path='' as $$
 select case p_platform
 when 'fivem' then array['serious-roleplay','semi-serious','beginner-friendly','economy','custom-cars','custom-clothing','custom-jobs','player-businesses','housing','police','ems','civilian-jobs','gangs']::text[]
 when 'redm' then array['serious-roleplay','semi-serious','beginner-friendly','economy','outlaw-rp','lawmen','ranching','horses','hunting','crafting','player-businesses','housing']::text[]
 when 'minecraft' then array['beginner-friendly','java','bedrock','crossplay','modded','vanilla','land-claims','pve','pvp','quests','custom-worlds','voice-chat','economy']::text[]
 when 'roblox' then array['beginner-friendly','serious-roleplay','semi-serious','events','voice-chat','custom-avatars','vehicles','housing','jobs','mobile-friendly','controller-support']::text[]
 else '{}'::text[] end;
$$;
revoke all on function private.listing_feature_keys(text) from public,anon,authenticated,service_role;

-- Trust comes from the locked, recorded owned listing, never a client flag.
create or replace function private.validate_owned_listing_features(p_user_id uuid,p_server_id uuid,p_data jsonb,p_confidence text,p_score integer,p_reasons jsonb)
returns text[] language plpgsql security definer set search_path='' as $$
declare target public.servers;existing text[];desired text[];added text[];editable text[];
begin
 select * into target from public.servers where id=p_server_id for update;
 if not found or p_user_id is null or target.owner_id is distinct from p_user_id or target.status<>'published' or target.age_rating='adult'
   or p_data->>'platform' is distinct from target.platform_id then
  raise exception 'This published listing is not available in your account.' using errcode='PT403';end if;
 perform private.validate_submission_application(jsonb_set(p_data,'{tags}','[]'::jsonb),p_confidence,p_score,p_reasons);
 if jsonb_typeof(p_data->'tags') is distinct from 'array' or exists(select 1 from jsonb_array_elements(p_data->'tags') x where jsonb_typeof(x)<>'string') then
  raise exception 'Choose valid community features.' using errcode='22023';end if;
 select coalesce(array_agg(t.tag order by t.tag),'{}'::text[]) into existing from public.server_tags t where t.server_id=target.id;
 select coalesce(array_agg(distinct x order by x),'{}'::text[]) into desired from jsonb_array_elements_text(p_data->'tags') x;
 if cardinality(desired)<>jsonb_array_length(p_data->'tags') or cardinality(desired)>greatest(30,cardinality(existing))
   or exists(select 1 from unnest(desired) x where char_length(x) not between 1 and 40) then
  raise exception 'Keep the existing listing keywords and choose up to eight new features.' using errcode='22023';end if;
 editable:=private.listing_feature_keys(target.platform_id);
 if exists(select 1 from unnest(existing) x where not(x=any(editable)) and not(x=any(desired))) then
  raise exception 'Keep existing researched keywords in this update. Staff can review keyword removals.' using errcode='22023';end if;
 select coalesce(array_agg(x),'{}'::text[]) into added from unnest(desired) x where not(x=any(existing));
 if cardinality(added)>8 or exists(select 1 from unnest(added) x where not(x=any(editable)) or not exists(select 1 from public.server_tag_catalog t where t.key=x and t.enabled)) then
  raise exception 'Choose up to eight new features that match this game.' using errcode='22023';end if;
 return desired;
end;
$$;
revoke all on function private.validate_owned_listing_features(uuid,uuid,jsonb,text,integer,jsonb) from public,anon,authenticated,service_role;

create or replace function private.create_reviewed_listing_application(
 p_user_id uuid,p_session_id uuid,p_expected_user_id uuid,p_data jsonb,p_moderation_confidence text,p_moderation_score integer,p_moderation_reasons jsonb,
 p_request_id text,p_idempotency_key text,p_terms_version text,p_standards_version text,p_owned_server_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.server_submissions;previous private.submission_creation_requests;fingerprint text;v_tags text[];
begin
 if p_user_id is distinct from p_expected_user_id or p_user_id is null then raise exception 'Your signed-in account changed. Open a new application.' using errcode='PT401';end if;
 perform 1 from auth.sessions a join auth.users u on u.id=a.user_id where a.id=p_session_id and a.user_id=p_user_id
 and (a.not_after is null or a.not_after>now()) and u.deleted_at is null and not coalesce(u.is_anonymous,false) for share of a,u;
 if not found then raise exception 'Sign in again before submitting your listing.' using errcode='PT401';end if;
 if not exists(select 1 from public.profiles where id=p_user_id) or exists(select 1 from public.security_bans b where b.user_id=p_user_id and b.target_type='account'
 and b.revoked_at is null and b.starts_at<=now() and (b.ends_at is null or b.ends_at>now())) then raise exception 'This account is restricted.' using errcode='42501';end if;
 if p_terms_version is distinct from '2026-08-19' or p_standards_version is distinct from '2026-08-19' then raise exception 'Current terms and listing standards must be accepted';end if;
 if p_idempotency_key is null or p_idempotency_key!~'^[a-f0-9]{64}$' or p_request_id is null or p_request_id!~*'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'Invalid application request.' using errcode='22023';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('data',p_data,'terms',p_terms_version,'standards',p_standards_version)::text,'UTF8')),'hex');
 -- Serialise a member's submissions as well as retries so the open-submission cap cannot race.
 perform pg_advisory_xact_lock(hashtextextended('application-create:'||p_user_id::text,0));
 select * into previous from private.submission_creation_requests where user_id=p_user_id and idempotency_key=p_idempotency_key;
 if found then
  if previous.owner_update_server_id is distinct from p_owned_server_id then raise exception 'This retry belongs to another listing request.' using errcode='PT409';end if;
  if previous.fingerprint is distinct from fingerprint then raise exception 'This retry contains different details. Start a new application attempt.' using errcode='PT409';end if;
  select * into s from public.server_submissions where id=previous.submission_id;
  return jsonb_build_object('id',s.id,'status',s.status,'review_version',s.review_version,'idempotent',true);
 end if;
 if p_owned_server_id is not null then
  v_tags:=private.validate_owned_listing_features(p_user_id,p_owned_server_id,p_data,p_moderation_confidence,p_moderation_score,p_moderation_reasons);
 else
  if p_data->>'platform' not in ('fivem','redm','minecraft','roblox') then raise exception 'Applications are open for FiveM, RedM, Minecraft and Roblox.' using errcode='22023';end if;
  v_tags:=private.validate_submission_application(p_data,p_moderation_confidence,p_moderation_score,p_moderation_reasons);
  if exists(select 1 from unnest(v_tags) x where not(x=any(private.listing_feature_keys(p_data->>'platform')))) then raise exception 'Some feature choices have changed. Keep this page open and copy your draft into the updated listing form in another tab.' using errcode='22023';end if;
 end if;
 if (select count(*) from public.server_submissions where submitted_by=p_user_id and status in ('pending_review','changes_requested'))>=5 then raise exception 'Too many open submissions';end if;
 if not public.consume_rate_limit(md5('member:'||p_user_id::text),'application-create',3,3600) then raise exception 'Too many attempts. Please wait before trying again.' using errcode='PT429';end if;
 insert into public.server_submissions(submitted_by,platform_id,name,region,language,framework,description,community_url,tags,access_type,cfx_join_url,roblox_details,
 moderation_confidence,moderation_score,moderation_reasons,request_id,idempotency_key,request_fingerprint,metadata_fingerprint,terms_version,standards_version)
 values(p_user_id,p_data->>'platform',btrim(p_data->>'name'),btrim(p_data->>'region'),btrim(p_data->>'language'),nullif(btrim(p_data->>'framework'),''),btrim(p_data->>'description'),nullif(p_data->>'communityUrl',''),v_tags,p_data->>'accessType',nullif(p_data->>'cfxJoinUrl',''),
 case when p_data->>'platform'='roblox' then (p_data->'roblox')-'applicantRole'-'authorityEvidence' else null end,
 p_moderation_confidence,p_moderation_score,coalesce(p_moderation_reasons,'[]'),p_request_id,p_idempotency_key,fingerprint,fingerprint,p_terms_version,p_standards_version) returning * into s;
 perform private.save_submission_roblox_evidence(s.id,s.platform_id,p_data->'roblox');
 insert into public.moderation_queue(target_type,target_id,confidence,score,reasons) values('server_submission',s.id::text,p_moderation_confidence,p_moderation_score,coalesce(p_moderation_reasons,'[]'));
 insert into private.submission_creation_requests(user_id,idempotency_key,fingerprint,submission_id,owner_update_server_id) values(p_user_id,p_idempotency_key,fingerprint,s.id,p_owned_server_id);
 return jsonb_build_object('id',s.id,'status',s.status,'review_version',s.review_version,'idempotent',false);
end;
$$;
revoke all on function private.create_reviewed_listing_application(uuid,uuid,uuid,jsonb,text,integer,jsonb,text,text,text,text,uuid) from public,anon,authenticated,service_role;

create or replace function public.create_server_application_server(
 p_user_id uuid,p_session_id uuid,p_expected_user_id uuid,p_data jsonb,p_moderation_confidence text,p_moderation_score integer,p_moderation_reasons jsonb,
 p_request_id text,p_idempotency_key text,p_terms_version text,p_standards_version text
)
returns jsonb language sql security definer set search_path='' as $$
 select private.create_reviewed_listing_application(p_user_id,p_session_id,p_expected_user_id,p_data,p_moderation_confidence,p_moderation_score,p_moderation_reasons,p_request_id,p_idempotency_key,p_terms_version,p_standards_version,null);
$$;
revoke all on function public.create_server_application_server(uuid,uuid,uuid,jsonb,text,integer,jsonb,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_server_application_server(uuid,uuid,uuid,jsonb,text,integer,jsonb,text,text,text,text) to service_role;

create or replace function public.propose_owned_listing_update_server(
 p_user_id uuid,p_session_id uuid,p_expected_user_id uuid,p_server_id uuid,p_expected_server_version bigint,
 p_data jsonb,p_moderation_confidence text,p_moderation_score integer,p_moderation_reasons jsonb,
 p_request_id text,p_idempotency_key text,p_terms_version text,p_standards_version text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;previous private.submission_creation_requests;current_listing public.servers;
begin
 -- Same member lock as the atomic creator; ties retries to the target as well as content.
 perform pg_advisory_xact_lock(hashtextextended('application-create:'||p_user_id::text,0));
 select r.* into previous from private.submission_creation_requests r
 where r.user_id=p_user_id and r.idempotency_key=p_idempotency_key;
 if found then
  if previous.owner_update_server_id is distinct from p_server_id or previous.owner_update_version is distinct from p_expected_server_version then
   raise exception 'This retry belongs to different listing details. Start a new update attempt.' using errcode='PT409';end if;
  -- Replays still revalidate the session and original full payload in the atomic creator.
  return private.create_reviewed_listing_application(p_user_id,p_session_id,p_expected_user_id,p_data,p_moderation_confidence,p_moderation_score,p_moderation_reasons,p_request_id,p_idempotency_key,p_terms_version,p_standards_version,p_server_id);
 end if;
 current_listing:=private.check_owner_listing_update(p_user_id,p_server_id,p_expected_server_version,p_data);
 if exists(select 1 from public.server_submissions where owner_update_server_id=p_server_id and status in ('pending_review','changes_requested')) then
  raise exception 'An update is already being reviewed for this listing. Open its progress in My account.' using errcode='PT409';end if;
 result:=private.create_reviewed_listing_application(p_user_id,p_session_id,p_expected_user_id,p_data,p_moderation_confidence,p_moderation_score,p_moderation_reasons,p_request_id,p_idempotency_key,p_terms_version,p_standards_version,p_server_id);
 update public.server_submissions set owner_update_server_id=p_server_id,owner_update_version=p_expected_server_version where id=(result->>'id')::uuid;
 update private.submission_creation_requests set owner_update_server_id=p_server_id,owner_update_version=p_expected_server_version
 where user_id=p_user_id and idempotency_key=p_idempotency_key;
 return result||jsonb_build_object('review_version',(select review_version from public.server_submissions where id=(result->>'id')::uuid));
end;
$$;

create or replace function private.resubmit_before_owner_updates(
  p_user_id uuid,p_session_id uuid,p_submission_id uuid,p_expected_version bigint,p_expected_queue_version bigint,
  p_idempotency_key text,p_data jsonb,p_moderation_confidence text,p_moderation_score integer,p_moderation_reasons jsonb,
  p_terms_version text,p_standards_version text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s public.server_submissions;
  previous private.server_submission_corrections;
  fingerprint text;
  v_tags text[];
  queue_version bigint;
  p_name text:=p_data->>'name';
  p_platform_id text:=p_data->>'platform';
  p_region text:=p_data->>'region';
  p_language text:=p_data->>'language';
  p_framework text:=p_data->>'framework';
  p_description text:=p_data->>'description';
  v_url text:=nullif(btrim(coalesce(p_data->>'communityUrl','')),'');
  cfx text:=nullif(btrim(coalesce(p_data->>'cfxJoinUrl','')),'');
  v_access_type text:=p_data->>'accessType';
begin
  -- A previously valid access token does not authorize an ended session.
  perform 1 from auth.sessions a join auth.users u on u.id=a.user_id
    where a.id=p_session_id and a.user_id=p_user_id and (a.not_after is null or a.not_after>now())
      and u.deleted_at is null and not coalesce(u.is_anonymous,false) for share of a,u;
  if not found then raise exception 'Sign in again before correcting your submission.' using errcode='PT401'; end if;
  if exists(select 1 from public.security_bans b where b.user_id=p_user_id and b.target_type='account'
    and b.revoked_at is null and b.starts_at<=now() and (b.ends_at is null or b.ends_at>now())) then
    raise exception 'This account is restricted.' using errcode='42501';
  end if;
  if p_expected_version is null or p_expected_version<1 or p_expected_queue_version is null or p_expected_queue_version<0 or p_idempotency_key is null or p_idempotency_key!~'^[a-f0-9]{64}$'
    or p_data is null or jsonb_typeof(p_data)<>'object'
    or p_data-'name'-'platform'-'region'-'language'-'framework'-'description'-'communityUrl'-'cfxJoinUrl'-'accessType'-'tags'-'roblox'<>'{}'::jsonb then
    raise exception 'Invalid correction request.' using errcode='22023';
  end if;
  if p_terms_version is distinct from '2026-08-19'
     or p_standards_version is distinct from '2026-08-19' then
    raise exception 'Current terms and listing standards must be accepted';
  end if;

  fingerprint:=encode(sha256(convert_to(jsonb_build_object('id',p_submission_id,'version',p_expected_version,'queueVersion',p_expected_queue_version,'data',p_data,'terms',p_terms_version,'standards',p_standards_version)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('submission-correction:'||p_user_id::text||':'||p_idempotency_key,0));
  select * into s from public.server_submissions where id=p_submission_id and submitted_by=p_user_id for update;
  if not found then raise exception 'Submission not found in your account.' using errcode='PT404'; end if;
  select * into previous from private.server_submission_corrections where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then
    if previous.fingerprint is distinct from fingerprint or previous.submission_id is distinct from s.id then
      raise exception 'This retry contains different changes. Check the latest review before sending again.' using errcode='PT409';
    end if;
    return jsonb_build_object('id',s.id,'status',s.status,'review_version',s.review_version,'idempotent',true);
  end if;
  if s.owner_update_server_id is not null then
    v_tags:=private.validate_owned_listing_features(p_user_id,s.owner_update_server_id,p_data,p_moderation_confidence,p_moderation_score,p_moderation_reasons);
  else
    if p_platform_id not in ('fivem','redm','minecraft','roblox') and p_platform_id is distinct from s.platform_id then raise exception 'Applications are open for FiveM, RedM, Minecraft and Roblox.' using errcode='22023';end if;
    v_tags:=private.validate_submission_application(p_data,p_moderation_confidence,p_moderation_score,p_moderation_reasons);
    if exists(select 1 from unnest(v_tags) x where not(x=any(coalesce(s.tags,'{}'::text[]))) and not(x=any(private.listing_feature_keys(p_platform_id)))) then raise exception 'Some feature choices have changed. Keep this page open and copy your draft into the updated listing form in another tab.' using errcode='22023';end if;
  end if;
  select q.review_version into queue_version from public.moderation_queue q where q.target_type='server_submission' and q.target_id=s.id::text for update;
  if coalesce(queue_version,0)<>p_expected_queue_version then raise exception 'The review queue changed. Check the latest review before sending corrections.' using errcode='PT409'; end if;
  if s.review_version<>p_expected_version then raise exception 'This submission has changed since you opened it. Load the latest review before sending your changes.' using errcode='PT409'; end if;
  if s.status<>'changes_requested' then raise exception 'This submission is no longer waiting for corrections. Check its current review status.' using errcode='PT409'; end if;
  if not public.consume_rate_limit(md5('member:'||p_user_id::text),'submission-corrections',10,3600) then raise exception 'Too many attempts. Please wait before trying again.' using errcode='PT429'; end if;
  update public.server_submissions set name=btrim(p_name),platform_id=p_platform_id,region=btrim(p_region),language=btrim(p_language),
    framework=nullif(btrim(p_framework),''),description=btrim(p_description),community_url=v_url,tags=v_tags,
    access_type=v_access_type,cfx_join_url=cfx,metadata_fingerprint=fingerprint,
    roblox_details=case when p_platform_id='roblox' then (p_data->'roblox')-'applicantRole'-'authorityEvidence' else null end,
    moderation_confidence=p_moderation_confidence,moderation_score=p_moderation_score,moderation_reasons=p_moderation_reasons,
    terms_version=p_terms_version,standards_version=p_standards_version,status='pending_review',updated_at=now()
    where id=s.id returning * into s;
  perform private.save_submission_roblox_evidence(s.id,s.platform_id,p_data->'roblox');
  -- The earlier reviewer and note intentionally remain visible as prior feedback.
  -- The revision trigger keeps the full original data and prior queue state.
  insert into public.moderation_queue(target_type,target_id,confidence,score,reasons)
    values('server_submission',s.id::text,p_moderation_confidence,p_moderation_score,p_moderation_reasons)
    on conflict(target_type,target_id) do update set confidence=excluded.confidence,score=excluded.score,reasons=excluded.reasons,
      status='open',assigned_to=null,resolved_by=null,resolution=null,resolved_at=null;
  insert into private.server_submission_corrections(user_id,idempotency_key,submission_id,fingerprint)
    values(p_user_id,p_idempotency_key,s.id,fingerprint);
  return jsonb_build_object('id',s.id,'status',s.status,'review_version',s.review_version,'idempotent',false);
end;
$$;

notify pgrst, 'reload schema';
commit;
