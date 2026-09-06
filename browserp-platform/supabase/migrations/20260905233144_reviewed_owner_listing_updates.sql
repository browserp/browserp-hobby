-- Prerequisite: 20260905224408_reviewed_roblox_applications.sql.
-- Owner changes remain proposals in the existing listing review queue.
begin;
-- Preserve existing published descriptions up to the server table limit.
-- Ordinary new-application HTTP input retains its existing 1500-character limit.
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
     or char_length(btrim(coalesce(p_description, ''))) not between 40 and 3000 then
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

alter table public.server_submissions add owner_update_server_id uuid references public.servers(id) on delete restrict,
 add owner_update_version bigint;
alter table public.server_submissions add constraint owner_update_reference_complete
 check ((owner_update_server_id is null and owner_update_version is null) or (owner_update_server_id is not null and owner_update_version is not null and owner_update_version>=1));
create unique index one_open_owner_update_per_listing on public.server_submissions(owner_update_server_id)
 where owner_update_server_id is not null and status in ('pending_review','changes_requested');
alter table private.submission_creation_requests add owner_update_server_id uuid,
 add owner_update_version bigint;

create or replace function private.owner_listing_fields(s public.servers)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',s.id,'slug',s.slug,'name',s.name,'platform_id',s.platform_id,'region',s.region,'language',s.language,
 'framework',s.framework,'description',s.description,'community_url',s.community_url,'access_type',s.access_type,'cfx_join_url',s.cfx_join_url,
 'tags',coalesce((select jsonb_agg(t.tag order by t.tag) from public.server_tags t where t.server_id=s.id),'[]'::jsonb),
 'roblox',case when s.platform_id='roblox' then s.roblox_details-'applicantRole'-'authorityEvidence' else null end);
$$;
revoke all on function private.owner_listing_fields(public.servers) from public,anon,authenticated,service_role;

create or replace function private.check_owner_listing_update(p_user_id uuid,p_server_id uuid,p_version bigint,p_data jsonb)
returns public.servers language plpgsql security definer set search_path='' as $$
declare s public.servers;
begin
 select * into s from public.servers where id=p_server_id for update;
 if not found or p_user_id is null or s.owner_id is distinct from p_user_id or s.status<>'published' or s.age_rating='adult' then
  raise exception 'This published listing is not available in your account.' using errcode='PT403';end if;
 if p_version is null or s.moderation_version<>p_version then raise exception 'The live listing changed. Load its latest details and check your proposed changes again.' using errcode='PT409';end if;
 if p_data is not null then
  if p_data->>'platform' is distinct from s.platform_id or nullif(p_data->>'cfxJoinUrl','') is distinct from s.cfx_join_url then
   raise exception 'Game and live connection changes need a staff review of the source. Keep the current values in this update.' using errcode='22023';end if;
  if s.platform_id='roblox' and (s.roblox_details is null
    or ((p_data->'roblox')-'joiningInstructions'-'applicantRole'-'authorityEvidence') is distinct from (s.roblox_details-'joiningInstructions')
    or p_data->>'framework' is distinct from s.framework) then
   raise exception 'Keep this listing linked to its reviewed Roblox experience and community. Ask staff about identity changes.' using errcode='22023';end if;
 end if;
 return s;
end;
$$;
revoke all on function private.check_owner_listing_update(uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;

create or replace function public.member_owned_listing_update(p_server_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_active_member();s public.servers; pending public.server_submissions;
begin
 select * into s from public.servers where id=p_server_id and owner_id=actor and status='published' and age_rating<>'adult';
 if not found then raise exception 'This published listing is not available in your account.' using errcode='PT403';end if;
 select * into pending from public.server_submissions where owner_update_server_id=s.id and status in ('pending_review','changes_requested');
 return jsonb_build_object('submission',private.owner_listing_fields(s)||jsonb_build_object('status','owner_draft','review_version',s.moderation_version,'queue_version',0),
  'ownerUpdate',jsonb_build_object('serverId',s.id,'serverVersion',s.moderation_version,'slug',s.slug,
    'unavailable',s.platform_id='roblox' and s.roblox_details is null,'setupRequired',s.platform_id='roblox' and s.roblox_details is null,
    'pendingId',case when pending.submitted_by=actor then pending.id else null end,'pendingStatus',pending.status,
    'needsStaff',pending.id is not null and pending.submitted_by is distinct from actor,'live',private.owner_listing_fields(s)));
end;
$$;
revoke all on function public.member_owned_listing_update(uuid) from public,anon,authenticated,service_role;
grant execute on function public.member_owned_listing_update(uuid) to authenticated;

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
  return public.create_server_application_server(p_user_id,p_session_id,p_expected_user_id,p_data,p_moderation_confidence,p_moderation_score,p_moderation_reasons,p_request_id,p_idempotency_key,p_terms_version,p_standards_version);
 end if;
 current_listing:=private.check_owner_listing_update(p_user_id,p_server_id,p_expected_server_version,p_data);
 if exists(select 1 from public.server_submissions where owner_update_server_id=p_server_id and status in ('pending_review','changes_requested')) then
  raise exception 'An update is already being reviewed for this listing. Open its progress in My account.' using errcode='PT409';end if;
 result:=public.create_server_application_server(p_user_id,p_session_id,p_expected_user_id,p_data,p_moderation_confidence,p_moderation_score,p_moderation_reasons,p_request_id,p_idempotency_key,p_terms_version,p_standards_version);
 update public.server_submissions set owner_update_server_id=p_server_id,owner_update_version=p_expected_server_version where id=(result->>'id')::uuid;
 update private.submission_creation_requests set owner_update_server_id=p_server_id,owner_update_version=p_expected_server_version
 where user_id=p_user_id and idempotency_key=p_idempotency_key;
 return result||jsonb_build_object('review_version',(select review_version from public.server_submissions where id=(result->>'id')::uuid));
end;
$$;
revoke all on function public.propose_owned_listing_update_server(uuid,uuid,uuid,uuid,bigint,jsonb,text,integer,jsonb,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.propose_owned_listing_update_server(uuid,uuid,uuid,uuid,bigint,jsonb,text,integer,jsonb,text,text,text,text) to service_role;

-- Keep ordinary creation corrections unchanged. Owner proposals use an additional
-- current ownership/live-version boundary, including when the original owner changes.
alter function public.resubmit_server_submission_server(uuid,uuid,uuid,bigint,bigint,text,jsonb,text,integer,jsonb,text,text) set schema private;
alter function private.resubmit_server_submission_server(uuid,uuid,uuid,bigint,bigint,text,jsonb,text,integer,jsonb,text,text) rename to resubmit_before_owner_updates;
revoke all on function private.resubmit_before_owner_updates(uuid,uuid,uuid,bigint,bigint,text,jsonb,text,integer,jsonb,text,text) from public,anon,authenticated,service_role;
create function public.resubmit_server_submission_server(p_user_id uuid,p_session_id uuid,p_submission_id uuid,p_expected_version bigint,p_expected_queue_version bigint,p_idempotency_key text,p_data jsonb,p_moderation_confidence text,p_moderation_score integer,p_moderation_reasons jsonb,p_terms_version text,p_standards_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.server_submissions where id=p_submission_id and owner_update_server_id is not null) then
  raise exception 'Open this listing update from My account to check the latest live details.' using errcode='PT409';end if;
 return private.resubmit_before_owner_updates(p_user_id,p_session_id,p_submission_id,p_expected_version,p_expected_queue_version,p_idempotency_key,p_data,p_moderation_confidence,p_moderation_score,p_moderation_reasons,p_terms_version,p_standards_version);
end;
$$;
revoke all on function public.resubmit_server_submission_server(uuid,uuid,uuid,bigint,bigint,text,jsonb,text,integer,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.resubmit_server_submission_server(uuid,uuid,uuid,bigint,bigint,text,jsonb,text,integer,jsonb,text,text) to service_role;
create function public.correct_owned_listing_update_server(p_user_id uuid,p_session_id uuid,p_submission_id uuid,p_expected_version bigint,p_expected_queue_version bigint,p_expected_server_version bigint,p_idempotency_key text,p_data jsonb,p_moderation_confidence text,p_moderation_score integer,p_moderation_reasons jsonb,p_terms_version text,p_standards_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.server_submissions;result jsonb;target public.servers;
begin
 select * into s from public.server_submissions where id=p_submission_id and submitted_by=p_user_id for update;
 if not found or s.owner_update_server_id is null then raise exception 'Listing update not found in your account.' using errcode='PT404';end if;
 target:=private.check_owner_listing_update(p_user_id,s.owner_update_server_id,p_expected_server_version,p_data);
 result:=private.resubmit_before_owner_updates(p_user_id,p_session_id,p_submission_id,p_expected_version,p_expected_queue_version,p_idempotency_key,p_data,p_moderation_confidence,p_moderation_score,p_moderation_reasons,p_terms_version,p_standards_version);
 if not coalesce((result->>'idempotent')::boolean,false) and s.owner_update_version<>p_expected_server_version then
  update public.server_submissions set owner_update_version=p_expected_server_version where id=s.id;
 end if;
 return result||jsonb_build_object('review_version',(select review_version from public.server_submissions where id=s.id));
end;
$$;
revoke all on function public.correct_owned_listing_update_server(uuid,uuid,uuid,bigint,bigint,bigint,text,jsonb,text,integer,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.correct_owned_listing_update_server(uuid,uuid,uuid,bigint,bigint,bigint,text,jsonb,text,integer,jsonb,text,text) to service_role;

alter function public.member_server_submission(uuid) set schema private;
alter function private.member_server_submission(uuid) rename to member_submission_before_owner_updates;
revoke all on function private.member_submission_before_owner_updates(uuid) from public,anon,authenticated,service_role;
create function public.member_server_submission(p_submission_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;s public.server_submissions;target public.servers;
begin
 result:=private.member_submission_before_owner_updates(p_submission_id);
 select * into s from public.server_submissions where id=p_submission_id;
 if s.owner_update_server_id is not null then
  select * into target from public.servers where id=s.owner_update_server_id;
  if target.owner_id is distinct from auth.uid() then raise exception 'This listing is no longer attached to your account.' using errcode='PT403';end if;
  result:=result||jsonb_build_object('ownerUpdate',jsonb_build_object('serverId',target.id,'serverVersion',target.moderation_version,
    'baselineVersion',s.owner_update_version,'slug',target.slug,'live',private.owner_listing_fields(target),
    'unavailable',target.status<>'published' or (target.platform_id='roblox' and target.roblox_details is null),
    'setupRequired',target.platform_id='roblox' and target.roblox_details is null));
  result:=jsonb_set(result,'{submission,roblox}',coalesce(s.roblox_details,'null'::jsonb));
 end if;
 return result;
end;
$$;
revoke all on function public.member_server_submission(uuid) from public,anon,authenticated,service_role;
grant execute on function public.member_server_submission(uuid) to authenticated;

alter function public.staff_server_submission_review(uuid) set schema private;
alter function private.staff_server_submission_review(uuid) rename to staff_submission_before_owner_updates;
revoke all on function private.staff_submission_before_owner_updates(uuid) from public,anon,authenticated,service_role;
create function public.staff_server_submission_review(p_submission_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;s public.server_submissions;target public.servers;
begin
 result:=private.staff_submission_before_owner_updates(p_submission_id);
 select * into s from public.server_submissions where id=p_submission_id;
 if s.owner_update_server_id is not null then
  select * into target from public.servers where id=s.owner_update_server_id;
  result:=result||jsonb_build_object('ownerUpdate',jsonb_build_object('serverId',target.id,'slug',target.slug,'live',private.owner_listing_fields(target),
   'changed',target.moderation_version<>s.owner_update_version,'ownerChanged',target.owner_id is distinct from s.submitted_by,'unavailable',target.status<>'published',
   'canApprove',public.has_staff_permission('servers.manage')));
  result:=jsonb_set(result,'{roblox}',coalesce(s.roblox_details,'null'::jsonb));
 end if;
 return result;
end;
$$;
revoke all on function public.staff_server_submission_review(uuid) from public,anon,authenticated,service_role;
grant execute on function public.staff_server_submission_review(uuid) to authenticated;

alter function public.staff_review_server_application(uuid,bigint,bigint,text,text,text,boolean,text) set schema private;
alter function private.staff_review_server_application(uuid,bigint,bigint,text,text,text,boolean,text) rename to review_application_before_owner_updates;
revoke all on function private.review_application_before_owner_updates(uuid,bigint,bigint,text,text,text,boolean,text) from public,anon,authenticated,service_role;
create function public.staff_review_server_application(p_submission_id uuid,p_expected_version bigint,p_expected_queue_version bigint,p_action text,p_reason text,p_request_id text,p_control_reviewed boolean,p_control_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.server_submissions;q public.moderation_queue;target public.servers;before_listing jsonb;after_listing jsonb;v_action text:=lower(btrim(p_action));
begin
 if not private.has_current_auth_session() or not public.has_staff_permission('servers.review') then raise exception 'Listing review permission required.' using errcode='42501';end if;
 select * into s from public.server_submissions where id=p_submission_id for update;
 if s.owner_update_server_id is null then return private.review_application_before_owner_updates(p_submission_id,p_expected_version,p_expected_queue_version,p_action,p_reason,p_request_id,p_control_reviewed,p_control_note);end if;
 select * into q from public.moderation_queue where target_type='server_submission' and target_id=s.id::text for update;
 if p_expected_version is distinct from s.review_version or p_expected_queue_version is distinct from coalesce(q.review_version,0) then
  raise exception 'This submission or its review queue changed. Open the latest review.' using errcode='PT409';end if;
 if s.status not in ('pending_review','changes_requested') then raise exception 'This update review is already closed.' using errcode='PT409';end if;
 if v_action is null or v_action not in ('approved','changes_requested','rejected') or char_length(btrim(coalesce(p_reason,''))) not between 5 and 1000 or char_length(coalesce(p_request_id,''))>160 then raise exception 'Choose a decision and a clear review reason.' using errcode='22023';end if;
 if v_action='approved' then
  if not public.has_staff_permission('servers.manage') then raise exception 'Server management permission is required to apply changes to a live listing.' using errcode='42501';end if;
  target:=private.check_owner_listing_update(s.submitted_by,s.owner_update_server_id,s.owner_update_version,null);
  if exists(select 1 from public.security_bans b where b.user_id=s.submitted_by and b.target_type='account' and b.revoked_at is null and b.starts_at<=now() and (b.ends_at is null or b.ends_at>now()))
    or not exists(select 1 from auth.users where id=s.submitted_by and deleted_at is null and not coalesce(is_anonymous,false)) then raise exception 'The listing owner account is restricted. Review its status before applying this update.' using errcode='42501';end if;
  before_listing:=private.owner_listing_fields(target);
  -- Deliberately update only public descriptive fields. Stable ID/slug, ownership,
  -- source submission, import configuration, images and staff-only flags survive.
  update public.servers set name=s.name,region=s.region,language=s.language,framework=s.framework,description=s.description,
   community_url=s.community_url,access_type=s.access_type,roblox_details=s.roblox_details,updated_at=now() where id=target.id returning * into target;
  delete from public.server_tags where server_id=target.id and not (tag=any(s.tags));
  insert into public.server_tags(server_id,tag) select target.id,unnest(s.tags) on conflict(server_id,tag) do nothing;
  after_listing:=private.owner_listing_fields(target);
 end if;
 update public.server_submissions set status=v_action,reviewed_by=auth.uid(),reviewed_at=now(),review_note=btrim(p_reason),updated_at=now() where id=s.id;
 update public.moderation_queue set status=case when v_action='changes_requested' then 'claimed' else 'resolved' end,
  assigned_to=auth.uid(),resolved_by=case when v_action='changes_requested' then null else auth.uid() end,
  resolution=btrim(p_reason),resolved_at=case when v_action='changes_requested' then null else now() end where target_type='server_submission' and target_id=s.id::text;
 insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
 values(auth.uid(),'listing_update.'||v_action,'listing',s.id::text,btrim(p_reason),nullif(p_request_id,''),
  jsonb_build_object('serverId',s.owner_update_server_id,'status',s.status,'listing',before_listing),
  jsonb_build_object('serverId',s.owner_update_server_id,'status',v_action,'listing',after_listing));
 return jsonb_build_object('kind','listing','id',s.id,'status',v_action,'serverId',s.owner_update_server_id);
end;
$$;
revoke all on function public.staff_review_server_application(uuid,bigint,bigint,text,text,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.staff_review_server_application(uuid,bigint,bigint,text,text,text,boolean,text) to authenticated;

-- A later staff edit commonly writes the same platform value. It must not copy
-- the first application over subsequently approved joining instructions.
create or replace function private.publish_roblox_application()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.source_submission_id is not distinct from old.source_submission_id
   and new.platform_id is not distinct from old.platform_id then return new;end if;
 if new.source_submission_id is not null then
  select s.roblox_details into new.roblox_details from public.server_submissions s where s.id=new.source_submission_id;
 end if;
 if new.platform_id<>'roblox' then new.roblox_details:=null;end if;
 return new;
end;
$$;
notify pgrst, 'reload schema';
commit;
