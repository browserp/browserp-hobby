-- Trusted 512 KiB chunk digests are prepared only after the server verifies
-- the complete object against this approved manifest's whole-file SHA-256.
-- The server still checks current member authorization before and after I/O.
begin;

create or replace function private.valid_data_export_file_chunks(p_byte_size integer,p_chunk_sha256 text[])
returns boolean language sql immutable set search_path='' as $$
 select p_byte_size between 1 and 10485760
   and p_chunk_sha256 is not null
   and array_ndims(p_chunk_sha256)=1 and array_lower(p_chunk_sha256,1)=1
   and cardinality(p_chunk_sha256) between 1 and 20
   and cardinality(p_chunk_sha256)=(p_byte_size::bigint+524287)/524288
   and not exists(select 1 from unnest(p_chunk_sha256) h where h is null or h !~ '^[a-f0-9]{64}$');
$$;
revoke all on function private.valid_data_export_file_chunks(integer,text[]) from public,anon,authenticated,service_role;

alter table private.member_data_export_files add column chunk_sha256 text[]
  check(chunk_sha256 is null or private.valid_data_export_file_chunks(byte_size,chunk_sha256));
revoke all on private.member_data_export_files from public,anon,authenticated,service_role;

create or replace function private.keep_data_export_file_identity()
returns trigger language plpgsql set search_path='' as $$
begin
 if row(new.id,new.export_id,new.asset_id,new.bucket,new.object_path,new.filename,new.byte_size,new.sha256,new.created_at)
   is distinct from row(old.id,old.export_id,old.asset_id,old.bucket,old.object_path,old.filename,old.byte_size,old.sha256,old.created_at)
   or (old.chunk_sha256 is not null and new.chunk_sha256 is distinct from old.chunk_sha256) then
   raise exception 'An approved file identity or prepared chunk digests cannot be changed.' using errcode='PT409';
 end if;
 return new;
end;
$$;
revoke all on function private.keep_data_export_file_identity() from public,anon,authenticated,service_role;
create trigger immutable_data_export_file_identity before update on private.member_data_export_files
  for each row execute function private.keep_data_export_file_identity();

create or replace function public.service_prepare_data_export_file_chunks(
 p_id uuid,p_file_id uuid,p_asset_id uuid,p_bucket text,p_object_path text,
 p_byte_size integer,p_sha256 text,p_chunk_sha256 text[]
)
returns boolean language plpgsql security definer set search_path='' as $$
declare e private.member_data_exports; approval private.data_export_approvals;
 request private.account_data_requests; f private.member_data_export_files;
begin
 if private.valid_data_export_file_chunks(p_byte_size,p_chunk_sha256) is distinct from true then
   raise exception 'Check the file chunk digests and size.' using errcode='22023'; end if;
 select * into e from private.member_data_exports where id=p_id;
 if not found then raise exception 'Copy not found.' using errcode='PT404'; end if;
 select * into approval from private.data_export_approvals where id=e.approval_id;
 -- Match the request-first lock order used by receipts and staff review.
 select * into request from private.account_data_requests where id=approval.request_id for update;
 select * into e from private.member_data_exports where id=p_id for update;
 if not found then raise exception 'Copy not found.' using errcode='PT404'; end if;
 if e.expires_at<=clock_timestamp() or e.payload is null then
   raise exception 'This copy expired. Refresh and prepare a new copy.' using errcode='PT410'; end if;
 if e.approval_id is distinct from approval.id or e.user_id is distinct from approval.user_id
   or request.user_id is distinct from e.user_id or request.kind is distinct from 'copy'
   or request.status is distinct from 'ready' or request.version is distinct from approval.request_version then
   raise exception 'This request changed. Refresh before downloading another copy.' using errcode='PT409'; end if;
 select * into f from private.member_data_export_files where id=p_file_id and export_id=e.id for update;
 if not found then raise exception 'File copy not found.' using errcode='PT404'; end if;
 if e.files_prepared_at is null or row(f.asset_id,f.bucket,f.object_path,f.byte_size,f.sha256)
   is distinct from row(p_asset_id,p_bucket,p_object_path,p_byte_size,p_sha256) then
   raise exception 'This uploaded file changed. Ask staff for a new copy review.' using errcode='PT409'; end if;
 -- A current owned asset must retain the exact manifest identity until commit.
 perform 1 from public.uploaded_assets a where a.id=f.asset_id and a.owner_id=e.user_id
   and a.bucket=f.bucket and a.object_path=f.object_path and a.sha256=f.sha256 and a.byte_size=f.byte_size for share;
 if not found then
   raise exception 'This uploaded file changed. Ask staff for a new copy review.' using errcode='PT409'; end if;
 -- Row-lock waits must not extend the copy's lifetime, even for an exact retry.
 if e.expires_at<=clock_timestamp() then
   raise exception 'This copy expired. Refresh and prepare a new copy.' using errcode='PT410'; end if;
 if f.chunk_sha256 is not null then
   if f.chunk_sha256 is distinct from p_chunk_sha256 then
     raise exception 'This file already has different prepared chunk digests.' using errcode='PT409'; end if;
   return true;
 end if;
 update private.member_data_export_files set chunk_sha256=p_chunk_sha256 where id=f.id;
 return true;
end;
$$;
revoke all on function public.service_prepare_data_export_file_chunks(uuid,uuid,uuid,text,text,integer,text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.service_prepare_data_export_file_chunks(uuid,uuid,uuid,text,text,integer,text,text[]) to service_role;

create or replace function public.member_read_data_export_file(p_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_active_member(); e private.member_data_exports; f private.member_data_export_files;
 access jsonb; checked_at timestamptz;
begin
 -- The quota upsert can wait for a concurrent bucket lock. Its own guard and
 -- the minimal active-member guard above prevent unauthenticated quota writes;
 -- all file authorization is deliberately read AFTER that possible wait.
 perform private.enforce_member_rate_limit('data-export-file-read',480,600);
 e:=private.readable_member_export(p_id);
 select * into f from private.member_data_export_files where id=p_file_id and export_id=e.id;
 if not found then raise exception 'File copy not found.' using errcode='PT404'; end if;
 if not exists(select 1 from public.uploaded_assets a where a.id=f.asset_id and a.owner_id=e.user_id
   and a.bucket=f.bucket and a.object_path=f.object_path and a.sha256=f.sha256 and a.byte_size=f.byte_size) then
   raise exception 'This uploaded file changed. Ask staff for a new copy review.' using errcode='PT409'; end if;
 access:=public.member_connection_status();
 checked_at:=clock_timestamp();
 -- Existing session/export helpers use transaction-start now(). Add scoped
 -- wall-clock checks here without changing unrelated authorization helpers.
 if e.expires_at<=checked_at then
   raise exception 'This copy expired. Refresh and prepare a new copy.' using errcode='PT410'; end if;
 if access->>'userId' is distinct from actor::text or access->>'active' is distinct from 'true'
   or not coalesce((access->>'authenticatedAt')::numeric between extract(epoch from checked_at)-600 and extract(epoch from checked_at)+30,false)
   or not exists(select 1 from auth.sessions s where s.user_id=actor and s.id::text=access->>'sessionId'
     and (s.not_after is null or s.not_after>checked_at)) then
   raise exception 'Sign in again to download your account data. Your download session expired or changed.' using errcode='PT401'; end if;
 -- A scheduled account restriction can also begin while the quota waits.
 if exists(select 1 from public.security_bans b where b.user_id=actor and b.target_type='account' and b.revoked_at is null
   and b.starts_at<=checked_at and (b.ends_at is null or b.ends_at>checked_at)) then
   raise exception 'An active, unrestricted sign-in is required.' using errcode='42501'; end if;
 return jsonb_build_object('id',f.id,'assetId',f.asset_id,'bucket',f.bucket,'objectPath',f.object_path,
   'filename',f.filename,'byteSize',f.byte_size,'sha256',f.sha256,'chunkSha256',f.chunk_sha256);
end;
$$;
revoke all on function public.member_read_data_export_file(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.member_read_data_export_file(uuid,uuid) to authenticated;

commit;
