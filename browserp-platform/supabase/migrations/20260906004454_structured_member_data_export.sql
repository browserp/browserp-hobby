-- Actual, scoped structured-data copies. No file-byte export or account erasure.
-- Private payloads expire; only exact allowlisted member fields leave the DB.
create table private.data_export_approvals (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references private.account_data_requests(id),
 user_id uuid not null, request_version bigint not null, approved_by uuid not null, request_key uuid not null,
 fingerprint bytea not null check(octet_length(fingerprint)=32), scope_complete boolean not null, supplement_note text not null,
 created_at timestamptz not null default now(), unique(approved_by,request_key), unique(request_id,request_version)
);
create table private.member_data_exports (
 id uuid primary key default gen_random_uuid(), approval_id uuid not null references private.data_export_approvals(id),
 user_id uuid not null, generation_key uuid not null, payload text, sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
 byte_size integer not null check(byte_size between 1 and 2097152), pending jsonb not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '1 hour',
 received_at timestamptz, unique(user_id,generation_key)
);
create index member_data_exports_approval on private.member_data_exports(approval_id,created_at desc);
create index member_data_exports_expiry on private.member_data_exports(expires_at) where payload is not null;
alter table private.data_export_approvals enable row level security;
alter table private.member_data_exports enable row level security;
revoke all on private.data_export_approvals,private.member_data_exports from public,anon,authenticated,service_role;
create trigger immutable_data_export_approval before update or delete on private.data_export_approvals
 for each row execute function private.keep_data_request_record();
create or replace function private.export_recent_member()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_active_member(); access jsonb:=public.member_connection_status();
begin
 if access->>'userId' is distinct from actor::text or access->>'active' is distinct from 'true' or access->>'recent' is distinct from 'true' then
  raise exception 'Sign in again to download your account data. A refreshed session alone is not enough.' using errcode='PT401'; end if;
 return actor;
end;
$$;
revoke all on function private.export_recent_member() from public,anon,authenticated,service_role;

create or replace function private.member_export_records(p_subject uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare collections jsonb:='{}'; counts jsonb:='{}'; pending jsonb:='[]'; n bigint; bytes bigint; total_rows bigint:=0; total_bytes bigint:=0; data jsonb;
begin
  if p_subject is distinct from (select auth.uid()) then raise exception 'Only your own account can be copied.' using errcode='42501'; end if;
  -- account: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'email',x.email,'phone',x.phone,'email_confirmed_at',x.email_confirmed_at,'phone_confirmed_at',x.phone_confirmed_at,'created_at',x.created_at,'updated_at',x.updated_at,'last_sign_in_at',x.last_sign_in_at) value from auth.users x where x.id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'email',x.email,'phone',x.phone,'email_confirmed_at',x.email_confirmed_at,'phone_confirmed_at',x.phone_confirmed_at,'created_at',x.created_at,'updated_at',x.updated_at,'last_sign_in_at',x.last_sign_in_at) value from auth.users x where x.id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('account',data); counts:=counts||jsonb_build_object('account',n);
  -- connections: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('provider',x.provider,'provider_id',x.provider_id,'created_at',x.created_at,'updated_at',x.updated_at,'last_sign_in_at',x.last_sign_in_at,'identity',jsonb_strip_nulls(jsonb_build_object('email',x.identity_data->'email','email_verified',x.identity_data->'email_verified','name',x.identity_data->'name','full_name',x.identity_data->'full_name','preferred_username',x.identity_data->'preferred_username','avatar_url',x.identity_data->'avatar_url'))) value from auth.identities x where x.user_id=p_subject order by x.provider,x.provider_id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('provider',x.provider,'provider_id',x.provider_id,'created_at',x.created_at,'updated_at',x.updated_at,'last_sign_in_at',x.last_sign_in_at,'identity',jsonb_strip_nulls(jsonb_build_object('email',x.identity_data->'email','email_verified',x.identity_data->'email_verified','name',x.identity_data->'name','full_name',x.identity_data->'full_name','preferred_username',x.identity_data->'preferred_username','avatar_url',x.identity_data->'avatar_url'))) value from auth.identities x where x.user_id=p_subject order by x.provider,x.provider_id limit 2001) bounded;
  collections:=collections||jsonb_build_object('connections',data); counts:=counts||jsonb_build_object('connections',n);
  -- profile: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'username',x.username,'display_name',x.display_name,'avatar_url',x.avatar_url,'bio',x.bio,'profile_visibility',x.profile_visibility,'imported_identity_reviewed',x.imported_identity_reviewed,'joined_at',x.joined_at,'updated_at',x.updated_at,'avatar_review_status',x.avatar_review_status,'bio_review_status',x.bio_review_status,'approved_avatar_url',x.approved_avatar_url,'approved_bio',x.approved_bio) value from public.profiles x where x.id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'username',x.username,'display_name',x.display_name,'avatar_url',x.avatar_url,'bio',x.bio,'profile_visibility',x.profile_visibility,'imported_identity_reviewed',x.imported_identity_reviewed,'joined_at',x.joined_at,'updated_at',x.updated_at,'avatar_review_status',x.avatar_review_status,'bio_review_status',x.bio_review_status,'approved_avatar_url',x.approved_avatar_url,'approved_bio',x.approved_bio) value from public.profiles x where x.id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('profile',data); counts:=counts||jsonb_build_object('profile',n);
  -- favorites: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('server_id',x.server_id,'created_at',x.created_at) value from public.favorites x where x.user_id=p_subject order by x.server_id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('server_id',x.server_id,'created_at',x.created_at) value from public.favorites x where x.user_id=p_subject order by x.server_id limit 2001) bounded;
  collections:=collections||jsonb_build_object('favorites',data); counts:=counts||jsonb_build_object('favorites',n);
  -- votes: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('server_id',x.server_id,'created_at',x.created_at) value from public.server_votes x where x.user_id=p_subject order by x.server_id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('server_id',x.server_id,'created_at',x.created_at) value from public.server_votes x where x.user_id=p_subject order by x.server_id limit 2001) bounded;
  collections:=collections||jsonb_build_object('votes',data); counts:=counts||jsonb_build_object('votes',n);
  -- comments: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'server_id',x.server_id,'body',x.body,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.server_comments x where x.author_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'server_id',x.server_id,'body',x.body,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.server_comments x where x.author_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('comments',data); counts:=counts||jsonb_build_object('comments',n);
  -- reviews: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'server_id',x.server_id,'rating',x.rating,'title',x.title,'body',x.body,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.reviews x where x.author_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'server_id',x.server_id,'rating',x.rating,'title',x.title,'body',x.body,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.reviews x where x.author_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('reviews',data); counts:=counts||jsonb_build_object('reviews',n);
  -- reactions: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('review_id',x.review_id,'reaction',x.reaction,'created_at',x.created_at) value from public.review_reactions x where x.user_id=p_subject order by x.review_id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('review_id',x.review_id,'reaction',x.reaction,'created_at',x.created_at) value from public.review_reactions x where x.user_id=p_subject order by x.review_id limit 2001) bounded;
  collections:=collections||jsonb_build_object('reactions',data); counts:=counts||jsonb_build_object('reactions',n);
  -- notifications: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'kind',x.kind,'title',x.title,'body',x.body,'action_url',x.action_url,'read_at',x.read_at,'created_at',x.created_at) value from public.notifications x where x.user_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'kind',x.kind,'title',x.title,'body',x.body,'action_url',x.action_url,'read_at',x.read_at,'created_at',x.created_at) value from public.notifications x where x.user_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('notifications',data); counts:=counts||jsonb_build_object('notifications',n);
  -- activity: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'event_type',x.event_type,'provider',x.provider,'masked_network',x.masked_network,'browser_family',x.browser_family,'os_family',x.os_family,'device_family',x.device_family,'created_at',x.created_at) value from public.account_activity x where x.user_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'event_type',x.event_type,'provider',x.provider,'masked_network',x.masked_network,'browser_family',x.browser_family,'os_family',x.os_family,'device_family',x.device_family,'created_at',x.created_at) value from public.account_activity x where x.user_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('activity',data); counts:=counts||jsonb_build_object('activity',n);
  -- resourceDownloads: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'resource_id',x.resource_id,'downloaded_at',x.downloaded_at) value from public.resource_downloads x where x.user_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'resource_id',x.resource_id,'downloaded_at',x.downloaded_at) value from public.resource_downloads x where x.user_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('resourceDownloads',data); counts:=counts||jsonb_build_object('resourceDownloads',n);
  -- toolUsage: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'tool_key',x.tool_key,'event_type',x.event_type,'occurred_on',x.occurred_on,'created_at',x.created_at) value from public.tool_events x where x.user_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'tool_key',x.tool_key,'event_type',x.event_type,'occurred_on',x.occurred_on,'created_at',x.created_at) value from public.tool_events x where x.user_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('toolUsage',data); counts:=counts||jsonb_build_object('toolUsage',n);
  -- orders: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'product_key',x.product_key,'quantity',x.quantity,'amount_total',x.amount_total,'currency',x.currency,'status',x.status,'created_at',x.created_at) value from public.promotion_orders x where x.user_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'product_key',x.product_key,'quantity',x.quantity,'amount_total',x.amount_total,'currency',x.currency,'status',x.status,'created_at',x.created_at) value from public.promotion_orders x where x.user_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('orders',data); counts:=counts||jsonb_build_object('orders',n);
  -- paymentAttempts: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'product_key',x.product_key,'quantity',x.quantity,'expected_amount',x.expected_amount,'currency',x.currency,'status',x.status,'terms_version',x.terms_version,'created_at',x.created_at,'updated_at',x.updated_at) value from public.payment_attempts x where x.user_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'product_key',x.product_key,'quantity',x.quantity,'expected_amount',x.expected_amount,'currency',x.currency,'status',x.status,'terms_version',x.terms_version,'created_at',x.created_at,'updated_at',x.updated_at) value from public.payment_attempts x where x.user_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('paymentAttempts',data); counts:=counts||jsonb_build_object('paymentAttempts',n);
  -- creditEntries: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'delta',x.delta,'source_type',x.source_type,'created_at',x.created_at) value from public.promotion_credit_ledger x where x.user_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'delta',x.delta,'source_type',x.source_type,'created_at',x.created_at) value from public.promotion_credit_ledger x where x.user_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('creditEntries',data); counts:=counts||jsonb_build_object('creditEntries',n);
  -- boosts: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'server_id',x.server_id,'source',x.source,'amount',x.amount,'boost_date',x.boost_date,'created_at',x.created_at) value from public.boosts x where x.actor_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'server_id',x.server_id,'source',x.source,'amount',x.amount,'boost_date',x.boost_date,'created_at',x.created_at) value from public.boosts x where x.actor_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('boosts',data); counts:=counts||jsonb_build_object('boosts',n);
  -- entitlements: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'server_id',x.server_id,'entitlement_type',x.entitlement_type,'starts_at',x.starts_at,'ends_at',x.ends_at,'revoked_at',x.revoked_at,'created_at',x.created_at) value from public.server_entitlements x where x.user_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'server_id',x.server_id,'entitlement_type',x.entitlement_type,'starts_at',x.starts_at,'ends_at',x.ends_at,'revoked_at',x.revoked_at,'created_at',x.created_at) value from public.server_entitlements x where x.user_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('entitlements',data); counts:=counts||jsonb_build_object('entitlements',n);
  -- developerProfile: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('headline',x.headline,'about',x.about,'specialties',x.specialties,'portfolio_url',x.portfolio_url,'verified',x.verified,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.developer_profiles x where x.user_id=p_subject order by x.user_id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('headline',x.headline,'about',x.about,'specialties',x.specialties,'portfolio_url',x.portfolio_url,'verified',x.verified,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.developer_profiles x where x.user_id=p_subject order by x.user_id limit 2001) bounded;
  collections:=collections||jsonb_build_object('developerProfile',data); counts:=counts||jsonb_build_object('developerProfile',n);
  -- developerServices: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'title',x.title,'summary',x.summary,'service_type',x.service_type,'pricing_note',x.pricing_note,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.developer_services x where x.developer_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'title',x.title,'summary',x.summary,'service_type',x.service_type,'pricing_note',x.pricing_note,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.developer_services x where x.developer_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('developerServices',data); counts:=counts||jsonb_build_object('developerServices',n);
  -- resources: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'platform_id',x.platform_id,'title',x.title,'slug',x.slug,'summary',x.summary,'body_markdown',x.body_markdown,'resource_type',x.resource_type,'download_asset_id',x.download_asset_id,'status',x.status,'published_at',x.published_at,'created_at',x.created_at,'updated_at',x.updated_at) value from public.resources x where x.author_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'platform_id',x.platform_id,'title',x.title,'slug',x.slug,'summary',x.summary,'body_markdown',x.body_markdown,'resource_type',x.resource_type,'download_asset_id',x.download_asset_id,'status',x.status,'published_at',x.published_at,'created_at',x.created_at,'updated_at',x.updated_at) value from public.resources x where x.author_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('resources',data); counts:=counts||jsonb_build_object('resources',n);
  -- campaigns: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'server_id',x.server_id,'name',x.name,'placement',x.placement,'headline',x.headline,'body',x.body,'cta_label',x.cta_label,'image_asset_id',x.image_asset_id,'destination_url',x.destination_url,'credit_budget',x.credit_budget,'credits_spent',x.credits_spent,'status',x.status,'starts_at',x.starts_at,'ends_at',x.ends_at,'impressions',x.impressions,'clicks',x.clicks,'created_at',x.created_at,'updated_at',x.updated_at) value from public.ad_campaigns x where x.owner_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'server_id',x.server_id,'name',x.name,'placement',x.placement,'headline',x.headline,'body',x.body,'cta_label',x.cta_label,'image_asset_id',x.image_asset_id,'destination_url',x.destination_url,'credit_budget',x.credit_budget,'credits_spent',x.credits_spent,'status',x.status,'starts_at',x.starts_at,'ends_at',x.ends_at,'impressions',x.impressions,'clicks',x.clicks,'created_at',x.created_at,'updated_at',x.updated_at) value from public.ad_campaigns x where x.owner_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('campaigns',data); counts:=counts||jsonb_build_object('campaigns',n);
  -- reportsSent: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'target_type',x.target_type,'target_id',x.target_id,'category',x.category,'details',x.details,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.reports x where x.reporter_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'target_type',x.target_type,'target_id',x.target_id,'category',x.category,'details',x.details,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.reports x where x.reporter_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('reportsSent',data); counts:=counts||jsonb_build_object('reportsSent',n);
  -- applications: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'application_type',x.application_type,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.applications x where x.applicant_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'application_type',x.application_type,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.applications x where x.applicant_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('applications',data); counts:=counts||jsonb_build_object('applications',n);
  -- uploads: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'media_type',x.media_type,'mime_type',x.mime_type,'byte_size',x.byte_size,'sha256',x.sha256,'moderation_status',x.moderation_status,'created_at',x.created_at,'reviewed_at',x.reviewed_at) value from public.uploaded_assets x where x.owner_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'media_type',x.media_type,'mime_type',x.mime_type,'byte_size',x.byte_size,'sha256',x.sha256,'moderation_status',x.moderation_status,'created_at',x.created_at,'reviewed_at',x.reviewed_at) value from public.uploaded_assets x where x.owner_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('uploads',data); counts:=counts||jsonb_build_object('uploads',n);
  -- appeals: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'ban_id',x.ban_id,'statement',x.statement,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.ban_appeals x where x.appellant_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'ban_id',x.ban_id,'statement',x.statement,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.ban_appeals x where x.appellant_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('appeals',data); counts:=counts||jsonb_build_object('appeals',n);
  -- securityAppeals: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'ban_id',x.ban_id,'statement',x.statement,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.security_ban_appeals x where x.appellant_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'ban_id',x.ban_id,'statement',x.statement,'status',x.status,'created_at',x.created_at,'updated_at',x.updated_at) value from public.security_ban_appeals x where x.appellant_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('securityAppeals',data); counts:=counts||jsonb_build_object('securityAppeals',n);
  -- ownedListings: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'platform_id',x.platform_id,'name',x.name,'slug',x.slug,'description',x.description,'region',x.region,'language',x.language,'framework',x.framework,'community_url',x.community_url,'website_url',x.website_url,'age_rating',x.age_rating,'status',x.status,'verified',x.verified,'beginner_friendly',x.beginner_friendly,'access_type',x.access_type,'cfx_join_url',x.cfx_join_url,'logo_asset_id',x.logo_asset_id,'banner_asset_id',x.banner_asset_id,'animated_media_enabled',x.animated_media_enabled,'theme_start',x.theme_start,'theme_end',x.theme_end,'published_at',x.published_at,'created_at',x.created_at,'updated_at',x.updated_at,'roblox',jsonb_strip_nulls(jsonb_build_object('kind',x.roblox_details->'kind','experienceUrl',x.roblox_details->'experienceUrl','communityGroupUrl',x.roblox_details->'communityGroupUrl','joiningInstructions',x.roblox_details->'joiningInstructions'))) value from public.servers x where x.owner_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'platform_id',x.platform_id,'name',x.name,'slug',x.slug,'description',x.description,'region',x.region,'language',x.language,'framework',x.framework,'community_url',x.community_url,'website_url',x.website_url,'age_rating',x.age_rating,'status',x.status,'verified',x.verified,'beginner_friendly',x.beginner_friendly,'access_type',x.access_type,'cfx_join_url',x.cfx_join_url,'logo_asset_id',x.logo_asset_id,'banner_asset_id',x.banner_asset_id,'animated_media_enabled',x.animated_media_enabled,'theme_start',x.theme_start,'theme_end',x.theme_end,'published_at',x.published_at,'created_at',x.created_at,'updated_at',x.updated_at,'roblox',jsonb_strip_nulls(jsonb_build_object('kind',x.roblox_details->'kind','experienceUrl',x.roblox_details->'experienceUrl','communityGroupUrl',x.roblox_details->'communityGroupUrl','joiningInstructions',x.roblox_details->'joiningInstructions'))) value from public.servers x where x.owner_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('ownedListings',data); counts:=counts||jsonb_build_object('ownedListings',n);
  -- submissions: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'platform_id',x.platform_id,'name',x.name,'region',x.region,'language',x.language,'framework',x.framework,'description',x.description,'community_url',x.community_url,'tags',x.tags,'access_type',x.access_type,'cfx_join_url',x.cfx_join_url,'logo_asset_id',x.logo_asset_id,'banner_asset_id',x.banner_asset_id,'status',x.status,'review_note',x.review_note,'reviewed_at',x.reviewed_at,'review_version',x.review_version,'terms_version',x.terms_version,'standards_version',x.standards_version,'owner_update_server_id',x.owner_update_server_id,'owner_update_version',x.owner_update_version,'created_at',x.created_at,'updated_at',x.updated_at,'roblox',jsonb_strip_nulls(jsonb_build_object('kind',x.roblox_details->'kind','experienceUrl',x.roblox_details->'experienceUrl','communityGroupUrl',x.roblox_details->'communityGroupUrl','joiningInstructions',x.roblox_details->'joiningInstructions'))) value from public.server_submissions x where x.submitted_by=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'platform_id',x.platform_id,'name',x.name,'region',x.region,'language',x.language,'framework',x.framework,'description',x.description,'community_url',x.community_url,'tags',x.tags,'access_type',x.access_type,'cfx_join_url',x.cfx_join_url,'logo_asset_id',x.logo_asset_id,'banner_asset_id',x.banner_asset_id,'status',x.status,'review_note',x.review_note,'reviewed_at',x.reviewed_at,'review_version',x.review_version,'terms_version',x.terms_version,'standards_version',x.standards_version,'owner_update_server_id',x.owner_update_server_id,'owner_update_version',x.owner_update_version,'created_at',x.created_at,'updated_at',x.updated_at,'roblox',jsonb_strip_nulls(jsonb_build_object('kind',x.roblox_details->'kind','experienceUrl',x.roblox_details->'experienceUrl','communityGroupUrl',x.roblox_details->'communityGroupUrl','joiningInstructions',x.roblox_details->'joiningInstructions'))) value from public.server_submissions x where x.submitted_by=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('submissions',data); counts:=counts||jsonb_build_object('submissions',n);
  -- robloxEvidence: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('submission_id',x.submission_id,'applicant_role',x.applicant_role,'authority_evidence',x.authority_evidence) value from private.submission_roblox_evidence x where exists(select 1 from public.server_submissions s where s.id=x.submission_id and s.submitted_by=p_subject) order by x.submission_id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('submission_id',x.submission_id,'applicant_role',x.applicant_role,'authority_evidence',x.authority_evidence) value from private.submission_roblox_evidence x where exists(select 1 from public.server_submissions s where s.id=x.submission_id and s.submitted_by=p_subject) order by x.submission_id limit 2001) bounded;
  collections:=collections||jsonb_build_object('robloxEvidence',data); counts:=counts||jsonb_build_object('robloxEvidence',n);
  -- claims: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'server_id',x.server_id,'message',x.message,'evidence_url',x.evidence_url,'community_url',x.community_url,'status',x.status,'verification_status',x.verification_status,'guild_name',x.guild_name,'verified_at',x.verified_at,'verification_checked_at',x.verification_checked_at,'reviewed_at',x.reviewed_at,'decision_reason',x.decision_reason,'created_at',x.created_at,'updated_at',x.updated_at) value from public.server_claim_requests x where x.claimant_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'server_id',x.server_id,'message',x.message,'evidence_url',x.evidence_url,'community_url',x.community_url,'status',x.status,'verification_status',x.verification_status,'guild_name',x.guild_name,'verified_at',x.verified_at,'verification_checked_at',x.verification_checked_at,'reviewed_at',x.reviewed_at,'decision_reason',x.decision_reason,'created_at',x.created_at,'updated_at',x.updated_at) value from public.server_claim_requests x where x.claimant_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('claims',data); counts:=counts||jsonb_build_object('claims',n);
  -- badges: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('badge_id',x.badge_id,'awarded_at',x.awarded_at,'expires_at',x.expires_at,'badge',(select jsonb_build_object('key',b.key,'name',b.name,'description',b.description) from public.badges b where b.id=x.badge_id)) value from public.user_badges x where x.user_id=p_subject order by x.badge_id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('badge_id',x.badge_id,'awarded_at',x.awarded_at,'expires_at',x.expires_at,'badge',(select jsonb_build_object('key',b.key,'name',b.name,'description',b.description) from public.badges b where b.id=x.badge_id)) value from public.user_badges x where x.user_id=p_subject order by x.badge_id limit 2001) bounded;
  collections:=collections||jsonb_build_object('badges',data); counts:=counts||jsonb_build_object('badges',n);
  -- listingTags: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('server_id',x.server_id,'tag',x.tag,'source',x.source) value from public.server_tags x where exists(select 1 from public.servers s where s.id=x.server_id and s.owner_id=p_subject) order by x.server_id,x.tag limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('server_id',x.server_id,'tag',x.tag,'source',x.source) value from public.server_tags x where exists(select 1 from public.servers s where s.id=x.server_id and s.owner_id=p_subject) order by x.server_id,x.tag limit 2001) bounded;
  collections:=collections||jsonb_build_object('listingTags',data); counts:=counts||jsonb_build_object('listingTags',n);
  -- listingCategories: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('server_id',x.server_id,'category_id',x.category_id,'category',(select jsonb_build_object('name',c.name,'slug',c.slug) from public.categories c where c.id=x.category_id)) value from public.server_categories x where exists(select 1 from public.servers s where s.id=x.server_id and s.owner_id=p_subject) order by x.server_id,x.category_id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('server_id',x.server_id,'category_id',x.category_id,'category',(select jsonb_build_object('name',c.name,'slug',c.slug) from public.categories c where c.id=x.category_id)) value from public.server_categories x where exists(select 1 from public.servers s where s.id=x.server_id and s.owner_id=p_subject) order by x.server_id,x.category_id limit 2001) bounded;
  collections:=collections||jsonb_build_object('listingCategories',data); counts:=counts||jsonb_build_object('listingCategories',n);
  -- dataRequests: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('id',x.id,'kind',x.kind,'status',x.status,'details',x.details,'staff_reply',x.staff_reply,'version',x.version,'created_at',x.created_at,'updated_at',x.updated_at) value from private.account_data_requests x where x.user_id=p_subject order by x.id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('id',x.id,'kind',x.kind,'status',x.status,'details',x.details,'staff_reply',x.staff_reply,'version',x.version,'created_at',x.created_at,'updated_at',x.updated_at) value from private.account_data_requests x where x.user_id=p_subject order by x.id limit 2001) bounded;
  collections:=collections||jsonb_build_object('dataRequests',data); counts:=counts||jsonb_build_object('dataRequests',n);
  -- requestHistory: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('request_id',x.request_id,'version',x.version,'event',x.event,'status',x.status,'details',x.details,'reply',x.reply,'recorded_at',x.recorded_at) value from private.account_data_request_history x where exists(select 1 from private.account_data_requests r where r.id=x.request_id and r.user_id=p_subject) order by x.request_id,x.version limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('request_id',x.request_id,'version',x.version,'event',x.event,'status',x.status,'details',x.details,'reply',x.reply,'recorded_at',x.recorded_at) value from private.account_data_request_history x where exists(select 1 from private.account_data_requests r where r.id=x.request_id and r.user_id=p_subject) order by x.request_id,x.version limit 2001) bounded;
  collections:=collections||jsonb_build_object('requestHistory',data); counts:=counts||jsonb_build_object('requestHistory',n);
  -- completedFollowUp: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('request_id',x.request_id,'method',x.method,'result',x.result,'completed_at',x.completed_at,'recorded_at',x.recorded_at) value from private.account_data_request_fulfillments x where exists(select 1 from private.account_data_requests r where r.id=x.request_id and r.user_id=p_subject) order by x.request_id limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('request_id',x.request_id,'method',x.method,'result',x.result,'completed_at',x.completed_at,'recorded_at',x.recorded_at) value from private.account_data_request_fulfillments x where exists(select 1 from private.account_data_requests r where r.id=x.request_id and r.user_id=p_subject) order by x.request_id limit 2001) bounded;
  collections:=collections||jsonb_build_object('completedFollowUp',data); counts:=counts||jsonb_build_object('completedFollowUp',n);
  -- submissionHistory: explicit projection; preflight the count/size before aggregation.
  select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from (select jsonb_build_object('submission_id',x.submission_id,'version',x.version,'recorded_at',x.recorded_at,'submission',jsonb_build_object('id',x.snapshot->'id','platform_id',x.snapshot->'platform_id','name',x.snapshot->'name','region',x.snapshot->'region','language',x.snapshot->'language','framework',x.snapshot->'framework','description',x.snapshot->'description','community_url',x.snapshot->'community_url','tags',x.snapshot->'tags','access_type',x.snapshot->'access_type','cfx_join_url',x.snapshot->'cfx_join_url','logo_asset_id',x.snapshot->'logo_asset_id','banner_asset_id',x.snapshot->'banner_asset_id','status',x.snapshot->'status','review_note',x.snapshot->'review_note','reviewed_at',x.snapshot->'reviewed_at','review_version',x.snapshot->'review_version','terms_version',x.snapshot->'terms_version','standards_version',x.snapshot->'standards_version','owner_update_server_id',x.snapshot->'owner_update_server_id','owner_update_version',x.snapshot->'owner_update_version','created_at',x.snapshot->'created_at','updated_at',x.snapshot->'updated_at','roblox',jsonb_build_object('kind',x.snapshot->'roblox_details'->'kind','experienceUrl',x.snapshot->'roblox_details'->'experienceUrl','communityGroupUrl',x.snapshot->'roblox_details'->'communityGroupUrl','joiningInstructions',x.snapshot->'roblox_details'->'joiningInstructions','applicantRole',x.snapshot->'roblox_evidence'->'applicantRole','authorityEvidence',x.snapshot->'roblox_evidence'->'authorityEvidence'))) value from private.server_submission_revisions x where exists(select 1 from public.server_submissions s where s.id=x.submission_id and s.submitted_by=p_subject) order by x.submission_id,x.version limit 2001) bounded;
  total_rows:=total_rows+n; total_bytes:=total_bytes+bytes;
  if n>2000 or total_rows>10000 or total_bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(value),'[]') into data from (select jsonb_build_object('submission_id',x.submission_id,'version',x.version,'recorded_at',x.recorded_at,'submission',jsonb_build_object('id',x.snapshot->'id','platform_id',x.snapshot->'platform_id','name',x.snapshot->'name','region',x.snapshot->'region','language',x.snapshot->'language','framework',x.snapshot->'framework','description',x.snapshot->'description','community_url',x.snapshot->'community_url','tags',x.snapshot->'tags','access_type',x.snapshot->'access_type','cfx_join_url',x.snapshot->'cfx_join_url','logo_asset_id',x.snapshot->'logo_asset_id','banner_asset_id',x.snapshot->'banner_asset_id','status',x.snapshot->'status','review_note',x.snapshot->'review_note','reviewed_at',x.snapshot->'reviewed_at','review_version',x.snapshot->'review_version','terms_version',x.snapshot->'terms_version','standards_version',x.snapshot->'standards_version','owner_update_server_id',x.snapshot->'owner_update_server_id','owner_update_version',x.snapshot->'owner_update_version','created_at',x.snapshot->'created_at','updated_at',x.snapshot->'updated_at','roblox',jsonb_build_object('kind',x.snapshot->'roblox_details'->'kind','experienceUrl',x.snapshot->'roblox_details'->'experienceUrl','communityGroupUrl',x.snapshot->'roblox_details'->'communityGroupUrl','joiningInstructions',x.snapshot->'roblox_details'->'joiningInstructions','applicantRole',x.snapshot->'roblox_evidence'->'applicantRole','authorityEvidence',x.snapshot->'roblox_evidence'->'authorityEvidence'))) value from private.server_submission_revisions x where exists(select 1 from public.server_submissions s where s.id=x.submission_id and s.submitted_by=p_subject) order by x.submission_id,x.version limit 2001) bounded;
  collections:=collections||jsonb_build_object('submissionHistory',data); counts:=counts||jsonb_build_object('submissionHistory',n);
  if exists(select 1 from public.uploaded_assets where owner_id=p_subject) then pending:=pending||'[{"category":"uploaded_files","message":"Uploaded file information is included; the file bytes still need a separate copy."}]'::jsonb; end if;
  if exists(select 1 from public.applications where applicant_id=p_subject and answers<>'{}'::jsonb)
   or exists(select 1 from public.blog_posts where author_id=p_subject)
   or exists(select 1 from public.staff_memberships where user_id=p_subject)
   or exists(select 1 from public.bans where user_id=p_subject)
   or exists(select 1 from public.security_bans where user_id=p_subject)
   or exists(select 1 from public.ban_appeals where appellant_id=p_subject and decision_note is not null)
   or exists(select 1 from public.security_ban_appeals where appellant_id=p_subject and decision_note is not null)
   or exists(select 1 from public.promotion_credit_ledger where user_id=p_subject and source_type='staff_adjustment') then
   pending:=pending||'[{"category":"reviewed_supplement","message":"Additional records need an individual review before this request can be completed."}]'::jsonb;
  end if;
  return jsonb_build_object('formatVersion',1,'scope','BrowseRP structured account records','generatedAt',now(),'collections',collections,'counts',counts,'pending',pending,
   'scopeNotes',jsonb_build_array('This file contains the named account records available through the structured copy workflow.','Uploaded file bytes and individually reviewed information are separate.','Credentials, other people''s private information and staff/security secrets are not included.'));
end;
$$;
revoke all on function private.member_export_records(uuid) from public,anon,authenticated,service_role;

-- Approval covers the current request version. Any later review, withdrawal or
-- completion revokes access to that version immediately. Staff cannot read the
-- generated account file through this workflow.
create or replace function public.staff_approve_data_export(p_id uuid,p_expected_version bigint,p_key uuid,p_scope_complete boolean,p_supplement_note text,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); r private.account_data_requests; prior private.data_export_approvals;
  note text:=btrim(coalesce(p_supplement_note,'')); signature bytea;
begin
  if private.can_fulfill_data_requests() is distinct from true then raise exception 'Completion permission and an authenticator check are required.' using errcode='42501'; end if;
  if p_id is null or p_key is null or p_expected_version is null or p_expected_version<1 or p_scope_complete is null or p_confirmed is distinct from true
    or char_length(note)>1000 or (not p_scope_complete and char_length(note)<20) or translate(note,E'\n\r\t','')~'[[:cntrl:]]'
    then raise exception 'Confirm the scope and describe any remaining follow-up.' using errcode='22023'; end if;
  signature:=pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('id',p_id,'version',p_expected_version,'scopeComplete',p_scope_complete,'note',note)::text,'UTF8'));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('data-export-approve:'||actor::text,0));
  select * into prior from private.data_export_approvals where approved_by=actor and request_key=p_key;
  if found then
    if prior.fingerprint is distinct from signature then raise exception 'That approval key was already used. Refresh the request.' using errcode='PT409'; end if;
    select * into r from private.account_data_requests where id=p_id;
    return jsonb_build_object('request',private.data_request_json(r));
  end if;
  select * into r from private.account_data_requests where id=p_id for update;
  if not found then raise exception 'Request not found.' using errcode='PT404'; end if;
  if r.kind<>'copy' or r.status<>'ready' or r.version is distinct from p_expected_version then raise exception 'This request changed or is not ready for a copy. Refresh it before approving.' using errcode='PT409'; end if;
  perform private.enforce_member_rate_limit('data-export-approve',10,600);
  update private.account_data_requests set version=version+1,updated_at=now(),staff_reply='Your structured account copy is approved for download. '
    ||case when p_scope_complete then 'Please check the file and confirm receipt. Staff will verify the full request before closing it.' else 'Other parts still need follow-up: '||note end
    where id=p_id returning * into r;
  insert into private.data_export_approvals(request_id,user_id,request_version,approved_by,request_key,fingerprint,scope_complete,supplement_note)
    values(r.id,r.user_id,r.version,actor,p_key,signature,p_scope_complete,note);
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,metadata)
    values(actor,'privacy.export.approved','data_request',r.id::text,'Approved a structured account copy.',p_key::text,jsonb_build_object('version',r.version,'scopeComplete',p_scope_complete));
  return jsonb_build_object('request',private.data_request_json(r));
end;
$$;
revoke all on function public.staff_approve_data_export(uuid,bigint,uuid,boolean,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.staff_approve_data_export(uuid,bigint,uuid,boolean,text,boolean) to authenticated;

create or replace function private.data_export_summary(e private.member_data_exports)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',e.id,'sha256',e.sha256,'byteSize',e.byte_size,'createdAt',e.created_at,'expiresAt',e.expires_at,'receivedAt',e.received_at,'pending',e.pending,
   'available',e.payload is not null and e.expires_at>now(),'filename','BrowseRP-account-data.json');
$$;
revoke all on function private.data_export_summary(private.member_data_exports) from public,anon,authenticated,service_role;

create or replace function private.data_request_json(r private.account_data_requests)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',r.id,'kind',r.kind,'status',r.status,'details',r.details,'staffReply',r.staff_reply,'version',r.version,'createdAt',r.created_at,'updatedAt',r.updated_at,
   'export',(select jsonb_build_object('approved',true,'scopeComplete',a.scope_complete,'supplementNote',a.supplement_note,'copy',
      (select private.data_export_summary(e) from private.member_data_exports e where e.approval_id=a.id order by e.created_at desc,e.id desc limit 1))
    from private.data_export_approvals a where a.request_id=r.id and a.request_version=r.version and r.status='ready'));
$$;
revoke all on function private.data_request_json(private.account_data_requests) from public,anon,authenticated,service_role;

create or replace function public.member_generate_data_export(p_id uuid,p_expected_version bigint,p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.export_recent_member(); r private.account_data_requests; a private.data_export_approvals; e private.member_data_exports; data jsonb; content text;
begin
  if p_id is null or p_key is null or p_expected_version is null then raise exception 'Refresh the copy request.' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('data-export-generate:'||actor::text,0));
  select * into r from private.account_data_requests where id=p_id and user_id=actor for update;
  if not found then raise exception 'Request not found.' using errcode='PT404'; end if;
  select * into a from private.data_export_approvals where request_id=r.id and request_version=r.version and user_id=actor;
  if not found or r.status<>'ready' or r.version is distinct from p_expected_version then raise exception 'This copy is not approved for the current request. Refresh your requests.' using errcode='PT409'; end if;
  select * into e from private.member_data_exports where user_id=actor and generation_key=p_key;
  if found then
    if e.approval_id<>a.id then raise exception 'That copy key was already used. Refresh your requests.' using errcode='PT409'; end if;
    if e.expires_at<=now() or e.payload is null then raise exception 'This copy expired. Refresh and prepare a new copy.' using errcode='PT410'; end if;
    return jsonb_build_object('copy',private.data_export_summary(e));
  end if;
  select * into e from private.member_data_exports where approval_id=a.id and expires_at>now() and payload is not null order by created_at desc limit 1;
  if found then return jsonb_build_object('copy',private.data_export_summary(e)); end if;
  perform private.enforce_member_rate_limit('data-export-generate-hour',2,3600);
  perform private.enforce_member_rate_limit('data-export-generate-day',3,86400);
  data:=private.member_export_records(actor);
  if not a.scope_complete then data:=jsonb_set(data,'{pending}',(data->'pending')||jsonb_build_array(jsonb_build_object('category','staff_follow_up','message',a.supplement_note))); end if;
  data:=data||jsonb_build_object('requestId',r.id,'requestVersion',r.version,'notice','This structured copy does not close your request. Staff still verifies any remaining parts.');
  content:=data::text;
  if octet_length(content)>2097152 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  insert into private.member_data_exports(approval_id,user_id,generation_key,payload,sha256,byte_size,pending)
    values(a.id,actor,p_key,content,encode(pg_catalog.sha256(pg_catalog.convert_to(content,'UTF8')),'hex'),octet_length(content),data->'pending') returning * into e;
  return jsonb_build_object('copy',private.data_export_summary(e));
end;
$$;
revoke all on function public.member_generate_data_export(uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.member_generate_data_export(uuid,bigint,uuid) to authenticated;

-- This guard is also called immediately before the API releases file bytes.
create or replace function private.readable_member_export(p_id uuid)
returns private.member_data_exports language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.export_recent_member(); e private.member_data_exports;
begin
 select * into e from private.member_data_exports where id=p_id and user_id=actor;
 if not found then raise exception 'Copy not found.' using errcode='PT404'; end if;
 if e.expires_at<=now() or e.payload is null then raise exception 'This copy expired. Refresh and prepare a new copy.' using errcode='PT410'; end if;
 if not exists(select 1 from private.data_export_approvals a join private.account_data_requests r on r.id=a.request_id
  where a.id=e.approval_id and r.user_id=actor and r.status='ready' and r.version=a.request_version)
 then raise exception 'This request changed. Refresh before downloading another copy.' using errcode='PT409'; end if;
 return e;
end;
$$;
revoke all on function private.readable_member_export(uuid) from public,anon,authenticated,service_role;
create or replace function public.member_read_data_export(p_id uuid,p_check_only boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.member_data_exports:=private.readable_member_export(p_id);
begin
 perform private.enforce_member_rate_limit('data-export-read',60,600);
 if p_check_only then return jsonb_build_object('allowed',true,'sha256',e.sha256); end if;
 return jsonb_build_object('copy',private.data_export_summary(e),'content',e.payload);
end;
$$;
revoke all on function public.member_read_data_export(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.member_read_data_export(uuid,boolean) to authenticated;

create or replace function public.member_receive_data_export(p_id uuid,p_sha256 text,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.member_data_exports; a private.data_export_approvals; r private.account_data_requests;
begin
 e:=private.readable_member_export(p_id);
 select * into a from private.data_export_approvals where id=e.approval_id;
 select * into r from private.account_data_requests where id=a.request_id for update;
 -- Recheck after waiting on a concurrent review or withdrawal.
 if r.status<>'ready' or r.version<>a.request_version then raise exception 'This request changed. Refresh your requests.' using errcode='PT409'; end if;
 if p_confirmed is distinct from true or p_sha256 is distinct from e.sha256 then raise exception 'Download and check your copy before confirming receipt.' using errcode='22023'; end if;
 update private.member_data_exports set received_at=coalesce(received_at,now()) where id=e.id returning * into e;
 -- Receipt is durable, but is not an assertion that files or individually
 -- reviewed information were delivered. Existing staff completion stays separate.
 return jsonb_build_object('copy',private.data_export_summary(e),'request',private.data_request_json(r));
end;
$$;
revoke all on function public.member_receive_data_export(uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.member_receive_data_export(uuid,text,boolean) to authenticated;

create or replace function public.service_prune_data_exports()
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 with expired as(select id from private.member_data_exports where payload is not null and expires_at<=now() order by expires_at limit 100 for update skip locked)
 update private.member_data_exports e set payload=null from expired where e.id=expired.id;
 get diagnostics n=row_count; return n;
end;
$$;
revoke all on function public.service_prune_data_exports() from public,anon,authenticated,service_role;
grant execute on function public.service_prune_data_exports() to service_role;
create or replace function private.data_request_history_page(p_id uuid,p_before_version bigint,p_staff boolean)
returns jsonb language plpgsql stable set search_path='' as $$
declare items jsonb; more boolean; result jsonb;
begin
  if p_before_version is not null and p_before_version<1 then raise exception 'Refresh the request history.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(x.payload order by x.version desc),'[]'::jsonb) into items from (
    select h.version,jsonb_build_object('version',h.version,'event',h.event,'status',h.status,'details',
      case when h.event in ('legacy_snapshot','submitted','member_update') then h.details end,
      'reply',case when h.event in ('legacy_snapshot','staff_review','fulfilled') then h.reply end,
      'recordedAt',h.recorded_at) payload
    from private.account_data_request_history h where h.request_id=p_id and (p_before_version is null or h.version<p_before_version)
    order by h.version desc limit 26
  )x;
  more:=jsonb_array_length(items)>25;
  if more then items:=items-25; end if;
  result:=jsonb_build_object('items',items,'next',case when more then (items->24->>'version')::bigint end);
  if p_staff then
    result:=result||jsonb_build_object('completion',(select jsonb_build_object('method',f.method,'result',f.result,'evidence',f.evidence,
      'completedAt',f.completed_at,'recordedAt',f.recorded_at) from private.account_data_request_fulfillments f where f.request_id=p_id));
  end if;
  if p_before_version is null then
    result:=result||jsonb_build_object('copies',coalesce((select jsonb_agg(x.item order by x.created_at desc) from (
      select e.created_at,jsonb_build_object('createdAt',e.created_at,'expiresAt',e.expires_at,'receivedAt',e.received_at,
        'requestVersion',a.request_version,'byteSize',e.byte_size,'pending',e.pending) item
      from private.member_data_exports e join private.data_export_approvals a on a.id=e.approval_id
      where a.request_id=p_id order by e.created_at desc,e.id desc limit 25
    )x),'[]'::jsonb));
  end if;
  return result;
end;
$$;
revoke all on function private.data_request_history_page(uuid,bigint,boolean) from public,anon,authenticated,service_role;

update public.permissions set description='Approve structured account copies and record verified completed follow-up. Requires data-request review permission; does not itself erase accounts.' where key='privacy.requests.fulfill';
notify pgrst, 'reload schema';
