-- One short account-scoped lease serializes authenticator changes across app
-- instances. This stores no factors, codes, setup keys, or provider tokens.
create table private.staff_authenticator_operations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  operation_id uuid not null,
  expires_at timestamptz not null
);
alter table private.staff_authenticator_operations enable row level security;
revoke all on private.staff_authenticator_operations from public, anon, authenticated, service_role;

create or replace function public.staff_authenticator_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.staff_mfa_enrollment_allowed()
    and coalesce((select auth.jwt())->>'aal','')='aal2'
    and coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"totp"}]'::jsonb
    and exists(select 1 from auth.sessions s where s.user_id=(select auth.uid())
      and s.id::text=(select auth.jwt())->>'session_id'
      and (s.not_after is null or s.not_after>now()));
$$;
revoke all on function public.staff_authenticator_access() from public, anon, authenticated, service_role;
grant execute on function public.staff_authenticator_access() to authenticated;

create or replace function public.staff_authenticator_operation(p_action text, p_operation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.staff_authenticator_access() then
    raise exception 'Verify your staff authenticator before changing sign-in security.' using errcode='42501';
  end if;
  if p_operation_id is null or p_action not in ('acquire','release') or p_action is null then
    raise exception 'Invalid authenticator operation.' using errcode='22023';
  end if;
  if p_action='acquire' then
    insert into private.staff_authenticator_operations(user_id,operation_id,expires_at)
      values((select auth.uid()),p_operation_id,clock_timestamp()+interval '2 minutes')
    on conflict(user_id) do update
      set operation_id=excluded.operation_id, expires_at=excluded.expires_at
      where private.staff_authenticator_operations.expires_at < clock_timestamp();
  else
    delete from private.staff_authenticator_operations
      where user_id=(select auth.uid()) and operation_id=p_operation_id;
  end if;
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;
revoke all on function public.staff_authenticator_operation(text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.staff_authenticator_operation(text,uuid) to authenticated;

-- Keep removal visible in the same restricted account activity history as setup.
alter table public.account_activity drop constraint account_activity_event_type_check;
alter table public.account_activity add constraint account_activity_event_type_check
  check (event_type in ('account.created','auth.signed_in','auth.signed_out',
    'auth.mfa_enrolled','auth.mfa_verified','auth.mfa_removed','auth.identity_linked','auth.identity_unlinked','auth.session_revoked',
    'profile.updated','profile.media_submitted','security.ban_matched'));

create or replace function public.record_account_activity_server(
  p_user_id uuid,
  p_event_type text,
  p_provider text,
  p_masked_network text,
  p_browser_family text,
  p_os_family text,
  p_device_family text,
  p_request_id text,
  p_network_ciphertext text,
  p_network_hash text,
  p_device_hash text,
  p_user_agent_hash text,
  p_metadata jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id=p_user_id) then
    raise exception 'Unknown account' using errcode='42501';
  end if;
  if p_event_type not in ('auth.signed_in','auth.signed_out','auth.mfa_enrolled','auth.mfa_verified','auth.mfa_removed','auth.identity_linked','auth.identity_unlinked','auth.session_revoked','profile.updated','profile.media_submitted','security.ban_matched') then
    raise exception 'Invalid account activity type';
  end if;
  insert into public.account_activity (
    user_id,event_type,provider,masked_network,browser_family,os_family,
    device_family,request_id,metadata
  ) values (
    p_user_id,p_event_type,nullif(p_provider,''),nullif(p_masked_network,''),
    nullif(p_browser_family,''),nullif(p_os_family,''),nullif(p_device_family,''),
    nullif(p_request_id,''),coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;
  insert into private.network_evidence (
    activity_id,network_ciphertext,network_hash,device_hash,user_agent_hash
  ) values (
    v_id,nullif(p_network_ciphertext,''),nullif(p_network_hash,''),
    nullif(p_device_hash,''),nullif(p_user_agent_hash,'')
  );
  return v_id;
end;
$$;
revoke execute on function public.record_account_activity_server(uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_account_activity_server(uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb)
  to service_role;
