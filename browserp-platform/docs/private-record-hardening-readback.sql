-- Metadata only: no user content or private records.
with targets(name) as (values
 ('profiles'),('reports'),('bans'),('ban_appeals'),('uploaded_assets'),
 ('server_endpoints'),('account_trust'),('favorites'),('notifications'),
 ('staff_memberships'),('promotion_orders'),('promotion_credit_ledger'),
 ('boosts'),('ad_campaigns'),('applications'),('server_submissions')
)
select t.name,c.relrowsecurity,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') anon_any_table,
 has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') anon_any_column,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') member_any_table,
 has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') member_any_column,
 has_table_privilege('service_role',c.oid,'SELECT') service_read
from targets t join pg_class c on c.oid=to_regclass('public.'||t.name)
order by t.name;
-- Expect exactly16 rows: RLS true, all four client flags false, service_read true.

select c.relname,pg_get_userbyid(c.relowner) owner,c.reloptions,
 has_table_privilege('anon',c.oid,'SELECT') anon_read,
 has_table_privilege('authenticated',c.oid,'SELECT') member_read,
 has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') anon_write,
 has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') member_write,
 pg_get_viewdef(c.oid,true) definition
from pg_class c where c.oid in('public.developer_directory'::regclass,'public.resource_directory'::regclass);
-- Both: expected existing trusted owner, invoker=false and barrier=true,
-- public reads true, writes false. Inspect explicit published/public-profile
-- predicates, approved developer avatar and enabled-platform join in definition.

select signature,has_function_privilege('authenticated',signature,'EXECUTE') member_execute
from unnest(array[
 'public.member_dashboard_overview()',
 'public.member_update_profile(text,text,text)',
 'public.member_set_profile_avatar(text,uuid)',
 'public.member_favorite_ids()',
 'public.mark_notifications_read()',
 'public.member_server_claims(uuid)',
 'public.staff_profile_review_queue()'
]) signature;
-- All true: functions still enforce their existing current-session/permission rules.
