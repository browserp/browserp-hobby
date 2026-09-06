-- Preserve private conversations and record independently completed follow-up.
-- This records a staff attestation; it performs no export, correction, erasure,
-- external delivery, file operation or Auth mutation.
alter table private.account_data_requests drop constraint account_data_requests_status_check;
alter table private.account_data_requests add constraint account_data_requests_status_check
  check(status in ('submitted','reviewing','information_needed','ready','declined','withdrawn','fulfilled'));
drop index private.account_data_requests_open_kind;
create unique index account_data_requests_open_kind on private.account_data_requests(user_id,kind)
  where status not in ('declined','withdrawn','fulfilled');

insert into public.permissions(key,description) values('privacy.requests.fulfill',
  'Record verified, completed data-request follow-up. Requires data-request review permission; does not itself export or erase data.') on conflict(key) do nothing;
insert into public.staff_role_permissions(role_key,permission_key) values('owner','privacy.requests.fulfill') on conflict do nothing;
create or replace function private.can_fulfill_data_requests()
returns boolean language sql stable security definer set search_path='' as $$
  select private.can_review_data_requests() and public.has_staff_permission('privacy.requests.fulfill');
$$;
revoke all on function private.can_fulfill_data_requests() from public,anon,authenticated,service_role;

create table private.account_data_request_history (
  request_id uuid not null references private.account_data_requests(id),
  version bigint not null,
  event text not null check(event in ('legacy_snapshot','submitted','member_update','withdrawn','staff_review','fulfilled')),
  actor_id uuid,
  status text not null,
  details text not null check(char_length(details)<=1000),
  reply text not null check(char_length(reply)<=1000),
  recorded_at timestamptz not null default now(),
  primary key(request_id,version)
);
alter table private.account_data_request_history enable row level security;
revoke all on private.account_data_request_history from public,anon,authenticated,service_role;
-- Earlier overwritten messages cannot be recovered. Preserve the actual saved
-- state once, clearly labelled, rather than inventing a retrospective thread.
insert into private.account_data_request_history(request_id,version,event,status,details,reply,recorded_at)
  select id,version,'legacy_snapshot',status,details,staff_reply,updated_at from private.account_data_requests;

create table private.account_data_request_fulfillments (
  request_id uuid primary key references private.account_data_requests(id),
  actor_id uuid not null,
  request_key uuid not null,
  fingerprint bytea not null check(octet_length(fingerprint)=32),
  method text not null check(method in ('secure_delivery','data_correction','account_erasure')),
  result text not null check(char_length(result) between 30 and 1000),
  evidence text not null check(char_length(evidence) between 20 and 1000),
  completed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique(actor_id,request_key)
);
alter table private.account_data_request_fulfillments enable row level security;
revoke all on private.account_data_request_fulfillments from public,anon,authenticated,service_role;

create or replace function private.keep_data_request_record()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Data-request history and completion records cannot be changed or removed.' using errcode='42501';
end;
$$;
revoke all on function private.keep_data_request_record() from public,anon,authenticated,service_role;
create trigger immutable_data_request_history before update or delete on private.account_data_request_history
  for each row execute function private.keep_data_request_record();
create trigger immutable_data_request_fulfillment before update or delete on private.account_data_request_fulfillments
  for each row execute function private.keep_data_request_record();

create or replace function private.record_data_request_history()
returns trigger language plpgsql security definer set search_path='' as $$
declare kind text;
begin
  if TG_OP='INSERT' then kind:='submitted';
  elsif new.version<>old.version+1 then raise exception 'The request version must advance exactly once.' using errcode='PT409';
  elsif new.status='fulfilled' then kind:='fulfilled';
  elsif new.status='withdrawn' then kind:='withdrawn';
  elsif new.status='submitted' then kind:='member_update';
  else kind:='staff_review'; end if;
  insert into private.account_data_request_history(request_id,version,event,actor_id,status,details,reply)
    values(new.id,new.version,kind,(select auth.uid()),new.status,new.details,new.staff_reply);
  return new;
end;
$$;
revoke all on function private.record_data_request_history() from public,anon,authenticated,service_role;
create trigger record_data_request_history after insert or update on private.account_data_requests
  for each row execute function private.record_data_request_history();

create or replace function public.member_data_requests(
  p_action text default 'list',p_kind text default null,p_details text default null,
  p_key uuid default null,p_id uuid default null,p_expected_version bigint default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_active_member(); r private.account_data_requests; clean text:=btrim(coalesce(p_details,''));
  fingerprint bytea:=pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('kind',p_kind,'details',clean)::text,'UTF8'));
begin
  if p_action='list' then
    return jsonb_build_object('items',coalesce((select jsonb_agg(private.data_request_json(x) order by x.created_at desc,x.id desc)
      from(select * from private.account_data_requests where user_id=actor order by created_at desc,id desc limit 50)x),'[]'::jsonb),'limit',50);
  end if;
  if p_action is null or p_action not in ('create','update','withdraw') or char_length(clean)>1000
    or translate(clean,E'\n\r\t','') ~ '[[:cntrl:]]' then raise exception 'Check your request details.' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('data-requests:'||actor::text,0));
  if p_action='create' then
    if p_kind is null or p_kind not in ('copy','delete','correction') or p_key is null
      or (p_kind='correction' and char_length(clean)<20) then raise exception 'Choose a request and describe the correction if needed.' using errcode='22023'; end if;
    select * into r from private.account_data_requests where user_id=actor and submission_key=p_key;
    if found then
      if r.submission_fingerprint is distinct from fingerprint then raise exception 'This key was already used for different request details. Refresh your requests.' using errcode='PT409'; end if;
      return jsonb_build_object('request',private.data_request_json(r));
    end if;
    if exists(select 1 from private.account_data_requests where user_id=actor and kind=p_kind and status not in ('declined','withdrawn','fulfilled')) then
      raise exception 'You already have an open request of this type. Check it below.' using errcode='PT409';
    end if;
    perform private.enforce_member_rate_limit('data-request-create',3,86400);
    insert into private.account_data_requests(user_id,submission_key,submission_fingerprint,kind,details) values(actor,p_key,fingerprint,p_kind,clean) returning * into r;
  else
    select * into r from private.account_data_requests where id=p_id and user_id=actor for update;
    if not found then raise exception 'Request not found.' using errcode='PT404'; end if;
    if p_action='withdraw' and r.status='withdrawn' then return jsonb_build_object('request',private.data_request_json(r)); end if;
    if p_expected_version is distinct from r.version then raise exception 'This request changed. Refresh it before saving.' using errcode='PT409'; end if;
    if r.status in ('declined','withdrawn','fulfilled') then raise exception 'This request is closed. Create a new request if needed.' using errcode='PT409'; end if;
    if p_action='update' and (r.status not in ('submitted','information_needed') or char_length(clean)<20) then
      raise exception 'Add at least 20 characters of detail when updating your request.' using errcode='22023';
    end if;
    perform private.enforce_member_rate_limit('data-request-update',10,3600);
    update private.account_data_requests set status=case when p_action='withdraw' then 'withdrawn' else 'submitted' end,
      details=case when p_action='update' then clean else details end,version=version+1,updated_at=now() where id=r.id returning * into r;
  end if;
  return jsonb_build_object('request',private.data_request_json(r));
end;
$$;
revoke all on function public.member_data_requests(text,text,text,uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.member_data_requests(text,text,text,uuid,uuid,bigint) to authenticated;

create or replace function public.staff_data_requests(
  p_status text default 'open',p_kind text default null,p_before_time timestamptz default null,p_before_id uuid default null,p_limit integer default 25
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb; more boolean;
begin
  if not private.can_review_data_requests() then raise exception 'Permission and an authenticator check are required to review data requests.' using errcode='42501'; end if;
  if p_status is null or p_status not in ('open','all','submitted','reviewing','information_needed','ready','declined','withdrawn','fulfilled')
    or (p_kind is not null and p_kind not in ('copy','delete','correction')) or p_limit is null or p_limit not between 1 and 50
    or (p_before_time is null)<>(p_before_id is null) then raise exception 'Choose valid request filters.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(x.payload order by x.created_at desc,x.id desc),'[]'::jsonb) into items from(
    select r.id,r.created_at,private.data_request_json(r)||jsonb_build_object('accountId',r.user_id,'displayName',coalesce(p.display_name,'Member')) payload
    from private.account_data_requests r left join public.profiles p on p.id=r.user_id
    where (p_kind is null or r.kind=p_kind)
      and (p_status='all' or (p_status='open' and r.status not in ('declined','withdrawn','fulfilled')) or r.status=p_status)
      and (p_before_time is null or (r.created_at,r.id)<(p_before_time,p_before_id))
    order by r.created_at desc,r.id desc limit p_limit+1)x;
  more:=jsonb_array_length(items)>p_limit;
  if more then items:=items-p_limit; end if;
  return jsonb_build_object('items',items,'canFulfill',private.can_fulfill_data_requests(),'next',case when more then jsonb_build_object('createdAt',items->(p_limit-1)->>'createdAt','id',items->(p_limit-1)->>'id') end);
end;
$$;
revoke all on function public.staff_data_requests(text,text,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.staff_data_requests(text,text,timestamptz,uuid,integer) to authenticated;

create or replace function public.staff_review_data_request(
  p_id uuid,p_status text,p_reply text,p_expected_version bigint,p_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); r private.account_data_requests; prior private.account_data_request_review_keys;
  clean text:=btrim(coalesce(p_reply,'')); before_value jsonb;
  signature bytea:=pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('id',p_id,'status',p_status,'reply',clean,'version',p_expected_version)::text,'UTF8'));
begin
  if not private.can_review_data_requests() then raise exception 'Permission and an authenticator check are required to review data requests.' using errcode='42501'; end if;
  if p_key is null or p_status is null or p_status not in ('reviewing','information_needed','ready','declined')
    or char_length(clean) not between 10 and 1000 or translate(clean,E'\n\r\t','') ~ '[[:cntrl:]]' then
    raise exception 'Choose a review decision and add a clear reply of 10–1000 characters.' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('data-request-review:'||actor::text,0));
  select * into prior from private.account_data_request_review_keys where actor_id=actor and request_key=p_key;
  if found then
    if prior.fingerprint is distinct from signature then
      raise exception 'That review was already used. Refresh the request before trying again.' using errcode='PT409'; end if;
    select * into r from private.account_data_requests where id=p_id;
    return jsonb_build_object('request',private.data_request_json(r));
  end if;
  select * into r from private.account_data_requests where id=p_id for update;
  if not found then raise exception 'Request not found.' using errcode='PT404'; end if;
  if p_expected_version is distinct from r.version or r.status in ('declined','withdrawn','fulfilled') then
    raise exception 'This request changed or closed. Refresh before reviewing it.' using errcode='PT409'; end if;
  perform private.enforce_member_rate_limit('data-request-review',30,600);
  before_value:=jsonb_build_object('status',r.status,'version',r.version);
  update private.account_data_requests set status=p_status,staff_reply=clean,version=version+1,updated_at=now() where id=p_id returning * into r;
  -- General staff audit visibility must not expose the member's request text.
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state,metadata)
    values(actor,'privacy.request.review','data_request',r.id::text,'Reviewed an account data request.',p_key::text,before_value,
      jsonb_build_object('status',r.status,'version',r.version),jsonb_build_object('kind',r.kind));
  insert into private.account_data_request_review_keys(actor_id,request_key,request_id,fingerprint) values(actor,p_key,p_id,signature);
  return jsonb_build_object('request',private.data_request_json(r));
end;
$$;
revoke all on function public.staff_review_data_request(uuid,text,text,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.staff_review_data_request(uuid,text,text,bigint,uuid) to authenticated;

-- History is fetched separately in bounded pages. Member responses never include
-- staff identity or the private fulfilment reference/evidence.
create or replace function private.data_request_history_page(p_id uuid,p_before_version bigint,p_staff boolean)
returns jsonb language plpgsql stable set search_path='' as $$
declare items jsonb; more boolean; result jsonb;
begin
  if p_before_version is not null and p_before_version<1 then raise exception 'Refresh the request history.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(x.payload order by x.version desc),'[]'::jsonb) into items from (
    select h.version,jsonb_build_object('version',h.version,'event',h.event,'status',h.status,'details',
      case when h.event in ('legacy_snapshot','submitted','member_update') then h.details end,
      'reply',case when h.event in ('legacy_snapshot','staff_review','fulfilled') then h.reply end,
      'recordedAt',h.recorded_at) payload
    from private.account_data_request_history h where h.request_id=p_id and (p_before_version is null or h.version<p_before_version)
    order by h.version desc limit 26
  )x;
  more:=jsonb_array_length(items)>25;
  if more then items:=items-25; end if;
  result:=jsonb_build_object('items',items,'next',case when more then (items->24->>'version')::bigint end);
  if p_staff then
    result:=result||jsonb_build_object('completion',(select jsonb_build_object('method',f.method,'result',f.result,'evidence',f.evidence,
      'completedAt',f.completed_at,'recordedAt',f.recorded_at) from private.account_data_request_fulfillments f where f.request_id=p_id));
  end if;
  return result;
end;
$$;
revoke all on function private.data_request_history_page(uuid,bigint,boolean) from public,anon,authenticated,service_role;

create or replace function public.member_data_request_history(p_id uuid,p_before_version bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_active_member();
begin
  if not exists(select 1 from private.account_data_requests where id=p_id and user_id=actor) then raise exception 'Request not found.' using errcode='PT404'; end if;
  return private.data_request_history_page(p_id,p_before_version,false);
end;
$$;
revoke all on function public.member_data_request_history(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.member_data_request_history(uuid,bigint) to authenticated;

create or replace function public.staff_data_request_history(p_id uuid,p_before_version bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_review_data_requests() then raise exception 'Permission and an authenticator check are required to review data requests.' using errcode='42501'; end if;
  if not exists(select 1 from private.account_data_requests where id=p_id) then raise exception 'Request not found.' using errcode='PT404'; end if;
  return private.data_request_history_page(p_id,p_before_version,true);
end;
$$;
revoke all on function public.staff_data_request_history(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.staff_data_request_history(uuid,bigint) to authenticated;

create or replace function public.staff_fulfill_data_request(
  p_id uuid,p_result text,p_method text,p_evidence text,p_completed_at timestamptz,
  p_expected_version bigint,p_key uuid,p_confirmed boolean
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); r private.account_data_requests; prior private.account_data_request_fulfillments;
  clean text:=btrim(coalesce(p_result,'')); evidence text:=btrim(coalesce(p_evidence,'')); signature bytea; before_value jsonb;
begin
  if private.can_fulfill_data_requests() is distinct from true then raise exception 'Completion permission and an authenticator check are required.' using errcode='42501'; end if;
  if p_key is null or p_id is null or p_confirmed is distinct from true or char_length(clean) not between 30 and 1000
    or char_length(evidence) not between 20 and 1000 or translate(clean||evidence,E'\n\r\t','') ~ '[[:cntrl:]]'
    or p_method is null or p_method not in ('secure_delivery','data_correction','account_erasure') or p_completed_at is null or not isfinite(p_completed_at)
    or p_completed_at>now() then raise exception 'Describe the completed result and private reference, give its actual date, and confirm the follow-up was completed.' using errcode='22023'; end if;
  signature:=pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('id',p_id,'result',clean,'method',p_method,'evidence',evidence,
    'completedAt',p_completed_at,'version',p_expected_version)::text,'UTF8'));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('data-request-fulfill:'||actor::text,0));
  select * into prior from private.account_data_request_fulfillments where actor_id=actor and request_key=p_key;
  if found then
    if prior.fingerprint is distinct from signature then raise exception 'That completion key was already used. Refresh the request.' using errcode='PT409'; end if;
    select * into r from private.account_data_requests where id=p_id;
    return jsonb_build_object('request',private.data_request_json(r));
  end if;
  select * into r from private.account_data_requests where id=p_id for update;
  if not found then raise exception 'Request not found.' using errcode='PT404'; end if;
  if p_expected_version is distinct from r.version or r.status<>'ready' then raise exception 'This request changed or is not ready for follow-up. Refresh it before recording completion.' using errcode='PT409'; end if;
  if p_method<>(case r.kind when 'copy' then 'secure_delivery' when 'correction' then 'data_correction' when 'delete' then 'account_erasure' end)
    or p_completed_at<r.created_at then raise exception 'The completed action and date must match this request.' using errcode='22023'; end if;
  perform private.enforce_member_rate_limit('data-request-fulfill',10,600);
  before_value:=jsonb_build_object('status',r.status,'version',r.version);
  insert into private.account_data_request_fulfillments(request_id,actor_id,request_key,fingerprint,method,result,evidence,completed_at)
    values(r.id,actor,p_key,signature,p_method,clean,evidence,p_completed_at);
  update private.account_data_requests set status='fulfilled',staff_reply=clean,version=version+1,updated_at=now() where id=r.id returning * into r;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state,metadata)
    values(actor,'privacy.request.fulfilled','data_request',r.id::text,'Recorded completed account data-request follow-up.',p_key::text,before_value,
      jsonb_build_object('status',r.status,'version',r.version),jsonb_build_object('kind',r.kind,'method',p_method));
  return jsonb_build_object('request',private.data_request_json(r));
end;
$$;
revoke all on function public.staff_fulfill_data_request(uuid,text,text,text,timestamptz,bigint,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.staff_fulfill_data_request(uuid,text,text,text,timestamptz,bigint,uuid,boolean) to authenticated;

notify pgrst, 'reload schema';
