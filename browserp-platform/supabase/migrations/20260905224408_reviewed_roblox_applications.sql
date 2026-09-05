-- Applications list a specific Roblox community, never an experience-wide player total.
-- Authority evidence stays private; approved public details are an explicit projection.
alter table public.server_submissions add column roblox_details jsonb;
alter table public.server_submissions drop constraint if exists server_submissions_access_type_check;
alter table public.server_submissions add constraint server_submissions_access_type_check check(access_type in ('public','allowlisted','application','unknown'));
alter table public.servers add column roblox_details jsonb;
create table private.submission_roblox_evidence (
 submission_id uuid primary key references public.server_submissions(id) on delete cascade,
 applicant_role text not null, authority_evidence text not null
);
create table private.submission_creation_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 idempotency_key text not null, fingerprint text not null,
 submission_id uuid not null references public.server_submissions(id) on delete cascade,
 primary key(user_id,idempotency_key)
);
create table private.submission_control_reviews (
 submission_id uuid not null references public.server_submissions(id) on delete cascade,
 version bigint not null, reviewer_id uuid not null references auth.users(id),
 note text not null, reviewed_at timestamptz not null default now(),
 primary key(submission_id,version)
);
alter table private.submission_roblox_evidence enable row level security;
alter table private.submission_creation_requests enable row level security;
alter table private.submission_control_reviews enable row level security;
revoke all on private.submission_roblox_evidence,private.submission_creation_requests,private.submission_control_reviews from public,anon,authenticated,service_role;

create or replace function private.validate_roblox_application(p_platform text,p_data jsonb,p_framework text,p_community_url text)
returns void language plpgsql set search_path='' as $$
begin
 if p_platform<>'roblox' then
   if p_data is not null and p_data<>'null'::jsonb then raise exception 'Roblox details belong only to Roblox applications.' using errcode='22023'; end if;
   return;
 end if;
 if p_data is null or jsonb_typeof(p_data) is distinct from 'object'
   or p_data-'kind'-'experienceUrl'-'communityGroupUrl'-'joiningInstructions'-'applicantRole'-'authorityEvidence'<>'{}'::jsonb
   or coalesce(p_data->>'kind','') not in ('independent_community','creator_experience')
   or coalesce(p_data->>'experienceUrl','') !~ '^https://www[.]roblox[.]com/games/[1-9][0-9]{0,19}$'
   or char_length(coalesce(p_framework,'')) not between 2 and 80
   or nullif(p_community_url,'') is null
   or p_community_url ~* '^https://(www[.])?cfx[.]re/'
   or char_length(coalesce(p_data->>'joiningInstructions','')) not between 40 and 1500
   or char_length(coalesce(p_data->>'applicantRole','')) not between 2 and 120
   or char_length(coalesce(p_data->>'authorityEvidence','')) not between 40 and 2000
   or (nullif(p_data->>'communityGroupUrl','') is not null and p_data->>'communityGroupUrl' !~ '^https://www[.]roblox[.]com/communities/[1-9][0-9]{0,19}$')
   or exists(select 1 from jsonb_each(p_data) e where e.value<>'null'::jsonb and jsonb_typeof(e.value)<>'string') then
   raise exception 'Complete the Roblox experience, joining instructions and private authority evidence using public Roblox page links.' using errcode='22023';
 end if;
end;
$$;
revoke all on function private.validate_roblox_application(text,jsonb,text,text) from public,anon,authenticated,service_role;

create or replace function private.save_submission_roblox_evidence(p_id uuid,p_platform text,p_data jsonb)
returns void language plpgsql set search_path='' as $$
begin
 if p_platform='roblox' then
  insert into private.submission_roblox_evidence values(p_id,p_data->>'applicantRole',p_data->>'authorityEvidence')
  on conflict(submission_id) do update set applicant_role=excluded.applicant_role,authority_evidence=excluded.authority_evidence;
 else delete from private.submission_roblox_evidence where submission_id=p_id; end if;
end;
$$;
revoke all on function private.save_submission_roblox_evidence(uuid,text,jsonb) from public,anon,authenticated,service_role;


create or replace function private.validate_submission_application(p_data jsonb,p_moderation_confidence text,p_moderation_score integer,p_moderation_reasons jsonb)
returns text[] language plpgsql set search_path='' as $$
declare
 v_tags text[]; p_name text:=p_data->>'name';p_platform_id text:=p_data->>'platform';p_region text:=p_data->>'region';
 p_language text:=p_data->>'language';p_framework text:=p_data->>'framework';p_description text:=p_data->>'description';
 v_url text:=nullif(btrim(coalesce(p_data->>'communityUrl','')),'');cfx text:=nullif(btrim(coalesce(p_data->>'cfxJoinUrl','')),'');v_access_type text:=p_data->>'accessType';
begin
 if p_data is null or jsonb_typeof(p_data)<>'object' or p_data-'name'-'platform'-'region'-'language'-'framework'-'description'-'communityUrl'-'cfxJoinUrl'-'accessType'-'tags'-'roblox'<>'{}'::jsonb then raise exception 'Invalid application details.' using errcode='22023';end if;
  if not exists (select 1 from public.platforms where id = p_platform_id and enabled) then
    raise exception 'Unsupported platform';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80
     or char_length(btrim(coalesce(p_region, ''))) not between 2 and 60
     or char_length(btrim(coalesce(p_language, ''))) not between 2 and 60
     or char_length(btrim(coalesce(p_description, ''))) not between 40 and 1500 then
    raise exception 'Invalid listing content';
  end if;
  if nullif(btrim(coalesce(p_framework, '')), '') is not null
     and char_length(btrim(p_framework)) > 80 then
    raise exception 'Invalid framework';
  end if;
  if v_url is not null and (
    char_length(v_url) > 300
    or v_url ~ '[[:space:]#]'
    or v_url ~* '^https://[^/]*@'
    or v_url ~* '^https://[^/]+:[0-9]+(?:/|$)'
    or v_url !~* '^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})(?:/[^[:space:]#]*)?$'
    or v_url ~* '^https://[^/]+\.(?:arpa|example|home|internal|invalid|lan|local|localdomain|localhost|onion|test)(?:/|$)'
    or v_url ~* '^https://(?:[^/]+\.)?(?:bit\.ly|buff\.ly|cutt\.ly|goo\.gl|is\.gd|ow\.ly|rb\.gy|rebrand\.ly|shorturl\.at|t\.co|tiny\.one|tinyurl\.com)(?:/|$)'
    or (
      v_url ~* '^https://(?:www\.)?discord\.com(?:/|$)'
      and v_url !~* '^https://(?:www\.)?discord\.com/invite/[a-z0-9_-]{2,64}/?$'
    )
    or (
      v_url ~* '^https://discord\.gg(?:/|$)'
      and v_url !~* '^https://discord\.gg/[a-z0-9_-]{2,64}/?$'
    )
    or (
      v_url ~* '^https://(?:www\.)?cfx\.re(?:/|$)'
      and v_url !~* '^https://(?:www\.)?cfx\.re/join/[a-z0-9]{3,32}/?$'
    )
  ) then
    raise exception 'Invalid community URL';
  end if;
  if p_moderation_confidence is null or p_moderation_score is null or p_moderation_confidence not in ('safe', 'likely_safe', 'review_recommended', 'high_risk')
     or p_moderation_score not between 0 and 84
     or jsonb_typeof(coalesce(p_moderation_reasons, '[]'::jsonb)) <> 'array' then
    raise exception 'Submission blocked';
  end if;

  if v_access_type is null or v_access_type not in ('public','allowlisted','application','unknown') then raise exception 'Choose a valid access option.' using errcode='22023'; end if;
  if cfx is not null and (p_platform_id not in ('fivem','redm') or cfx !~* '^https://cfx\.re/join/[a-z0-9]{3,32}/?$') then raise exception 'Use a direct Cfx connect link for FiveM or RedM.' using errcode='22023'; end if;
  if jsonb_typeof(p_data->'tags') is distinct from 'array' then raise exception 'Choose valid community features.' using errcode='22023'; end if;
  select coalesce(array_agg(distinct lower(btrim(x)) order by lower(btrim(x))),'{}'::text[]) into v_tags
    from jsonb_array_elements_text(p_data->'tags') x
    where exists(select 1 from public.server_tag_catalog t where t.key=lower(btrim(x)) and t.enabled);
  if cardinality(v_tags)>8 or cardinality(v_tags)<>jsonb_array_length(p_data->'tags') then raise exception 'One of these community features is no longer available. Update your selection.' using errcode='22023'; end if;
  perform private.validate_roblox_application(p_platform_id,p_data->'roblox',p_framework,v_url);
 return v_tags;
end;
$$;
revoke all on function private.validate_submission_application(jsonb,text,integer,jsonb) from public,anon,authenticated,service_role;


create or replace function public.create_server_application_server(
 p_user_id uuid,p_session_id uuid,p_expected_user_id uuid,p_data jsonb,p_moderation_confidence text,p_moderation_score integer,p_moderation_reasons jsonb,
 p_request_id text,p_idempotency_key text,p_terms_version text,p_standards_version text
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
 v_tags:=private.validate_submission_application(p_data,p_moderation_confidence,p_moderation_score,p_moderation_reasons);
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('data',p_data,'terms',p_terms_version,'standards',p_standards_version)::text,'UTF8')),'hex');
 -- Serialise a member's submissions as well as retries so the open-submission cap cannot race.
 perform pg_advisory_xact_lock(hashtextextended('application-create:'||p_user_id::text,0));
 select * into previous from private.submission_creation_requests where user_id=p_user_id and idempotency_key=p_idempotency_key;
 if found then
  if previous.fingerprint is distinct from fingerprint then raise exception 'This retry contains different details. Start a new application attempt.' using errcode='PT409';end if;
  select * into s from public.server_submissions where id=previous.submission_id;
  return jsonb_build_object('id',s.id,'status',s.status,'review_version',s.review_version,'idempotent',true);
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
 insert into private.submission_creation_requests values(p_user_id,p_idempotency_key,fingerprint,s.id);
 return jsonb_build_object('id',s.id,'status',s.status,'review_version',s.review_version,'idempotent',false);
end;
$$;
revoke all on function public.create_server_application_server(uuid,uuid,uuid,jsonb,text,integer,jsonb,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_server_application_server(uuid,uuid,uuid,jsonb,text,integer,jsonb,text,text,text,text) to service_role;
-- Keep the earlier service-only writers during the preview-to-production rollout.
-- The separate retirement migration is applied only after the atomic web writer is live.

create or replace function public.resubmit_server_submission_server(
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

  v_tags:=private.validate_submission_application(p_data,p_moderation_confidence,p_moderation_score,p_moderation_reasons);
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
create or replace function private.track_submission_revision()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if to_jsonb(new)-'review_version'-'updated_at' is not distinct from to_jsonb(old)-'review_version'-'updated_at' then
    new.review_version:=old.review_version;
    return new;
  end if;
  insert into private.server_submission_revisions(submission_id,version,snapshot,queue_snapshot)
    values(old.id,old.review_version,to_jsonb(old)||jsonb_build_object('roblox_evidence',(select jsonb_build_object('applicantRole',e.applicant_role,'authorityEvidence',e.authority_evidence) from private.submission_roblox_evidence e where e.submission_id=old.id)),(select to_jsonb(q) from public.moderation_queue q where q.target_type='server_submission' and q.target_id=old.id::text));
  new.review_version:=old.review_version+1;
  return new;
end;
$$;
create or replace function public.member_server_submission(p_submission_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_active_member(); s public.server_submissions;
begin
  select * into s from public.server_submissions where id=p_submission_id and submitted_by=actor;
  if not found then raise exception 'Submission not found in your account.' using errcode='PT404'; end if;
  return jsonb_build_object('submission',jsonb_build_object(
    'id',s.id,'name',s.name,'platform_id',s.platform_id,'region',s.region,'language',s.language,
    'framework',s.framework,'description',s.description,'community_url',s.community_url,
    'tags',s.tags,'access_type',s.access_type,'cfx_join_url',s.cfx_join_url,
    'roblox',case when s.platform_id='roblox' then s.roblox_details||coalesce((select jsonb_build_object('applicantRole',e.applicant_role,'authorityEvidence',e.authority_evidence) from private.submission_roblox_evidence e where e.submission_id=s.id),'{}') else null end,
    'status',s.status,'review_note',s.review_note,'reviewed_at',s.reviewed_at,
    'review_version',s.review_version,'queue_version',coalesce((select q.review_version from public.moderation_queue q where q.target_type='server_submission' and q.target_id=s.id::text),0),'created_at',s.created_at,'updated_at',s.updated_at),
    'history',(select coalesce(jsonb_agg(x.item order by x.version desc),'[]'::jsonb) from (
      select r.version,jsonb_build_object('version',r.version,'status',r.snapshot->>'status',
        'review_note',r.snapshot->>'review_note','reviewed_at',r.snapshot->>'reviewed_at','recorded_at',r.recorded_at) item
      from private.server_submission_revisions r where r.submission_id=s.id and r.snapshot->>'review_note' is not null
      order by r.version desc limit 20) x));
end;
$$;
create or replace function public.staff_server_submission_review(p_submission_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.server_submissions; q public.moderation_queue;
begin
  if not private.has_current_auth_session() or not public.has_staff_permission('servers.review') then raise exception 'Listing review permission required.' using errcode='42501'; end if;
  select * into s from public.server_submissions where id=p_submission_id;
  if not found then raise exception 'Submission not found.' using errcode='PT404'; end if;
  select * into q from public.moderation_queue where target_type='server_submission' and target_id=s.id::text;
  return jsonb_build_object('kind','listing','id',s.id,'name',s.name,'platform',s.platform_id,'region',s.region,'language',s.language,
    'framework',s.framework,'description',s.description,'communityUrl',s.community_url,'cfxJoinUrl',s.cfx_join_url,'access',s.access_type,'tags',s.tags,
    'roblox',case when s.platform_id='roblox' then s.roblox_details||coalesce((select jsonb_build_object('applicantRole',e.applicant_role,'authorityEvidence',e.authority_evidence) from private.submission_roblox_evidence e where e.submission_id=s.id),'{}') else null end,
    'status',s.status,'reviewVersion',s.review_version,'queueVersion',coalesce(q.review_version,0),'reviewNote',s.review_note,
    'moderationConfidence',s.moderation_confidence,'moderationScore',s.moderation_score,'moderationReasons',s.moderation_reasons,
    'createdAt',s.created_at,'updatedAt',s.updated_at,
    'history',(select coalesce(jsonb_agg(x.item order by x.version desc),'[]'::jsonb) from (
      select r.version,jsonb_build_object('version',r.version,'status',r.snapshot->>'status','reviewNote',r.snapshot->>'review_note',
        'roblox',r.snapshot->'roblox_details'||coalesce(r.snapshot->'roblox_evidence','{}'), 'name',r.snapshot->>'name','description',r.snapshot->>'description','communityUrl',r.snapshot->>'community_url','recordedAt',r.recorded_at) item
      from private.server_submission_revisions r where r.submission_id=s.id order by r.version desc limit 20) x));
end;
$$;
create or replace function public.staff_review_server_application(p_submission_id uuid,p_expected_version bigint,p_expected_queue_version bigint,p_action text,p_reason text,p_request_id text,p_control_reviewed boolean,p_control_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.server_submissions; q public.moderation_queue;
begin
  if not private.has_current_auth_session() or not public.has_staff_permission('servers.review') then raise exception 'Listing review permission required.' using errcode='42501'; end if;
  if p_expected_version is null or p_expected_version<1 or p_expected_queue_version is null or p_expected_queue_version<0 then raise exception 'Open the latest review before recording a decision.' using errcode='22023'; end if;
  select * into s from public.server_submissions where id=p_submission_id for update;
  if not found then raise exception 'Submission not found.' using errcode='PT404'; end if;
  select * into q from public.moderation_queue where target_type='server_submission' and target_id=s.id::text for update;
  if s.review_version<>p_expected_version or coalesce(q.review_version,0)<>p_expected_queue_version then
    raise exception 'This submission or its review queue changed. Open the latest review and check the updated details before deciding.' using errcode='PT409';
  end if;
  if s.platform_id='roblox' and lower(btrim(p_action))='approved' then
    if p_control_reviewed is distinct from true or char_length(btrim(coalesce(p_control_note,''))) not between 20 and 500
      or s.roblox_details is null or not exists(select 1 from private.submission_roblox_evidence where submission_id=s.id) then
      raise exception 'Check the applicant controls this community and record how you confirmed it before approving.' using errcode='22023';
    end if;
    insert into private.submission_control_reviews(submission_id,version,reviewer_id,note) values(s.id,s.review_version,auth.uid(),btrim(p_control_note));
  end if;
  return private.staff_resolve_queue_item('listing',s.id::text,p_action,p_reason,p_request_id);
end;
$$;

revoke all on function public.staff_review_server_application(uuid,bigint,bigint,text,text,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.staff_review_server_application(uuid,bigint,bigint,text,text,text,boolean,text) to authenticated;
-- The earlier versioned endpoint cannot bypass the Roblox authority review.
create or replace function public.staff_review_server_submission(p_submission_id uuid,p_expected_version bigint,p_expected_queue_version bigint,p_action text,p_reason text,p_request_id text)
returns jsonb language sql security definer set search_path='' as $$
 select public.staff_review_server_application(p_submission_id,p_expected_version,p_expected_queue_version,p_action,p_reason,p_request_id,false,null);
$$;

create or replace function private.publish_roblox_application()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source_submission_id is not null then
  select s.roblox_details into new.roblox_details from public.server_submissions s where s.id=new.source_submission_id;
 end if;
 if new.platform_id<>'roblox' then new.roblox_details:=null;end if;
 return new;
end;
$$;
revoke all on function private.publish_roblox_application() from public,anon,authenticated,service_role;
create trigger publish_roblox_application before insert or update of source_submission_id,platform_id on public.servers for each row execute function private.publish_roblox_application();

create or replace function public.public_roblox_listing_details(p_server_ids uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'roblox',case when s.roblox_details is null then null else jsonb_build_object('kind',s.roblox_details->>'kind','experienceUrl',s.roblox_details->>'experienceUrl','communityGroupUrl',s.roblox_details->>'communityGroupUrl','joiningInstructions',s.roblox_details->>'joiningInstructions') end)),'[]') from public.servers s
 where s.platform_id='roblox' and s.status='published' and s.id=any(p_server_ids[1:100]);
$$;
revoke all on function public.public_roblox_listing_details(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.public_roblox_listing_details(uuid[]) to anon,authenticated;
