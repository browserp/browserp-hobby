begin;

-- Explicit duty choices and worked time are private records, independent of
-- browser-presence heartbeats. The existing staff authenticator guard checks
-- current membership, allowlist, account/session status and a verified TOTP.
create table private.staff_duty_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  availability text not null default 'off_duty' check (availability in ('available','away','off_duty')),
  updated_at timestamptz not null default now()
);
create table private.staff_work_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now() check (isfinite(started_at)),
  ended_at timestamptz check (ended_at is null or (isfinite(ended_at) and ended_at >= started_at)),
  status text not null default 'open' check (status in ('open','needs_review','confirmed')),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  check ((status='open') = (ended_at is null))
);
create unique index staff_work_one_open on private.staff_work_sessions(user_id) where ended_at is null;
create index staff_work_user_date on private.staff_work_sessions(user_id,started_at desc,id desc);
create index staff_work_date on private.staff_work_sessions(started_at desc,id desc);
create table private.staff_duty_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_key uuid not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,request_key)
);
alter table private.staff_duty_state enable row level security;
alter table private.staff_work_sessions enable row level security;
alter table private.staff_duty_requests enable row level security;
revoke all on private.staff_duty_state,private.staff_work_sessions,private.staff_duty_requests from public,anon,authenticated,service_role;

create function private.require_staff_duty(p_manage boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare actor uuid:=(select auth.uid()); checked_at timestamptz:=clock_timestamp();
begin
  -- Existing staff ACLs remain authoritative. Supplement their transaction-time
  -- deadlines with wall time so a lock/quota wait cannot extend a live session.
  if actor is null or public.staff_authenticator_access() is distinct from true
    or not exists(select 1 from auth.sessions s where s.user_id=actor
      and s.id::text=(select auth.jwt())->>'session_id' and (s.not_after is null or s.not_after>checked_at))
    or exists(select 1 from public.security_bans b where b.user_id=actor and b.target_type='account'
      and b.revoked_at is null and b.starts_at<=checked_at and (b.ends_at is null or b.ends_at>checked_at)) then
    raise exception 'An active verified staff session is required.' using errcode='42501';
  end if;
  if p_manage and public.has_staff_permission('staff.manage') is distinct from true then
    raise exception 'Staff-management permission is required to correct work sessions.' using errcode='42501';
  end if;
end;
$$;
revoke all on function private.require_staff_duty(boolean) from public,anon,authenticated,service_role;

create function private.staff_work_session_json(s private.staff_work_sessions)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',s.id,'userId',s.user_id,
    'displayName',(select p.display_name from public.profiles p where p.id=s.user_id),
    'startedAt',s.started_at,'endedAt',s.ended_at,'status',s.status,'version',s.version,
    'needsReview',s.status='needs_review' or (s.ended_at is null and s.started_at < now()-interval '12 hours'),
    'confirmedSeconds',case when s.status='confirmed' then floor(extract(epoch from s.ended_at-s.started_at))::bigint else 0 end);
$$;
revoke all on function private.staff_work_session_json(private.staff_work_sessions) from public,anon,authenticated,service_role;

create function private.staff_duty_json(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('availability',coalesce((select availability from private.staff_duty_state where user_id=p_user_id),'off_duty'),
    'updatedAt',(select updated_at from private.staff_duty_state where user_id=p_user_id),
    'openSession',(select private.staff_work_session_json(s) from private.staff_work_sessions s where s.user_id=p_user_id and s.ended_at is null));
$$;
revoke all on function private.staff_duty_json(uuid) from public,anon,authenticated,service_role;

create function public.staff_duty_read(p_view text default 'self',p_from timestamptz default now()-interval '30 days',p_to timestamptz default now(),
  p_limit integer default 25,p_before timestamptz default null,p_before_id uuid default null,p_user_id uuid default null,p_after_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); manager boolean; rows_json jsonb; totals jsonb; team_totals jsonb; last_row jsonb;
begin
  perform private.require_staff_duty();
  manager:=public.has_staff_permission('staff.manage');
  if p_view is null or p_view not in ('self','team','availability') or p_limit is null or p_limit not between 1 and 100
    or p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to-p_from>interval '93 days'
    or (p_before is null)<>(p_before_id is null) or (p_before is not null and not isfinite(p_before)) then
    raise exception 'Choose a valid duty view, date range up to 93 days and page size up to 100.' using errcode='22023';
  end if;
  if (p_view='team' and manager is distinct from true) or (p_user_id is not null and p_view<>'team') then
    raise exception 'Staff-management permission is required for team hours.' using errcode='42501';
  end if;
  if p_view='availability' then
    select coalesce(jsonb_agg(x.value order by x.user_id),'[]') into rows_json from (
      select sm.user_id,jsonb_build_object('userId',sm.user_id,'displayName',p.display_name,
        'availability',coalesce(d.availability,'off_duty'),'updatedAt',d.updated_at) value
      from public.staff_memberships sm join public.profiles p on p.id=sm.user_id
      left join private.staff_duty_state d on d.user_id=sm.user_id
      where sm.status='active' and (p_after_user_id is null or sm.user_id>p_after_user_id)
      order by sm.user_id limit p_limit+1
    ) x;
    return jsonb_build_object('view',p_view,'availability',case when jsonb_array_length(rows_json)>p_limit then rows_json-p_limit else rows_json end,
      'nextAfterUserId',case when jsonb_array_length(rows_json)>p_limit then rows_json->(p_limit-1)->>'userId' else null end,
      'canManageTeam',manager,'asOf',now());
  end if;
  select coalesce(jsonb_agg(x.value order by x.started_at desc,x.id desc),'[]') into rows_json from (
    select s.id,s.started_at,private.staff_work_session_json(s) value
    from private.staff_work_sessions s
    where (p_view='team' or s.user_id=actor) and (p_user_id is null or s.user_id=p_user_id)
      and s.started_at<p_to and (s.ended_at is null or s.ended_at>p_from)
      and (p_before is null or (s.started_at,s.id)<(p_before,p_before_id))
    order by s.started_at desc,s.id desc limit p_limit+1
  ) x;
  select jsonb_build_object('confirmedSeconds',coalesce(sum(case when s.status='confirmed'
      then floor(extract(epoch from least(s.ended_at,p_to)-greatest(s.started_at,p_from)))::bigint else 0 end),0),
      'pendingReviewCount',count(*) filter(where s.status='needs_review' or (s.ended_at is null and s.started_at<now()-interval '12 hours')),
      'openSessionCount',count(*) filter(where s.ended_at is null)) into totals
    from private.staff_work_sessions s where (p_view='team' or s.user_id=actor) and (p_user_id is null or s.user_id=p_user_id)
      and s.started_at<p_to and (s.ended_at is null or s.ended_at>p_from);
  -- Per-person totals use the same bounded range. Sessions, not audit visits,
  -- are the source; pending and open intervals contribute no confirmed time.
  if p_view='team' then
    select coalesce(jsonb_agg(x.value order by x.user_id),'[]') into team_totals from (
      select s.user_id,jsonb_build_object('userId',s.user_id,'displayName',max(p.display_name),
        'confirmedSeconds',coalesce(sum(case when s.status='confirmed' then floor(extract(epoch from least(s.ended_at,p_to)-greatest(s.started_at,p_from)))::bigint else 0 end),0),
        'pendingReviewCount',count(*) filter(where s.status='needs_review' or (s.ended_at is null and s.started_at<now()-interval '12 hours'))) value
      from private.staff_work_sessions s join public.profiles p on p.id=s.user_id
      where (p_user_id is null or s.user_id=p_user_id) and s.started_at<p_to and (s.ended_at is null or s.ended_at>p_from)
        and (p_after_user_id is null or s.user_id>p_after_user_id)
      group by s.user_id order by s.user_id limit p_limit+1
    ) x;
  end if;
  last_row:=rows_json->(p_limit-1);
  return jsonb_build_object('view',p_view,'duty',private.staff_duty_json(actor),'canManageTeam',manager,
    'from',p_from,'to',p_to,'asOf',now(),'sessions',case when jsonb_array_length(rows_json)>p_limit then rows_json-p_limit else rows_json end,
    'next',case when jsonb_array_length(rows_json)>p_limit then jsonb_build_object('before',last_row->>'startedAt','beforeId',last_row->>'id') else null end,
    'totals',totals,'teamTotals',case when jsonb_array_length(team_totals)>p_limit then team_totals-p_limit else team_totals end,
    'nextAfterUserId',case when jsonb_array_length(team_totals)>p_limit then team_totals->(p_limit-1)->>'userId' else null end);
end;
$$;
revoke all on function public.staff_duty_read(text,timestamptz,timestamptz,integer,timestamptz,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.staff_duty_read(text,timestamptz,timestamptz,integer,timestamptz,uuid,uuid,uuid) to authenticated;

create function public.staff_duty_mutate(p_action text,p_key uuid,p_availability text default null,p_session_id uuid default null,p_version bigint default null,
  p_started_at timestamptz default null,p_ended_at timestamptz default null,p_reason text default null,p_confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); target uuid; s private.staff_work_sessions; prior private.staff_duty_requests;
  payload jsonb; result jsonb; before_value jsonb; after_value jsonb; reason text; actual_start timestamptz; actual_end timestamptz; changed boolean:=false; now_at timestamptz:=clock_timestamp();
begin
  perform private.require_staff_duty(p_action='correct_session');
  if p_action is null or p_action not in ('set_availability','clock_in','clock_out','confirm_session','correct_session') or p_key is null then
    raise exception 'Choose a valid duty action and request key.' using errcode='22023';
  end if;
  payload:=jsonb_build_object('action',p_action,'availability',p_availability,'sessionId',p_session_id,'version',p_version,
    'startedAt',p_started_at,'endedAt',p_ended_at,'reason',p_reason,'confirmed',p_confirmed);
  -- Lock the actor's idempotency ledger separately from the affected person's
  -- work sessions: concurrent managers cannot race self clock-in/out writes.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-duty-request:'||actor::text,0));
  -- Even exact retries must still be authorized after waiting for the ledger.
  perform private.require_staff_duty(p_action='correct_session');
  select * into prior from private.staff_duty_requests where actor_id=actor and request_key=p_key;
  if found then
    if prior.payload is distinct from payload then raise exception 'This request key was already used. Refresh before saving.' using errcode='PT409'; end if;
    return prior.result;
  end if;
  target:=actor;
  if p_action in ('clock_out','confirm_session','correct_session') then
    select * into s from private.staff_work_sessions where id=p_session_id;
    if not found or (p_action<>'correct_session' and s.user_id<>actor) then raise exception 'Work session not found.' using errcode='PT404'; end if;
    target:=s.user_id;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-duty-user:'||target::text,0));
  perform private.require_staff_duty(p_action='correct_session');
  perform private.enforce_member_rate_limit('staff-duty',60,300);
  perform private.require_staff_duty(p_action='correct_session');
  -- A queued clock-in starts after the preceding transaction finishes. Using
  -- the request's earlier timestamp could overlap the preceding clock-out;
  -- a quota wait must also finish before the worked-time timestamp is captured.
  now_at:=clock_timestamp();
  if p_action='set_availability' then
    if p_availability is null or p_availability not in ('available','away','off_duty') then raise exception 'Choose Available, Away or Off duty.' using errcode='22023'; end if;
    before_value:=private.staff_duty_json(actor);
    insert into private.staff_duty_state(user_id,availability) values(actor,p_availability)
      on conflict(user_id) do update set availability=excluded.availability,updated_at=now_at;
    after_value:=private.staff_duty_json(actor); reason:='Staff member explicitly changed their availability.'; changed:=true;
  elsif p_action='clock_in' then
    select * into s from private.staff_work_sessions where user_id=actor and ended_at is null for update;
    if not found then
      insert into private.staff_work_sessions(user_id,started_at) values(actor,now_at) returning * into s;
      insert into private.staff_duty_state(user_id,availability) values(actor,'available')
        on conflict(user_id) do update set availability='available',updated_at=now_at;
      reason:='Staff member explicitly clocked in.'; changed:=true;
    end if;
    after_value:=private.staff_work_session_json(s);
  else
    select * into s from private.staff_work_sessions where id=p_session_id for update;
    if not found or s.user_id<>target then raise exception 'Work session not found.' using errcode='PT404'; end if;
    perform private.require_staff_duty(p_action='correct_session');
    now_at:=clock_timestamp();
    before_value:=private.staff_work_session_json(s);
    -- A second clock-out cannot close a newer open session or change the
    -- recorded end. Retrying the original key also returns its original result.
    if p_action='clock_out' and s.ended_at is not null then
      after_value:=before_value;
    else
      if p_version is null or p_version<>s.version then raise exception 'This work session changed. Refresh before saving.' using errcode='PT409'; end if;
      if p_action='clock_out' then
        update private.staff_work_sessions set ended_at=now_at,
          status=case when now_at-started_at>interval '12 hours' then 'needs_review' else 'confirmed' end,
          version=version+1,updated_at=now_at where id=s.id returning * into s;
        reason:='Staff member explicitly clocked out.';
      else
        reason:=btrim(coalesce(p_reason,''));
        if p_confirmed is distinct from true or char_length(reason) not between 10 and 500 or reason~'[[:cntrl:]]' then
          raise exception 'Confirm actual worked time and give a reason of 10-500 characters.' using errcode='22023';
        end if;
        if p_action='confirm_session' and s.status<>'needs_review' and not (s.ended_at is null and s.started_at<now_at-interval '12 hours') then
          raise exception 'Only a session needing review can be confirmed. Ask management for other corrections.' using errcode='PT409';
        end if;
        actual_start:=case when p_action='correct_session' then p_started_at else s.started_at end;
        actual_end:=p_ended_at;
        if actual_start is null or actual_end is null or not isfinite(actual_start) or not isfinite(actual_end)
          or actual_start>now_at or actual_end>now_at or actual_end<actual_start then
          raise exception 'Use actual start and end times, in order and not in the future.' using errcode='22023';
        end if;
        if p_action='confirm_session' and actual_end-actual_start>interval '24 hours' then
          raise exception 'Ask management to confirm a session longer than 24 hours.' using errcode='PT409';
        end if;
        if exists(select 1 from private.staff_work_sessions other where other.user_id=target and other.id<>s.id
          and other.started_at<actual_end and coalesce(other.ended_at,'infinity'::timestamptz)>actual_start) then
          raise exception 'Worked time cannot overlap another session. Review both records first.' using errcode='PT409';
        end if;
        update private.staff_work_sessions set started_at=actual_start,ended_at=actual_end,status='confirmed',version=version+1,updated_at=now_at where id=s.id returning * into s;
      end if;
      if target=actor and before_value->>'endedAt' is null then
        insert into private.staff_duty_state(user_id,availability) values(actor,'off_duty')
          on conflict(user_id) do update set availability='off_duty',updated_at=now_at;
      end if;
      after_value:=private.staff_work_session_json(s); changed:=true;
    end if;
  end if;
  if changed then
    insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
      values(actor,'staff.duty.'||p_action,case when p_action='set_availability' then 'staff_duty' else 'staff_work_session' end,
        case when p_action='set_availability' then target::text else s.id::text end,reason,p_key::text,before_value,after_value);
  end if;
  result:=jsonb_build_object('duty',private.staff_duty_json(actor),'session',case when p_action='set_availability' then null else after_value end,
    'canManageTeam',public.has_staff_permission('staff.manage'),'changed',changed);
  insert into private.staff_duty_requests(actor_id,request_key,payload,result) values(actor,p_key,payload,result);
  -- Any intervening row/audit write can wait too. Denial here rolls back the
  -- work record, audit and retry ledger together rather than releasing a result.
  perform private.require_staff_duty(p_action='correct_session');
  return result;
end;
$$;
revoke all on function public.staff_duty_mutate(text,uuid,text,uuid,bigint,timestamptz,timestamptz,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.staff_duty_mutate(text,uuid,text,uuid,bigint,timestamptz,timestamptz,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
