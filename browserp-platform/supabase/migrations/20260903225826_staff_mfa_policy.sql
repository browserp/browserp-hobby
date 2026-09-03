-- Staff can learn whether to enroll before satisfying MFA, without needing
-- moderation permissions or access to the broader security workspace.
begin;

create or replace function public.staff_mfa_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.staff_mfa_enrollment_allowed() then
    raise exception 'Staff permission required' using errcode = '42501';
  end if;
  return jsonb_build_object('staffMfaRequired', coalesce((
    select staff_mfa_required from private.platform_security_settings where singleton
  ), false));
end;
$$;

revoke all on function public.staff_mfa_policy() from public, anon, service_role;
grant execute on function public.staff_mfa_policy() to authenticated;

commit;
