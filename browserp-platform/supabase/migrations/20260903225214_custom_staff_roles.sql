begin;

alter table public.staff_roles
  add column if not exists is_custom boolean not null default false,
  add column if not exists version bigint not null default 1;

-- The existing foreign key now validates custom roles too. Owner mutation checks
-- and the unique active-owner index continue to protect the owner mapping.
alter table private.discord_owner_allowlist
  drop constraint if exists discord_owner_allowlist_role_key_check;

create or replace function public.staff_role_control()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_staff_permission('staff.manage')
     or not public.has_staff_permission('staff.permissions.manage')
     or not exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and role_key='owner' and status='active') then
    raise exception 'Owner permission required' using errcode='42501';
  end if;
  return jsonb_build_object(
    'roles',coalesce((select jsonb_agg(jsonb_build_object(
      'key',r.key,'name',r.name,'description',r.description,'custom',r.is_custom,'version',r.version,
      'memberCount',(select count(*) from private.discord_owner_allowlist a where a.role_key=r.key and a.enabled),
      'permissions',coalesce((select jsonb_agg(permission_key order by permission_key) from public.staff_role_permissions where role_key=r.key),'[]'::jsonb)
    ) order by r.rank desc) from public.staff_roles r where r.key<>'owner'),'[]'::jsonb),
    'permissions',coalesce((select jsonb_agg(jsonb_build_object('key',p.key,'description',p.description) order by p.key)
      from public.permissions p where p.key not in ('staff.manage','staff.permissions.manage','security.network.approve')),'[]'::jsonb)
  );
end;
$$;

create or replace function public.staff_mutate_role(
  p_key text, p_name text, p_description text, p_permissions text[],
  p_expected_version bigint, p_reason text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_key text := lower(btrim(coalesce(p_key,'')));
  v_name text := btrim(coalesce(p_name,''));
  v_description text := btrim(coalesce(p_description,''));
  v_reason text := btrim(coalesce(p_reason,''));
  v_existing public.staff_roles%rowtype;
  v_rank integer;
  v_before jsonb;
  v_after jsonb;
  v_prior jsonb;
begin
  if not public.has_staff_permission('staff.manage')
     or not public.has_staff_permission('staff.permissions.manage')
     or not exists(select 1 from public.staff_memberships where user_id=v_actor and role_key='owner' and status='active') then
    raise exception 'Owner permission required' using errcode='42501';
  end if;
  if char_length(v_name) not between 2 and 60 or char_length(v_description) not between 5 and 300
     or char_length(v_reason) not between 5 and 500 then
    raise exception 'Check the role name, description and reason' using errcode='22023';
  end if;
  if p_expected_version is null or p_expected_version<0 then
    raise exception 'Reload roles before saving' using errcode='40001';
  end if;
  if p_request_id is null or p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'A request ID is required' using errcode='22023';
  end if;
  if p_permissions is null or cardinality(p_permissions)>80 or exists(
    select 1 from unnest(p_permissions) x where x is null or x in ('staff.manage','staff.permissions.manage','security.network.approve')
      or not exists(select 1 from public.permissions where key=x)
  ) then
    raise exception 'Choose valid assignable permissions' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('browserp.staff.roles',0));
  select after_state into v_prior from public.staff_audit_events
    where actor_id=v_actor and request_id=p_request_id and action='staff.role.save' order by id desc limit 1;
  if found then return v_prior; end if;
  if v_key='' then
    v_key := 'custom_' || left(trim(both '_' from regexp_replace(lower(v_name),'[^a-z0-9]+','_','g')),33);
    if v_key='custom_' then raise exception 'Include a letter or number in the role name' using errcode='22023'; end if;
    if p_expected_version<>0 or exists(select 1 from public.staff_roles where key=v_key or lower(name)=lower(v_name)) then
      raise exception 'A role with this name already exists' using errcode='23505';
    end if;
    select candidate into v_rank from generate_series(1,799) candidate
      where not exists(select 1 from public.staff_roles where rank=candidate) order by candidate desc limit 1;
    if v_rank is null then raise exception 'The custom role limit has been reached' using errcode='22023'; end if;
    insert into public.staff_roles(key,name,description,rank,protected,is_custom,version)
      values(v_key,v_name,v_description,v_rank,false,true,1);
  else
    select * into v_existing from public.staff_roles where key=v_key for update;
    if not found or not v_existing.is_custom or v_existing.protected or v_key='owner' then
      raise exception 'Only custom roles can be edited here' using errcode='42501';
    end if;
    if v_existing.version<>p_expected_version then raise exception 'This role changed; reload before saving' using errcode='40001'; end if;
    v_before := to_jsonb(v_existing) || jsonb_build_object('permissions',coalesce((select jsonb_agg(permission_key order by permission_key) from public.staff_role_permissions where role_key=v_key),'[]'::jsonb));
    update public.staff_roles set name=v_name,description=v_description,version=version+1 where key=v_key;
  end if;
  delete from public.staff_role_permissions where role_key=v_key;
  insert into public.staff_role_permissions(role_key,permission_key) select v_key,x from unnest(p_permissions) x group by x;
  select jsonb_build_object('key',r.key,'name',r.name,'description',r.description,'custom',r.is_custom,'version',r.version,
    'permissions',coalesce((select jsonb_agg(permission_key order by permission_key) from public.staff_role_permissions where role_key=v_key),'[]'::jsonb))
    into v_after from public.staff_roles r where r.key=v_key;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state,metadata)
    values(v_actor,'staff.role.save','staff_role',v_key,v_reason,p_request_id,v_before,v_after,'{}'::jsonb);
  return v_after;
end;
$$;

revoke execute on function public.staff_role_control(), public.staff_mutate_role(text,text,text,text[],bigint,text,text) from public,anon,service_role;
grant execute on function public.staff_role_control(), public.staff_mutate_role(text,text,text,text[],bigint,text,text) to authenticated;

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
      where r.key <> 'owner'
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
     and (v_role_key = 'owner' or not exists (select 1 from public.staff_roles where key = v_role_key)) then
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


commit;
