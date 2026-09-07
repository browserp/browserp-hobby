-- Private, account-bound delivery of the files named by an approved JSON copy.
-- This does not erase accounts, weaken evidence retention, or create public URLs.
alter table private.member_data_exports add column files_prepared_at timestamptz;
create table private.member_data_export_files (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references private.member_data_exports(id),
  asset_id uuid not null,
  bucket text not null check(bucket in ('profile-media','server-media','uploads-quarantine','advertisements')),
  object_path text not null check(object_path ~ '^[a-zA-Z0-9_./-]+$' and object_path not like '/%' and object_path not like '%..%'),
  filename text not null,
  byte_size integer not null check(byte_size between 1 and 10485760),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  received_at timestamptz,
  unique(export_id,asset_id)
);
alter table private.member_data_export_files enable row level security;
revoke all on private.member_data_export_files from public,anon,authenticated,service_role;

create or replace function private.data_export_summary(e private.member_data_exports)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',e.id,'sha256',e.sha256,'byteSize',e.byte_size,'createdAt',e.created_at,'expiresAt',e.expires_at,'receivedAt',e.received_at,'pending',e.pending,
   'available',e.payload is not null and e.expires_at>now(),'filename','BrowseRP-account-data.json',
   'files',case when e.files_prepared_at is not null then
     (select jsonb_build_object('count',count(*),'received',count(received_at)) from private.member_data_export_files where export_id=e.id) end);
$$;
revoke all on function private.data_export_summary(private.member_data_exports) from public,anon,authenticated,service_role;

create or replace function public.member_list_data_export_files(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.member_data_exports; item jsonb; asset public.uploaded_assets; file_count integer;
begin
 e:=private.readable_member_export(p_id);
 select * into e from private.member_data_exports where id=e.id for update;
 e:=private.readable_member_export(p_id);
 perform private.enforce_member_rate_limit('data-export-files-list',30,600);
 if e.files_prepared_at is null then
   file_count:=jsonb_array_length(coalesce(e.payload::jsonb->'collections'->'uploads','[]'::jsonb));
   if file_count>2000 then raise exception 'This copy needs a larger file review. Your request remains open.' using errcode='PT413'; end if;
   -- Match the immutable JSON snapshot, not a client-supplied account/path.
   for item in select value from jsonb_array_elements(coalesce(e.payload::jsonb->'collections'->'uploads','[]'::jsonb)) loop
     select * into asset from public.uploaded_assets where id=(item->>'id')::uuid and owner_id=e.user_id;
     if not found or asset.sha256 is distinct from item->>'sha256' or asset.byte_size is distinct from (item->>'byte_size')::bigint
       or asset.sha256 !~ '^[a-f0-9]{64}$' or asset.byte_size not between 1 and 10485760
       or asset.bucket not in ('profile-media','server-media','uploads-quarantine','advertisements')
       or asset.object_path !~ '^[a-zA-Z0-9_./-]+$' or asset.object_path like '/%' or asset.object_path like '%..%'
     then raise exception 'An uploaded file changed or needs individual review. Ask staff for a new copy review.' using errcode='PT409'; end if;
     if not exists(select 1 from storage.objects o where o.bucket_id=asset.bucket and o.name=asset.object_path
       and o.metadata->>'size'=asset.byte_size::text) then
       raise exception 'An uploaded file could not be confirmed in storage. Your request remains open for staff follow-up.' using errcode='PT503'; end if;
     insert into private.member_data_export_files(export_id,asset_id,bucket,object_path,filename,byte_size,sha256)
       values(e.id,asset.id,asset.bucket,asset.object_path,
         asset.media_type||'-'||asset.id::text||case asset.mime_type when 'image/png' then '.png' when 'image/jpeg' then '.jpg' when 'image/webp' then '.webp' else '.bin' end,
         asset.byte_size,asset.sha256);
   end loop;
   -- Interrupted historical uploads can leave a storage object without a row.
   -- Do not silently claim a complete file inventory when that happened.
   if exists(select 1 from storage.objects o
     where o.bucket_id in ('profile-media','server-media','uploads-quarantine','advertisements') and o.created_at<=e.created_at
       and (o.owner_id=e.user_id::text or split_part(o.name,'/',1)=e.user_id::text
         or (o.bucket_id='advertisements' and split_part(o.name,'/',1)='staff' and split_part(o.name,'/',2)=e.user_id::text))
       and not exists(select 1 from private.member_data_export_files f where f.export_id=e.id and f.bucket=o.bucket_id and f.object_path=o.name)) then
     raise exception 'Some stored files need reconciliation before a complete file copy is available. Your request remains open.' using errcode='PT409';
   end if;
   update private.member_data_exports set files_prepared_at=now() where id=e.id returning * into e;
 end if;
 return jsonb_build_object('copy',private.data_export_summary(e),'files',coalesce((select jsonb_agg(jsonb_build_object(
   'id',f.id,'filename',f.filename,'byteSize',f.byte_size,'sha256',f.sha256,'receivedAt',f.received_at) order by f.filename)
   from private.member_data_export_files f where f.export_id=e.id),'[]'::jsonb));
end;
$$;
revoke all on function public.member_list_data_export_files(uuid) from public,anon,authenticated,service_role;
grant execute on function public.member_list_data_export_files(uuid) to authenticated;

create or replace function public.member_read_data_export_file(p_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.member_data_exports:=private.readable_member_export(p_id); f private.member_data_export_files;
begin
 select * into f from private.member_data_export_files where id=p_file_id and export_id=e.id;
 if not found then raise exception 'File copy not found.' using errcode='PT404'; end if;
 if not exists(select 1 from public.uploaded_assets a where a.id=f.asset_id and a.owner_id=e.user_id
   and a.bucket=f.bucket and a.object_path=f.object_path and a.sha256=f.sha256 and a.byte_size=f.byte_size) then
   raise exception 'This uploaded file changed. Ask staff for a new copy review.' using errcode='PT409'; end if;
 perform private.enforce_member_rate_limit('data-export-file-read',480,600);
 return jsonb_build_object('id',f.id,'bucket',f.bucket,'objectPath',f.object_path,'filename',f.filename,'byteSize',f.byte_size,'sha256',f.sha256);
end;
$$;
revoke all on function public.member_read_data_export_file(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.member_read_data_export_file(uuid,uuid) to authenticated;

create or replace function public.member_receive_data_export_file(p_id uuid,p_file_id uuid,p_sha256 text,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.member_data_exports:=private.readable_member_export(p_id); f private.member_data_export_files; r private.account_data_requests;
begin
 select r0.* into r from private.account_data_requests r0 join private.data_export_approvals a on a.request_id=r0.id
   where a.id=e.approval_id for update of r0;
 e:=private.readable_member_export(p_id);
 perform public.member_read_data_export_file(p_id,p_file_id);
 select * into f from private.member_data_export_files where id=p_file_id and export_id=e.id for update;
 if p_confirmed is distinct from true or p_sha256 is distinct from f.sha256 then
   raise exception 'Save and check this file before confirming receipt.' using errcode='22023'; end if;
 update private.member_data_export_files set received_at=coalesce(received_at,now()) where id=f.id returning * into f;
 return jsonb_build_object('id',f.id,'receivedAt',f.received_at,'copy',private.data_export_summary(e));
end;
$$;
revoke all on function public.member_receive_data_export_file(uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.member_receive_data_export_file(uuid,uuid,text,boolean) to authenticated;
