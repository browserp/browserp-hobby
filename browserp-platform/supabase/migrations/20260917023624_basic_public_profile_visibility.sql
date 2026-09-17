-- Basic is opt-in. Keep the existing public default and all stored visibility choices.
alter table public.profiles drop constraint if exists profiles_profile_visibility_check;
alter table public.profiles add constraint profiles_profile_visibility_check
  check (profile_visibility in ('public','members','private','basic'));

-- Preserve the existing member/session/moderation gates; only extend the accepted choice.
create or replace function public.member_update_profile(p_display_name text,p_bio text,p_visibility text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.require_active_member();v_name text:=btrim(coalesce(p_display_name,''));v_bio text:=btrim(coalesce(p_bio,''));v_id uuid;
begin
 perform private.enforce_member_rate_limit('profile-update',12,900);
 perform private.require_member_write_session(v_user);
 if char_length(v_name) not between 2 and 48 or v_name ~ '[<>[:cntrl:]]'
   or char_length(v_bio)>500 or v_bio ~ '[[:cntrl:]]' or p_visibility not in ('public','members','private','basic') then raise exception 'Invalid profile details'; end if;
 perform 1 from public.profiles where id=v_user for update;
 if not found then raise exception 'Profile not found';end if;
 if v_name is distinct from (select display_name from public.profiles where id=v_user) then
   v_id:=private.stage_content(v_user,'display_name',v_user,v_name);
 end if;
 update public.profiles set bio=v_bio,profile_visibility=p_visibility,updated_at=clock_timestamp() where id=v_user;
 perform private.require_member_write_session(v_user);
 return (select jsonb_build_object('displayName',p.display_name,'bio',p.bio,'visibility',p.profile_visibility,
   'avatarUrl',p.avatar_url,'avatarStatus',p.avatar_review_status,'bioStatus',p.bio_review_status,
   'moderation', (select private.content_item(s) from private.content_submissions s where s.id=v_id)) from public.profiles p where p.id=v_user);
end;
$$;
revoke all on function public.member_update_profile(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.member_update_profile(text,text,text) to authenticated;
