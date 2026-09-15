-- Public member presentation reuses the approved profile and badge projections.
-- Banner choices are BrowseRP-made designs, so no unreviewed image is published.
alter table public.profiles add column if not exists banner_style text not null default 'aurora';
alter table public.profiles drop constraint if exists profiles_banner_style_check;
alter table public.profiles add constraint profiles_banner_style_check
  check (banner_style in ('aurora','afterglow','midnight','daybreak'));

create or replace function public.service_member_badges(p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select private.member_badge_projection(p_user_id);
$$;
revoke all on function public.service_member_badges(uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_member_badges(uuid) to service_role;

create or replace function public.public_server_creator(p_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'username',p.username,'displayName',left(p.display_name,48),
    'avatarUrl',case when p.avatar_review_status='approved' then p.approved_avatar_url end
  )
  from public.servers s
  join public.server_submissions sub on sub.id=s.source_submission_id
  join public.profiles p on p.id=sub.submitted_by
  where s.slug=p_slug and s.status='published' and s.age_rating<>'adult'
    and p.profile_visibility='public'
    and p.username ~ '^[a-z0-9_]{3,30}$'
  limit 1;
$$;
revoke all on function public.public_server_creator(text) from public,anon,authenticated,service_role;
grant execute on function public.public_server_creator(text) to anon,authenticated;

create or replace function public.member_set_banner_style(p_style text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid := private.require_active_member();
begin
  perform private.require_member_write_session(v_user);
  perform private.enforce_member_rate_limit('profile-banner',12,900);
  if p_style not in ('aurora','afterglow','midnight','daybreak') then
    raise exception 'Choose a BrowseRP banner style';
  end if;
  update public.profiles set banner_style=p_style,updated_at=timezone('utc',now()) where id=v_user;
  if not found then raise exception 'Profile not found'; end if;
  perform private.require_member_write_session(v_user);
  return jsonb_build_object('bannerStyle',p_style);
end;
$$;
revoke all on function public.member_set_banner_style(text) from public,anon,authenticated,service_role;
grant execute on function public.member_set_banner_style(text) to authenticated;

create or replace function public.member_report_profile(p_username text,p_category text,p_details text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid := private.require_active_member(); v_target uuid; v_id uuid;
begin
  perform private.require_member_write_session(v_user);
  perform private.enforce_member_rate_limit('profile-report',5,900);
  if p_username !~ '^[a-z0-9_]{3,30}$'
     or p_category not in ('impersonation','harassment','unsafe-content','misleading')
     or char_length(btrim(coalesce(p_details,''))) not between 20 and 2000
     or p_details ~ '[[:cntrl:]]' then
    raise exception 'Check the report details';
  end if;
  select id into v_target from public.profiles
    where username=p_username and profile_visibility in ('public','members');
  if v_target is null or v_target=v_user then raise exception 'This profile cannot be reported'; end if;
  insert into public.reports(reporter_id,target_type,target_id,category,details)
    values(v_user,'profile',v_target::text,p_category,btrim(p_details)) returning id into v_id;
  perform private.require_member_write_session(v_user);
  return jsonb_build_object('id',v_id,'status','open');
end;
$$;
revoke all on function public.member_report_profile(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.member_report_profile(text,text,text) to authenticated;
