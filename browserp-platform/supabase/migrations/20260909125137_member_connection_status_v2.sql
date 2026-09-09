-- Additive bridge only: deploy v2 callers before retiring the legacy RPC.
-- Keep the exact established account/session/OAuth contract; no new authority.
create or replace function public.member_connection_status_v2()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  claims jsonb := (select auth.jwt());
  active boolean := false;
  staff boolean := false;
  authenticated_at numeric;
begin
  active := coalesce(private.member_access_allowed(),false);
  if active then
    active := exists(select 1 from auth.sessions s where s.user_id=actor
      and s.id::text=claims->>'session_id' and (s.not_after is null or s.not_after>now()));
  end if;
  if not active then return jsonb_build_object('active',false); end if;
  staff := exists(select 1 from public.staff_memberships where user_id=actor);
  select max((entry->>'timestamp')::numeric) into authenticated_at
    from jsonb_array_elements(case when jsonb_typeof(claims->'amr')='array' then claims->'amr' else '[]'::jsonb end) entry
    where entry->>'method'='oauth' and jsonb_typeof(entry->'timestamp')='number'
      and entry->>'timestamp' ~ '^[0-9]{1,12}$';
  return jsonb_build_object('active',true,'staff',staff,'userId',actor,
    'sessionId',claims->>'session_id','authenticatedAt',authenticated_at,
    'recent',coalesce(authenticated_at between extract(epoch from now())-600 and extract(epoch from now())+30,false));
end;
$$;
revoke all on function public.member_connection_status_v2() from public,anon,authenticated,service_role;
grant execute on function public.member_connection_status_v2() to authenticated;

comment on function public.member_connection_status_v2() is
  'Versioned member session read; preserves the original guarded connection status contract.';
