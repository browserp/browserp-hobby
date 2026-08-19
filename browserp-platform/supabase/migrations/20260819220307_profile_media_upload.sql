-- Cropped member avatars use one reviewed, public image bucket. The browser
-- never receives a storage write credential; the consolidated server router
-- validates and stores the normalized PNG before this function queues review.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-media','profile-media',true,1048576,array['image/png'])
on conflict(id) do update set public=true,file_size_limit=1048576,allowed_mime_types=array['image/png'];

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
    and a.byte_size between 70 and 1048576 and a.moderation_status='quarantined';
  if v_path is null or p_avatar_url !~* '^https://kywabzfgjoqiznnxygbq\.supabase\.co/storage/v1/object/public/profile-media/'
     or p_avatar_url not like '%/'||v_path then
    raise exception 'Invalid reviewed profile-media upload';
  end if;
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

commit;
