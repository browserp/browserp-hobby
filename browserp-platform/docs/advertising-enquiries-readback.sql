-- Metadata only: no member enquiry, reply, URL or audit rows are read.
select n.nspname as schema_name,c.relname,c.relrowsecurity,
       not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_denied,
       not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as member_raw_denied,
       not has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') as service_raw_denied
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='private' and c.relname in ('advertising_enquiries','advertising_enquiry_keys') order by c.relname;

select p.oid::regprocedure::text as function_name,p.prosecdef,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as member_execute,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname in ('member_advertising_enquiries','staff_advertising_enquiry_access','staff_advertising_enquiries','staff_review_advertising_enquiry'))
   or (n.nspname='private' and p.proname in ('advertising_enquiry_json','can_review_advertising_enquiries','advertising_enquiry_page','member_export_records','member_export_records_before_advertising'))
order by n.nspname,p.proname;
-- Expected: public four => member true, anon/service false. Private five => all false.
-- JSON projection helper is not SECURITY DEFINER; other guarded private helpers are.

select indexname from pg_indexes where schemaname='private' and tablename in ('advertising_enquiries','advertising_enquiry_keys') order by indexname;
-- Expected four indexes: two table PKs plus advertising_enquiries_member/queue.
select
 position('advertisingEnquiries' in pg_get_functiondef('private.member_export_records(uuid)'::regprocedure))>0 as export_includes_enquiries,
 position('10000' in pg_get_functiondef('private.member_export_records(uuid)'::regprocedure))>0 as combined_row_cap,
 position('2097152' in pg_get_functiondef('private.member_export_records(uuid)'::regprocedure))>0 as final_byte_cap,
 position('adverts.manage' in pg_get_functiondef('private.can_review_advertising_enquiries()'::regprocedure))>0 as existing_advert_permission,
 position('totp' in pg_get_functiondef('private.can_review_advertising_enquiries()'::regprocedure))>0 as totp_required;
