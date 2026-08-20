-- Retire the superseded four-argument profile mutation so authenticated
-- callers cannot bypass the current display-name and owned-avatar boundaries.
begin;

revoke execute on function public.member_update_profile(text,text,text,text)
  from public, anon, authenticated, service_role;

comment on function public.member_update_profile(text,text,text,text) is
  'Legacy compatibility function retained without API role execution privileges.';

do $profile_legacy_boundary$
begin
  if has_function_privilege('authenticated', 'public.member_update_profile(text,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.member_update_profile(text,text,text,text)', 'EXECUTE') then
    raise exception 'Legacy profile update function remains callable';
  end if;
end
$profile_legacy_boundary$;

commit;
