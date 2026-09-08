-- Preserve the existing advertising-aware collector and its explicit privacy
-- projections. Add only the subject's duty data, comment links and current
-- recommendation consent; no browsing history or another person's work record.
begin;

alter function private.member_export_records(uuid) rename to member_export_records_before_duty_comments;
revoke all on function private.member_export_records_before_duty_comments(uuid) from public,anon,authenticated,service_role;

create or replace function private.member_export_records(p_subject uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; data jsonb; n bigint; bytes bigint; total_rows bigint;
begin
 if p_subject is distinct from private.require_active_member() then
   raise exception 'Only your own account can be copied.' using errcode='42501';
 end if;
 result:=private.member_export_records_before_duty_comments(p_subject);
 select coalesce(sum(value::bigint),0) into total_rows from jsonb_each_text(result->'counts');

 -- Enrich the already bounded explicit comment projection instead of replacing
 -- historical fields. A parent ID is the subject's own reply relationship; no
 -- parent body, author, moderation information or other person's row is joined.
 select coalesce(jsonb_agg(item.value||jsonb_build_object(
   'parent_comment_id',c.parent_comment_id,'edited_at',c.edited_at) order by item.position),'[]'::jsonb)
 into data
 from jsonb_array_elements(result->'collections'->'comments') with ordinality item(value,position)
 left join public.server_comments c on c.id=(item.value->>'id')::uuid and c.author_id=p_subject;
 result:=jsonb_set(result,'{collections,comments}',data);
 if total_rows>10000 or octet_length((result->'collections')::text)>2000000 then
   raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413';
 end if;

 -- State is stored only after an explicit duty choice; an absent row stays an
 -- empty collection rather than inventing an off-duty event or timestamp.
 select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (
   select jsonb_build_object('availability',s.availability,'updated_at',s.updated_at) value
   from private.staff_duty_state s where s.user_id=p_subject order by s.user_id limit 2001
 ) bounded;
 if n>2000 or total_rows+n>10000 or octet_length((result->'collections')::text)+bytes>2000000 then
   raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413';
 end if;
 select coalesce(jsonb_agg(value),'[]'::jsonb) into data from (
   select jsonb_build_object('availability',s.availability,'updated_at',s.updated_at) value
   from private.staff_duty_state s where s.user_id=p_subject order by s.user_id limit 2001
 ) bounded;
 result:=jsonb_set(result,'{collections}',(result->'collections')||jsonb_build_object('staffDutyState',data));
 result:=jsonb_set(result,'{counts}',(result->'counts')||jsonb_build_object('staffDutyState',n));
 total_rows:=total_rows+n;

 -- Work intervals remain the subject's data after a staff role changes. Do not
 -- use the team view, derived confirmed hours, request payloads or audit prose:
 -- those can contain another person's work or private correction reasons.
 select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (
   select jsonb_build_object('id',s.id,'started_at',s.started_at,'ended_at',s.ended_at,
     'status',s.status,'version',s.version,'updated_at',s.updated_at) value
   from private.staff_work_sessions s where s.user_id=p_subject order by s.id limit 2001
 ) bounded;
 if n>2000 or total_rows+n>10000 or octet_length((result->'collections')::text)+bytes>2000000 then
   raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413';
 end if;
 select coalesce(jsonb_agg(value),'[]'::jsonb) into data from (
   select jsonb_build_object('id',s.id,'started_at',s.started_at,'ended_at',s.ended_at,
     'status',s.status,'version',s.version,'updated_at',s.updated_at) value
   from private.staff_work_sessions s where s.user_id=p_subject order by s.id limit 2001
 ) bounded;
 result:=jsonb_set(result,'{collections}',(result->'collections')||jsonb_build_object('staffWorkSessions',data));
 result:=jsonb_set(result,'{counts}',(result->'counts')||jsonb_build_object('staffWorkSessions',n));
 total_rows:=total_rows+n;

 -- Match the consent RPC's explicit unset state without inventing a persisted
 -- choice or timestamp. Export only the subject's current preference, never
 -- local browsing history, prior choices or a second account's setting.
 select jsonb_build_object('schemaVersion',coalesce(p.schema_version,1),'choice',p.choice,
   'version',coalesce(p.version,0),'updatedAt',p.updated_at) into data
 from (select 1) subject left join private.member_recommendation_preferences p on p.user_id=p_subject;
 if total_rows+1>10000 or octet_length((result->'collections')::text)+octet_length(data::text)>2000000 then
   raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413';
 end if;
 result:=jsonb_set(result,'{collections}',(result->'collections')||jsonb_build_object('recommendationPreferences',jsonb_build_array(data)));
 result:=jsonb_set(result,'{counts}',(result->'counts')||jsonb_build_object('recommendationPreferences',1));
 result:=jsonb_set(result,'{scopeNotes}',coalesce(result->'scopeNotes','[]'::jsonb)||jsonb_build_array(
   'Staff duty records include only your stored availability and work intervals. Private correction reasons and other people''s work records are excluded.'));

 -- Include JSON keys, separators and the new comment fields in the final
 -- collection budget, then retain the existing complete payload byte cap.
 if octet_length((result->'collections')::text)>2000000 or octet_length(result::text)>2097152 then
   raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413';
 end if;
 return result;
end;
$$;
revoke all on function private.member_export_records(uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
