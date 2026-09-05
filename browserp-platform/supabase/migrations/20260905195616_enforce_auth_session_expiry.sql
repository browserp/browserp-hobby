-- A session row can still exist after its configured end time. Keep the
-- existing actor/session-id checks and also honor that deadline everywhere the
-- shared member and staff guards are used. Sessions without a deadline retain
-- their existing behavior; no user, identity, role or session rows are changed.
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
      and (s.not_after is null or s.not_after > now())
      and s.id = case
        when coalesce((select auth.jwt())->>'session_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((select auth.jwt())->>'session_id')::uuid
        else null::uuid
      end
  );
$$;
revoke all on function private.has_current_auth_session() from public, anon, authenticated, service_role;
