-- BrowseRP clean-slate production schema.
-- This migration is intentionally designed for a brand-new Supabase project.

begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'This ledger is append-only';
end;
$$;

create table public.platforms (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name text not null unique check (char_length(name) between 2 and 80),
  short_name text not null check (char_length(short_name) between 1 and 8),
  description text not null default '',
  accent text not null default '#625bf6' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  adapter_key text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.categories (
  id uuid primary key default extensions.gen_random_uuid(),
  platform_id text references public.platforms(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  slug text not null check (slug ~ '^[a-z0-9-]{2,70}$'),
  description text not null default '',
  icon_key text not null default 'spark',
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique nulls not distinct (platform_id, slug)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null check (char_length(display_name) between 2 and 48),
  avatar_url text,
  bio text not null default '' check (char_length(bio) <= 500),
  profile_visibility text not null default 'public' check (profile_visibility in ('public', 'members', 'private')),
  imported_identity_reviewed boolean not null default false,
  joined_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.staff_roles (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  name text not null unique,
  description text not null,
  rank integer not null unique check (rank between 1 and 1000),
  protected boolean not null default false
);

create table public.permissions (
  key text primary key check (key ~ '^[a-z0-9_.]{3,80}$'),
  description text not null
);

create table public.staff_role_permissions (
  role_key text not null references public.staff_roles(key) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_key, permission_key)
);

create table public.staff_memberships (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role_key text not null references public.staff_roles(key),
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default timezone('utc', now()),
  reason text not null check (char_length(reason) between 3 and 500),
  updated_at timestamptz not null default timezone('utc', now())
);

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
    join public.staff_role_permissions srp on srp.role_key = sm.role_key
    where sm.user_id = (select auth.uid())
      and sm.status = 'active'
      and srp.permission_key = p_permission
  );
$$;

create table public.badges (
  id uuid primary key default extensions.gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{2,50}$'),
  name text not null,
  description text not null,
  icon_key text not null default 'badge',
  color text not null default '#625bf6',
  system_managed boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.user_badges (
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_id uuid not null references public.badges(id) on delete cascade,
  awarded_by uuid references public.profiles(id) on delete set null,
  reason text not null default 'System award',
  awarded_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  primary key (user_id, badge_id)
);

create table public.account_trust (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  trust_score numeric(5,2) not null default 50 check (trust_score between 0 and 100),
  verified_server_owner boolean not null default false,
  verified_developer boolean not null default false,
  restricted_until timestamptz,
  restriction_reason text,
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.servers (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete set null,
  platform_id text not null references public.platforms(id),
  name text not null check (char_length(name) between 3 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,100}$'),
  description text not null check (char_length(description) between 40 and 3000),
  region text not null check (char_length(region) between 2 and 60),
  language text not null default 'English' check (char_length(language) between 2 and 60),
  framework text check (char_length(framework) <= 80),
  community_url text,
  website_url text,
  age_rating text not null default 'general' check (age_rating in ('general', 'teen', 'adult')),
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'published', 'suspended', 'rejected', 'archived')),
  verified boolean not null default false,
  beginner_friendly boolean not null default false,
  quality_score numeric(5,2) not null default 50 check (quality_score between 0 and 100),
  engagement_score numeric(5,2) not null default 50 check (engagement_score between 0 and 100),
  theme_start text not null default '#252b4a',
  theme_end text not null default '#625bf6',
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.server_tags (
  server_id uuid not null references public.servers(id) on delete cascade,
  tag text not null check (char_length(tag) between 2 and 40),
  source text not null default 'owner' check (source in ('owner', 'staff', 'system')),
  relevance_score numeric(5,2) not null default 50 check (relevance_score between 0 and 100),
  primary key (server_id, tag)
);

create table public.server_categories (
  server_id uuid not null references public.servers(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  relevance_score numeric(5,2) not null default 50 check (relevance_score between 0 and 100),
  primary key (server_id, category_id)
);

create table public.server_endpoints (
  server_id uuid primary key references public.servers(id) on delete cascade,
  endpoint_encrypted text,
  adapter_key text,
  verification_token_hash text,
  verified_at timestamptz,
  last_check_at timestamptz,
  failure_count integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.server_status_snapshots (
  id bigint generated always as identity primary key,
  server_id uuid not null references public.servers(id) on delete cascade,
  online boolean not null,
  players integer not null default 0 check (players >= 0),
  capacity integer not null default 0 check (capacity >= 0),
  latency_ms integer check (latency_ms >= 0),
  provider_status text not null default 'ok',
  checked_at timestamptz not null default timezone('utc', now())
);

create table public.server_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  submitted_by uuid not null references public.profiles(id) on delete cascade,
  platform_id text not null references public.platforms(id),
  name text not null,
  region text not null,
  language text not null default 'English',
  framework text,
  description text not null,
  community_url text,
  moderation_confidence text not null check (moderation_confidence in ('safe', 'likely_safe', 'review_recommended', 'high_risk', 'blocked')),
  moderation_score integer not null check (moderation_score between 0 and 100),
  moderation_reasons jsonb not null default '[]'::jsonb,
  status text not null default 'pending_review' check (status in ('pending_review', 'changes_requested', 'approved', 'rejected', 'withdrawn')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, server_id)
);

create table public.reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  title text not null check (char_length(title) between 3 and 100),
  body text not null check (char_length(body) between 20 and 1500),
  status text not null default 'pending_review' check (status in ('pending_review', 'published', 'hidden', 'rejected')),
  moderation_confidence text not null default 'likely_safe',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (server_id, author_id)
);

create table public.review_reactions (
  review_id uuid not null references public.reviews(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('helpful', 'not_helpful')),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (review_id, user_id)
);

create table public.boosts (
  id uuid primary key default extensions.gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('daily_free', 'promotion_credit', 'staff_grant')),
  amount integer not null default 1 check (amount between 1 and 100),
  boost_date date not null default (timezone('utc', now())::date),
  created_at timestamptz not null default timezone('utc', now())
);

create unique index boosts_one_free_per_server_day
  on public.boosts (server_id, actor_id, boost_date)
  where source = 'daily_free';

create table public.promotion_products (
  key text primary key,
  name text not null,
  description text not null,
  credit_amount integer not null check (credit_amount > 0),
  unit_amount integer not null check (unit_amount > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  stripe_price_id text unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.promotion_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  product_key text not null references public.promotion_products(key),
  quantity integer not null check (quantity between 1 and 10),
  amount_total integer not null check (amount_total >= 0),
  currency text not null,
  stripe_event_id text not null unique,
  stripe_session_id text not null unique,
  status text not null default 'paid' check (status in ('paid', 'refunded', 'partially_refunded', 'disputed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.promotion_credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete restrict,
  delta integer not null check (delta <> 0),
  reason text not null check (char_length(reason) between 3 and 200),
  source_type text not null check (source_type in ('purchase', 'boost_spend', 'refund', 'staff_adjustment', 'expiry')),
  source_id text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (source_type, source_id)
);

create table public.ad_campaigns (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  server_id uuid references public.servers(id) on delete cascade,
  name text not null check (char_length(name) between 3 and 100),
  placement text not null check (placement in ('directory', 'platform', 'resource')),
  image_asset_id uuid,
  destination_url text not null,
  credit_budget integer not null check (credit_budget > 0),
  credits_spent integer not null default 0 check (credits_spent >= 0),
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'scheduled', 'active', 'paused', 'completed', 'rejected')),
  starts_at timestamptz,
  ends_at timestamptz,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.developer_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  headline text not null check (char_length(headline) between 3 and 120),
  about text not null check (char_length(about) between 40 and 2000),
  specialties text[] not null default '{}',
  portfolio_url text,
  verified boolean not null default false,
  status text not null default 'pending_review' check (status in ('pending_review', 'published', 'suspended', 'rejected')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.developer_services (
  id uuid primary key default extensions.gen_random_uuid(),
  developer_id uuid not null references public.developer_profiles(user_id) on delete cascade,
  title text not null check (char_length(title) between 3 and 100),
  summary text not null check (char_length(summary) between 20 and 600),
  service_type text not null,
  pricing_note text,
  status text not null default 'pending_review' check (status in ('draft', 'pending_review', 'published', 'hidden', 'rejected')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.resources (
  id uuid primary key default extensions.gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  platform_id text references public.platforms(id) on delete set null,
  title text not null check (char_length(title) between 3 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,140}$'),
  summary text not null check (char_length(summary) between 20 and 500),
  body_markdown text not null check (char_length(body_markdown) between 40 and 50000),
  resource_type text not null check (resource_type in ('guide', 'template', 'config', 'tool', 'reference')),
  download_asset_id uuid,
  status text not null default 'pending_review' check (status in ('draft', 'pending_review', 'published', 'hidden', 'rejected')),
  download_count bigint not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.resource_downloads (
  id bigint generated always as identity primary key,
  resource_id uuid not null references public.resources(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  anonymous_session_hash text,
  downloaded_at timestamptz not null default timezone('utc', now())
);

create table public.reports (
  id uuid primary key default extensions.gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('profile', 'server', 'review', 'developer_service', 'resource', 'advertisement')),
  target_id text not null,
  category text not null,
  details text not null check (char_length(details) between 20 and 2000),
  status text not null default 'open' check (status in ('open', 'triaged', 'resolved', 'dismissed')),
  assigned_to uuid references public.profiles(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.moderation_queue (
  id uuid primary key default extensions.gen_random_uuid(),
  target_type text not null,
  target_id text not null,
  confidence text not null check (confidence in ('safe', 'likely_safe', 'review_recommended', 'high_risk', 'blocked')),
  score integer not null check (score between 0 and 100),
  reasons jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'claimed', 'resolved', 'dismissed')),
  assigned_to uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution text,
  created_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  unique (target_type, target_id)
);

create table public.bans (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  scope text not null check (scope in ('account', 'listing', 'community', 'developer', 'staff')),
  reason_code text not null,
  reason text not null check (char_length(reason) between 10 and 1000),
  evidence jsonb not null default '[]'::jsonb,
  starts_at timestamptz not null default timezone('utc', now()),
  ends_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoke_reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.ban_appeals (
  id uuid primary key default extensions.gen_random_uuid(),
  ban_id uuid not null references public.bans(id) on delete cascade,
  appellant_id uuid not null references public.profiles(id) on delete cascade,
  statement text not null check (char_length(statement) between 40 and 3000),
  status text not null default 'submitted' check (status in ('submitted', 'under_review', 'approved', 'denied', 'withdrawn')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  decision_note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (ban_id, appellant_id)
);

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.security_events (
  id bigint generated always as identity primary key,
  severity text not null check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  event_type text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  network_hash text,
  user_agent_family text,
  details jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.staff_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text not null,
  reason text not null check (char_length(reason) between 3 and 1000),
  request_id text,
  network_hash text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.applications (
  id uuid primary key default extensions.gen_random_uuid(),
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  application_type text not null check (application_type in ('staff', 'verified_developer', 'advertisement', 'server_verification')),
  answers jsonb not null,
  status text not null default 'submitted' check (status in ('submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'withdrawn')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  decision_note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.uploaded_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  bucket text not null,
  object_path text not null unique,
  media_type text not null check (media_type in ('avatar', 'server_logo', 'server_banner', 'advertisement', 'resource')),
  mime_type text not null,
  byte_size bigint not null check (byte_size between 1 and 10485760),
  sha256 text not null,
  moderation_status text not null default 'quarantined' check (moderation_status in ('quarantined', 'scanning', 'approved', 'rejected')),
  moderation_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);

alter table public.ad_campaigns
  add constraint ad_campaigns_image_asset_fk foreign key (image_asset_id) references public.uploaded_assets(id) on delete set null;
alter table public.resources
  add constraint resources_download_asset_fk foreign key (download_asset_id) references public.uploaded_assets(id) on delete set null;

create table public.tool_events (
  id bigint generated always as identity primary key,
  tool_key text not null,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null default 'execute',
  occurred_on date not null default (timezone('utc', now())::date),
  created_at timestamptz not null default timezone('utc', now())
);

create table public.blog_posts (
  id uuid primary key default extensions.gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 3 and 140),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,160}$'),
  excerpt text not null check (char_length(excerpt) between 20 and 400),
  body_markdown text not null,
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  seo_title text,
  seo_description text,
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.rate_limit_buckets (
  key_hash text not null,
  action text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (key_hash, action)
);

create table public.system_settings (
  key text primary key,
  value jsonb not null,
  description text not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table private.secrets (
  key text primary key,
  secret_hash text not null,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Helpful indexes for primary application paths.
create index servers_directory_idx on public.servers (status, age_rating, platform_id, published_at desc);
create index server_tags_search_idx on public.server_tags using gin (to_tsvector('simple', tag));
create index status_latest_idx on public.server_status_snapshots (server_id, checked_at desc);
create index submissions_queue_idx on public.server_submissions (status, created_at);
create index moderation_queue_idx on public.moderation_queue (status, score desc, created_at);
create index reports_queue_idx on public.reports (status, created_at);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);
create index audit_actor_idx on public.staff_audit_events (actor_id, created_at desc);
create index security_open_idx on public.security_events (severity, resolved_at, created_at desc);
create index downloads_resource_idx on public.resource_downloads (resource_id, downloaded_at desc);
create index tools_daily_idx on public.tool_events (tool_key, occurred_on);

-- Seed configurable platform, category, permission, badge and promotion data.
insert into public.platforms (id, name, short_name, description, accent, adapter_key, sort_order) values
  ('fivem', 'FiveM', '5M', 'GTA V community roleplay servers.', '#625bf6', 'cfx', 10),
  ('redm', 'RedM', 'RM', 'Red Dead Redemption 2 community roleplay servers.', '#b76a3a', 'cfx', 20),
  ('minecraft', 'Minecraft', 'MC', 'Minecraft storytelling and roleplay worlds.', '#3d8c61', 'minecraft', 30),
  ('roblox', 'Roblox', 'RX', 'Roblox roleplay experiences and communities.', '#eb5b63', 'roblox', 40),
  ('gmod', 'Garry''s Mod', 'GM', 'Garry''s Mod roleplay servers.', '#3c78d8', 'source', 50),
  ('arma', 'ARMA', 'AR', 'Structured military and civilian roleplay communities.', '#7d875b', 'steam', 60),
  ('vrchat', 'VRChat', 'VR', 'Social and world-based roleplay communities.', '#1784d5', 'manual', 70),
  ('dayz', 'DayZ', 'DZ', 'Survival roleplay communities.', '#63735c', 'steam', 80),
  ('project-zomboid', 'Project Zomboid', 'PZ', 'Collaborative survival storytelling.', '#6e6571', 'steam', 90),
  ('ets2', 'Euro Truck Simulator', 'ET', 'Virtual logistics and simulation communities.', '#d28a2d', 'truckersmp', 100);

insert into public.categories (platform_id, name, slug, description, icon_key, sort_order) values
  (null, 'Serious roleplay', 'serious-roleplay', 'Character-first communities with structured expectations.', 'shield', 10),
  (null, 'Beginner friendly', 'beginner-friendly', 'Communities with clear onboarding for newer players.', 'spark', 20),
  (null, 'Fantasy', 'fantasy', 'Fantasy settings and collaborative worldbuilding.', 'wand', 30),
  (null, 'Science fiction', 'science-fiction', 'Futuristic and space-based settings.', 'orbit', 40),
  (null, 'City life', 'city-life', 'Modern city, economy and public-service roleplay.', 'city', 50),
  (null, 'Simulation', 'simulation', 'Grounded vehicle, logistics and life simulation.', 'route', 60),
  (null, 'Survival', 'survival', 'Cooperative survival storytelling.', 'compass', 70),
  (null, 'Community events', 'community-events', 'Event-led and creator-led communities.', 'calendar', 80);

insert into public.staff_roles (key, name, description, rank, protected) values
  ('support', 'Support', 'Handles member questions and first-line reports.', 100, false),
  ('moderator', 'Moderator', 'Reviews content, reports and routine enforcement.', 300, false),
  ('senior_moderator', 'Senior moderator', 'Handles escalations and appeal preparation.', 500, false),
  ('administrator', 'Administrator', 'Manages platform configuration and staff operations.', 800, true),
  ('owner', 'Owner', 'Highest-trust emergency and governance access.', 1000, true);

insert into public.permissions (key, description) values
  ('reports.read', 'Read the report queue.'),
  ('reports.resolve', 'Resolve or dismiss reports.'),
  ('moderation.read', 'Read the moderation queue.'),
  ('moderation.resolve', 'Resolve moderation cases.'),
  ('servers.review', 'Review listing submissions.'),
  ('servers.enforce', 'Suspend or restore server listings.'),
  ('users.enforce', 'Apply member restrictions and bans.'),
  ('appeals.review', 'Review ban appeals.'),
  ('developers.verify', 'Review developer verification.'),
  ('advertising.review', 'Review advertisements and campaigns.'),
  ('security.read', 'Read privacy-preserving security signals.'),
  ('security.reveal', 'Request tightly controlled sensitive reveals.'),
  ('staff.manage', 'Manage staff memberships.'),
  ('settings.manage', 'Manage platform settings.'),
  ('audit.read', 'Read staff audit events.');

insert into public.staff_role_permissions (role_key, permission_key)
select 'support', key from public.permissions where key in ('reports.read');
insert into public.staff_role_permissions (role_key, permission_key)
select 'moderator', key from public.permissions where key in ('reports.read','reports.resolve','moderation.read','moderation.resolve','servers.review');
insert into public.staff_role_permissions (role_key, permission_key)
select 'senior_moderator', key from public.permissions where key in ('reports.read','reports.resolve','moderation.read','moderation.resolve','servers.review','servers.enforce','users.enforce','appeals.review','developers.verify','advertising.review','audit.read');
insert into public.staff_role_permissions (role_key, permission_key)
select 'administrator', key from public.permissions where key <> 'security.reveal';
insert into public.staff_role_permissions (role_key, permission_key)
select 'owner', key from public.permissions;

insert into public.badges (key, name, description, icon_key, color, system_managed) values
  ('new_joiner', 'New Joiner', 'Displayed for the first five days after joining.', 'spark', '#625bf6', true),
  ('verified_owner', 'Verified server owner', 'Ownership has been reviewed by BrowseRP staff.', 'shield-check', '#248b67', true),
  ('verified_developer', 'Verified developer', 'Developer identity and work history have been reviewed.', 'code-check', '#3676bc', true),
  ('community_helper', 'Community helper', 'Recognises constructive community participation.', 'heart', '#b05e88', false);

insert into public.promotion_products (key, name, description, credit_amount, unit_amount, currency, sort_order) values
  ('starter', 'Starter spotlight', 'Five fixed promotion credits.', 5, 500, 'gbp', 10),
  ('growth', 'Growth spotlight', 'Fifteen fixed promotion credits.', 15, 1200, 'gbp', 20),
  ('launch', 'Launch spotlight', 'Forty fixed promotion credits.', 40, 2500, 'gbp', 30);

insert into public.system_settings (key, value, description) values
  ('new_joiner_days', '5'::jsonb, 'Days the New Joiner badge remains active.'),
  ('daily_free_boosts', '3'::jsonb, 'Free community boosts per authenticated member per UTC day.'),
  ('mass_ban_threshold', '10'::jsonb, 'Staff bans within five minutes before automatic suspension.'),
  ('paid_discovery_weight', '0.06'::jsonb, 'Maximum paid/free boost contribution to discovery score.');

-- Account provisioning keeps imported identity data conservative and reviewable.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display text;
  v_username text;
  v_badge_id uuid;
begin
  v_display := left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', 'New member'), '[<>\x00-\x1F\x7F]', '', 'g'), 48);
  if char_length(trim(v_display)) < 2 then v_display := 'New member'; end if;
  v_username := 'member_' || left(replace(new.id::text, '-', ''), 12);

  insert into public.profiles (id, username, display_name, avatar_url)
  values (new.id, v_username, trim(v_display), nullif(new.raw_user_meta_data ->> 'avatar_url', ''));
  insert into public.account_trust (user_id) values (new.id);

  select id into v_badge_id from public.badges where key = 'new_joiner';
  if v_badge_id is not null then
    insert into public.user_badges (user_id, badge_id, reason, expires_at)
    values (new.id, v_badge_id, 'New account', timezone('utc', now()) + interval '5 days');
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Updated-at triggers.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'platforms','categories','profiles','staff_memberships','account_trust','servers',
    'server_endpoints','server_submissions','reviews','promotion_products','ad_campaigns',
    'developer_profiles','developer_services','resources','reports','ban_appeals',
    'applications','blog_posts','rate_limit_buckets','system_settings'
  ] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute procedure public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

-- Immutable financial and audit records.
create trigger promotion_credit_ledger_immutable before update or delete on public.promotion_credit_ledger for each row execute procedure public.prevent_mutation();
create trigger staff_audit_events_immutable before update or delete on public.staff_audit_events for each row execute procedure public.prevent_mutation();

-- Current public directory views never expose connection endpoints or adult listings.
create or replace view public.category_directory
with (security_invoker = true)
as
select c.id, c.name, c.slug, c.description, c.icon_key, c.platform_id,
       count(distinct sc.server_id)::integer as count
from public.categories c
left join public.server_categories sc on sc.category_id = c.id
left join public.servers s on s.id = sc.server_id and s.status = 'published' and s.age_rating <> 'adult'
where c.enabled
group by c.id;

create or replace view public.developer_directory
with (security_invoker = true)
as
select dp.user_id as id, p.display_name, p.username, p.avatar_url, dp.headline,
       dp.specialties, dp.portfolio_url, dp.verified, dp.created_at
from public.developer_profiles dp
join public.profiles p on p.id = dp.user_id
where dp.status = 'published' and p.profile_visibility = 'public';

create or replace view public.resource_directory
with (security_invoker = true)
as
select r.id, r.title, r.slug, r.summary, r.resource_type, r.download_count as downloads,
       r.published_at, p.name as platform_name, pr.display_name as author_name
from public.resources r
join public.profiles pr on pr.id = r.author_id
left join public.platforms p on p.id = r.platform_id
where r.status = 'published';

-- Search runs in Postgres and caps promotion influence at six percent.
create or replace function public.search_server_directory(
  p_query text default '',
  p_platform text default 'all',
  p_region text default 'all',
  p_online boolean default false,
  p_verified boolean default false,
  p_beginner boolean default false,
  p_sort text default 'recommended',
  p_limit integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with directory as (
    select
      s.id, s.name, s.slug, s.platform_id, p.name as platform_name, p.short_name as platform_short,
      s.description, s.region, s.language, s.framework, s.verified, s.beginner_friendly,
      s.quality_score::float8 as quality_score, s.engagement_score::float8 as engagement_score,
      s.theme_start, s.theme_end, s.created_at,
      coalesce(latest.online, false) as online,
      coalesce(latest.players, 0) as players,
      coalesce(latest.capacity, 0) as capacity,
      coalesce(uptime.uptime_percent, 0)::float8 as uptime_percent,
      least(coalesce(boosts.boost_score, 0), 100)::float8 as boost_score,
      coalesce(tags.tags, '[]'::jsonb) as tags,
      (
        s.quality_score * .28 + s.engagement_score * .22 +
        coalesce(uptime.uptime_percent, 0) * .18 +
        case when coalesce(latest.capacity, 0) > 0 then least(latest.players::numeric / latest.capacity, 1) * 100 else 0 end * .18 +
        case when s.verified then 100 else 0 end * .08 +
        least(coalesce(boosts.boost_score, 0), 100) * .06
      )::float8 as discovery_score
    from public.servers s
    join public.platforms p on p.id = s.platform_id and p.enabled
    left join lateral (
      select ss.online, ss.players, ss.capacity
      from public.server_status_snapshots ss
      where ss.server_id = s.id
      order by ss.checked_at desc limit 1
    ) latest on true
    left join lateral (
      select round(100 * avg(case when ss.online then 1 else 0 end), 2) as uptime_percent
      from public.server_status_snapshots ss
      where ss.server_id = s.id and ss.checked_at >= timezone('utc', now()) - interval '30 days'
    ) uptime on true
    left join lateral (
      select sum(b.amount)::numeric as boost_score
      from public.boosts b
      where b.server_id = s.id and b.created_at >= timezone('utc', now()) - interval '7 days'
    ) boosts on true
    left join lateral (
      select jsonb_agg(st.tag order by st.relevance_score desc, st.tag) as tags
      from public.server_tags st where st.server_id = s.id
    ) tags on true
    where s.status = 'published'
      and s.age_rating <> 'adult'
  ), filtered as (
    select * from directory d
    where (coalesce(p_platform, 'all') = 'all' or d.platform_id = p_platform)
      and (coalesce(p_region, 'all') = 'all' or d.region = p_region)
      and (not coalesce(p_online, false) or d.online)
      and (not coalesce(p_verified, false) or d.verified)
      and (not coalesce(p_beginner, false) or d.beginner_friendly)
      and (
        nullif(trim(coalesce(p_query, '')), '') is null or
        concat_ws(' ', d.name, d.description, d.platform_name, d.region, d.language, d.framework, d.tags::text)
          ilike '%' || replace(replace(trim(p_query), '%', '\%'), '_', '\_') || '%'
      )
  ), ordered as (
    select * from filtered
    order by
      case when p_sort = 'players' then players end desc nulls last,
      case when p_sort = 'trending' then engagement_score end desc nulls last,
      case when p_sort = 'newest' then extract(epoch from created_at) end desc nulls last,
      case when p_sort = 'uptime' then uptime_percent end desc nulls last,
      case when p_sort = 'boosted' then boost_score end desc nulls last,
      discovery_score desc,
      name asc
    limit least(greatest(coalesce(p_limit, 30), 1), 100)
  )
  select coalesce(jsonb_agg(to_jsonb(ordered)), '[]'::jsonb) from ordered;
$$;

create or replace function public.public_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'servers', (select count(*) from public.servers where status = 'published' and age_rating <> 'adult'),
    'online', (select count(distinct s.id) from public.servers s join lateral (select online from public.server_status_snapshots x where x.server_id=s.id order by checked_at desc limit 1) x on x.online where s.status='published' and s.age_rating <> 'adult'),
    'verified', (select count(*) from public.servers where status='published' and verified and age_rating <> 'adult'),
    'players', (select coalesce(sum(x.players),0) from public.servers s join lateral (select players from public.server_status_snapshots z where z.server_id=s.id order by checked_at desc limit 1) x on true where s.status='published' and s.age_rating <> 'adult'),
    'pendingReviews', 0,
    'boostsToday', (select coalesce(sum(amount),0) from public.boosts where boost_date=timezone('utc', now())::date),
    'toolRunsToday', (select count(*) from public.tool_events where occurred_on=timezone('utc', now())::date),
    'moderationHealth', 'Operational'
  );
$$;

create or replace function public.daily_boost_balance()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'dailyAllowance', 3,
    'used', count(*)::integer,
    'remaining', greatest(0, 3 - count(*))::integer
  )
  from public.boosts
  where actor_id = (select auth.uid()) and source='daily_free' and boost_date=timezone('utc', now())::date;
$$;

create or replace function public.grant_daily_boost(p_server_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_used integer;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || timezone('utc', now())::date::text, 0));
  if not exists (select 1 from public.servers where id=p_server_id and status='published' and age_rating <> 'adult') then
    raise exception 'Server not found';
  end if;
  select count(*) into v_used from public.boosts where actor_id=v_user and source='daily_free' and boost_date=timezone('utc', now())::date;
  if v_used >= 3 then raise exception 'Daily boost allowance used'; end if;
  insert into public.boosts(server_id, actor_id, source) values (p_server_id, v_user, 'daily_free');
  return jsonb_build_object('serverId', p_server_id, 'remaining', 2-v_used);
exception when unique_violation then
  raise exception 'You already boosted this server today';
end;
$$;

create or replace function public.create_server_submission(
  p_name text,
  p_platform_id text,
  p_region text,
  p_language text,
  p_framework text,
  p_description text,
  p_community_url text,
  p_moderation_confidence text,
  p_moderation_score integer,
  p_moderation_reasons jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.platforms where id=p_platform_id and enabled) then raise exception 'Unsupported platform'; end if;
  if p_moderation_confidence = 'blocked' or p_moderation_score > 84 then raise exception 'Submission blocked'; end if;
  insert into public.server_submissions(submitted_by, platform_id, name, region, language, framework, description, community_url, moderation_confidence, moderation_score, moderation_reasons)
  values(v_user, p_platform_id, left(trim(p_name),80), left(trim(p_region),60), left(trim(p_language),60), nullif(left(trim(p_framework),80),''), left(trim(p_description),1500), nullif(left(trim(p_community_url),300),''), p_moderation_confidence, least(greatest(p_moderation_score,0),100), coalesce(p_moderation_reasons,'[]'::jsonb))
  returning id into v_id;
  insert into public.moderation_queue(target_type,target_id,confidence,score,reasons)
  values('server_submission',v_id::text,p_moderation_confidence,p_moderation_score,coalesce(p_moderation_reasons,'[]'::jsonb));
  return jsonb_build_object('id',v_id,'status','pending_review','moderation',p_moderation_confidence);
end;
$$;

create or replace function public.consume_rate_limit(p_key_hash text, p_action text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_count integer;
begin
  if char_length(p_key_hash) > 200 or char_length(p_action) > 80 or p_limit not between 1 and 1000 or p_window_seconds not between 1 and 86400 then return false; end if;
  insert into public.rate_limit_buckets(key_hash,action,window_started_at,request_count)
  values(p_key_hash,p_action,v_now,1)
  on conflict(key_hash,action) do update set
    window_started_at = case when public.rate_limit_buckets.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now else public.rate_limit_buckets.window_started_at end,
    request_count = case when public.rate_limit_buckets.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1 else public.rate_limit_buckets.request_count + 1 end,
    updated_at = v_now
  returning request_count into v_count;
  return v_count <= p_limit;
end;
$$;

create or replace function public.record_tool_run(p_tool_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tool_key not in ('joaat','name-generator','status-checker','config-generator') then raise exception 'Unknown tool'; end if;
  insert into public.tool_events(tool_key,user_id) values(p_tool_key,(select auth.uid()));
end;
$$;

create or replace function public.promotion_credit_balance(p_user_id uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(delta),0)::integer from public.promotion_credit_ledger
  where user_id = coalesce(p_user_id, (select auth.uid()))
    and (p_user_id is null or p_user_id = (select auth.uid()) or public.has_staff_permission('settings.manage'));
$$;

create or replace function public.member_dashboard_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when (select auth.uid()) is null then null else jsonb_build_object(
    'profile', (select to_jsonb(p) from (select id,username,display_name,avatar_url,bio,joined_at from public.profiles where id=(select auth.uid())) p),
    'servers', (select coalesce(jsonb_agg(to_jsonb(s) order by s.updated_at desc),'[]'::jsonb) from (select id,name,slug,status,verified,updated_at from public.servers where owner_id=(select auth.uid()) limit 20) s),
    'submissions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (select id,name,status,created_at from public.server_submissions where submitted_by=(select auth.uid()) limit 20) x),
    'promotionCredits', public.promotion_credit_balance(),
    'unreadNotifications', (select count(*) from public.notifications where user_id=(select auth.uid()) and read_at is null),
    'favorites', (select count(*) from public.favorites where user_id=(select auth.uid()))
  ) end;
$$;

create or replace function public.staff_dashboard_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_staff_permission('moderation.read') then raise exception 'Staff permission required' using errcode='42501'; end if;
  return jsonb_build_object(
    'pendingSubmissions',(select count(*) from public.server_submissions where status='pending_review'),
    'openModeration',(select count(*) from public.moderation_queue where status='open'),
    'openReports',(select count(*) from public.reports where status in ('open','triaged')),
    'activeBans',(select count(*) from public.bans where revoked_at is null and (ends_at is null or ends_at > timezone('utc',now()))),
    'securityAlerts',(select count(*) from public.security_events where resolved_at is null and severity in ('high','critical')),
    'recentAudit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) from (select id,action,target_type,target_id,reason,created_at from public.staff_audit_events limit 20) a)
  );
end;
$$;

-- The webhook authenticates with a separately provisioned, bcrypt-hashed secret.
create or replace function public.fulfill_stripe_checkout(
  p_fulfillment_secret text,
  p_stripe_event_id text,
  p_stripe_session_id text,
  p_user_id uuid,
  p_product_key text,
  p_quantity integer,
  p_amount_total integer,
  p_currency text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_product public.promotion_products%rowtype;
  v_order_id uuid;
begin
  select secret_hash into v_hash from private.secrets where key='stripe_fulfillment';
  if v_hash is null or extensions.crypt(p_fulfillment_secret, v_hash) <> v_hash then raise exception 'Invalid fulfillment secret' using errcode='42501'; end if;
  if p_quantity not between 1 and 10 then raise exception 'Invalid quantity'; end if;
  select * into v_product from public.promotion_products where key=p_product_key and active for share;
  if not found then raise exception 'Unknown promotion product'; end if;
  if lower(p_currency) <> v_product.currency or p_amount_total <> v_product.unit_amount * p_quantity then raise exception 'Payment amount does not match catalog'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'Unknown member'; end if;

  select id into v_order_id from public.promotion_orders where stripe_event_id=p_stripe_event_id or stripe_session_id=p_stripe_session_id;
  if v_order_id is not null then return jsonb_build_object('orderId',v_order_id,'idempotent',true); end if;

  insert into public.promotion_orders(user_id,product_key,quantity,amount_total,currency,stripe_event_id,stripe_session_id,metadata)
  values(p_user_id,p_product_key,p_quantity,p_amount_total,lower(p_currency),p_stripe_event_id,p_stripe_session_id,coalesce(p_metadata,'{}'::jsonb))
  returning id into v_order_id;
  insert into public.promotion_credit_ledger(user_id,delta,reason,source_type,source_id)
  values(p_user_id,v_product.credit_amount*p_quantity,'Fixed promotion credit purchase','purchase',v_order_id::text);
  insert into public.notifications(user_id,kind,title,body,action_url)
  values(p_user_id,'purchase','Promotion credits added',format('%s credits were added to your account.',v_product.credit_amount*p_quantity),'/dashboard');
  return jsonb_build_object('orderId',v_order_id,'credits',v_product.credit_amount*p_quantity,'idempotent',false);
end;
$$;

-- Automatic containment if one staff account performs a mass-ban pattern.
create or replace function public.detect_mass_ban_pattern()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_threshold integer := 10;
begin
  select coalesce((value #>> '{}')::integer,10) into v_threshold from public.system_settings where key='mass_ban_threshold';
  select count(*) into v_count from public.bans where actor_id=new.actor_id and created_at >= timezone('utc',now())-interval '5 minutes';
  if v_count >= v_threshold then
    update public.staff_memberships set status='suspended', updated_at=timezone('utc',now()) where user_id=new.actor_id and status='active';
    insert into public.security_events(severity,event_type,actor_id,details)
    values('critical','staff.mass_ban_detected',new.actor_id,jsonb_build_object('actionsInFiveMinutes',v_count,'automaticContainment',true));
    insert into public.notifications(user_id,kind,title,body,action_url)
      select sm.user_id,'security','Staff account automatically contained','A mass-action threshold was reached. Review the security event before restoring access.','/staff'
      from public.staff_memberships sm where sm.role_key='owner' and sm.status='active';
  end if;
  return new;
end;
$$;

create trigger bans_mass_action_guard after insert on public.bans for each row execute procedure public.detect_mass_ban_pattern();

-- Row-level security: explicit policies only.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'platforms','categories','profiles','staff_roles','permissions','staff_role_permissions','staff_memberships',
    'badges','user_badges','account_trust','servers','server_tags','server_categories','server_endpoints',
    'server_status_snapshots','server_submissions','favorites','reviews','review_reactions','boosts',
    'promotion_products','promotion_orders','promotion_credit_ledger','ad_campaigns','developer_profiles',
    'developer_services','resources','resource_downloads','reports','moderation_queue','bans','ban_appeals',
    'notifications','security_events','staff_audit_events','applications','uploaded_assets','tool_events',
    'blog_posts','rate_limit_buckets','system_settings'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

create policy platforms_public_read on public.platforms for select using (enabled or public.has_staff_permission('settings.manage'));
create policy categories_public_read on public.categories for select using (enabled or public.has_staff_permission('settings.manage'));
create policy profiles_public_read on public.profiles for select using (profile_visibility='public' or id=(select auth.uid()) or public.has_staff_permission('reports.read'));
create policy profiles_self_update on public.profiles for update using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy roles_staff_read on public.staff_roles for select using (public.has_staff_permission('staff.manage') or key=(select role_key from public.staff_memberships where user_id=(select auth.uid())));
create policy permissions_staff_read on public.permissions for select using (public.has_staff_permission('staff.manage'));
create policy role_permissions_staff_read on public.staff_role_permissions for select using (public.has_staff_permission('staff.manage'));
create policy membership_self_read on public.staff_memberships for select using (user_id=(select auth.uid()) or public.has_staff_permission('staff.manage'));
create policy badges_public_read on public.badges for select using (enabled);
create policy user_badges_public_read on public.user_badges for select using ((expires_at is null or expires_at>timezone('utc',now())) and (user_id=(select auth.uid()) or exists(select 1 from public.profiles p where p.id=user_id and p.profile_visibility='public')));
create policy trust_self_read on public.account_trust for select using (user_id=(select auth.uid()) or public.has_staff_permission('reports.read'));
create policy servers_public_read on public.servers for select using ((status='published' and age_rating<>'adult') or owner_id=(select auth.uid()) or public.has_staff_permission('servers.review'));
create policy server_tags_public_read on public.server_tags for select using (exists(select 1 from public.servers s where s.id=server_id and ((s.status='published' and s.age_rating<>'adult') or s.owner_id=(select auth.uid()) or public.has_staff_permission('servers.review'))));
create policy server_categories_public_read on public.server_categories for select using (exists(select 1 from public.servers s where s.id=server_id and ((s.status='published' and s.age_rating<>'adult') or s.owner_id=(select auth.uid()) or public.has_staff_permission('servers.review'))));
create policy server_endpoints_owner_read on public.server_endpoints for select using (exists(select 1 from public.servers s where s.id=server_id and s.owner_id=(select auth.uid())) or public.has_staff_permission('servers.review'));
create policy status_public_read on public.server_status_snapshots for select using (exists(select 1 from public.servers s where s.id=server_id and s.status='published' and s.age_rating<>'adult'));
create policy submissions_owner_read on public.server_submissions for select using (submitted_by=(select auth.uid()) or public.has_staff_permission('servers.review'));
create policy favorites_self_all on public.favorites for all using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy reviews_public_read on public.reviews for select using (status='published' or author_id=(select auth.uid()) or public.has_staff_permission('moderation.read'));
create policy review_reactions_public_read on public.review_reactions for select using (exists(select 1 from public.reviews r where r.id=review_id and r.status='published'));
create policy boosts_self_read on public.boosts for select using (actor_id=(select auth.uid()) or public.has_staff_permission('audit.read'));
create policy promotion_products_public_read on public.promotion_products for select using (active or public.has_staff_permission('settings.manage'));
create policy orders_self_read on public.promotion_orders for select using (user_id=(select auth.uid()) or public.has_staff_permission('settings.manage'));
create policy credits_self_read on public.promotion_credit_ledger for select using (user_id=(select auth.uid()) or public.has_staff_permission('settings.manage'));
create policy campaigns_owner_read on public.ad_campaigns for select using (owner_id=(select auth.uid()) or public.has_staff_permission('advertising.review'));
create policy developers_public_read on public.developer_profiles for select using (status='published' or user_id=(select auth.uid()) or public.has_staff_permission('developers.verify'));
create policy services_public_read on public.developer_services for select using (status='published' or developer_id=(select auth.uid()) or public.has_staff_permission('developers.verify'));
create policy resources_public_read on public.resources for select using (status='published' or author_id=(select auth.uid()) or public.has_staff_permission('moderation.read'));
create policy downloads_staff_read on public.resource_downloads for select using (public.has_staff_permission('audit.read'));
create policy reports_owner_staff_read on public.reports for select using (reporter_id=(select auth.uid()) or public.has_staff_permission('reports.read'));
create policy reports_authenticated_insert on public.reports for insert to authenticated with check (reporter_id=(select auth.uid()));
create policy moderation_staff_read on public.moderation_queue for select using (public.has_staff_permission('moderation.read'));
create policy bans_subject_staff_read on public.bans for select using (user_id=(select auth.uid()) or public.has_staff_permission('users.enforce') or public.has_staff_permission('appeals.review'));
create policy appeals_subject_staff_read on public.ban_appeals for select using (appellant_id=(select auth.uid()) or public.has_staff_permission('appeals.review'));
create policy appeals_subject_insert on public.ban_appeals for insert to authenticated with check (appellant_id=(select auth.uid()) and exists(select 1 from public.bans b where b.id=ban_id and b.user_id=(select auth.uid())));
create policy notifications_self_read on public.notifications for select using (user_id=(select auth.uid()));
create policy notifications_self_update on public.notifications for update using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy security_authorized_read on public.security_events for select using (public.has_staff_permission('security.read'));
create policy audit_authorized_read on public.staff_audit_events for select using (public.has_staff_permission('audit.read'));
create policy applications_self_read on public.applications for select using (applicant_id=(select auth.uid()) or public.has_staff_permission('moderation.read'));
create policy applications_self_insert on public.applications for insert to authenticated with check (applicant_id=(select auth.uid()));
create policy assets_owner_read on public.uploaded_assets for select using (owner_id=(select auth.uid()) or public.has_staff_permission('moderation.read'));
create policy blog_public_read on public.blog_posts for select using (status='published' or author_id=(select auth.uid()) or public.has_staff_permission('moderation.read'));
create policy settings_staff_read on public.system_settings for select using (public.has_staff_permission('settings.manage'));

-- Function grants are explicit; tables remain protected by RLS.
revoke all on function public.has_staff_permission(text) from public;
grant execute on function public.has_staff_permission(text) to anon, authenticated;
revoke all on function public.search_server_directory(text,text,text,boolean,boolean,boolean,text,integer) from public;
grant execute on function public.search_server_directory(text,text,text,boolean,boolean,boolean,text,integer) to anon, authenticated;
revoke all on function public.public_overview() from public;
grant execute on function public.public_overview() to anon, authenticated;
revoke all on function public.daily_boost_balance() from public;
grant execute on function public.daily_boost_balance() to authenticated;
revoke all on function public.grant_daily_boost(uuid) from public;
grant execute on function public.grant_daily_boost(uuid) to authenticated;
revoke all on function public.create_server_submission(text,text,text,text,text,text,text,text,integer,jsonb) from public;
grant execute on function public.create_server_submission(text,text,text,text,text,text,text,text,integer,jsonb) to authenticated;
revoke all on function public.consume_rate_limit(text,text,integer,integer) from public;
grant execute on function public.consume_rate_limit(text,text,integer,integer) to anon, authenticated;
revoke all on function public.record_tool_run(text) from public;
grant execute on function public.record_tool_run(text) to anon, authenticated;
revoke all on function public.promotion_credit_balance(uuid) from public;
grant execute on function public.promotion_credit_balance(uuid) to authenticated;
revoke all on function public.member_dashboard_overview() from public;
grant execute on function public.member_dashboard_overview() to authenticated;
revoke all on function public.staff_dashboard_overview() from public;
grant execute on function public.staff_dashboard_overview() to authenticated;
revoke all on function public.fulfill_stripe_checkout(text,text,text,uuid,text,integer,integer,text,jsonb) from public;
grant execute on function public.fulfill_stripe_checkout(text,text,text,uuid,text,integer,integer,text,jsonb) to anon;

commit;
