begin;

-- A single homepage feature slot. Member daily boosts remain independent.
create table private.staff_featured_boost (
  slot integer primary key default 1 check (slot = 1),
  -- Retain the slot version after deletion so an old form cannot reuse version 0.
  server_id uuid references public.servers(id) on delete set null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null check (ends_at > starts_at),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  version bigint not null default 1
);
alter table private.staff_featured_boost enable row level security;
revoke all on private.staff_featured_boost from public, anon, authenticated;

create function public.public_featured_boost()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('slug', s.slug, 'expiresAt', b.ends_at)
    from private.staff_featured_boost b
    join public.servers s on s.id = b.server_id
    where b.slot = 1 and b.starts_at <= statement_timestamp()
      and b.ends_at > statement_timestamp() and s.status = 'published'
      and s.published_at is not null
  ), 'null'::jsonb);
$$;

create function public.staff_featured_boost_control()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_active jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Featured boost management permission required' using errcode = '42501';
  end if;
  if not public.has_staff_permission('settings.manage') then
    -- This optional Overview panel must not eject staff who may use Overview.
    if public.has_staff_permission('website.overview.read') then
      return jsonb_build_object('canManage', false);
    end if;
    raise exception 'Featured boost management permission required' using errcode = '42501';
  end if;
  select jsonb_build_object('serverId', b.server_id, 'name', s.name, 'slug', s.slug,
    'startsAt', b.starts_at, 'expiresAt', b.ends_at, 'version', b.version)
    into v_active from private.staff_featured_boost b join public.servers s on s.id = b.server_id
    where b.slot = 1 and b.starts_at <= statement_timestamp() and b.ends_at > statement_timestamp()
      and s.status = 'published' and s.published_at is not null;
  return jsonb_build_object('canManage', true, 'active', v_active, 'version', coalesce((select b.version from private.staff_featured_boost b where b.slot = 1), 0), 'servers', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug) order by s.name)
    from public.servers s where s.status = 'published' and s.published_at is not null
  ), '[]'::jsonb));
end;
$$;

create function public.staff_set_featured_boost(
  p_action text, p_server_id uuid, p_duration_hours integer,
  p_expected_version bigint, p_reason text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz;
  v_current private.staff_featured_boost%rowtype;
  v_target public.servers%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('browserp.staff.authority', 0));
  perform private.require_staff_authority('settings.manage');
  if p_action is null or p_action not in ('start', 'end') or char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500
    or p_request_id is null or p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Choose an action and provide a reason and request ID' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'Reload the featured boost before changing it.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('staff_featured_boost', 0));
  perform private.require_staff_authority('settings.manage');
  v_now := clock_timestamp();
  select a.after_state into v_after from public.staff_audit_events a
    where a.actor_id = v_actor and a.request_id = p_request_id
      and a.action = 'featured_boost.' || p_action;
  if v_after is not null then return v_after; end if;
  select * into v_current from private.staff_featured_boost where slot = 1 for update;
  if p_expected_version is distinct from coalesce(v_current.version, 0) then
    raise exception 'The featured boost changed. Reload and try again.' using errcode = 'PT409';
  end if;
  v_before := case when v_current.slot is null then null else
    jsonb_build_object('serverId', v_current.server_id, 'startsAt', v_current.starts_at,
      'expiresAt', v_current.ends_at, 'version', v_current.version) end;
  if p_action = 'start' then
    if p_duration_hours is null or p_duration_hours not between 1 and 720 or p_server_id is null then
      raise exception 'Choose a server and a duration from 1 hour to 30 days' using errcode = '22023';
    end if;
    select * into v_target from public.servers where id = p_server_id and status = 'published'
      and published_at is not null for share;
    if v_target.id is null then
      raise exception 'Choose a published server' using errcode = '22023';
    end if;
    perform private.require_staff_authority('settings.manage');
    v_now := clock_timestamp();
    insert into private.staff_featured_boost(slot, server_id, starts_at, ends_at, updated_by, updated_at, version)
      values (1, p_server_id, v_now, v_now + make_interval(hours => p_duration_hours), v_actor, v_now, 1)
      on conflict (slot) do update set server_id = excluded.server_id, starts_at = excluded.starts_at,
        ends_at = excluded.ends_at, updated_by = excluded.updated_by, updated_at = excluded.updated_at,
        version = private.staff_featured_boost.version + 1;
    select jsonb_build_object('serverId', b.server_id, 'name', v_target.name, 'slug', v_target.slug,
      'startsAt', b.starts_at, 'expiresAt', b.ends_at, 'version', b.version)
      into v_after from private.staff_featured_boost b where b.slot = 1;
  else
    if v_current.slot is null or v_current.server_id is null or v_current.ends_at <= v_now then
      raise exception 'There is no active featured boost to end' using errcode = '22023';
    end if;
    update private.staff_featured_boost set ends_at = v_now, updated_at = v_now,
      updated_by = v_actor, version = version + 1 where slot = 1;
    v_after := jsonb_build_object('ended', true, 'serverId', v_current.server_id,
      'expiresAt', v_now, 'version', v_current.version + 1);
  end if;
  insert into public.staff_audit_events(actor_id, action, target_type, target_id, reason, request_id, before_state, after_state)
    values(v_actor, 'featured_boost.' || p_action, 'server',
      (case when p_action = 'start' then p_server_id else v_current.server_id end)::text, btrim(p_reason), p_request_id, v_before, v_after);
  perform private.require_staff_authority('settings.manage');
  return v_after;
end;
$$;

revoke all on function public.public_featured_boost(), public.staff_featured_boost_control(),
  public.staff_set_featured_boost(text,uuid,integer,bigint,text,text) from public, anon, authenticated, service_role;
grant execute on function public.public_featured_boost() to anon, authenticated, service_role;
grant execute on function public.staff_featured_boost_control(),
  public.staff_set_featured_boost(text,uuid,integer,bigint,text,text) to authenticated;

commit;
