begin;

-- Retire worked-time operations without changing any historical state, work
-- session, request ledger or audit row. Legacy off_duty is displayed as Away.
alter table private.staff_duty_state drop constraint staff_duty_state_availability_check;
alter table private.staff_duty_state add constraint staff_duty_state_availability_check
  check (availability in ('available','busy','away','off_duty'));
alter table private.staff_duty_state alter column availability set default 'away';

-- The existing require_staff_duty helper checks verified active staff identity,
-- current sessions, bans and permissions. It never required a clock-in; keep it.
create or replace function private.staff_duty_json(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('availability',coalesce((select case when availability='off_duty' then 'away' else availability end
      from private.staff_duty_state where user_id=p_user_id),'away'),
    'updatedAt',(select updated_at from private.staff_duty_state where user_id=p_user_id));
$$;
revoke all on function private.staff_duty_json(uuid) from public,anon,authenticated,service_role;

-- Preserve signatures for the existing route, but expose availability only.
-- The old date arguments are ignored; work-session selectors are rejected.
create or replace function public.staff_duty_read(p_view text default 'self',p_from timestamptz default now()-interval '30 days',p_to timestamptz default now(),
  p_limit integer default 25,p_before timestamptz default null,p_before_id uuid default null,p_user_id uuid default null,p_after_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); manager boolean; rows_json jsonb;
begin
  perform private.require_staff_duty();
  if p_view='team' or p_before is not null or p_before_id is not null or p_user_id is not null then
    raise exception 'Staff hours are no longer available.' using errcode='22023';
  end if;
  if p_view is null or p_view not in ('self','availability') or p_limit is null or p_limit not between 1 and 100
    or (p_view='self' and p_after_user_id is not null) then
    raise exception 'Choose a valid availability view and page size up to 100.' using errcode='22023';
  end if;
  manager:=public.has_staff_permission('staff.manage');
  if p_view='self' then
    return jsonb_build_object('view',p_view,'duty',private.staff_duty_json(actor),'canManageTeam',manager,'asOf',now());
  end if;
  select coalesce(jsonb_agg(x.value order by x.user_id),'[]') into rows_json from (
    select sm.user_id,jsonb_build_object('userId',sm.user_id,'displayName',p.display_name,
      'availability',case when d.availability in ('available','busy','away') then d.availability else 'away' end,
      'updatedAt',d.updated_at) value
    from public.staff_memberships sm join public.profiles p on p.id=sm.user_id
    left join private.staff_duty_state d on d.user_id=sm.user_id
    where sm.status='active' and (p_after_user_id is null or sm.user_id>p_after_user_id)
    order by sm.user_id limit p_limit+1
  ) x;
  return jsonb_build_object('view',p_view,'availability',case when jsonb_array_length(rows_json)>p_limit then rows_json-p_limit else rows_json end,
    'nextAfterUserId',case when jsonb_array_length(rows_json)>p_limit then rows_json->(p_limit-1)->>'userId' else null end,
    'canManageTeam',manager,'asOf',now());
end;
$$;
revoke all on function public.staff_duty_read(text,timestamptz,timestamptz,integer,timestamptz,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.staff_duty_read(text,timestamptz,timestamptz,integer,timestamptz,uuid,uuid,uuid) to authenticated;

create or replace function public.staff_duty_mutate(p_action text,p_key uuid,p_availability text default null,p_session_id uuid default null,p_version bigint default null,
  p_started_at timestamptz default null,p_ended_at timestamptz default null,p_reason text default null,p_confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); prior private.staff_duty_requests;
  payload jsonb; result jsonb; before_value jsonb; after_value jsonb; now_at timestamptz;
begin
  perform private.require_staff_duty();
  if p_action is null or p_action<>'set_availability' then
    raise exception 'Only staff availability can be changed. Work sessions are no longer available.' using errcode='22023';
  end if;
  if p_key is null or p_availability is null or p_availability not in ('available','busy','away')
    or p_session_id is not null or p_version is not null or p_started_at is not null or p_ended_at is not null
    or p_reason is not null or p_confirmed is distinct from false then
    raise exception 'Choose Available, Busy or Away with a valid request key.' using errcode='22023';
  end if;
  payload:=jsonb_build_object('action',p_action,'availability',p_availability,'sessionId',null,'version',null,
    'startedAt',null,'endedAt',null,'reason',null,'confirmed',false);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-duty-request:'||actor::text,0));
  perform private.require_staff_duty();
  select * into prior from private.staff_duty_requests where actor_id=actor and request_key=p_key;
  if found then
    if prior.payload is distinct from payload then raise exception 'This request key was already used. Refresh before saving.' using errcode='PT409'; end if;
    -- A pre-retirement retry may contain an old openSession. Return only the
    -- availability receipt and re-evaluate the current capability, not that data.
    return jsonb_build_object('duty',jsonb_build_object(
      'availability',case when prior.result#>>'{duty,availability}' in ('available','busy','away') then prior.result#>>'{duty,availability}' else 'away' end,
      'updatedAt',prior.result#>'{duty,updatedAt}'),
      'changed',prior.result->'changed','canManageTeam',public.has_staff_permission('staff.manage'));
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-duty-user:'||actor::text,0));
  perform private.require_staff_duty();
  perform private.enforce_member_rate_limit('staff-duty',60,300);
  perform private.require_staff_duty();
  now_at:=clock_timestamp();
  before_value:=private.staff_duty_json(actor);
  insert into private.staff_duty_state(user_id,availability,updated_at) values(actor,p_availability,now_at)
    on conflict(user_id) do update set availability=excluded.availability,updated_at=excluded.updated_at;
  after_value:=private.staff_duty_json(actor);
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
    values(actor,'staff.duty.set_availability','staff_duty',actor::text,
      'Staff member explicitly changed their availability.',p_key::text,before_value,after_value);
  result:=jsonb_build_object('duty',after_value,'canManageTeam',public.has_staff_permission('staff.manage'),'changed',true);
  insert into private.staff_duty_requests(actor_id,request_key,payload,result) values(actor,p_key,payload,result);
  -- Lock, quota and audit waits must not extend an expired/revoked session.
  -- Denial rolls back availability, its action audit and the retry receipt.
  perform private.require_staff_duty();
  return result;
end;
$$;
revoke all on function public.staff_duty_mutate(text,uuid,text,uuid,bigint,timestamptz,timestamptz,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.staff_duty_mutate(text,uuid,text,uuid,bigint,timestamptz,timestamptz,text,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
