-- A private request inbox only: this migration never exports or deletes member
-- data, files, identities, listings, or retained security evidence.
create table private.account_data_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  submission_key uuid not null,
  submission_fingerprint bytea not null check(octet_length(submission_fingerprint)=32),
  kind text not null check(kind in ('copy','delete','correction')),
  status text not null default 'submitted' check(status in ('submitted','reviewing','information_needed','ready','declined','withdrawn')),
  details text not null default '' check(char_length(details)<=1000),
  staff_reply text not null default '' check(char_length(staff_reply)<=1000),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,submission_key)
);
create unique index account_data_requests_open_kind on private.account_data_requests(user_id,kind)
  where status not in ('declined','withdrawn');
create index account_data_requests_queue on private.account_data_requests(created_at desc,id desc);
create index account_data_requests_owner on private.account_data_requests(user_id,created_at desc,id desc);
alter table private.account_data_requests enable row level security;
revoke all on private.account_data_requests from public,anon,authenticated,service_role;

insert into public.permissions(key,description) values('privacy.requests.manage','Review private account data requests. This does not grant export or deletion access.') on conflict(key) do nothing;
insert into public.staff_role_permissions(role_key,permission_key) values('owner','privacy.requests.manage') on conflict do nothing;
-- Exact retry fingerprints stay private; general staff logs must not contain
-- request prose, replies, or hashes of either.
create table private.account_data_request_review_keys (
  actor_id uuid not null,
  request_key uuid not null,
  request_id uuid not null references private.account_data_requests(id),
  fingerprint bytea not null check(octet_length(fingerprint)=32),
  primary key(actor_id,request_key)
);
alter table private.account_data_request_review_keys enable row level security;
revoke all on private.account_data_request_review_keys from public,anon,authenticated,service_role;

create or replace function private.data_request_json(r private.account_data_requests)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',r.id,'kind',r.kind,'status',r.status,'details',r.details,
    'staffReply',r.staff_reply,'version',r.version,'createdAt',r.created_at,'updatedAt',r.updated_at);
$$;
revoke all on function private.data_request_json(private.account_data_requests) from public,anon,authenticated,service_role;

create or replace function private.can_review_data_requests()
returns boolean language sql stable security definer set search_path='' as $$
  select public.staff_mfa_enrollment_allowed() and public.has_staff_permission('privacy.requests.manage')
    and coalesce((select auth.jwt())->>'aal','')='aal2'
    and coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"totp"}]'::jsonb;
$$;
revoke all on function private.can_review_data_requests() from public,anon,authenticated,service_role;

create or replace function public.staff_data_request_access()
returns boolean language sql stable security definer set search_path='' as $$
  select private.can_review_data_requests();
$$;
revoke all on function public.staff_data_request_access() from public,anon,authenticated,service_role;
grant execute on function public.staff_data_request_access() to authenticated;

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
    if exists(select 1 from private.account_data_requests where user_id=actor and kind=p_kind and status not in ('declined','withdrawn')) then
      raise exception 'You already have an open request of this type. Check it below.' using errcode='PT409';
    end if;
    perform private.enforce_member_rate_limit('data-request-create',3,86400);
    insert into private.account_data_requests(user_id,submission_key,submission_fingerprint,kind,details) values(actor,p_key,fingerprint,p_kind,clean) returning * into r;
  else
    select * into r from private.account_data_requests where id=p_id and user_id=actor for update;
    if not found then raise exception 'Request not found.' using errcode='PT404'; end if;
    if p_action='withdraw' and r.status='withdrawn' then return jsonb_build_object('request',private.data_request_json(r)); end if;
    if p_expected_version is distinct from r.version then raise exception 'This request changed. Refresh it before saving.' using errcode='PT409'; end if;
    if r.status in ('declined','withdrawn') then raise exception 'This request is closed. Create a new request if needed.' using errcode='PT409'; end if;
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
  if p_status is null or p_status not in ('open','all','submitted','reviewing','information_needed','ready','declined','withdrawn')
    or (p_kind is not null and p_kind not in ('copy','delete','correction')) or p_limit is null or p_limit not between 1 and 50
    or (p_before_time is null)<>(p_before_id is null) then raise exception 'Choose valid request filters.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(x.payload order by x.created_at desc,x.id desc),'[]'::jsonb) into items from(
    select r.id,r.created_at,private.data_request_json(r)||jsonb_build_object('accountId',r.user_id,'displayName',coalesce(p.display_name,'Member')) payload
    from private.account_data_requests r left join public.profiles p on p.id=r.user_id
    where (p_kind is null or r.kind=p_kind)
      and (p_status='all' or (p_status='open' and r.status not in ('declined','withdrawn')) or r.status=p_status)
      and (p_before_time is null or (r.created_at,r.id)<(p_before_time,p_before_id))
    order by r.created_at desc,r.id desc limit p_limit+1)x;
  more:=jsonb_array_length(items)>p_limit;
  if more then items:=items-p_limit; end if;
  return jsonb_build_object('items',items,'next',case when more then jsonb_build_object('createdAt',items->(p_limit-1)->>'createdAt','id',items->(p_limit-1)->>'id') end);
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
  if p_expected_version is distinct from r.version or r.status in ('declined','withdrawn') then
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
