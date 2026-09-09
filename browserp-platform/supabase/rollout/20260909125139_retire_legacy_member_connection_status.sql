-- CONTROLLED RELEASE STEP. Kept outside migrations to prevent automatic apply.
-- Apply only after the v2 bridge is verified, member content writes are paused,
-- and surviving deployments without this mandatory preflight are contained.
-- Drain old requests after commit and before the moderation migration.
-- Preserve the guarded legacy body for postgres-owned internal connection and
-- export consumers. Never restore client execution while old upload code exists.
begin;
do $$
begin
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='member_connection_status_v2' and p.pronargs=0
      and p.prosecdef and pg_get_userbyid(p.proowner)='postgres')
    or not has_function_privilege('authenticated','public.member_connection_status_v2()','execute') then
    raise exception 'The guarded authenticated v2 session contract must be installed first';
  end if;
  if pg_get_userbyid((select proowner from pg_proc where oid='public.member_connection_status()'::regprocedure)) <> 'postgres' then
    raise exception 'Verify legacy session function ownership before retirement';
  end if;
end;
$$;
revoke all on function public.member_connection_status() from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
