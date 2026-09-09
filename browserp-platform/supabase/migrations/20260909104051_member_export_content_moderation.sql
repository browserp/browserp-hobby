-- Extend the existing approved account copy with the subject's stored content
-- submissions. This does not change publication, retention or erasure policy.
begin;

create function private.content_export_item(s private.content_submissions)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
   'id',s.id,'kind',s.kind,'target_id',s.target_id,'content_text',s.content_text,
   'source_url',s.source_url,'asset_id',s.asset_id,'fingerprint',s.fingerprint,
   'status',s.status,'reason',s.reason,'version',s.version,
   'created_at',s.created_at,'updated_at',s.updated_at,
   'checked_at',s.checked_at,'check_applied_at',s.check_applied_at,
   'appeal_status',s.appeal_status,'appeal_statement',s.appeal_statement,'appealed_at',s.appealed_at,
   'check_result',case when s.check_result is null then null else jsonb_build_object(
     'decision',s.check_result->'decision','reason',s.check_result->'reason',
     'policyVersion',s.check_result->'policyVersion','checker',s.check_result->'checker',
     'details',case when s.check_result->'details' is null or s.check_result->'details'='null'::jsonb then null
       else jsonb_build_object('code',s.check_result->'details'->'code',
         'signalCodes',s.check_result->'details'->'signalCodes','categories',s.check_result->'details'->'categories',
         'safeThreshold',s.check_result->'details'->'safeThreshold','blockThreshold',s.check_result->'details'->'blockThreshold',
         'coveredCategories',s.check_result->'details'->'coveredCategories') end) end);
$$;
revoke all on function private.content_export_item(private.content_submissions) from public,anon,authenticated,service_role;

alter function private.member_export_records(uuid) rename to member_export_records_before_content_moderation;
revoke all on function private.member_export_records_before_content_moderation(uuid) from public,anon,authenticated,service_role;

create function private.member_export_records(p_subject uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; data jsonb; n bigint; bytes bigint; total_rows bigint;
begin
 if p_subject is distinct from private.require_active_member() then
   raise exception 'Only your own account can be copied.' using errcode='42501';
 end if;
 result:=private.member_export_records_before_content_moderation(p_subject);
 select coalesce(sum(value::bigint),0) into total_rows from jsonb_each_text(result->'counts');

 -- Include blocked, appealed and superseded records as well as published ones.
 -- Check a bounded projection before aggregation; never silently truncate.
 select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (
   select private.content_export_item(s) value from private.content_submissions s
   where s.owner_id=p_subject order by s.id limit 2001
 ) bounded;
 if n>2000 or total_rows+n>10000 or octet_length((result->'collections')::text)+bytes>2000000 then
   raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413';
 end if;
 select coalesce(jsonb_agg(value),'[]'::jsonb) into data from (
   select private.content_export_item(s) value from private.content_submissions s
   where s.owner_id=p_subject order by s.id limit 2001
 ) bounded;
 result:=jsonb_set(result,'{collections}',(result->'collections')||jsonb_build_object('contentModeration',data));
 result:=jsonb_set(result,'{counts}',(result->'counts')||jsonb_build_object('contentModeration',n));
 result:=jsonb_set(result,'{scopeNotes}',coalesce(result->'scopeNotes','[]'::jsonb)||jsonb_build_array(
   'Content moderation includes your stored submissions, check outcomes and appeals. Private reviewer identities and internal provider fields are excluded. Uploaded image information and file delivery use the existing separate copy process.'));
 if octet_length((result->'collections')::text)>2000000 or octet_length(result::text)>2097152 then
   raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413';
 end if;
 return result;
end;
$$;
revoke all on function private.member_export_records(uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
