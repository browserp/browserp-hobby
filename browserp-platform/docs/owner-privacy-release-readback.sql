-- Metadata only: no user rows, request text, identities, tokens or listing data.
-- Run after owner/options/privacy and raw-read hardening migrations; review every expected flag.
with expected(signature,expected_member,expected_service) as (values
 ('public.member_owned_listing_update(uuid)',true,false),
 ('public.member_server_submission(uuid)',true,false),
 ('public.staff_server_submission_review(uuid)',true,false),
 ('public.staff_review_server_application(uuid,bigint,bigint,text,text,text,boolean,text)',true,false),
 ('public.create_server_application_server(uuid,uuid,uuid,jsonb,text,integer,jsonb,text,text,text,text)',false,true),
 ('public.propose_owned_listing_update_server(uuid,uuid,uuid,uuid,bigint,jsonb,text,integer,jsonb,text,text,text,text)',false,true),
 ('public.correct_owned_listing_update_server(uuid,uuid,uuid,bigint,bigint,bigint,text,jsonb,text,integer,jsonb,text,text)',false,true),
 ('public.resubmit_server_submission_server(uuid,uuid,uuid,bigint,bigint,text,jsonb,text,integer,jsonb,text,text)',false,true),
 ('private.create_reviewed_listing_application(uuid,uuid,uuid,jsonb,text,integer,jsonb,text,text,text,text,uuid)',false,false),
 ('private.validate_owned_listing_features(uuid,uuid,jsonb,text,integer,jsonb)',false,false),
 ('private.resubmit_before_owner_updates(uuid,uuid,uuid,bigint,bigint,text,jsonb,text,integer,jsonb,text,text)',false,false),
 ('private.check_owner_listing_update(uuid,uuid,bigint,jsonb)',false,false),
 ('public.member_data_requests(text,text,text,uuid,uuid,bigint)',true,false),
 ('public.member_data_request_history(uuid,bigint)',true,false),
 ('public.staff_data_requests(text,text,timestamptz,uuid,integer)',true,false),
 ('public.staff_data_request_history(uuid,bigint)',true,false),
 ('public.staff_review_data_request(uuid,text,text,bigint,uuid)',true,false),
 ('public.staff_fulfill_data_request(uuid,text,text,text,timestamptz,bigint,uuid,boolean)',true,false),
 ('private.can_fulfill_data_requests()',false,false),
 ('private.data_request_history_page(uuid,bigint,boolean)',false,false),
 ('private.record_data_request_history()',false,false),
 ('private.keep_data_request_record()',false,false)
), actual as (
 select *,to_regprocedure(signature) oid from expected
)
select signature,oid is not null as function_exists,
 case when oid is not null then has_function_privilege('anon',oid,'EXECUTE') end as anon_execute,
 case when oid is not null then has_function_privilege('authenticated',oid,'EXECUTE') end as member_execute,
 case when oid is not null then has_function_privilege('service_role',oid,'EXECUTE') end as service_execute,
 case when oid is not null then not has_function_privilege('anon',oid,'EXECUTE')
  and has_function_privilege('authenticated',oid,'EXECUTE')=expected_member
  and has_function_privilege('service_role',oid,'EXECUTE')=expected_service else false end as expected_grants
from actual order by signature;

select n.nspname||'.'||c.relname relation,c.relrowsecurity,
 has_table_privilege('anon',c.oid,'SELECT') anon_select,
 has_table_privilege('authenticated',c.oid,'SELECT') member_select,
 has_any_column_privilege('anon',c.oid,'SELECT') anon_any_column_select,
 has_any_column_privilege('authenticated',c.oid,'SELECT') member_any_column_select,
 has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') member_any_write,
 has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') service_any_access
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where (n.nspname='private' and c.relname in ('account_data_requests','account_data_request_history','account_data_request_fulfillments','submission_creation_requests'))
 or (n.nspname='public' and c.relname='server_submissions')
order by relation;
-- All private table access above should be false and RLS true.
-- server_submissions: anon/member table + column reads false; service access true.
-- Its existing RLS owner policy can remain as a second barrier, but no raw member grant.
select policyname,permissive,roles,cmd,qual,with_check from pg_policies
 where schemaname='public' and tablename='server_submissions' order by policyname;

select t.tgname,c.relname,t.tgenabled,pg_get_triggerdef(t.oid) definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and n.nspname='private' and c.relname in ('account_data_requests','account_data_request_history','account_data_request_fulfillments')
order by c.relname,t.tgname;

select indexname,indexdef from pg_indexes where
 (schemaname='public' and indexname='one_open_owner_update_per_listing') or
 (schemaname='private' and indexname='account_data_requests_open_kind');

select permission_key,array_agg(role_key order by role_key) roles
from public.staff_role_permissions where permission_key in ('privacy.requests.manage','privacy.requests.fulfill') group by permission_key;
-- Initial expected role for both is owner. Any deliberate custom grants need
-- review/fulfill to be held together; the fulfillment RPC independently enforces both.

select
 position('not_after' in pg_get_functiondef('private.has_current_auth_session()'::regprocedure))>0 session_expiry_checked,
 position('require_active_member' in pg_get_functiondef('public.member_owned_listing_update(uuid)'::regprocedure))>0 owner_read_checks_member,
 position('can_review_data_requests' in pg_get_functiondef('private.can_fulfill_data_requests()'::regprocedure))>0 completion_requires_review,
 position('privacy.requests.fulfill' in pg_get_functiondef('private.can_fulfill_data_requests()'::regprocedure))>0 completion_has_separate_permission,
 position('totp' in pg_get_functiondef('private.can_review_data_requests()'::regprocedure))>0 privacy_requires_totp;

select staff_mfa_required from private.platform_security_settings where singleton=true;
-- Must remain true for the staff-owner listing review permission path.
