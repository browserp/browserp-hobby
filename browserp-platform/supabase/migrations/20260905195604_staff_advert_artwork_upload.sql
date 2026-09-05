-- Staff upload through the authenticated website boundary. Public readers can
-- display artwork, but receive no Storage write policy or privileged credential.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('advertisements','advertisements',true,1048576,array['image/png','image/jpeg','image/webp','image/avif'])
on conflict(id) do update set public=true,file_size_limit=1048576,
  allowed_mime_types=array['image/png','image/jpeg','image/webp','image/avif'];
-- Explicit restrictions keep this server boundary intact if another upload
-- policy is broadened later. They do not change other buckets' access rules.
create policy "advert artwork server insert" on storage.objects as restrictive
  for insert to anon,authenticated with check (bucket_id<>'advertisements');
create policy "advert artwork server update" on storage.objects as restrictive
  for update to anon,authenticated using (bucket_id<>'advertisements') with check (bucket_id<>'advertisements');
create policy "advert artwork server delete" on storage.objects as restrictive
  for delete to anon,authenticated using (bucket_id<>'advertisements');

-- Keep existing first-party URL artwork working. Newly uploaded staff artwork
-- must have a completed server registration, linked atomically to the campaign.
create or replace function private.link_staff_advert_artwork()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_asset public.uploaded_assets;
  v_prefix constant text := 'https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/advertisements/staff/';
begin
  if lower(left(new.image_url,char_length(v_prefix)))=v_prefix then
    new.image_url := v_prefix||substring(new.image_url from char_length(v_prefix)+1);
    select a.* into v_asset from public.uploaded_assets a
    where a.bucket='advertisements' and a.media_type='advertisement'
      and a.object_path='staff/'||substring(new.image_url from char_length(v_prefix)+1)
    for update;
    if v_asset.id is null or v_asset.moderation_status<>'approved' then
      raise exception 'Upload this artwork again before saving.' using errcode='23514';
    end if;
    new.image_asset_id := v_asset.id;
  else
    new.image_asset_id := null;
  end if;
  return new;
end;
$$;
revoke all on function private.link_staff_advert_artwork() from public,anon,authenticated,service_role;
create trigger link_staff_advert_artwork before insert or update of image_url,image_asset_id
on public.ad_campaigns for each row execute function private.link_staff_advert_artwork();

-- Only the server may claim unreferenced files for deletion. Rejection occurs
-- under the same lock as campaign linking; Storage removal happens via its API.
create or replace function public.claim_advert_media_cleanup(p_asset_id uuid default null,p_owner_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_asset record; v_result jsonb := '[]'::jsonb;
begin
  for v_asset in
    select a.* from public.uploaded_assets a
    where a.bucket='advertisements' and a.media_type='advertisement'
      and a.object_path ~ '^staff/[0-9a-f-]{36}/[0-9a-f-]{36}\.png$'
      and (p_asset_id is null or a.id=p_asset_id)
      and (p_owner_id is null or a.owner_id=p_owner_id)
      and (p_asset_id is not null or a.created_at < now()-interval '24 hours')
      and not exists(select 1 from public.ad_campaigns c where c.image_asset_id=a.id
        or c.image_url='https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/advertisements/'||a.object_path)
    order by a.created_at limit 5 for update skip locked
  loop
    if exists(select 1 from public.ad_campaigns c where c.image_asset_id=v_asset.id
        or c.image_url='https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/advertisements/'||v_asset.object_path) then
      continue;
    end if;
    update public.uploaded_assets set moderation_status='rejected',
      moderation_result=moderation_result||'{"cleanupPending":true}'::jsonb
    where id=v_asset.id;
    v_result := v_result||jsonb_build_array(jsonb_build_object('id',v_asset.id,'objectPath',v_asset.object_path));
  end loop;
  return v_result;
end;
$$;
revoke all on function public.claim_advert_media_cleanup(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_advert_media_cleanup(uuid,uuid) to service_role;

create or replace function public.complete_advert_media_cleanup(p_asset_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  delete from public.uploaded_assets a where a.id=p_asset_id
    and a.bucket='advertisements' and a.media_type='advertisement'
    and a.moderation_status='rejected' and a.moderation_result @> '{"cleanupPending":true}'::jsonb
    and not exists(select 1 from public.ad_campaigns c where c.image_asset_id=a.id
      or c.image_url='https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/advertisements/'||a.object_path);
  return found;
end;
$$;
revoke all on function public.complete_advert_media_cleanup(uuid) from public,anon,authenticated,service_role;
grant execute on function public.complete_advert_media_cleanup(uuid) to service_role;
commit;
