-- READ-ONLY metadata receipt. Run before/after the separately controlled steps.
-- Does not establish old-deployment containment, storage drain, MFA or live tests.
-- Known body fingerprints are from the reviewed source and 2026-09-09 hosted
-- metadata readback, NOT account data. Any difference requires review; never
-- overwrite a newer body merely to make its fingerprint match this snapshot.
begin read only;

with expected(signature, body_md5, authenticated_expected) as (values
 ('public.member_connection_status()', '287e1b9d060012a398d20800c6fa6990', false),
 ('public.member_connection_status_v2()', '287e1b9d060012a398d20800c6fa6990', true),
 ('public.member_connection_operation(text,uuid)', 'f2810e6dbd1780386e28d0d1b80c8277', true),
 ('private.export_recent_member()', 'e501f0049b1b839aa42341c0aaecd012', false),
 ('public.member_read_data_export_file(uuid,uuid)', 'a36958614fd134581cdc2c2ecd4c6369', true)
)
select e.signature, p.oid is not null as present,
 pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer,
 p.proconfig as settings, md5(p.prosrc) as body_md5,
 md5(p.prosrc)=e.body_md5 as reviewed_body_matches,
 case when p.oid is not null then has_function_privilege('anon',p.oid,'execute') end as anon_execute,
 case when p.oid is not null then has_function_privilege('authenticated',p.oid,'execute') end as authenticated_execute,
 case when p.oid is not null then has_function_privilege('service_role',p.oid,'execute') end as service_execute,
 e.authenticated_expected as authenticated_expected_after_retirement
from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
order by e.signature;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id in ('profile-media','uploads-quarantine') order by id;

rollback;
