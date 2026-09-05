-- Owners correct the same reviewed submission. Content and review snapshots stay
-- private; the staff audit history is retained and the existing queue row reopens.
alter table public.server_submissions add column if not exists review_version bigint not null default 1 check (review_version > 0);

alter table public.moderation_queue add column if not exists review_version bigint not null default 1 check (review_version > 0);
create or replace function private.bump_queue_review_version()
returns trigger language plpgsql set search_path='' as $$
begin
  new.review_version:=old.review_version+1;
  return new;
end;
$$;
revoke all on function private.bump_queue_review_version() from public,anon,authenticated,service_role;
create trigger bump_queue_review_version before update on public.moderation_queue for each row execute function private.bump_queue_review_version();

create table private.server_submission_revisions (
  submission_id uuid not null references public.server_submissions(id) on delete cascade,
  version bigint not null,
  snapshot jsonb not null,
  queue_snapshot jsonb,
  recorded_at timestamptz not null default now(),
  primary key(submission_id,version)
);
create table private.server_submission_corrections (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  submission_id uuid not null references public.server_submissions(id) on delete cascade,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  primary key(user_id,idempotency_key)
);
alter table private.server_submission_revisions enable row level security;
alter table private.server_submission_corrections enable row level security;
revoke all on private.server_submission_revisions,private.server_submission_corrections from public,anon,authenticated,service_role;

create or replace function private.track_submission_revision()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if to_jsonb(new)-'review_version'-'updated_at' is not distinct from to_jsonb(old)-'review_version'-'updated_at' then
    new.review_version:=old.review_version;
    return new;
  end if;
  insert into private.server_submission_revisions(submission_id,version,snapshot,queue_snapshot)
    values(old.id,old.review_version,to_jsonb(old),(select to_jsonb(q) from public.moderation_queue q where q.target_type='server_submission' and q.target_id=old.id::text));
  new.review_version:=old.review_version+1;
  return new;
end;
$$;
revoke all on function private.track_submission_revision() from public,anon,authenticated,service_role;
create trigger track_submission_revision before update on public.server_submissions for each row execute function private.track_submission_revision();

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
    'status',s.status,'review_note',s.review_note,'reviewed_at',s.reviewed_at,
    'review_version',s.review_version,'queue_version',coalesce((select q.review_version from public.moderation_queue q where q.target_type='server_submission' and q.target_id=s.id::text),0),'created_at',s.created_at,'updated_at',s.updated_at),
    'history',(select coalesce(jsonb_agg(x.item order by x.version desc),'[]'::jsonb) from (
      select r.version,jsonb_build_object('version',r.version,'status',r.snapshot->>'status',
        'review_note',r.snapshot->>'review_note','reviewed_at',r.snapshot->>'reviewed_at','recorded_at',r.recorded_at) item
      from private.server_submission_revisions r where r.submission_id=s.id and r.snapshot->>'review_note' is not null
      order by r.version desc limit 20) x));
end;
$$;
revoke all on function public.member_server_submission(uuid) from public,anon,authenticated,service_role;
grant execute on function public.member_server_submission(uuid) to authenticated;

-- Only the website's server boundary can supply the moderation assessment. It
-- derives actor/session from authenticated state, never from the request body.
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
    or p_data-'name'-'platform'-'region'-'language'-'framework'-'description'-'communityUrl'-'cfxJoinUrl'-'accessType'-'tags'<>'{}'::jsonb then
    raise exception 'Invalid correction request.' using errcode='22023';
  end if;
  if p_terms_version is distinct from '2026-08-19'
     or p_standards_version is distinct from '2026-08-19' then
    raise exception 'Current terms and listing standards must be accepted';
  end if;

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
  if p_moderation_confidence not in ('safe', 'likely_safe', 'review_recommended', 'high_risk')
     or p_moderation_score not between 0 and 84
     or jsonb_typeof(coalesce(p_moderation_reasons, '[]'::jsonb)) <> 'array' then
    raise exception 'Submission blocked';
  end if;

  if v_access_type is null or v_access_type not in ('public','allowlisted','application') then raise exception 'Choose a valid access option.' using errcode='22023'; end if;
  if cfx is not null and (p_platform_id not in ('fivem','redm') or cfx !~* '^https://cfx\.re/join/[a-z0-9]{3,32}/?$') then raise exception 'Use a direct Cfx connect link for FiveM or RedM.' using errcode='22023'; end if;
  if jsonb_typeof(p_data->'tags') is distinct from 'array' then raise exception 'Choose valid community features.' using errcode='22023'; end if;
  select coalesce(array_agg(distinct lower(btrim(x)) order by lower(btrim(x))),'{}'::text[]) into v_tags
    from jsonb_array_elements_text(p_data->'tags') x
    where exists(select 1 from public.server_tag_catalog t where t.key=lower(btrim(x)) and t.enabled);
  if cardinality(v_tags)>8 or cardinality(v_tags)<>jsonb_array_length(p_data->'tags') then raise exception 'One of these community features is no longer available. Update your selection.' using errcode='22023'; end if;
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
    moderation_confidence=p_moderation_confidence,moderation_score=p_moderation_score,moderation_reasons=p_moderation_reasons,
    terms_version=p_terms_version,standards_version=p_standards_version,status='pending_review',updated_at=now()
    where id=s.id returning * into s;
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
revoke all on function public.resubmit_server_submission_server(uuid,uuid,uuid,bigint,bigint,text,jsonb,text,integer,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.resubmit_server_submission_server(uuid,uuid,uuid,bigint,bigint,text,jsonb,text,integer,jsonb,text,text) to service_role;

-- The former generic listing action must not remain a direct-RPC bypass. Move
-- its implementation behind the boundary, preserving all non-listing behavior.
alter function public.staff_resolve_queue_item(text,text,text,text,text) set schema private;
revoke all on function private.staff_resolve_queue_item(text,text,text,text,text) from public,anon,authenticated,service_role;
create or replace function public.staff_resolve_queue_item(p_kind text,p_item_id text,p_action text,p_reason text,p_request_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if lower(btrim(coalesce(p_kind,'')))='listing' then
    raise exception 'Open the latest submission review before recording a decision.' using errcode='PT409';
  end if;
  return private.staff_resolve_queue_item(p_kind,p_item_id,p_action,p_reason,p_request_id);
end;
$$;
revoke all on function public.staff_resolve_queue_item(text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.staff_resolve_queue_item(text,text,text,text,text) to authenticated;

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
    'status',s.status,'reviewVersion',s.review_version,'queueVersion',coalesce(q.review_version,0),'reviewNote',s.review_note,
    'moderationConfidence',s.moderation_confidence,'moderationScore',s.moderation_score,'moderationReasons',s.moderation_reasons,
    'createdAt',s.created_at,'updatedAt',s.updated_at,
    'history',(select coalesce(jsonb_agg(x.item order by x.version desc),'[]'::jsonb) from (
      select r.version,jsonb_build_object('version',r.version,'status',r.snapshot->>'status','reviewNote',r.snapshot->>'review_note',
        'name',r.snapshot->>'name','description',r.snapshot->>'description','communityUrl',r.snapshot->>'community_url','recordedAt',r.recorded_at) item
      from private.server_submission_revisions r where r.submission_id=s.id order by r.version desc limit 20) x));
end;
$$;
revoke all on function public.staff_server_submission_review(uuid) from public,anon,authenticated,service_role;
grant execute on function public.staff_server_submission_review(uuid) to authenticated;

create or replace function public.staff_review_server_submission(p_submission_id uuid,p_expected_version bigint,p_expected_queue_version bigint,p_action text,p_reason text,p_request_id text)
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
  return private.staff_resolve_queue_item('listing',s.id::text,p_action,p_reason,p_request_id);
end;
$$;
revoke all on function public.staff_review_server_submission(uuid,bigint,bigint,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.staff_review_server_submission(uuid,bigint,bigint,text,text,text) to authenticated;
