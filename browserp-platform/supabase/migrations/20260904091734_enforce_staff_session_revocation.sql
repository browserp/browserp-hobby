-- A revoked Supabase session can leave a cryptographically valid JWT behind.
-- Require its session row for sensitive staff reads, writes and MFA enrollment.
-- Identity-trigger staff provisioning is deliberately independent of sessions.
create or replace function private.has_current_auth_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.sessions s
    where s.user_id = (select auth.uid())
      and s.id = case
        when coalesce((select auth.jwt())->>'session_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((select auth.jwt())->>'session_id')::uuid
        else null::uuid
      end
  );
$$;
revoke all on function private.has_current_auth_session() from public, anon, authenticated, service_role;

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
    join auth.identities i on i.user_id=sm.user_id and i.provider='discord'
    join private.discord_owner_allowlist a
      on a.discord_user_id=coalesce(i.provider_id,i.identity_data->>'provider_id',i.identity_data->>'sub')
     and a.enabled and a.role_key=sm.role_key
    where sm.user_id=(select auth.uid())
      and sm.status='active'
      and (select private.has_current_auth_session())
      and coalesce((select auth.jwt())->'app_metadata'->>'provider','')='discord'
      and coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"oauth"}]'::jsonb
      and (
        not coalesce((select s.staff_mfa_required from private.platform_security_settings s where s.singleton), false)
        or (
          coalesce((select auth.jwt())->>'aal','aal1')='aal2'
          and coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"totp"}]'::jsonb
        )
      )
      and 1=(select count(*) from auth.identities x where x.user_id=sm.user_id)
      and coalesce(
        (select o.allowed from public.staff_permission_overrides o
         where o.user_id=sm.user_id and o.permission_key=p_permission),
        exists (select 1 from public.staff_role_permissions rp
                where rp.role_key=sm.role_key and rp.permission_key=p_permission)
      )
  );
$$;
revoke execute on function public.has_staff_permission(text) from public, anon, authenticated, service_role;
grant execute on function public.has_staff_permission(text) to anon, authenticated;

create or replace function public.staff_mfa_enrollment_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.staff_memberships sm
    join auth.identities i on i.user_id=sm.user_id and i.provider='discord'
    join private.discord_owner_allowlist a
      on a.discord_user_id=coalesce(i.provider_id,i.identity_data->>'provider_id',i.identity_data->>'sub')
      and a.enabled and a.role_key=sm.role_key
    where sm.user_id=(select auth.uid()) and sm.status='active'
      and (select private.has_current_auth_session())
      and coalesce((select auth.jwt())->'app_metadata'->>'provider','')='discord'
      and coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"oauth"}]'::jsonb
      and 1=(select count(*) from auth.identities x where x.user_id=sm.user_id)
  );
$$;
revoke execute on function public.staff_mfa_enrollment_allowed() from public, anon, authenticated, service_role;
grant execute on function public.staff_mfa_enrollment_allowed() to authenticated;

