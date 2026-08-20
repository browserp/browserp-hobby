-- Validated member avatars publish immediately. Display names remain bound to
-- the authenticated OAuth identity and pass the same database-side safety
-- boundary even when the RPC is called directly.
begin;

create or replace function private.profile_display_name_allowed(p_value text)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_value, ''));
  v_leet text;
  v_words text;
  v_compact text;
begin
  if char_length(v_name) not between 2 and 48
     or v_name ~ '[[:cntrl:]]'
     or v_name !~ '[[:alnum:]]' then
    return false;
  end if;

  if v_name ~* '(https?://|www[.]|discord[.](gg|com/invite)|@[[:space:]]*(everyone|here))' then
    return false;
  end if;

  v_leet := translate(lower(v_name), '013457@$!', 'oieastasi');
  v_words := ' ' || regexp_replace(v_leet, '[^a-z0-9]+', ' ', 'g') || ' ';
  v_compact := regexp_replace(v_leet, '[^a-z0-9]+', '', 'g');

  if v_words ~ ' (fuck|fucker|fucking|shit|cunt|bitch|porn|porno|nude|nudes|rape|rapist|pedo|paedo|pedophile|paedophile|nigger|nigga|faggot) '
     or v_compact ~ '(nigger|nigga|faggot|pedophile|paedophile)'
     or v_compact ~ '(browserp(admin|staff|owner|support|official)|(admin|staff|owner|support|official)browserp|discord(admin|staff|support|moderator|official))' then
    return false;
  end if;
  return true;
end;
$$;
revoke all on function private.profile_display_name_allowed(text) from public, anon, authenticated;

create or replace function private.queue_profile_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op='INSERT' or new.avatar_url is distinct from old.avatar_url then
    new.avatar_review_status=case when nullif(btrim(coalesce(new.avatar_url,'')),'') is null then 'not_set' else 'approved' end;
    new.approved_avatar_url=case when nullif(btrim(coalesce(new.avatar_url,'')),'') is null then null else new.avatar_url end;
  end if;
  if tg_op='INSERT' or new.bio is distinct from old.bio then
    new.bio_review_status=case when nullif(btrim(coalesce(new.bio,'')),'') is null then 'not_set' else 'pending_review' end;
    new.approved_bio='';
  end if;
  return new;
end;
$$;
revoke all on function private.queue_profile_review() from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display text;
  v_username text;
  v_badge_id uuid;
  v_discord_user_id text;
  v_avatar_url text;
begin
  v_display := left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', 'BrowseRP member'), '[<>\x00-\x1F\x7F]', '', 'g'), 48);
  if not private.profile_display_name_allowed(v_display) then v_display := 'BrowseRP member'; end if;
  v_username := 'member_' || left(replace(new.id::text, '-', ''), 12);

  v_avatar_url := nullif(new.raw_user_meta_data ->> 'avatar_url', '');
  if new.raw_app_meta_data ->> 'provider' = 'discord' and coalesce(v_avatar_url, '') !~* '^https://cdn[.]discordapp[.]com/' then
    v_avatar_url := null;
  elsif new.raw_app_meta_data ->> 'provider' = 'google' and coalesce(v_avatar_url, '') !~* '^https://lh3[.]googleusercontent[.]com/' then
    v_avatar_url := null;
  elsif coalesce(new.raw_app_meta_data ->> 'provider', '') not in ('discord', 'google') then
    v_avatar_url := null;
  end if;

  insert into public.profiles (id, username, display_name, avatar_url)
  values (new.id, v_username, btrim(v_display), v_avatar_url);
  insert into public.account_trust (user_id) values (new.id);

  select id into v_badge_id from public.badges where key = 'new_joiner';
  if v_badge_id is not null then
    insert into public.user_badges (user_id, badge_id, reason, expires_at)
    values (new.id, v_badge_id, 'New account', timezone('utc', now()) + interval '5 days');
  end if;

  if new.raw_app_meta_data ->> 'provider' = 'discord' then
    v_discord_user_id := coalesce(new.raw_user_meta_data ->> 'provider_id', new.raw_user_meta_data ->> 'sub');
    perform private.grant_discord_owner(new.id, v_discord_user_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.member_update_profile(
  p_display_name text,p_bio text,p_visibility text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := (select auth.uid()); v_name text := btrim(coalesce(p_display_name,'')); v_bio text := btrim(coalesce(p_bio,''));
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not private.profile_display_name_allowed(v_name)
     or char_length(v_bio)>500 or v_bio ~ '[[:cntrl:]]'
     or p_visibility not in ('public','members','private') then
    raise exception 'Invalid profile details';
  end if;
  update public.profiles set display_name=v_name,bio=v_bio,profile_visibility=p_visibility,
    updated_at=timezone('utc',now()) where id=v_user;
  if not found then raise exception 'Profile not found'; end if;
  return (select jsonb_build_object(
    'displayName',p.display_name,'bio',p.bio,'visibility',p.profile_visibility,
    'avatarUrl',p.avatar_url,'avatarStatus',p.avatar_review_status,'bioStatus',p.bio_review_status
  ) from public.profiles p where p.id=v_user);
end;
$$;
revoke execute on function public.member_update_profile(text,text,text) from public, anon, service_role;
grant execute on function public.member_update_profile(text,text,text) to authenticated;

create or replace function public.member_set_profile_avatar(p_avatar_url text,p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid := (select auth.uid());
  v_path text;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select a.object_path into v_path
  from public.uploaded_assets a
  where a.id=p_asset_id and a.owner_id=v_user and a.bucket='profile-media'
    and a.media_type='avatar' and a.mime_type='image/png'
    and a.byte_size between 70 and 1048576 and a.moderation_status in ('quarantined','approved');
  if v_path is null or p_avatar_url !~* '^https://kywabzfgjoqiznnxygbq[.]supabase[.]co/storage/v1/object/public/profile-media/'
     or p_avatar_url not like '%/'||v_path then
    raise exception 'Invalid profile-media upload';
  end if;
  update public.uploaded_assets
  set moderation_status='approved',
      moderation_result=coalesce(moderation_result,'{}'::jsonb)||jsonb_build_object('publication','immediate','safety','validated-raster'),
      reviewed_at=timezone('utc',now()),reviewed_by=null
  where id=p_asset_id;
  update public.profiles set avatar_url=p_avatar_url,updated_at=timezone('utc',now()) where id=v_user;
  if not found then raise exception 'Profile not found'; end if;
  return (select jsonb_build_object(
    'avatarUrl',p.avatar_url,'avatarStatus',p.avatar_review_status,
    'displayName',p.display_name,'bio',p.bio,'bioStatus',p.bio_review_status,
    'visibility',p.profile_visibility
  ) from public.profiles p where p.id=v_user);
end;
$$;
revoke execute on function public.member_set_profile_avatar(text,uuid) from public,anon,service_role;
grant execute on function public.member_set_profile_avatar(text,uuid) to authenticated;

create or replace function public.staff_profile_review_queue()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.has_staff_permission('profiles.review') then
    coalesce(jsonb_agg(jsonb_build_object(
      'userId',p.id,'displayName',p.display_name,'avatarUrl',p.avatar_url,'bio',p.bio,
      'avatarStatus',p.avatar_review_status,'bioStatus',p.bio_review_status,'joinedAt',p.joined_at
    ) order by p.joined_at),'[]'::jsonb)
  else (select null::jsonb where false) end
  from public.profiles p
  where p.bio_review_status='pending_review';
$$;

create or replace function public.staff_review_profile_content(
  p_user_id uuid,p_field text,p_action text,p_reason text,p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=(select auth.uid()); v_reason text:=btrim(coalesce(p_reason,'')); v_before jsonb; v_after jsonb;
begin
  if not public.has_staff_permission('profiles.review') then raise exception 'Profile-review permission required' using errcode='42501'; end if;
  if p_field <> 'bio' or p_action not in ('approve','reject') or char_length(v_reason) not between 5 and 500 then raise exception 'Invalid profile review'; end if;
  select jsonb_build_object('avatarStatus',avatar_review_status,'bioStatus',bio_review_status) into v_before
  from public.profiles where id=p_user_id for update;
  if v_before is null then raise exception 'Profile not found'; end if;
  update public.profiles set bio_review_status=case when p_action='approve' then 'approved' else 'rejected' end,
    approved_bio=case when p_action='approve' then bio else '' end where id=p_user_id;
  select jsonb_build_object('avatarStatus',avatar_review_status,'bioStatus',bio_review_status) into v_after from public.profiles where id=p_user_id;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
  values(v_actor,'profile.bio.'||p_action,'profile',p_user_id::text,v_reason,nullif(p_request_id,''),v_before,v_after);
  return jsonb_build_object('userId',p_user_id,'field','bio','status',case when p_action='approve' then 'approved' else 'rejected' end);
end;
$$;
revoke execute on function public.staff_profile_review_queue(), public.staff_review_profile_content(uuid,text,text,text,text)
  from public, anon, service_role;
grant execute on function public.staff_profile_review_queue(), public.staff_review_profile_content(uuid,text,text,text,text)
  to authenticated;

update public.uploaded_assets
set moderation_status='approved',
    moderation_result=coalesce(moderation_result,'{}'::jsonb)||jsonb_build_object('publication','immediate','migration','profile_avatar_immediate_name_filter'),
    reviewed_at=timezone('utc',now()),reviewed_by=null
where media_type='avatar' and moderation_status in ('quarantined','scanning');

update public.profiles
set avatar_review_status='approved',approved_avatar_url=avatar_url
where nullif(btrim(coalesce(avatar_url,'')),'') is not null;

update public.profiles
set avatar_review_status='not_set',approved_avatar_url=null
where nullif(btrim(coalesce(avatar_url,'')),'') is null;

do $profile_safety_invariants$
begin
  if not private.profile_display_name_allowed('County Roleplay')
     or private.profile_display_name_allowed('BrowseRP Admin')
     or private.profile_display_name_allowed('discord.gg/example')
     or private.profile_display_name_allowed('f4gg0t') then
    raise exception 'Profile display-name filter invariant failed';
  end if;
  if exists (
    select 1 from public.profiles
    where nullif(btrim(coalesce(avatar_url,'')),'') is not null
      and (avatar_review_status<>'approved' or approved_avatar_url is distinct from avatar_url)
  ) then
    raise exception 'Immediate avatar-publication invariant failed';
  end if;
end
$profile_safety_invariants$;

commit;
