-- Quarantined uploads never become public until moderation approves and moves them.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('uploads-quarantine', 'uploads-quarantine', false, 10485760, array['image/png','image/jpeg','image/webp']),
  ('server-media', 'server-media', true, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "owners upload to quarantine"
on storage.objects for insert to authenticated
with check (
  bucket_id='uploads-quarantine'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy "owners inspect quarantined uploads"
on storage.objects for select to authenticated
using (
  bucket_id='uploads-quarantine'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy "moderators inspect quarantine"
on storage.objects for select to authenticated
using (bucket_id='uploads-quarantine' and public.has_staff_permission('moderation.read'));

create policy "approved media is public"
on storage.objects for select to public
using (bucket_id='server-media');

commit;
