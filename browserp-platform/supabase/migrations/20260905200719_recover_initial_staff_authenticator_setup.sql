-- Recovery of an UNVERIFIED first setup uses the same private account lease as
-- backup management, but cannot acquire/check it after any factor is verified.
-- This does not relax the separate AAL2 backup-management guard.
create or replace function public.staff_initial_authenticator_operation(p_action text,p_operation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  if not public.staff_mfa_enrollment_allowed() or not private.has_current_auth_session() then
    raise exception 'An active staff sign-in is required to finish setup.' using errcode='42501';
  end if;
  if p_operation_id is null or p_action is null or p_action not in ('acquire','check','release') then
    raise exception 'Invalid authenticator setup action.' using errcode='22023';
  end if;
  if p_action='release' then
    delete from private.staff_authenticator_operations where user_id=(select auth.uid()) and operation_id=p_operation_id;
    get diagnostics v_count=row_count; return v_count=1;
  end if;
  if exists(select 1 from auth.mfa_factors f where f.user_id=(select auth.uid()) and f.status='verified') then
    raise exception 'An authenticator is already verified. Sign in with it to manage your security.' using errcode='42501';
  end if;
  if p_action='check' then
    return exists(select 1 from private.staff_authenticator_operations
      where user_id=(select auth.uid()) and operation_id=p_operation_id and expires_at>clock_timestamp());
  end if;
  insert into private.staff_authenticator_operations(user_id,operation_id,expires_at)
    values((select auth.uid()),p_operation_id,clock_timestamp()+interval '2 minutes')
  on conflict(user_id) do update
    set operation_id=excluded.operation_id,expires_at=excluded.expires_at
    where private.staff_authenticator_operations.expires_at<clock_timestamp();
  get diagnostics v_count=row_count; return v_count=1;
end;
$$;
revoke all on function public.staff_initial_authenticator_operation(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.staff_initial_authenticator_operation(text,uuid) to authenticated;
