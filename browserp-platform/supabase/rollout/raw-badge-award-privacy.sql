-- Standalone proposal for Main to review and apply before canonical badges.
-- Hide raw award evidence while retaining the existing row policy and four
-- non-sensitive columns. This does not activate any new badge functionality.
begin;

do $$
begin
  if to_regprocedure('public.member_badges(uuid)') is not null
     or to_regclass('private.member_signup_order') is not null then
    raise exception 'Canonical badges are already installed; do not restore transitional raw-table reads.';
  end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='user_badges' and c.relkind='r'
      and c.relrowsecurity and pg_get_userbyid(c.relowner)='postgres') then
    raise exception 'Verify the existing postgres-owned user_badges table and enabled row security before applying.';
  end if;
end;
$$;

-- Column REVOKE alone cannot override a surviving table-level SELECT grant.
-- Remove that broad grant first, including possible inherited PUBLIC access.
revoke select on table public.user_badges from public,anon,authenticated;
revoke select (user_id,badge_id,awarded_by,reason,awarded_at,expires_at)
  on table public.user_badges from public,anon,authenticated;
grant select (user_id,badge_id,awarded_at,expires_at)
  on table public.user_badges to anon,authenticated;

-- Fail closed if another inherited grant still exposes the protected fields.
do $$
declare client_role text; column_name text;
begin
  foreach client_role in array array['anon','authenticated'] loop
    if has_table_privilege(client_role,'public.user_badges','select')
       or has_column_privilege(client_role,'public.user_badges','reason','select')
       or has_column_privilege(client_role,'public.user_badges','awarded_by','select') then
      raise exception 'Raw badge evidence remains readable for %; review inherited privileges.',client_role;
    end if;
    foreach column_name in array array['user_id','badge_id','awarded_at','expires_at'] loop
      if not has_column_privilege(client_role,'public.user_badges',column_name,'select') then
        raise exception 'The expected public badge column % is unavailable for %.',column_name,client_role;
      end if;
    end loop;
  end loop;
end;
$$;

notify pgrst,'reload schema';
commit;
