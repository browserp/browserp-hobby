-- Requires 20260909105431_staff_capability_hierarchy.sql. Apply before the
-- application adapter; the adapter does not fall back to raw membership rows.
begin;

create function public.service_public_staff_memberships()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', m.user_id,
    'role_key', m.role_key,
    'status', m.status,
    'granted_at', m.granted_at
  ) order by m.granted_at, m.user_id), '[]'::jsonb)
  from (
    select sm.user_id, sm.role_key, sm.status, sm.granted_at
    from public.staff_memberships sm
    where sm.status = 'active'
      and private.is_active_staff_member(sm.user_id)
    order by sm.granted_at, sm.user_id
    limit 100
  ) m;
$$;

revoke all on function public.service_public_staff_memberships()
  from public, anon, authenticated, service_role;
grant execute on function public.service_public_staff_memberships() to service_role;

notify pgrst, 'reload schema';
commit;
