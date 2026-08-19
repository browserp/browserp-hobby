-- Owner-controlled Discord staff access and rank management.
-- Provider identifiers remain operational data and are never committed here.
begin;

alter table private.discord_owner_allowlist
  add column if not exists role_key text,
  add column if not exists updated_at timestamptz not null default timezone('utc', now()),
  add column if not exists version bigint not null default 1;

-- Preserve the one materialized owner while retiring unused legacy bootstrap
-- entries. The operator can add them again later from the staff centre.
update private.discord_owner_allowlist a
set role_key = 'owner',
    updated_at = timezone('utc', now())
where a.role_key is null
  and exists (
    select 1
    from auth.identities i
    join public.staff_memberships sm on sm.user_id = i.user_id
    where i.provider = 'discord'
      and coalesce(
        i.provider_id,
        i.identity_data ->> 'provider_id',
        i.identity_data ->> 'sub'
      ) = a.discord_user_id
      and sm.role_key = 'owner'
      and sm.status = 'active'
  );

update private.discord_owner_allowlist
set role_key = 'support',
    enabled = false,
    note = 'Retired legacy bootstrap entry',
    updated_at = timezone('utc', now()),
    version = version + 1
where role_key is null;

do $staff_bootstrap_invariant$
begin
  if (
    select count(*)
    from private.discord_owner_allowlist
    where enabled and role_key = 'owner'
  ) <> 1 then
    raise exception 'Exactly one active owner mapping is required before staff access can be upgraded';
  end if;
end
$staff_bootstrap_invariant$;

alter table private.discord_owner_allowlist
  alter column role_key set not null;

do $staff_allowlist_constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'private.discord_owner_allowlist'::regclass
      and conname = 'discord_owner_allowlist_role_key_fkey'
  ) then
    alter table private.discord_owner_allowlist
      add constraint discord_owner_allowlist_role_key_fkey
      foreign key (role_key) references public.staff_roles(key);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'private.discord_owner_allowlist'::regclass
      and conname = 'discord_owner_allowlist_role_key_check'
  ) then
    alter table private.discord_owner_allowlist
      add constraint discord_owner_allowlist_role_key_check
      check (role_key in (
        'owner',
        'administrator',
        'senior_moderator',
        'moderator',
        'support'
      ));
  end if;
end
$staff_allowlist_constraints$;

create unique index if not exists discord_owner_allowlist_single_owner_idx
  on private.discord_owner_allowlist (role_key)
  where enabled and role_key = 'owner';

comment on column private.discord_owner_allowlist.role_key is
  'Role provisioned after a Discord-only account is approved by the protected owner.';
comment on column private.discord_owner_allowlist.version is
  'Optimistic-concurrency version used by the owner staff-access workspace.';

-- Owner authorization requires both an owner membership and the unique active
-- owner mapping. Non-owner ranks remain Discord-only and permission-scoped.
create or replace function public.has_staff_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_memberships sm
    join public.staff_role_permissions srp on srp.role_key = sm.role_key
    where sm.user_id = (select auth.uid())
      and sm.status = 'active'
      and srp.permission_key = p_permission
      and coalesce((select auth.jwt()) -> 'app_metadata' ->> 'provider', '') = 'discord'
      and coalesce(
        (select auth.jwt()) -> 'app_metadata' -> 'providers',
        '[]'::jsonb
      ) = '["discord"]'::jsonb
      and coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)
        @> '[{"method":"oauth"}]'::jsonb
      and exists (
        select 1
        from auth.identities i
        join private.discord_owner_allowlist a
          on a.discord_user_id = coalesce(
            i.provider_id,
            i.identity_data ->> 'provider_id',
            i.identity_data ->> 'sub'
          )
         and a.enabled
         and a.role_key = sm.role_key
        where i.user_id = sm.user_id
          and i.provider = 'discord'
      )
      and 1 = (
        select count(*)
        from auth.identities i
        where i.user_id = sm.user_id
      )
      and not exists (
        select 1
        from auth.identities i
        where i.user_id = sm.user_id
          and i.provider is distinct from 'discord'
      )
  );
$$;

revoke execute on function public.has_staff_permission(text) from public;
grant execute on function public.has_staff_permission(text) to anon, authenticated;

-- Retain the established trigger call path but provision the mapped role.
-- Identity changes never reactivate or alter an existing membership.
create or replace function private.grant_discord_owner(
  p_user_id uuid,
  p_discord_user_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_key text;
begin
  if p_user_id is null or p_discord_user_id is null then return; end if;

  select a.role_key
    into v_role_key
  from private.discord_owner_allowlist a
  where a.discord_user_id = p_discord_user_id
    and a.enabled;

  if v_role_key is null then return; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then return; end if;
  if 1 <> (select count(*) from auth.identities i where i.user_id = p_user_id) then return; end if;
  if not exists (
    select 1
    from auth.identities i
    where i.user_id = p_user_id
      and i.provider = 'discord'
      and coalesce(
        i.provider_id,
        i.identity_data ->> 'provider_id',
        i.identity_data ->> 'sub'
      ) = p_discord_user_id
  ) then return; end if;

  insert into public.staff_memberships (user_id, role_key, status, reason)
  values (p_user_id, v_role_key, 'active', 'Owner-approved Discord staff access')
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function private.grant_discord_owner(uuid, text)
  from public, anon, authenticated;

create or replace function private.staff_access_snapshot(p_discord_user_id text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'discordUserId', a.discord_user_id,
    'displayName', p.display_name,
    'avatarUrl', p.avatar_url,
    'roleKey', a.role_key,
    'status', case
      when not a.enabled then 'revoked'
      when sm.user_id is null then 'pending'
      else sm.status
    end,
    'enabled', a.enabled,
    'pending', (a.enabled and sm.user_id is null),
    'protected', (a.role_key = 'owner'),
    'version', a.version
  )
  from private.discord_owner_allowlist a
  left join lateral (
    select i.user_id
    from auth.identities i
    where i.provider = 'discord'
      and coalesce(
        i.provider_id,
        i.identity_data ->> 'provider_id',
        i.identity_data ->> 'sub'
      ) = a.discord_user_id
    order by i.created_at
    limit 1
  ) identity_match on true
  left join public.profiles p on p.id = identity_match.user_id
  left join public.staff_memberships sm on sm.user_id = identity_match.user_id
  where a.discord_user_id = p_discord_user_id;
$$;

revoke all on function private.staff_access_snapshot(text)
  from public, anon, authenticated, service_role;

create or replace function public.staff_list_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if not public.has_staff_permission('staff.manage')
     or not exists (
       select 1
       from public.staff_memberships sm
       where sm.user_id = v_actor
         and sm.role_key = 'owner'
         and sm.status = 'active'
     ) then
    raise exception 'Owner permission required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(
        private.staff_access_snapshot(a.discord_user_id)
        order by (a.role_key = 'owner') desc, a.updated_at desc, a.discord_user_id
      )
      from private.discord_owner_allowlist a
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', r.key,
        'name', r.name,
        'description', r.description
      ) order by r.rank desc)
      from public.staff_roles r
      where r.key in ('administrator', 'senior_moderator', 'moderator', 'support')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.staff_mutate_access(
  p_discord_user_id text,
  p_action text,
  p_role_key text,
  p_reason text,
  p_expected_version bigint,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_discord_user_id text := btrim(coalesce(p_discord_user_id, ''));
  v_role_key text := lower(btrim(coalesce(p_role_key, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_existing private.discord_owner_allowlist%rowtype;
  v_target_user uuid;
  v_before jsonb;
  v_after jsonb;
  v_prior_result jsonb;
begin
  if not public.has_staff_permission('staff.manage')
     or not exists (
       select 1
       from public.staff_memberships sm
       where sm.user_id = v_actor
         and sm.role_key = 'owner'
         and sm.status = 'active'
     ) then
    raise exception 'Owner permission required' using errcode = '42501';
  end if;

  if v_discord_user_id !~ '^[0-9]{17,20}$' then
    raise exception 'Invalid Discord user ID';
  end if;
  if v_action not in ('assign', 'change_role', 'suspend', 'reactivate', 'revoke') then
    raise exception 'Invalid staff access action';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'A reason between 5 and 500 characters is required';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'A valid expected version is required' using errcode = '40001';
  end if;
  if p_request_id is null
     or p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'A request ID is required';
  end if;

  -- A provider retry with the same trusted request ID must observe the first
  -- result, including when both calls arrive concurrently.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_request_id, 0)
  );

  select sae.after_state
    into v_prior_result
  from public.staff_audit_events sae
  where sae.actor_id = v_actor
    and sae.request_id = p_request_id
  order by sae.id desc
  limit 1;
  if found then return v_prior_result; end if;

  select *
    into v_existing
  from private.discord_owner_allowlist a
  where a.discord_user_id = v_discord_user_id
  for update;

  if found and v_existing.role_key = 'owner' then
    raise exception 'The protected owner cannot be changed here' using errcode = '42501';
  end if;
  if v_action in ('assign', 'change_role')
     and v_role_key not in ('administrator', 'senior_moderator', 'moderator', 'support') then
    raise exception 'Choose an assignable staff role';
  end if;

  if v_action = 'assign' then
    if found or p_expected_version <> 0 then
      raise exception 'Staff access changed; reload before trying again' using errcode = '40001';
    end if;
  else
    if not found then
      raise exception 'Staff access entry was not found';
    end if;
    if v_existing.version <> p_expected_version then
      raise exception 'Staff access changed; reload before trying again' using errcode = '40001';
    end if;
  end if;

  v_before := private.staff_access_snapshot(v_discord_user_id);

  select i.user_id
    into v_target_user
  from auth.identities i
  where i.provider = 'discord'
    and coalesce(
      i.provider_id,
      i.identity_data ->> 'provider_id',
      i.identity_data ->> 'sub'
    ) = v_discord_user_id
  order by i.created_at
  limit 1;

  if v_target_user is not null
     and 1 <> (select count(*) from auth.identities i where i.user_id = v_target_user) then
    raise exception 'Target account must remain Discord-only' using errcode = '42501';
  end if;

  if v_action = 'assign' then
    insert into private.discord_owner_allowlist (
      discord_user_id, enabled, note, role_key, updated_at, version
    ) values (
      v_discord_user_id, true, 'Managed by protected owner', v_role_key,
      timezone('utc', now()), 1
    );

    if v_target_user is not null then
      insert into public.staff_memberships as sm (
        user_id, role_key, status, granted_by, reason
      ) values (
        v_target_user, v_role_key, 'active', v_actor, v_reason
      )
      on conflict (user_id) do update set
        role_key = excluded.role_key,
        status = 'active',
        granted_by = excluded.granted_by,
        reason = excluded.reason,
        updated_at = timezone('utc', now());
    end if;
  elsif v_action = 'change_role' then
    update private.discord_owner_allowlist
    set role_key = v_role_key,
        updated_at = timezone('utc', now()),
        version = version + 1
    where discord_user_id = v_discord_user_id;

    if v_target_user is not null then
      update public.staff_memberships
      set role_key = v_role_key,
          granted_by = v_actor,
          reason = v_reason,
          updated_at = timezone('utc', now())
      where user_id = v_target_user;
    end if;
  elsif v_action = 'suspend' then
    if v_target_user is null or not exists (
      select 1 from public.staff_memberships where user_id = v_target_user
    ) then
      raise exception 'Pending access cannot be suspended; revoke it instead';
    end if;

    update public.staff_memberships
    set status = 'suspended',
        reason = v_reason,
        updated_at = timezone('utc', now())
    where user_id = v_target_user;
    update private.discord_owner_allowlist
    set updated_at = timezone('utc', now()), version = version + 1
    where discord_user_id = v_discord_user_id;
  elsif v_action = 'reactivate' then
    update private.discord_owner_allowlist
    set enabled = true,
        updated_at = timezone('utc', now()),
        version = version + 1
    where discord_user_id = v_discord_user_id;

    if v_target_user is not null then
      insert into public.staff_memberships as sm (
        user_id, role_key, status, granted_by, reason
      ) values (
        v_target_user, v_existing.role_key, 'active', v_actor, v_reason
      )
      on conflict (user_id) do update set
        role_key = excluded.role_key,
        status = 'active',
        granted_by = excluded.granted_by,
        reason = excluded.reason,
        updated_at = timezone('utc', now());
    end if;
  elsif v_action = 'revoke' then
    update private.discord_owner_allowlist
    set enabled = false,
        updated_at = timezone('utc', now()),
        version = version + 1
    where discord_user_id = v_discord_user_id;
    if v_target_user is not null then
      update public.staff_memberships
      set status = 'revoked',
          reason = v_reason,
          updated_at = timezone('utc', now())
      where user_id = v_target_user;
    end if;
  end if;

  v_after := private.staff_access_snapshot(v_discord_user_id);

  insert into public.staff_audit_events (
    actor_id,
    action,
    target_type,
    target_id,
    reason,
    request_id,
    before_state,
    after_state,
    metadata
  ) values (
    v_actor,
    'staff.access.' || v_action,
    'staff_access',
    v_discord_user_id,
    v_reason,
    p_request_id,
    v_before,
    v_after,
    jsonb_build_object('requestedRole', nullif(v_role_key, ''))
  );

  return v_after;
end;
$$;

revoke execute on function public.staff_list_access()
  from public, anon, service_role;
grant execute on function public.staff_list_access() to authenticated;

revoke execute on function public.staff_mutate_access(text,text,text,text,bigint,text)
  from public, anon, service_role;
grant execute on function public.staff_mutate_access(text,text,text,text,bigint,text)
  to authenticated;

comment on function public.staff_list_access() is
  'Protected-owner projection of Discord staff mappings, ranks and statuses.';
comment on function public.staff_mutate_access(text,text,text,text,bigint,text) is
  'Single-account, version-checked and audited staff rank management for the protected owner.';

commit;
