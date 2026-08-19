-- Profile-media review, guarded inactivity retention and duplicate-submission signals.
begin;

create or replace function public.member_update_profile(
  p_display_name text,p_bio text,p_visibility text,p_avatar_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_display_name,''));
  v_bio text := btrim(coalesce(p_bio,''));
  v_avatar text := nullif(btrim(coalesce(p_avatar_url,'')),'');
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if char_length(v_name) not between 2 and 48 or v_name ~ '[[:cntrl:]]'
     or char_length(v_bio)>500 or v_bio ~ '[[:cntrl:]]'
     or p_visibility not in ('public','members','private')
     or (v_avatar is not null and (
       char_length(v_avatar)>500 or v_avatar !~* '^https://'
       or not (
         v_avatar ~* '^https://cdn\.discordapp\.com/avatars/'
         or v_avatar ~* '^https://lh3\.googleusercontent\.com/'
         or v_avatar ~* '^https://kywabzfgjoqiznnxygbq\.supabase\.co/storage/v1/object/public/profile-media/'
       )
     )) then
    raise exception 'Invalid profile details';
  end if;
  update public.profiles
  set display_name=v_name,bio=v_bio,profile_visibility=p_visibility,avatar_url=v_avatar,
      updated_at=timezone('utc',now())
  where id=v_user;
  if not found then raise exception 'Profile not found'; end if;
  return (select jsonb_build_object(
    'displayName',p.display_name,'bio',p.bio,'visibility',p.profile_visibility,
    'avatarUrl',p.avatar_url,'avatarStatus',p.avatar_review_status,'bioStatus',p.bio_review_status
  ) from public.profiles p where p.id=v_user);
end;
$$;
revoke execute on function public.member_update_profile(text,text,text,text) from public, anon, service_role;
grant execute on function public.member_update_profile(text,text,text,text) to authenticated;

create table if not exists public.account_retention_flags (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null check (status in ('warning','due','blocked')),
  last_active_at timestamptz not null,
  warned_at timestamptz not null default timezone('utc',now()),
  due_at timestamptz not null,
  block_reason text,
  updated_at timestamptz not null default timezone('utc',now())
);
alter table public.account_retention_flags enable row level security;
revoke all on table public.account_retention_flags from public, anon, authenticated;
create index if not exists account_retention_due_idx on public.account_retention_flags(status,due_at);

create or replace function private.run_account_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz:=timezone('utc',now());
  v_candidate record;
  v_warned integer:=0;
  v_deleted integer:=0;
  v_blocked integer:=0;
  v_has_financial boolean;
  v_has_media boolean;
begin
  for v_candidate in
    select u.id,
      greatest(u.created_at,coalesce(u.last_sign_in_at,u.created_at),
        coalesce((select max(a.created_at) from public.account_activity a where a.user_id=u.id),u.created_at)) as last_active_at
    from auth.users u
    where not exists(select 1 from public.staff_memberships sm where sm.user_id=u.id and sm.status='active')
  loop
    if v_candidate.last_active_at > v_now-interval '45 days' then
      delete from public.account_retention_flags where user_id=v_candidate.id;
      continue;
    end if;
    insert into public.account_retention_flags(user_id,status,last_active_at,due_at)
    values(v_candidate.id,'warning',v_candidate.last_active_at,v_candidate.last_active_at+interval '60 days')
    on conflict(user_id) do update set last_active_at=excluded.last_active_at,due_at=excluded.due_at,updated_at=v_now;
    if exists(select 1 from public.account_retention_flags f where f.user_id=v_candidate.id and f.warned_at>=v_now-interval '5 seconds') then
      insert into public.notifications(user_id,kind,title,body,action_url)
      values(v_candidate.id,'account_retention','Your BrowseRP account is inactive',
        'Sign in before the date shown in your account to keep your profile and community posts.','/dashboard#account');
      v_warned:=v_warned+1;
    end if;
    if v_candidate.last_active_at > v_now-interval '60 days' then continue; end if;
    select exists(select 1 from public.promotion_orders o where o.user_id=v_candidate.id)
       or exists(select 1 from public.promotion_credit_ledger l where l.user_id=v_candidate.id)
       or exists(select 1 from public.payment_attempts p where p.user_id=v_candidate.id)
      into v_has_financial;
    select exists(select 1 from public.uploaded_assets a where a.owner_id=v_candidate.id) into v_has_media;
    if v_has_financial or v_has_media then
      update public.account_retention_flags set status='blocked',
        block_reason=case when v_has_financial then 'financial-retention' else 'media-cleanup-required' end,
        updated_at=v_now where user_id=v_candidate.id;
      v_blocked:=v_blocked+1;
      continue;
    end if;
    update public.account_activity set user_id=null,
      metadata=metadata||jsonb_build_object('accountRemovedForInactivity',true)
    where user_id=v_candidate.id;
    delete from auth.sessions where user_id=v_candidate.id;
    delete from auth.users where id=v_candidate.id;
    if found then v_deleted:=v_deleted+1; end if;
  end loop;
  return jsonb_build_object('warned',v_warned,'deleted',v_deleted,'blocked',v_blocked,'completedAt',v_now);
end;
$$;
revoke all on function private.run_account_retention() from public, anon, authenticated, service_role;

create or replace function public.staff_account_retention()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.has_staff_permission('security.read') then coalesce(jsonb_agg(jsonb_build_object(
    'userId',f.user_id,'displayName',p.display_name,'status',f.status,'lastActiveAt',f.last_active_at,
    'warnedAt',f.warned_at,'dueAt',f.due_at,'blockReason',f.block_reason
  ) order by f.due_at),'[]'::jsonb) else (select null::jsonb where false) end
  from public.account_retention_flags f join public.profiles p on p.id=f.user_id;
$$;
revoke execute on function public.staff_account_retention() from public, anon, service_role;
grant execute on function public.staff_account_retention() to authenticated;

create or replace function private.flag_duplicate_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_matches integer;
begin
  select count(*) into v_matches from public.server_submissions s
  where s.created_at>=timezone('utc',now())-interval '24 hours'
    and s.platform_id=new.platform_id
    and s.id<>new.id
    and (lower(btrim(s.name))=lower(btrim(new.name))
      or (nullif(btrim(new.community_url),'') is not null and lower(btrim(s.community_url))=lower(btrim(new.community_url))));
  if v_matches>0 then
    insert into public.security_events(severity,event_type,actor_id,details)
    values('medium','submission.duplicate_pattern',new.submitted_by,jsonb_build_object(
      'submissionId',new.id,'platformId',new.platform_id,'matchingRecentSubmissions',v_matches
    ));
  end if;
  return new;
end;
$$;
drop trigger if exists server_submission_duplicate_signal on public.server_submissions;
create trigger server_submission_duplicate_signal after insert on public.server_submissions
for each row execute procedure private.flag_duplicate_submission();
revoke all on function private.flag_duplicate_submission() from public, anon, authenticated, service_role;

create or replace function public.staff_security_flag_control()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.has_staff_permission('security.read') then coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'severity',e.severity,'eventType',e.event_type,'displayName',p.display_name,
    'details',e.details,'createdAt',e.created_at,'resolvedAt',e.resolved_at
  ) order by (e.resolved_at is null) desc,e.created_at desc),'[]'::jsonb) else (select null::jsonb where false) end
  from public.security_events e left join public.profiles p on p.id=e.actor_id
  where e.event_type like 'submission.%' or e.event_type like 'account.%';
$$;
revoke execute on function public.staff_security_flag_control() from public, anon, service_role;
grant execute on function public.staff_security_flag_control() to authenticated;

create or replace function public.staff_resolve_security_flag(p_event_id bigint,p_reason text,p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=(select auth.uid()); v_before jsonb; v_after jsonb; v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.has_staff_permission('security.read') then raise exception 'Security permission required' using errcode='42501'; end if;
  if char_length(v_reason) not between 5 and 500 then raise exception 'A reason is required'; end if;
  select to_jsonb(e) into v_before from public.security_events e where e.id=p_event_id for update;
  if v_before is null then raise exception 'Security signal not found'; end if;
  update public.security_events set resolved_at=timezone('utc',now()),resolved_by=v_actor where id=p_event_id;
  select to_jsonb(e) into v_after from public.security_events e where e.id=p_event_id;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
  values(v_actor,'security.flag.resolved','security_event',p_event_id::text,v_reason,nullif(p_request_id,''),v_before,v_after);
  return v_after;
end;
$$;
revoke execute on function public.staff_resolve_security_flag(bigint,text,text) from public, anon, service_role;
grant execute on function public.staff_resolve_security_flag(bigint,text,text) to authenticated;

do $cron_setup$
begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'grant usage on schema cron to postgres';
    execute 'grant all privileges on all tables in schema cron to postgres';
    execute $schedule$select cron.schedule('browserp-account-retention','17 3 * * *','select private.run_account_retention()')$schedule$;
  end if;
exception when undefined_table or undefined_function or feature_not_supported then
  raise notice 'pg_cron is unavailable in this environment; retention remains manually callable.';
end
$cron_setup$;

commit;
