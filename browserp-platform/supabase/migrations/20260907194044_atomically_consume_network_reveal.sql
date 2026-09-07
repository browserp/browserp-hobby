-- An approved non-owner reveal is consumed by the same conditional UPDATE
-- that arbitrates concurrent callers. Keep evidence and audit in its transaction.
begin;
create or replace function public.staff_network_reveal_evidence(p_activity_id bigint,p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=(select auth.uid()); v_ciphertext text; v_owner_direct boolean;
begin
  select exists(select 1 from public.staff_memberships where user_id=v_actor and role_key='owner' and status='active')
    and public.has_staff_permission('security.network.approve') into v_owner_direct;
  if not v_owner_direct and not public.has_staff_permission('security.network.request') then
    raise exception 'Approved network-evidence request required' using errcode='42501';
  end if;
  if not v_owner_direct then
    -- Wait on this caller's exact request before checking wall-clock expiry.
    -- now() alone would remain frozen if a concurrent transaction held the row.
    perform 1 from public.network_reveal_requests r
    where r.id=p_request_id and r.activity_id=p_activity_id and r.requested_by=v_actor
    for update;
    update public.network_reveal_requests r set status='used',used_at=clock_timestamp()
    where r.id=p_request_id and r.activity_id=p_activity_id and r.requested_by=v_actor
      and r.status='approved' and r.expires_at>clock_timestamp() and r.used_at is null;
    if not found then
      raise exception 'Approved network-evidence request required' using errcode='42501';
    end if;
  end if;
  select network_ciphertext into v_ciphertext from private.network_evidence where activity_id=p_activity_id;
  if v_ciphertext is null then raise exception 'Protected network evidence is unavailable'; end if;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,after_state)
  values(v_actor,'network.reveal.viewed','account_activity',p_activity_id::text,'Approved protected evidence view',jsonb_build_object('requestId',p_request_id));
  return jsonb_build_object('ciphertext',v_ciphertext);
end;
$$;
-- Preserve the existing RPC grants; there is no public or service-role reveal.
revoke execute on function public.staff_network_reveal_evidence(bigint,uuid) from public,anon,service_role;
grant execute on function public.staff_network_reveal_evidence(bigint,uuid) to authenticated;
commit;
