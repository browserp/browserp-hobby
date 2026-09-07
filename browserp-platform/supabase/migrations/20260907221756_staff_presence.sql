begin;

-- Presence is private operational state. The public roster receives only a
-- short-lived boolean through a server-only function; timestamps and account
-- identifiers never leave the backend boundary.
create table private.staff_presence (
  user_id uuid primary key references public.staff_memberships(user_id) on delete cascade,
  last_seen_at timestamptz not null default timezone('utc', now())
);

alter table private.staff_presence enable row level security;
revoke all on table private.staff_presence from public, anon, authenticated, service_role;

create or replace function public.staff_presence_touch()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null
     or not public.staff_mfa_enrollment_allowed()
     or (
       coalesce((
         select s.staff_mfa_required
         from private.platform_security_settings s
         where s.singleton
       ), false)
       and (
         coalesce((select auth.jwt())->>'aal', 'aal1') <> 'aal2'
         or not (coalesce((select auth.jwt())->'amr', '[]'::jsonb) @> '[{"method":"totp"}]'::jsonb)
       )
     ) then
    raise exception 'An active verified staff session is required' using errcode = '42501';
  end if;

  insert into private.staff_presence (user_id, last_seen_at)
  values (v_user, timezone('utc', now()))
  on conflict (user_id) do update
    set last_seen_at = excluded.last_seen_at;

  return true;
end;
$$;

revoke execute on function public.staff_presence_touch()
  from public, anon, service_role;
grant execute on function public.staff_presence_touch() to authenticated;

create or replace function public.service_public_staff_presence()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', sm.user_id,
    'online', coalesce(sp.last_seen_at >= statement_timestamp() - interval '90 seconds', false)
  ) order by sm.user_id), '[]'::jsonb)
  from public.staff_memberships sm
  left join private.staff_presence sp on sp.user_id = sm.user_id
  where sm.status = 'active';
$$;

revoke execute on function public.service_public_staff_presence()
  from public, anon, authenticated;
grant execute on function public.service_public_staff_presence() to service_role;

commit;
