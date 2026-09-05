-- Retention identifies accounts for review; inactivity alone never deletes data.
-- The unused quarantine bucket must not bypass the website's upload controls.
begin;

drop policy if exists "owners upload to quarantine" on storage.objects;

create or replace function private.run_account_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_candidate record;
  v_inserted integer;
  v_notified integer := 0;
  v_review_due integer := 0;
begin
  for v_candidate in
    select u.id,
      greatest(u.created_at, coalesce(u.last_sign_in_at, u.created_at),
        coalesce((select max(a.created_at) from public.account_activity a where a.user_id=u.id), u.created_at)) as last_active_at,
      exists(select 1 from public.staff_memberships sm where sm.user_id=u.id and sm.status='active') as active_staff
    from auth.users u
    join public.profiles p on p.id=u.id
    where u.deleted_at is null and not coalesce(u.is_anonymous, false)
  loop
    if v_candidate.active_staff or v_candidate.last_active_at > v_now - interval '45 days' then
      delete from public.account_retention_flags where user_id=v_candidate.id;
      continue;
    end if;

    insert into public.account_retention_flags(user_id, status, last_active_at, due_at)
    values(v_candidate.id, 'warning', v_candidate.last_active_at, v_candidate.last_active_at + interval '60 days')
    on conflict(user_id) do nothing;
    get diagnostics v_inserted = row_count;

    update public.account_retention_flags
    set status=case when v_candidate.last_active_at <= v_now - interval '60 days' then 'due' else 'warning' end,
        last_active_at=v_candidate.last_active_at,
        due_at=v_candidate.last_active_at + interval '60 days',
        block_reason=null,
        updated_at=v_now
    where user_id=v_candidate.id;

    if v_inserted = 1 then
      insert into public.notifications(user_id, kind, title, body, action_url)
      values(v_candidate.id, 'account_retention', 'Your BrowseRP account is still here',
        'You have not visited BrowseRP recently. Your account and server ownership remain in place. Inactivity does not automatically delete your data.',
        '/dashboard');
      v_notified := v_notified + 1;
    end if;
    if v_candidate.last_active_at <= v_now - interval '60 days' then
      v_review_due := v_review_due + 1;
    end if;
  end loop;

  return jsonb_build_object('warned', v_notified, 'reviewDue', v_review_due,
    'deleted', 0, 'blocked', 0, 'mode', 'review-only', 'completedAt', v_now);
end;
$$;
revoke all on function private.run_account_retention() from public, anon, authenticated, service_role;

-- Correct any unread notice left by the previous deletion policy.
update public.notifications
set title='Your BrowseRP account is still here',
    body='You have not visited BrowseRP recently. Your account and server ownership remain in place. Inactivity does not automatically delete your data.',
    action_url='/dashboard'
where kind='account_retention' and read_at is null;

commit;
