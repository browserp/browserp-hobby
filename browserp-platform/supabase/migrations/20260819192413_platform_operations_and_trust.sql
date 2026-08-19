-- BrowseRP platform operations, staff MFA, account security, adverts and blogs.
-- Additive and rollback-compatible with the live v2 schema.
begin;

-- Individual staff permissions can be allowed or denied without inventing a
-- new rank. The protected owner is intentionally excluded from overrides.
create table if not exists public.staff_permission_overrides (
  user_id uuid not null references public.staff_memberships(user_id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  allowed boolean not null,
  reason text not null check (char_length(reason) between 5 and 500),
  changed_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, permission_key)
);

alter table public.staff_permission_overrides enable row level security;
revoke all on table public.staff_permission_overrides from public, anon, authenticated;

insert into public.permissions (key, description) values
  ('accounts.read', 'Read privacy-safe account creation and sign-in activity.'),
  ('accounts.sessions.revoke', 'Revoke member sessions and start account recovery.'),
  ('profiles.review', 'Review profile text and quarantined profile pictures.'),
  ('staff.permissions.manage', 'Manage per-person staff permission overrides.'),
  ('security.network.request', 'Request temporary access to protected network evidence.'),
  ('security.network.approve', 'Approve or deny network-evidence requests.'),
  ('adverts.manage', 'Create, schedule, pause and archive site advertisements.'),
  ('blogs.manage', 'Create, review, publish and archive blog posts.'),
  ('bans.manage', 'Apply and revoke account, device and network-prefix bans.')
on conflict (key) do update set description = excluded.description;

insert into public.staff_role_permissions (role_key, permission_key)
select 'owner', p.key from public.permissions p
on conflict (role_key, permission_key) do nothing;

insert into public.staff_role_permissions (role_key, permission_key)
select 'administrator', p.key
from public.permissions p
where p.key in (
  'accounts.read', 'profiles.review', 'security.network.request',
  'adverts.manage', 'blogs.manage', 'bans.manage'
)
on conflict (role_key, permission_key) do nothing;

-- MFA is deliberately activated only after the protected owner has enrolled a
-- TOTP factor and proved an AAL2 session. This avoids a deployment-time owner
-- lockout while still making activation an irreversible, audited owner step.
create table if not exists private.platform_security_settings (
  singleton boolean primary key default true check (singleton),
  staff_mfa_required boolean not null default false,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default timezone('utc', now())
);
insert into private.platform_security_settings (singleton) values (true)
on conflict (singleton) do nothing;
alter table private.platform_security_settings enable row level security;
revoke all on table private.platform_security_settings from public, anon, authenticated;

-- OAuth avatars and member bios are never promoted to public surfaces until
-- they have passed the same staff moderation boundary as other user content.
alter table public.profiles
  add column if not exists avatar_review_status text not null default 'pending_review',
  add column if not exists bio_review_status text not null default 'pending_review',
  add column if not exists approved_avatar_url text,
  add column if not exists approved_bio text not null default '';

do $profile_review_constraints$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_avatar_review_status_check') then
    alter table public.profiles add constraint profiles_avatar_review_status_check
      check (avatar_review_status in ('pending_review','approved','rejected','not_set'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_bio_review_status_check') then
    alter table public.profiles add constraint profiles_bio_review_status_check
      check (bio_review_status in ('pending_review','approved','rejected','not_set'));
  end if;
end
$profile_review_constraints$;

update public.profiles set avatar_review_status='not_set'
where nullif(btrim(coalesce(avatar_url,'')),'') is null and approved_avatar_url is null;
update public.profiles set bio_review_status='not_set',approved_bio=''
where nullif(btrim(coalesce(bio,'')),'') is null;

create or replace function private.queue_profile_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op='INSERT' or new.avatar_url is distinct from old.avatar_url then
    new.avatar_review_status=case when nullif(btrim(coalesce(new.avatar_url,'')),'') is null then 'not_set' else 'pending_review' end;
    new.approved_avatar_url=null;
  end if;
  if tg_op='INSERT' or new.bio is distinct from old.bio then
    new.bio_review_status=case when nullif(btrim(coalesce(new.bio,'')),'') is null then 'not_set' else 'pending_review' end;
    new.approved_bio='';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_content_review_state_insert on public.profiles;
drop trigger if exists profiles_content_review_state_update on public.profiles;
create trigger profiles_content_review_state_insert before insert on public.profiles
for each row execute procedure private.queue_profile_review();
create trigger profiles_content_review_state_update before update of avatar_url,bio on public.profiles
for each row execute procedure private.queue_profile_review();
revoke all on function private.queue_profile_review() from public, anon, authenticated;

-- Public, privacy-safe account activity and separately protected evidence.
create table if not exists public.account_activity (
  id bigint generated always as identity primary key,
  user_id uuid,
  event_type text not null check (event_type in (
    'account.created', 'auth.signed_in', 'auth.signed_out',
    'auth.mfa_enrolled', 'auth.mfa_verified', 'auth.session_revoked',
    'profile.updated', 'profile.media_submitted', 'security.ban_matched'
  )),
  provider text,
  masked_network text,
  browser_family text,
  os_family text,
  device_family text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists account_activity_user_created_idx
  on public.account_activity (user_id, created_at desc);
create index if not exists account_activity_type_created_idx
  on public.account_activity (event_type, created_at desc);

alter table public.account_activity enable row level security;
revoke all on table public.account_activity from public, anon, authenticated;

create table if not exists private.network_evidence (
  activity_id bigint primary key references public.account_activity(id) on delete cascade,
  network_ciphertext text,
  network_hash text,
  device_hash text,
  user_agent_hash text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table private.network_evidence enable row level security;
revoke all on table private.network_evidence from public, anon, authenticated;

create table if not exists public.network_reveal_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  activity_id bigint not null references public.account_activity(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 10 and 500),
  status text not null default 'pending' check (status in ('pending','approved','denied','expired','used')),
  decided_by uuid references public.profiles(id) on delete set null,
  decision_reason text,
  decided_at timestamptz,
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.network_reveal_requests enable row level security;
revoke all on table public.network_reveal_requests from public, anon, authenticated;
create index if not exists network_reveal_status_created_idx
  on public.network_reveal_requests (status, created_at desc);
create unique index if not exists network_reveal_one_open_request_idx
  on public.network_reveal_requests (activity_id, requested_by)
  where status in ('pending','approved');

-- Stable pseudonymous device IDs support abuse controls without invasive
-- hardware fingerprinting. Network bans operate on a hashed prefix to avoid
-- treating a changing household IP as a permanent identity.
create table if not exists public.security_bans (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('account','device','network_prefix')),
  target_hash text not null check (target_hash ~ '^[0-9a-f]{64}$'),
  public_reference text not null unique check (public_reference ~ '^BRP-[A-Z0-9]{10}$'),
  scope text not null default 'platform' check (scope in ('platform','account','listing','community')),
  reason_code text not null,
  reason text not null check (char_length(reason) between 10 and 1000),
  permanent boolean not null default true,
  starts_at timestamptz not null default timezone('utc', now()),
  ends_at timestamptz,
  revoked_at timestamptz,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoke_reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists security_bans_active_target_idx
  on public.security_bans (target_type, target_hash)
  where revoked_at is null;
alter table public.security_bans enable row level security;
revoke all on table public.security_bans from public, anon, authenticated;

create table if not exists public.security_ban_appeals (
  id uuid primary key default extensions.gen_random_uuid(),
  ban_id uuid not null references public.security_bans(id) on delete cascade,
  appellant_id uuid references public.profiles(id) on delete set null,
  contact_email text,
  statement text not null check (char_length(statement) between 40 and 3000),
  status text not null default 'submitted' check (status in ('submitted','under_review','approved','denied','withdrawn')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  decision_note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (ban_id, appellant_id)
);

alter table public.security_ban_appeals enable row level security;
revoke all on table public.security_ban_appeals from public, anon, authenticated;

create or replace function public.check_security_ban_server(
  p_user_id uuid,p_network_hash text,p_device_hash text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id',b.id,'reference',b.public_reference,'scope',b.scope,'reasonCode',b.reason_code)
  from public.security_bans b
  where b.revoked_at is null and b.starts_at<=timezone('utc',now())
    and (b.permanent or b.ends_at>timezone('utc',now()))
    and (
      (b.target_type='account' and b.target_hash=pg_catalog.encode(extensions.digest(p_user_id::text,'sha256'),'hex'))
      or (b.target_type='network_prefix' and b.target_hash=p_network_hash)
      or (b.target_type='device' and b.target_hash=p_device_hash)
    )
  order by case b.target_type when 'account' then 1 when 'device' then 2 else 3 end limit 1;
$$;
revoke execute on function public.check_security_ban_server(uuid,text,text) from public, anon, authenticated;
grant execute on function public.check_security_ban_server(uuid,text,text) to service_role;

create or replace function public.submit_security_ban_appeal_server(
  p_reference text,p_contact_email text,p_statement text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_ban public.security_bans%rowtype; v_id uuid;
begin
  select * into v_ban from public.security_bans where public_reference=upper(btrim(p_reference)) and revoked_at is null;
  if v_ban.id is null then raise exception 'Ban reference was not found'; end if;
  if char_length(btrim(coalesce(p_statement,''))) not between 40 and 3000
     or coalesce(p_contact_email,'') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or char_length(p_contact_email)>254 then raise exception 'A valid email and full appeal statement are required'; end if;
  if exists(select 1 from public.security_ban_appeals where ban_id=v_ban.id and status in ('submitted','under_review')) then raise exception 'An appeal is already open'; end if;
  insert into public.security_ban_appeals(ban_id,contact_email,statement)
  values(v_ban.id,lower(btrim(p_contact_email)),btrim(p_statement)) returning id into v_id;
  return jsonb_build_object('id',v_id,'reference',v_ban.public_reference,'status','submitted');
end;
$$;
revoke execute on function public.submit_security_ban_appeal_server(text,text,text) from public, anon, authenticated;
grant execute on function public.submit_security_ban_appeal_server(text,text,text) to service_role;

-- Listing metadata requested by FiveM owners.
create table if not exists public.server_tag_catalog (
  key text primary key check (key ~ '^[a-z0-9-]{2,40}$'),
  label text not null unique,
  group_name text not null,
  enabled boolean not null default true,
  sort_order integer not null default 0
);

insert into public.server_tag_catalog (key, label, group_name, sort_order) values
  ('economy','Economy','Experience',10),
  ('whitelisted','Whitelisted','Access',20),
  ('public','Public access','Access',30),
  ('custom-clothing','Custom clothing','Features',40),
  ('custom-jobs','Custom jobs','Features',50),
  ('player-businesses','Player-owned businesses','Features',60),
  ('serious-roleplay','Serious roleplay','Play style',70),
  ('semi-serious','Semi-serious','Play style',80),
  ('beginner-friendly','Beginner friendly','Play style',90),
  ('police','Police','Departments',100),
  ('ems','EMS','Departments',110),
  ('gangs','Gangs','Features',120),
  ('qbcore','QBCore','Framework',130),
  ('qbox','QBox','Framework',140),
  ('esx','ESX','Framework',150),
  ('uk','United Kingdom','Region',160),
  ('us','United States','Region',170)
on conflict (key) do update set
  label = excluded.label,
  group_name = excluded.group_name,
  sort_order = excluded.sort_order;

alter table public.server_tag_catalog enable row level security;
drop policy if exists server_tag_catalog_public_read on public.server_tag_catalog;
create policy server_tag_catalog_public_read on public.server_tag_catalog
  for select to anon, authenticated using (enabled);
grant select on table public.server_tag_catalog to anon, authenticated;

alter table public.server_submissions
  add column if not exists tags text[] not null default '{}',
  add column if not exists access_type text not null default 'public',
  add column if not exists cfx_join_url text,
  add column if not exists metadata_fingerprint text,
  add column if not exists logo_asset_id uuid references public.uploaded_assets(id) on delete set null,
  add column if not exists banner_asset_id uuid references public.uploaded_assets(id) on delete set null;

alter table public.servers
  add column if not exists access_type text not null default 'public',
  add column if not exists cfx_join_url text,
  add column if not exists logo_asset_id uuid references public.uploaded_assets(id) on delete set null,
  add column if not exists banner_asset_id uuid references public.uploaded_assets(id) on delete set null,
  add column if not exists animated_media_enabled boolean not null default false;

do $listing_constraints$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.server_submissions'::regclass and conname='server_submissions_access_type_check') then
    alter table public.server_submissions add constraint server_submissions_access_type_check check (access_type in ('public','allowlisted','application'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.servers'::regclass and conname='servers_access_type_check') then
    alter table public.servers add constraint servers_access_type_check check (access_type in ('public','allowlisted','application'));
  end if;
end
$listing_constraints$;

create or replace function public.attach_server_submission_metadata_server(
  p_user_id uuid,p_submission_id uuid,p_tags text[],p_access_type text,
  p_cfx_join_url text,p_metadata_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_existing text; v_tags text[];
begin
  if p_user_id is null or p_submission_id is null or p_metadata_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'Invalid submission metadata'; end if;
  if p_access_type not in ('public','allowlisted','application') then raise exception 'Invalid access type'; end if;
  select coalesce(array_agg(distinct lower(btrim(x)) order by lower(btrim(x))),'{}'::text[]) into v_tags
  from unnest(coalesce(p_tags,'{}'::text[])) x
  where exists(select 1 from public.server_tag_catalog t where t.key=lower(btrim(x)) and t.enabled);
  if cardinality(v_tags)>8 or cardinality(v_tags)<>cardinality(coalesce(p_tags,'{}'::text[])) then raise exception 'Invalid listing tags'; end if;
  if p_cfx_join_url is not null and p_cfx_join_url !~* '^https://cfx\.re/join/[a-z0-9]{3,32}/?$' then raise exception 'Invalid Cfx join URL'; end if;
  select metadata_fingerprint into v_existing from public.server_submissions
  where id=p_submission_id and submitted_by=p_user_id and status in ('pending_review','changes_requested') for update;
  if not found then raise exception 'Submission not found'; end if;
  if v_existing is not null and v_existing<>p_metadata_fingerprint then raise exception 'Conflicting submission metadata replay'; end if;
  update public.server_submissions set tags=v_tags,access_type=p_access_type,
    cfx_join_url=nullif(btrim(coalesce(p_cfx_join_url,'')),''),metadata_fingerprint=p_metadata_fingerprint,
    updated_at=timezone('utc',now()) where id=p_submission_id;
  return jsonb_build_object('id',p_submission_id,'tags',to_jsonb(v_tags),'accessType',p_access_type,'cfxJoinUrl',p_cfx_join_url);
end;
$$;
revoke execute on function public.attach_server_submission_metadata_server(uuid,uuid,text[],text,text,text)
  from public, anon, authenticated;
grant execute on function public.attach_server_submission_metadata_server(uuid,uuid,text[],text,text,text)
  to service_role;

create or replace function private.publish_submission_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_submission public.server_submissions%rowtype;
begin
  if new.source_submission_id is null then return new; end if;
  select * into v_submission from public.server_submissions where id=new.source_submission_id;
  if v_submission.id is null then return new; end if;
  update public.servers set access_type=v_submission.access_type,cfx_join_url=v_submission.cfx_join_url where id=new.id;
  insert into public.server_tags(server_id,tag,source,relevance_score)
  select new.id,tag,'owner',80 from unnest(v_submission.tags) tag
  on conflict(server_id,tag) do update set source='owner',relevance_score=80;
  return new;
end;
$$;
drop trigger if exists servers_publish_submission_metadata on public.servers;
create trigger servers_publish_submission_metadata after insert or update of source_submission_id on public.servers
for each row execute procedure private.publish_submission_metadata();
revoke all on function private.publish_submission_metadata() from public, anon, authenticated;

create table if not exists public.server_votes (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (server_id, user_id)
);
alter table public.server_votes enable row level security;
revoke all on table public.server_votes from public, anon, authenticated;

create table if not exists public.server_comments (
  id uuid primary key default extensions.gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 3 and 1000),
  status text not null default 'pending_review' check (status in ('pending_review','published','hidden','rejected')),
  moderation_score integer not null default 0 check (moderation_score between 0 and 100),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists server_comments_public_idx on public.server_comments (server_id, status, created_at desc);
alter table public.server_comments enable row level security;
revoke all on table public.server_comments from public, anon, authenticated;

-- Adverts use fixed placements and plain text. Raw HTML, scripts and arbitrary
-- website editing are deliberately outside this control plane.
alter table public.ad_campaigns
  add column if not exists headline text,
  add column if not exists body text,
  add column if not exists cta_label text,
  add column if not exists version bigint not null default 1,
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

alter table public.ad_campaigns drop constraint if exists ad_campaigns_placement_check;
alter table public.ad_campaigns add constraint ad_campaigns_placement_check
  check (placement in ('top','side','directory','server_detail'));

-- Paid privileges are explicit ledger-backed entitlements. Payments remain
-- disabled until the complete Stripe event and refund lifecycle is live.
create table if not exists public.server_entitlements (
  id uuid primary key default extensions.gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  entitlement_type text not null check (entitlement_type in ('featured','animated_logo','animated_banner')),
  source_ledger_id bigint references public.promotion_credit_ledger(id) on delete restrict,
  starts_at timestamptz not null default timezone('utc', now()),
  ends_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);
create unique index if not exists server_entitlements_active_idx
  on public.server_entitlements (server_id, entitlement_type)
  where revoked_at is null;
alter table public.server_entitlements enable row level security;
revoke all on table public.server_entitlements from public, anon, authenticated;

create table if not exists public.payment_attempts (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete restrict,
  product_key text not null references public.promotion_products(key),
  quantity integer not null check (quantity between 1 and 10),
  expected_amount integer not null check (expected_amount > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  status text not null default 'created' check (status in ('created','pending','paid','failed','expired','partially_refunded','refunded','disputed')),
  terms_version text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stripe_event_receipts (
  event_id text primary key,
  event_type text not null,
  object_id text,
  livemode boolean not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'received' check (status in ('received','processed','ignored','failed')),
  attempts integer not null default 1,
  error_code text,
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz
);
alter table public.payment_attempts enable row level security;
alter table public.stripe_event_receipts enable row level security;
revoke all on table public.payment_attempts, public.stripe_event_receipts from public, anon, authenticated;

-- Log account creation without copying email addresses or provider tokens.
create or replace function private.log_account_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_activity (user_id, event_type, provider, metadata)
  values (
    new.id,
    'account.created',
    nullif(new.raw_app_meta_data ->> 'provider', ''),
    jsonb_build_object('source', 'supabase-auth')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_account_activity_created on auth.users;
create trigger on_auth_account_activity_created
after insert on auth.users
for each row execute procedure private.log_account_created();
revoke all on function private.log_account_created() from public, anon, authenticated;

insert into public.account_activity(user_id,event_type,provider,metadata,created_at)
select u.id,'account.created',nullif(u.raw_app_meta_data->>'provider',''),jsonb_build_object('source','auth-history'),u.created_at
from auth.users u
where not exists(select 1 from public.account_activity a where a.user_id=u.id and a.event_type='account.created');

create or replace function public.record_account_activity_server(
  p_user_id uuid,
  p_event_type text,
  p_provider text,
  p_masked_network text,
  p_browser_family text,
  p_os_family text,
  p_device_family text,
  p_request_id text,
  p_network_ciphertext text,
  p_network_hash text,
  p_device_hash text,
  p_user_agent_hash text,
  p_metadata jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id=p_user_id) then
    raise exception 'Unknown account' using errcode='42501';
  end if;
  if p_event_type not in ('auth.signed_in','auth.signed_out','auth.mfa_enrolled','auth.mfa_verified','auth.session_revoked','profile.updated','profile.media_submitted','security.ban_matched') then
    raise exception 'Invalid account activity type';
  end if;
  insert into public.account_activity (
    user_id,event_type,provider,masked_network,browser_family,os_family,
    device_family,request_id,metadata
  ) values (
    p_user_id,p_event_type,nullif(p_provider,''),nullif(p_masked_network,''),
    nullif(p_browser_family,''),nullif(p_os_family,''),nullif(p_device_family,''),
    nullif(p_request_id,''),coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;
  insert into private.network_evidence (
    activity_id,network_ciphertext,network_hash,device_hash,user_agent_hash
  ) values (
    v_id,nullif(p_network_ciphertext,''),nullif(p_network_hash,''),
    nullif(p_device_hash,''),nullif(p_user_agent_hash,'')
  );
  return v_id;
end;
$$;
revoke execute on function public.record_account_activity_server(uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_account_activity_server(uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb)
  to service_role;

create or replace function public.member_update_profile(
  p_display_name text,p_bio text,p_visibility text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := (select auth.uid()); v_name text := btrim(coalesce(p_display_name,'')); v_bio text := btrim(coalesce(p_bio,''));
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if char_length(v_name) not between 2 and 48 or v_name ~ '[[:cntrl:]]'
     or char_length(v_bio)>500 or v_bio ~ '[[:cntrl:]]'
     or p_visibility not in ('public','members','private') then
    raise exception 'Invalid profile details';
  end if;
  update public.profiles set display_name=v_name,bio=v_bio,profile_visibility=p_visibility,
    updated_at=timezone('utc',now()) where id=v_user;
  if not found then raise exception 'Profile not found'; end if;
  return (select jsonb_build_object(
    'displayName',p.display_name,'bio',p.bio,'visibility',p.profile_visibility,
    'avatarUrl',p.avatar_url,'avatarStatus',p.avatar_review_status,'bioStatus',p.bio_review_status
  ) from public.profiles p where p.id=v_user);
end;
$$;
revoke execute on function public.member_update_profile(text,text,text) from public, anon, service_role;
grant execute on function public.member_update_profile(text,text,text) to authenticated;

-- Every staff API call requires a Discord OAuth session. TOTP/AAL2 becomes
-- mandatory as soon as the protected owner completes the staged activation.
-- Per-person overrides are evaluated before the rank default.
create or replace function public.has_staff_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_memberships sm
    join auth.identities i on i.user_id=sm.user_id and i.provider='discord'
    join private.discord_owner_allowlist a
      on a.discord_user_id=coalesce(i.provider_id,i.identity_data->>'provider_id',i.identity_data->>'sub')
     and a.enabled and a.role_key=sm.role_key
    where sm.user_id=(select auth.uid())
      and sm.status='active'
      and coalesce((select auth.jwt())->'app_metadata'->>'provider','')='discord'
      and coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"oauth"}]'::jsonb
      and (
        not coalesce((select s.staff_mfa_required from private.platform_security_settings s where s.singleton), false)
        or (
          coalesce((select auth.jwt())->>'aal','aal1')='aal2'
          and coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"totp"}]'::jsonb
        )
      )
      and 1=(select count(*) from auth.identities x where x.user_id=sm.user_id)
      and coalesce(
        (select o.allowed from public.staff_permission_overrides o
         where o.user_id=sm.user_id and o.permission_key=p_permission),
        exists (select 1 from public.staff_role_permissions rp
                where rp.role_key=sm.role_key and rp.permission_key=p_permission)
      )
  );
$$;
revoke execute on function public.has_staff_permission(text) from public;
grant execute on function public.has_staff_permission(text) to anon, authenticated;

create or replace function public.staff_mfa_enrollment_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.staff_memberships sm
    join auth.identities i on i.user_id=sm.user_id and i.provider='discord'
    join private.discord_owner_allowlist a
      on a.discord_user_id=coalesce(i.provider_id,i.identity_data->>'provider_id',i.identity_data->>'sub')
      and a.enabled and a.role_key=sm.role_key
    where sm.user_id=(select auth.uid()) and sm.status='active'
      and coalesce((select auth.jwt())->'app_metadata'->>'provider','')='discord'
      and coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"oauth"}]'::jsonb
      and 1=(select count(*) from auth.identities x where x.user_id=sm.user_id)
  );
$$;
revoke execute on function public.staff_mfa_enrollment_allowed() from public, anon, service_role;
grant execute on function public.staff_mfa_enrollment_allowed() to authenticated;

create or replace function public.staff_security_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_required boolean;
begin
  if not public.has_staff_permission('reports.read') then
    raise exception 'Staff permission required' using errcode='42501';
  end if;
  select staff_mfa_required into v_required
  from private.platform_security_settings where singleton;
  return jsonb_build_object(
    'staffMfaRequired',coalesce(v_required,false),
    'sessionAal',coalesce((select auth.jwt())->>'aal','aal1'),
    'totpVerified',coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"totp"}]'::jsonb,
    'isOwner',exists(select 1 from public.staff_memberships sm
      where sm.user_id=(select auth.uid()) and sm.role_key='owner' and sm.status='active')
  );
end;
$$;

create or replace function public.staff_activate_mfa_requirement(p_reason text,p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason,''));
begin
  if not public.has_staff_permission('staff.manage')
     or not exists (select 1 from public.staff_memberships where user_id=v_actor and role_key='owner' and status='active')
     or coalesce((select auth.jwt())->>'aal','aal1') <> 'aal2'
     or not (coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"totp"}]'::jsonb) then
    raise exception 'A protected owner AAL2 session is required' using errcode='42501';
  end if;
  if char_length(v_reason) not between 5 and 500 then raise exception 'A reason is required'; end if;
  update private.platform_security_settings
  set staff_mfa_required=true,changed_by=v_actor,changed_at=timezone('utc',now())
  where singleton;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
  values(v_actor,'staff.mfa.required','security_setting','staff_mfa_required',v_reason,nullif(p_request_id,''),
    jsonb_build_object('required',false),jsonb_build_object('required',true));
  return jsonb_build_object('staffMfaRequired',true);
end;
$$;

revoke execute on function public.staff_security_status(), public.staff_activate_mfa_requirement(text,text)
  from public, anon, service_role;
grant execute on function public.staff_security_status(), public.staff_activate_mfa_requirement(text,text)
  to authenticated;

create or replace function public.staff_mutate_permission(
  p_discord_user_id text,
  p_permission_key text,
  p_allowed boolean,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_target uuid;
  v_reason text := btrim(coalesce(p_reason,''));
  v_before jsonb;
  v_after jsonb;
begin
  if not public.has_staff_permission('staff.permissions.manage')
     or not exists (select 1 from public.staff_memberships where user_id=v_actor and role_key='owner' and status='active') then
    raise exception 'Owner permission required' using errcode='42501';
  end if;
  if p_discord_user_id !~ '^[0-9]{17,20}$' or char_length(v_reason) not between 5 and 500 then
    raise exception 'Invalid permission change';
  end if;
  if not exists (select 1 from public.permissions where key=p_permission_key)
     or p_permission_key in ('staff.manage','staff.permissions.manage','security.network.approve') then
    raise exception 'This permission cannot be delegated';
  end if;
  select i.user_id into v_target
  from auth.identities i
  join public.staff_memberships sm on sm.user_id=i.user_id
  where i.provider='discord'
    and coalesce(i.provider_id,i.identity_data->>'provider_id',i.identity_data->>'sub')=p_discord_user_id
    and sm.role_key<>'owner';
  if v_target is null then raise exception 'Staff account not found'; end if;
  select to_jsonb(o) into v_before from public.staff_permission_overrides o
  where o.user_id=v_target and o.permission_key=p_permission_key;
  if p_allowed is null then
    delete from public.staff_permission_overrides where user_id=v_target and permission_key=p_permission_key;
  else
    insert into public.staff_permission_overrides(user_id,permission_key,allowed,reason,changed_by)
    values(v_target,p_permission_key,p_allowed,v_reason,v_actor)
    on conflict(user_id,permission_key) do update set
      allowed=excluded.allowed, reason=excluded.reason, changed_by=excluded.changed_by,
      updated_at=timezone('utc',now());
  end if;
  select to_jsonb(o) into v_after from public.staff_permission_overrides o
  where o.user_id=v_target and o.permission_key=p_permission_key;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
  values(v_actor,'staff.permission.changed','staff_permission',v_target::text||':'||p_permission_key,
         v_reason,nullif(p_request_id,''),v_before,v_after);
  return jsonb_build_object('userId',v_target,'permission',p_permission_key,'allowed',p_allowed);
end;
$$;
revoke execute on function public.staff_mutate_permission(text,text,boolean,text,text) from public, anon, service_role;
grant execute on function public.staff_mutate_permission(text,text,boolean,text,text) to authenticated;

create or replace function public.staff_permission_control()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if not public.has_staff_permission('staff.permissions.manage')
     or not exists (select 1 from public.staff_memberships where user_id=v_actor and role_key='owner' and status='active') then
    raise exception 'Owner permission required' using errcode='42501';
  end if;
  return jsonb_build_object(
    'permissions',coalesce((select jsonb_agg(jsonb_build_object(
      'key',p.key,'description',p.description,'delegatable',
      p.key not in ('staff.manage','staff.permissions.manage','security.network.approve')
    ) order by p.key) from public.permissions p),'[]'::jsonb),
    'defaults',coalesce((select jsonb_agg(jsonb_build_object(
      'roleKey',rp.role_key,'permissionKey',rp.permission_key
    ) order by rp.role_key,rp.permission_key) from public.staff_role_permissions rp),'[]'::jsonb),
    'overrides',coalesce((select jsonb_agg(jsonb_build_object(
      'userId',o.user_id,'permissionKey',o.permission_key,'allowed',o.allowed,
      'reason',o.reason,'updatedAt',o.updated_at
    ) order by o.user_id,o.permission_key) from public.staff_permission_overrides o),'[]'::jsonb)
  );
end;
$$;
revoke execute on function public.staff_permission_control() from public, anon, service_role;
grant execute on function public.staff_permission_control() to authenticated;

create or replace function public.staff_account_activity(p_limit integer default 100)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.has_staff_permission('accounts.read') then
    coalesce(jsonb_agg(jsonb_build_object(
      'id',x.id,'userId',x.user_id,'displayName',x.display_name,'avatarUrl',x.avatar_url,
      'eventType',x.event_type,'provider',x.provider,'maskedNetwork',x.masked_network,
      'browser',x.browser_family,'os',x.os_family,'device',x.device_family,
      'createdAt',x.created_at
    ) order by x.created_at desc),'[]'::jsonb)
  else (select null::jsonb where false) end
  from (
    select a.*,p.display_name,p.avatar_url
    from public.account_activity a
    left join public.profiles p on p.id=a.user_id
    order by a.created_at desc
    limit least(greatest(coalesce(p_limit,100),1),250)
  ) x;
$$;
revoke execute on function public.staff_account_activity(integer) from public, anon, service_role;
grant execute on function public.staff_account_activity(integer) to authenticated;

create or replace function public.staff_profile_review_queue()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.has_staff_permission('profiles.review') then
    coalesce(jsonb_agg(jsonb_build_object(
      'userId',p.id,'displayName',p.display_name,'avatarUrl',p.avatar_url,'bio',p.bio,
      'avatarStatus',p.avatar_review_status,'bioStatus',p.bio_review_status,'joinedAt',p.joined_at
    ) order by p.joined_at),'[]'::jsonb)
  else (select null::jsonb where false) end
  from public.profiles p
  where p.avatar_review_status='pending_review' or p.bio_review_status='pending_review';
$$;

create or replace function public.staff_review_profile_content(
  p_user_id uuid,p_field text,p_action text,p_reason text,p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=(select auth.uid()); v_reason text:=btrim(coalesce(p_reason,'')); v_before jsonb; v_after jsonb;
begin
  if not public.has_staff_permission('profiles.review') then raise exception 'Profile-review permission required' using errcode='42501'; end if;
  if p_field not in ('avatar','bio') or p_action not in ('approve','reject') or char_length(v_reason) not between 5 and 500 then raise exception 'Invalid profile review'; end if;
  select jsonb_build_object('avatarStatus',avatar_review_status,'bioStatus',bio_review_status) into v_before
  from public.profiles where id=p_user_id for update;
  if v_before is null then raise exception 'Profile not found'; end if;
  if p_field='avatar' then
    update public.profiles set avatar_review_status=case when p_action='approve' then 'approved' else 'rejected' end,
      approved_avatar_url=case when p_action='approve' then avatar_url else null end where id=p_user_id;
  else
    update public.profiles set bio_review_status=case when p_action='approve' then 'approved' else 'rejected' end,
      approved_bio=case when p_action='approve' then bio else '' end where id=p_user_id;
  end if;
  select jsonb_build_object('avatarStatus',avatar_review_status,'bioStatus',bio_review_status) into v_after from public.profiles where id=p_user_id;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
  values(v_actor,'profile.'||p_field||'.'||p_action,'profile',p_user_id::text,v_reason,nullif(p_request_id,''),v_before,v_after);
  return jsonb_build_object('userId',p_user_id,'field',p_field,'status',case when p_action='approve' then 'approved' else 'rejected' end);
end;
$$;
revoke execute on function public.staff_profile_review_queue(), public.staff_review_profile_content(uuid,text,text,text,text)
  from public, anon, service_role;
grant execute on function public.staff_profile_review_queue(), public.staff_review_profile_content(uuid,text,text,text,text)
  to authenticated;

create or replace function public.staff_revoke_account_sessions(p_user_id uuid,p_reason text,p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason,''));
  v_count integer;
begin
  if not public.has_staff_permission('accounts.sessions.revoke') then
    raise exception 'Session-revocation permission required' using errcode='42501';
  end if;
  if p_user_id is null or char_length(v_reason) not between 10 and 500 then
    raise exception 'A target and a detailed reason are required';
  end if;
  if exists (select 1 from public.staff_memberships where user_id=p_user_id and role_key='owner' and status='active')
     and p_user_id<>v_actor then
    raise exception 'Only the protected owner can revoke the owner session' using errcode='42501';
  end if;
  delete from auth.sessions where user_id=p_user_id;
  get diagnostics v_count=row_count;
  insert into public.account_activity(user_id,event_type,provider,metadata)
  values(p_user_id,'auth.session_revoked','staff',jsonb_build_object('sessions',v_count));
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state)
  values(v_actor,'account.sessions.revoked','account',p_user_id::text,v_reason,nullif(p_request_id,''),jsonb_build_object('sessions',v_count));
  return jsonb_build_object('userId',p_user_id,'revokedSessions',v_count);
end;
$$;
revoke execute on function public.staff_revoke_account_sessions(uuid,text,text) from public, anon, service_role;
grant execute on function public.staff_revoke_account_sessions(uuid,text,text) to authenticated;

create or replace function public.staff_ban_control()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_staff_permission('bans.manage') then raise exception 'Ban-management permission required' using errcode='42501'; end if;
  return jsonb_build_object(
    'bans',coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'userId',b.user_id,'targetType',b.target_type,'reference',b.public_reference,
      'scope',b.scope,'reasonCode',b.reason_code,'reason',b.reason,'permanent',b.permanent,
      'createdAt',b.created_at,'revokedAt',b.revoked_at
    ) order by b.created_at desc) from public.security_bans b where b.revoked_at is null),'[]'::jsonb),
    'appeals',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'banId',a.ban_id,'reference',b.public_reference,'statement',a.statement,
      'contactEmail',a.contact_email,'status',a.status,'createdAt',a.created_at
    ) order by a.created_at desc)
    from public.security_ban_appeals a join public.security_bans b on b.id=a.ban_id
    where a.status in ('submitted','under_review')),'[]'::jsonb)
  );
end;
$$;

create or replace function public.staff_apply_security_ban(
  p_activity_id bigint,p_target_type text,p_scope text,p_reason_code text,p_reason text,p_permanent boolean,p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid:=(select auth.uid()); v_activity public.account_activity%rowtype; v_evidence private.network_evidence%rowtype;
  v_hash text; v_reference text; v_id uuid; v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.has_staff_permission('bans.manage') then raise exception 'Ban-management permission required' using errcode='42501'; end if;
  if p_target_type not in ('account','device','network_prefix') or p_scope not in ('platform','account','listing','community')
     or char_length(v_reason) not between 10 and 1000 or char_length(btrim(coalesce(p_reason_code,''))) not between 3 and 80 then raise exception 'Invalid ban request'; end if;
  select * into v_activity from public.account_activity where id=p_activity_id;
  select * into v_evidence from private.network_evidence where activity_id=p_activity_id;
  if v_activity.id is null then raise exception 'Activity record not found'; end if;
  if exists(select 1 from public.staff_memberships where user_id=v_activity.user_id and role_key='owner' and status='active') then raise exception 'The protected owner cannot be banned' using errcode='42501'; end if;
  v_hash:=case p_target_type
    when 'account' then pg_catalog.encode(extensions.digest(v_activity.user_id::text,'sha256'),'hex')
    when 'device' then v_evidence.device_hash else v_evidence.network_hash end;
  if v_hash is null then raise exception 'The required security signal is unavailable'; end if;
  loop
    v_reference:='BRP-'||upper(substr(pg_catalog.encode(extensions.gen_random_bytes(8),'hex'),1,10));
    exit when not exists(select 1 from public.security_bans where public_reference=v_reference);
  end loop;
  insert into public.security_bans(user_id,target_type,target_hash,public_reference,scope,reason_code,reason,permanent,actor_id)
  values(v_activity.user_id,p_target_type,v_hash,v_reference,p_scope,btrim(p_reason_code),v_reason,coalesce(p_permanent,true),v_actor)
  returning id into v_id;
  if v_activity.user_id is not null then delete from auth.sessions where user_id=v_activity.user_id; end if;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state)
  values(v_actor,'security.ban.applied','security_ban',v_id::text,v_reason,nullif(p_request_id,''),
    jsonb_build_object('reference',v_reference,'targetType',p_target_type,'scope',p_scope));
  return jsonb_build_object('id',v_id,'reference',v_reference,'targetType',p_target_type);
end;
$$;

create or replace function public.staff_decide_security_appeal(
  p_appeal_id uuid,p_approved boolean,p_reason text,p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=(select auth.uid()); v_appeal public.security_ban_appeals%rowtype; v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.has_staff_permission('appeals.review') or not public.has_staff_permission('bans.manage') then raise exception 'Appeal-review permission required' using errcode='42501'; end if;
  if char_length(v_reason) not between 10 and 1000 then raise exception 'A detailed decision reason is required'; end if;
  select * into v_appeal from public.security_ban_appeals where id=p_appeal_id for update;
  if v_appeal.id is null or v_appeal.status not in ('submitted','under_review') then raise exception 'Appeal is no longer open' using errcode='40001'; end if;
  update public.security_ban_appeals set status=case when p_approved then 'approved' else 'denied' end,
    reviewed_by=v_actor,decision_note=v_reason,updated_at=timezone('utc',now()) where id=p_appeal_id;
  if p_approved then update public.security_bans set revoked_at=timezone('utc',now()),revoked_by=v_actor,revoke_reason=v_reason where id=v_appeal.ban_id and revoked_at is null; end if;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state)
  values(v_actor,case when p_approved then 'security.appeal.approved' else 'security.appeal.denied' end,
    'security_ban_appeal',p_appeal_id::text,v_reason,nullif(p_request_id,''),jsonb_build_object('approved',p_approved));
  return jsonb_build_object('appealId',p_appeal_id,'status',case when p_approved then 'approved' else 'denied' end);
end;
$$;

create or replace function public.staff_revoke_security_ban(p_ban_id uuid,p_reason text,p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_reason text:=btrim(coalesce(p_reason,'')); v_reference text;
begin
  if not public.has_staff_permission('bans.manage') then raise exception 'Ban-management permission required' using errcode='42501'; end if;
  if char_length(v_reason) not between 10 and 500 then raise exception 'A detailed revocation reason is required'; end if;
  update public.security_bans set revoked_at=timezone('utc',now()),revoked_by=v_actor,revoke_reason=v_reason
  where id=p_ban_id and revoked_at is null returning public_reference into v_reference;
  if v_reference is null then raise exception 'Ban is no longer active' using errcode='40001'; end if;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state)
  values(v_actor,'security.ban.revoked','security_ban',p_ban_id::text,v_reason,nullif(p_request_id,''),jsonb_build_object('reference',v_reference));
  return jsonb_build_object('id',p_ban_id,'reference',v_reference,'status','revoked');
end;
$$;

revoke execute on function public.staff_ban_control(),
  public.staff_apply_security_ban(bigint,text,text,text,text,boolean,text),
  public.staff_decide_security_appeal(uuid,boolean,text,text),
  public.staff_revoke_security_ban(uuid,text,text) from public, anon, service_role;
grant execute on function public.staff_ban_control(),
  public.staff_apply_security_ban(bigint,text,text,text,text,boolean,text),
  public.staff_decide_security_appeal(uuid,boolean,text,text),
  public.staff_revoke_security_ban(uuid,text,text) to authenticated;

create or replace function public.staff_request_network_reveal(p_activity_id bigint,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_id uuid; v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.has_staff_permission('security.network.request') then
    raise exception 'Network-evidence request permission required' using errcode='42501';
  end if;
  if char_length(v_reason) not between 10 and 500
     or not exists(select 1 from public.account_activity where id=p_activity_id) then
    raise exception 'A valid activity and detailed reason are required';
  end if;
  insert into public.network_reveal_requests(activity_id,requested_by,reason)
  values(p_activity_id,v_actor,v_reason) returning id into v_id;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,after_state)
  values(v_actor,'network.reveal.requested','account_activity',p_activity_id::text,v_reason,jsonb_build_object('requestId',v_id));
  return jsonb_build_object('requestId',v_id,'status','pending');
end;
$$;

create or replace function public.staff_decide_network_reveal(p_request_id uuid,p_approved boolean,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_request public.network_reveal_requests%rowtype; v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.has_staff_permission('security.network.approve')
     or not exists(select 1 from public.staff_memberships where user_id=v_actor and role_key='owner' and status='active') then
    raise exception 'Owner approval required' using errcode='42501';
  end if;
  if char_length(v_reason) not between 10 and 500 then raise exception 'A detailed decision reason is required'; end if;
  select * into v_request from public.network_reveal_requests where id=p_request_id for update;
  if v_request.id is null or v_request.status<>'pending' then raise exception 'Reveal request is no longer pending' using errcode='40001'; end if;
  update public.network_reveal_requests set
    status=case when p_approved then 'approved' else 'denied' end,
    decided_by=v_actor,decision_reason=v_reason,decided_at=timezone('utc',now()),
    expires_at=case when p_approved then timezone('utc',now())+interval '10 minutes' else null end
  where id=p_request_id;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,after_state)
  values(v_actor,case when p_approved then 'network.reveal.approved' else 'network.reveal.denied' end,
    'network_reveal_request',p_request_id::text,v_reason,jsonb_build_object('approved',p_approved));
  return jsonb_build_object('requestId',p_request_id,'status',case when p_approved then 'approved' else 'denied' end);
end;
$$;

create or replace function public.staff_network_reveal_evidence(p_activity_id bigint,p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=(select auth.uid()); v_ciphertext text; v_is_owner boolean;
begin
  select exists(select 1 from public.staff_memberships where user_id=v_actor and role_key='owner' and status='active') into v_is_owner;
  if not public.has_staff_permission('security.network.approve') and not (
    public.has_staff_permission('security.network.request') and exists(
      select 1 from public.network_reveal_requests r
      where r.id=p_request_id and r.activity_id=p_activity_id and r.requested_by=v_actor
        and r.status='approved' and r.expires_at>timezone('utc',now()) and r.used_at is null
    )
  ) then raise exception 'Approved network-evidence request required' using errcode='42501'; end if;
  select network_ciphertext into v_ciphertext from private.network_evidence where activity_id=p_activity_id;
  if v_ciphertext is null then raise exception 'Protected network evidence is unavailable'; end if;
  if not v_is_owner then update public.network_reveal_requests set status='used',used_at=timezone('utc',now()) where id=p_request_id; end if;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,after_state)
  values(v_actor,'network.reveal.viewed','account_activity',p_activity_id::text,'Approved protected evidence view',jsonb_build_object('requestId',p_request_id));
  return jsonb_build_object('ciphertext',v_ciphertext);
end;
$$;

revoke execute on function public.staff_request_network_reveal(bigint,text),
  public.staff_decide_network_reveal(uuid,boolean,text),
  public.staff_network_reveal_evidence(bigint,uuid) from public, anon, service_role;
grant execute on function public.staff_request_network_reveal(bigint,text),
  public.staff_decide_network_reveal(uuid,boolean,text),
  public.staff_network_reveal_evidence(bigint,uuid) to authenticated;

create or replace function public.staff_network_reveal_control()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_owner boolean;
begin
  if not public.has_staff_permission('security.network.request')
     and not public.has_staff_permission('security.network.approve') then return '[]'::jsonb; end if;
  select exists(select 1 from public.staff_memberships sm
    where sm.user_id=v_actor and sm.role_key='owner' and sm.status='active') into v_owner;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'requestId',r.id,'activityId',r.activity_id,'requestedBy',r.requested_by,
    'requesterName',coalesce(p.display_name,'Staff member'),'maskedNetwork',a.masked_network,
    'reason',r.reason,'status',case when r.status='approved' and r.expires_at<=timezone('utc',now()) then 'expired' else r.status end,
    'decisionReason',r.decision_reason,'expiresAt',r.expires_at,'createdAt',r.created_at,
    'requestedByMe',r.requested_by=v_actor
  ) order by r.created_at desc)
  from public.network_reveal_requests r
  join public.account_activity a on a.id=r.activity_id
  left join public.profiles p on p.id=r.requested_by
  where (v_owner or r.requested_by=v_actor)
    and r.created_at>timezone('utc',now())-interval '90 days'),'[]'::jsonb);
end;
$$;
revoke execute on function public.staff_network_reveal_control() from public, anon, service_role;
grant execute on function public.staff_network_reveal_control() to authenticated;

create or replace function public.staff_comment_review_item(p_queue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_item jsonb;
begin
  if not public.has_staff_permission('moderation.read') then
    raise exception 'Moderation read permission required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'queueId',q.id,'commentId',c.id,'status',c.status,'body',c.body,
    'author',p.display_name,'server',s.name,'createdAt',c.created_at
  ) into v_item
  from public.moderation_queue q
  join public.server_comments c on q.target_type='server_comment' and q.target_id=c.id::text
  join public.profiles p on p.id=c.author_id
  join public.servers s on s.id=c.server_id
  where q.id=p_queue_id and q.status in ('open','claimed');
  if v_item is null then raise exception 'Comment review item not found'; end if;
  return v_item;
end;
$$;

create or replace function public.staff_resolve_comment_review(
  p_queue_id uuid,p_action text,p_reason text,p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid()); v_comment_id uuid; v_before jsonb; v_after jsonb;
  v_action text := lower(btrim(coalesce(p_action,''))); v_reason text := btrim(coalesce(p_reason,''));
begin
  if not public.has_staff_permission('moderation.resolve') then
    raise exception 'Moderation resolution permission required' using errcode='42501';
  end if;
  if v_action not in ('approve','reject','hide') or char_length(v_reason) not between 5 and 500 then
    raise exception 'A valid comment decision and reason are required';
  end if;
  select q.target_id::uuid into v_comment_id from public.moderation_queue q
  where q.id=p_queue_id and q.target_type='server_comment' and q.status in ('open','claimed') for update;
  if v_comment_id is null then raise exception 'Comment review item is no longer open' using errcode='40001'; end if;
  select to_jsonb(c) into v_before from public.server_comments c where c.id=v_comment_id for update;
  if v_before is null then raise exception 'Comment not found'; end if;
  update public.server_comments set
    status=case v_action when 'approve' then 'published' when 'reject' then 'rejected' else 'hidden' end,
    updated_at=timezone('utc',now()) where id=v_comment_id;
  update public.moderation_queue set status='resolved',assigned_to=v_actor,resolved_by=v_actor,
    resolution=v_reason,resolved_at=timezone('utc',now()) where id=p_queue_id;
  select to_jsonb(c) into v_after from public.server_comments c where c.id=v_comment_id;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
  values(v_actor,'comment.'||v_action,'server_comment',v_comment_id::text,v_reason,nullif(p_request_id,''),v_before,v_after);
  return jsonb_build_object('queueId',p_queue_id,'commentId',v_comment_id,'status',v_after->>'status');
end;
$$;
revoke execute on function public.staff_comment_review_item(uuid),
  public.staff_resolve_comment_review(uuid,text,text,text) from public, anon, service_role;
grant execute on function public.staff_comment_review_item(uuid),
  public.staff_resolve_comment_review(uuid,text,text,text) to authenticated;

create or replace function public.staff_advert_control()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.has_staff_permission('adverts.manage') then
    coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.name,'placement',a.placement,'headline',a.headline,
      'body',a.body,'ctaLabel',a.cta_label,'destinationUrl',a.destination_url,
      'status',a.status,'startsAt',a.starts_at,'endsAt',a.ends_at,
      'version',a.version,'updatedAt',a.updated_at
    ) order by a.updated_at desc),'[]'::jsonb)
  else (select null::jsonb where false) end
  from public.ad_campaigns a;
$$;

create or replace function public.staff_mutate_advert(
  p_id uuid,p_action text,p_name text,p_placement text,p_headline text,p_body text,
  p_cta_label text,p_destination_url text,p_starts_at timestamptz,p_ends_at timestamptz,
  p_expected_version bigint,p_reason text,p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid:=(select auth.uid()); v_id uuid; v_action text:=lower(btrim(coalesce(p_action,'')));
  v_reason text:=btrim(coalesce(p_reason,'')); v_before jsonb; v_after jsonb;
begin
  if not public.has_staff_permission('adverts.manage') then raise exception 'Advert-management permission required' using errcode='42501'; end if;
  if v_action not in ('save','activate','pause','archive') or char_length(v_reason) not between 5 and 500 then raise exception 'Invalid advert action'; end if;
  if v_action in ('save','activate') then
    if char_length(btrim(coalesce(p_name,''))) not between 3 and 100
       or p_placement not in ('top','side','directory','server_detail')
       or char_length(btrim(coalesce(p_headline,''))) not between 3 and 100
       or char_length(btrim(coalesce(p_body,''))) not between 10 and 300
       or char_length(btrim(coalesce(p_cta_label,''))) not between 2 and 40
       or not ((left(coalesce(p_destination_url,''),1)='/' and left(coalesce(p_destination_url,''),2)<>'//') or coalesce(p_destination_url,'') ~* '^https://')
       or (p_ends_at is not null and p_starts_at is not null and p_ends_at<=p_starts_at) then
      raise exception 'Invalid advert content';
    end if;
  end if;
  if p_id is null then
    if v_action not in ('save','activate') or coalesce(p_expected_version,0)<>0 then raise exception 'Invalid new advert'; end if;
    insert into public.ad_campaigns(owner_id,name,placement,headline,body,cta_label,destination_url,
      credit_budget,status,starts_at,ends_at,created_by)
    values(v_actor,btrim(p_name),p_placement,btrim(p_headline),btrim(p_body),btrim(p_cta_label),
      btrim(p_destination_url),1,case when v_action='activate' then 'active' else 'draft' end,
      p_starts_at,p_ends_at,v_actor) returning id into v_id;
  else
    select to_jsonb(a) into v_before from public.ad_campaigns a where a.id=p_id for update;
    if v_before is null then raise exception 'Advert not found'; end if;
    if coalesce((v_before->>'version')::bigint,0)<>p_expected_version then raise exception 'Advert changed; reload first' using errcode='40001'; end if;
    update public.ad_campaigns set
      name=case when v_action in ('save','activate') then btrim(p_name) else name end,
      placement=case when v_action in ('save','activate') then p_placement else placement end,
      headline=case when v_action in ('save','activate') then btrim(p_headline) else headline end,
      body=case when v_action in ('save','activate') then btrim(p_body) else body end,
      cta_label=case when v_action in ('save','activate') then btrim(p_cta_label) else cta_label end,
      destination_url=case when v_action in ('save','activate') then btrim(p_destination_url) else destination_url end,
      starts_at=case when v_action in ('save','activate') then p_starts_at else starts_at end,
      ends_at=case when v_action in ('save','activate') then p_ends_at else ends_at end,
      status=case v_action when 'activate' then 'active' when 'pause' then 'paused' when 'archive' then 'completed' else 'draft' end,
      version=version+1,updated_at=timezone('utc',now()) where id=p_id returning id into v_id;
  end if;
  select to_jsonb(a) into v_after from public.ad_campaigns a where a.id=v_id;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
  values(v_actor,'advert.'||v_action,'advert',v_id::text,v_reason,nullif(p_request_id,''),v_before,v_after);
  return v_after;
end;
$$;

create or replace function public.staff_blog_control()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.has_staff_permission('blogs.manage') then
    coalesce(jsonb_agg(jsonb_build_object(
      'id',b.id,'title',b.title,'slug',b.slug,'excerpt',b.excerpt,'body',b.body_markdown,
      'status',b.status,'seoTitle',b.seo_title,'seoDescription',b.seo_description,
      'publishedAt',b.published_at,'updatedAt',b.updated_at
    ) order by b.updated_at desc),'[]'::jsonb)
  else (select null::jsonb where false) end
  from public.blog_posts b;
$$;

create or replace function public.staff_mutate_blog(
  p_id uuid,p_action text,p_title text,p_slug text,p_excerpt text,p_body text,
  p_seo_title text,p_seo_description text,p_reason text,p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid:=(select auth.uid()); v_id uuid; v_action text:=lower(btrim(coalesce(p_action,'')));
  v_reason text:=btrim(coalesce(p_reason,'')); v_before jsonb; v_after jsonb;
begin
  if not public.has_staff_permission('blogs.manage') then raise exception 'Blog-management permission required' using errcode='42501'; end if;
  if v_action not in ('save','publish','archive') or char_length(v_reason) not between 5 and 500 then raise exception 'Invalid blog action'; end if;
  if v_action in ('save','publish') and (
    char_length(btrim(coalesce(p_title,''))) not between 3 and 140
    or coalesce(p_slug,'') !~ '^[a-z0-9-]{3,160}$'
    or char_length(btrim(coalesce(p_excerpt,''))) not between 20 and 400
    or char_length(btrim(coalesce(p_body,''))) not between 80 and 20000
    or char_length(btrim(coalesce(p_seo_title,''))) not between 10 and 160
    or char_length(btrim(coalesce(p_seo_description,''))) not between 40 and 300
  ) then raise exception 'Invalid blog content'; end if;
  if p_id is null then
    if v_action not in ('save','publish') then raise exception 'Invalid new blog'; end if;
    insert into public.blog_posts(author_id,title,slug,excerpt,body_markdown,status,seo_title,seo_description,published_at)
    values(v_actor,btrim(p_title),p_slug,btrim(p_excerpt),btrim(p_body),case when v_action='publish' then 'published' else 'draft' end,
      btrim(p_seo_title),btrim(p_seo_description),case when v_action='publish' then timezone('utc',now()) else null end)
    returning id into v_id;
  else
    select to_jsonb(b) into v_before from public.blog_posts b where b.id=p_id for update;
    if v_before is null then raise exception 'Blog post not found'; end if;
    update public.blog_posts set
      title=case when v_action in ('save','publish') then btrim(p_title) else title end,
      slug=case when v_action in ('save','publish') then p_slug else slug end,
      excerpt=case when v_action in ('save','publish') then btrim(p_excerpt) else excerpt end,
      body_markdown=case when v_action in ('save','publish') then btrim(p_body) else body_markdown end,
      seo_title=case when v_action in ('save','publish') then btrim(p_seo_title) else seo_title end,
      seo_description=case when v_action in ('save','publish') then btrim(p_seo_description) else seo_description end,
      status=case v_action when 'publish' then 'published' when 'archive' then 'archived' else 'draft' end,
      published_at=case when v_action='publish' then coalesce(published_at,timezone('utc',now())) when v_action='archive' then published_at else null end,
      updated_at=timezone('utc',now()) where id=p_id returning id into v_id;
  end if;
  select to_jsonb(b) into v_after from public.blog_posts b where b.id=v_id;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
  values(v_actor,'blog.'||v_action,'blog_post',v_id::text,v_reason,nullif(p_request_id,''),v_before,v_after);
  return v_after;
end;
$$;

revoke execute on function public.staff_advert_control(), public.staff_blog_control(),
  public.staff_mutate_advert(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,bigint,text,text),
  public.staff_mutate_blog(uuid,text,text,text,text,text,text,text,text,text) from public, anon, service_role;
grant execute on function public.staff_advert_control(), public.staff_blog_control(),
  public.staff_mutate_advert(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,bigint,text,text),
  public.staff_mutate_blog(uuid,text,text,text,text,text,text,text,text,text) to authenticated;

create or replace function public.public_server_engagement(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'serverId',s.id,'slug',s.slug,'accessType',s.access_type,
    'cfxJoinUrl',case when s.cfx_join_url ~* '^https://cfx\.re/join/[a-z0-9]{3,32}/?$' then s.cfx_join_url else null end,
    'animatedMediaEnabled',s.animated_media_enabled,
    'voteCount',(select count(*) from public.server_votes v where v.server_id=s.id),
    'comments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'body',c.body,'createdAt',c.created_at,'author',p.display_name,
      'avatarUrl',case when p.avatar_review_status='approved' then p.approved_avatar_url else null end
    ) order by c.created_at desc)
    from public.server_comments c join public.profiles p on p.id=c.author_id
    where c.server_id=s.id and c.status='published'),'[]'::jsonb)
  )
  from public.servers s where s.slug=lower(btrim(p_slug)) and s.status='published' and s.age_rating<>'adult' limit 1;
$$;

create or replace function public.member_server_interaction(
  p_server_id uuid,p_action text,p_body text default null,p_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid:=(select auth.uid()); v_id uuid; v_action text:=lower(btrim(coalesce(p_action,'')));
begin
  if v_user is null then raise exception 'Sign in to continue' using errcode='42501'; end if;
  if not exists(select 1 from public.servers where id=p_server_id and status='published' and age_rating<>'adult') then raise exception 'Server not found'; end if;
  if v_action='vote' then
    insert into public.server_votes(server_id,user_id) values(p_server_id,v_user) on conflict do nothing;
    return jsonb_build_object('voted',true,'voteCount',(select count(*) from public.server_votes where server_id=p_server_id));
  elsif v_action='unvote' then
    delete from public.server_votes where server_id=p_server_id and user_id=v_user;
    return jsonb_build_object('voted',false,'voteCount',(select count(*) from public.server_votes where server_id=p_server_id));
  elsif v_action='comment' then
    if char_length(btrim(coalesce(p_body,''))) not between 3 and 1000 then raise exception 'Comment must be between 3 and 1,000 characters'; end if;
    insert into public.server_comments(server_id,author_id,body) values(p_server_id,v_user,btrim(p_body)) returning id into v_id;
    insert into public.moderation_queue(target_type,target_id,confidence,score,reasons)
    values('server_comment',v_id::text,'review_recommended',40,'["member_comment"]'::jsonb);
    return jsonb_build_object('id',v_id,'status','pending_review');
  elsif v_action='report' then
    if char_length(btrim(coalesce(p_body,''))) not between 20 and 2000 or char_length(btrim(coalesce(p_category,''))) not between 3 and 80 then raise exception 'A report category and details are required'; end if;
    insert into public.reports(reporter_id,target_type,target_id,category,details)
    values(v_user,'server',p_server_id::text,btrim(p_category),btrim(p_body)) returning id into v_id;
    return jsonb_build_object('id',v_id,'status','open');
  end if;
  raise exception 'Invalid server action';
end;
$$;

revoke execute on function public.public_server_engagement(text), public.member_server_interaction(uuid,text,text,text) from public;
grant execute on function public.public_server_engagement(text) to anon, authenticated, service_role;
grant execute on function public.member_server_interaction(uuid,text,text,text) to authenticated;

create or replace function public.public_advertisements(p_placement text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'placement',a.placement,'headline',a.headline,'body',a.body,
    'ctaLabel',a.cta_label,'destinationUrl',a.destination_url,'name',a.name
  ) order by a.starts_at nulls first,a.created_at desc),'[]'::jsonb)
  from public.ad_campaigns a
  where a.status='active'
    and a.placement=p_placement
    and (a.starts_at is null or a.starts_at<=timezone('utc',now()))
    and (a.ends_at is null or a.ends_at>timezone('utc',now()));
$$;
revoke execute on function public.public_advertisements(text) from public;
grant execute on function public.public_advertisements(text) to anon, authenticated, service_role;

create or replace function public.public_blog_index()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',b.id,'title',b.title,'slug',b.slug,'excerpt',b.excerpt,
    'seoTitle',b.seo_title,'seoDescription',b.seo_description,'publishedAt',b.published_at
  ) order by b.published_at desc),'[]'::jsonb)
  from public.blog_posts b where b.status='published' and b.published_at<=timezone('utc',now());
$$;

create or replace function public.public_blog_post(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id',b.id,'title',b.title,'slug',b.slug,'excerpt',b.excerpt,'body',b.body_markdown,
    'seoTitle',b.seo_title,'seoDescription',b.seo_description,'publishedAt',b.published_at
  ) from public.blog_posts b
  where b.status='published' and b.slug=p_slug and b.published_at<=timezone('utc',now()) limit 1;
$$;
revoke execute on function public.public_blog_index(), public.public_blog_post(text) from public;
grant execute on function public.public_blog_index(), public.public_blog_post(text) to anon, authenticated, service_role;

insert into public.ad_campaigns(
  owner_id,name,placement,headline,body,cta_label,destination_url,credit_budget,status,created_by
)
select sm.user_id,'BrowseRP house advert','top','Advertise your FiveM community here',
  'Place a reviewed campaign across BrowseRP without disrupting the server directory.',
  'Advertising options','/advertise',1,'active',sm.user_id
from public.staff_memberships sm
where sm.role_key='owner' and sm.status='active'
  and not exists(select 1 from public.ad_campaigns where name='BrowseRP house advert' and placement='top');

insert into public.ad_campaigns(
  owner_id,name,placement,headline,body,cta_label,destination_url,credit_budget,status,created_by
)
select sm.user_id,'BrowseRP side house advert','side','Put your server in front of roleplayers',
  'Personalised advert placements are reviewed before they go live.',
  'Find out more','/advertise',1,'active',sm.user_id
from public.staff_memberships sm
where sm.role_key='owner' and sm.status='active'
  and not exists(select 1 from public.ad_campaigns where name='BrowseRP side house advert' and placement='side');

-- Seed one factual SEO article from the protected owner. It contains no fake
-- listings or unverifiable performance claims.
insert into public.blog_posts (
  author_id,title,slug,excerpt,body_markdown,status,seo_title,seo_description,published_at
)
select sm.user_id,
  'How to choose a FiveM roleplay server in 2026',
  'how-to-choose-a-fivem-roleplay-server',
  'A practical checklist for comparing FiveM roleplay communities by style, access, region and expectations.',
  E'# How to choose a FiveM roleplay server\n\nThe best FiveM server is the one that matches how you want to roleplay. Start with the basics: region, language, access type and the time you normally play. A busy server in another time zone may feel empty when you are online.\n\n## Decide how serious you want the roleplay to be\n\nSerious roleplay communities normally expect detailed characters, consistent behaviour and familiarity with their rules. Semi-serious and beginner-friendly servers can be easier places to learn. Neither style is automatically better; the important point is choosing a community that describes its expectations honestly.\n\n## Check access and onboarding\n\nPublic servers let players join quickly. Allowlisted or application-based communities usually require an introduction or character application first. Read the server requirements before joining and never share passwords, authentication tokens or personal documents with a community.\n\n## Compare the features that matter to you\n\nUseful tags include economy, custom jobs, player-owned businesses, police, EMS, gangs and custom clothing. Treat long feature lists as a starting point, then read the full listing and community rules.\n\n## Look for clear ownership and safety information\n\nA complete listing should explain who the community is for, link to a normal HTTPS community destination and avoid exaggerated promises. Report listings that impersonate another community, promote harassment, use unsafe downloads or ask for credentials.\n\nBrowseRP is building a reviewed FiveM directory where players can compare those details in one place and server owners can present their communities clearly.',
  'published',
  'How to choose a FiveM roleplay server in 2026 | BrowseRP',
  'Compare FiveM roleplay servers by region, access, roleplay style, framework and community safety before choosing where to play.',
  timezone('utc',now())
from public.staff_memberships sm
where sm.role_key='owner' and sm.status='active'
on conflict (slug) do nothing;

commit;
