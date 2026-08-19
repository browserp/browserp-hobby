-- BrowseRP v2 application boundaries. Additive and rollback-compatible with
-- the production v1.3 schema; no previously applied migration is rewritten.
begin;

-- Private tables are not exposed by the Data API, but RLS remains useful
-- defense in depth if the exposed-schema configuration changes later.
alter table private.secrets enable row level security;
alter table private.discord_owner_allowlist enable row level security;
revoke all on table private.secrets from public, anon, authenticated;
revoke all on table private.discord_owner_allowlist from public, anon, authenticated;

-- Browser clients must use narrow RPCs rather than direct table mutation. The
-- existing SECURITY DEFINER member RPCs keep favorites and notification reads
-- working while preventing column-overposting through PostgREST.
drop policy if exists profiles_self_update on public.profiles;
drop policy if exists favorites_self_all on public.favorites;
drop policy if exists reports_authenticated_insert on public.reports;
drop policy if exists appeals_subject_insert on public.ban_appeals;
drop policy if exists notifications_self_update on public.notifications;
drop policy if exists applications_self_insert on public.applications;

drop policy if exists favorites_self_read on public.favorites;
create policy favorites_self_read
on public.favorites for select
to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

revoke insert, update, delete on table public.profiles from anon, authenticated;
revoke insert, update, delete on table public.notifications from anon, authenticated;
revoke insert, update, delete on table public.favorites from anon, authenticated;
revoke insert, update, delete on table public.reports from anon, authenticated;
revoke insert, update, delete on table public.ban_appeals from anon, authenticated;
revoke insert, update, delete on table public.applications from anon, authenticated;

-- Submission provenance and replay protection. Existing rows remain valid.
alter table public.server_submissions
  add column if not exists request_id text,
  add column if not exists idempotency_key text,
  add column if not exists request_fingerprint text,
  add column if not exists terms_version text,
  add column if not exists standards_version text;

alter table public.server_submissions
  drop constraint if exists server_submissions_request_id_format,
  add constraint server_submissions_request_id_format
    check (request_id is null or request_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') not valid,
  drop constraint if exists server_submissions_idempotency_key_format,
  add constraint server_submissions_idempotency_key_format
    check (idempotency_key is null or idempotency_key ~ '^[0-9a-f]{64}$') not valid,
  drop constraint if exists server_submissions_request_fingerprint_format,
  add constraint server_submissions_request_fingerprint_format
    check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$') not valid,
  drop constraint if exists server_submissions_legal_versions_format,
  add constraint server_submissions_legal_versions_format
    check (
      (terms_version is null or char_length(terms_version) between 1 and 64)
      and (standards_version is null or char_length(standards_version) between 1 and 64)
    ) not valid;

create unique index if not exists server_submissions_member_idempotency_idx
  on public.server_submissions (submitted_by, idempotency_key)
  where idempotency_key is not null;
create index if not exists server_submissions_owner_created_idx
  on public.server_submissions (submitted_by, created_at desc);

-- A single internal request can resolve at most one staff queue item. Existing
-- staff actions already include request_id; the partial index makes the
-- boundary effective without changing the established RPC signature.
create unique index if not exists staff_audit_actor_request_idx
  on public.staff_audit_events (actor_id, request_id)
  where actor_id is not null and request_id is not null;

create or replace function public.create_server_submission_server_v2(
  p_user_id uuid,
  p_name text,
  p_platform_id text,
  p_region text,
  p_language text,
  p_framework text,
  p_description text,
  p_community_url text,
  p_moderation_confidence text,
  p_moderation_score integer,
  p_moderation_reasons jsonb,
  p_request_id text,
  p_idempotency_key text,
  p_terms_version text,
  p_standards_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_existing_fingerprint text;
  v_fingerprint text;
  v_url text := nullif(btrim(coalesce(p_community_url, '')), '');
begin
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Unknown member' using errcode = '42501';
  end if;
  if p_request_id is null
     or p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid submission request';
  end if;
  if p_terms_version is distinct from '2026-08-19'
     or p_standards_version is distinct from '2026-08-19' then
    raise exception 'Current terms and listing standards must be accepted';
  end if;

  if not exists (select 1 from public.platforms where id = p_platform_id and enabled) then
    raise exception 'Unsupported platform';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80
     or char_length(btrim(coalesce(p_region, ''))) not between 2 and 60
     or char_length(btrim(coalesce(p_language, ''))) not between 2 and 60
     or char_length(btrim(coalesce(p_description, ''))) not between 40 and 1500 then
    raise exception 'Invalid listing content';
  end if;
  if nullif(btrim(coalesce(p_framework, '')), '') is not null
     and char_length(btrim(p_framework)) > 80 then
    raise exception 'Invalid framework';
  end if;
  if v_url is not null and (
    char_length(v_url) > 300
    or v_url ~ '[[:space:]#]'
    or v_url ~* '^https://[^/]*@'
    or v_url ~* '^https://[^/]+:[0-9]+(?:/|$)'
    or v_url !~* '^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})(?:/[^[:space:]#]*)?$'
    or v_url ~* '^https://[^/]+\.(?:arpa|example|home|internal|invalid|lan|local|localdomain|localhost|onion|test)(?:/|$)'
    or v_url ~* '^https://(?:[^/]+\.)?(?:bit\.ly|buff\.ly|cutt\.ly|goo\.gl|is\.gd|ow\.ly|rb\.gy|rebrand\.ly|shorturl\.at|t\.co|tiny\.one|tinyurl\.com)(?:/|$)'
    or (
      v_url ~* '^https://(?:www\.)?discord\.com(?:/|$)'
      and v_url !~* '^https://(?:www\.)?discord\.com/invite/[a-z0-9_-]{2,64}/?$'
    )
    or (
      v_url ~* '^https://discord\.gg(?:/|$)'
      and v_url !~* '^https://discord\.gg/[a-z0-9_-]{2,64}/?$'
    )
    or (
      v_url ~* '^https://(?:www\.)?cfx\.re(?:/|$)'
      and v_url !~* '^https://(?:www\.)?cfx\.re/join/[a-z0-9]{3,32}/?$'
    )
  ) then
    raise exception 'Invalid community URL';
  end if;
  if p_moderation_confidence not in ('safe', 'likely_safe', 'review_recommended', 'high_risk')
     or p_moderation_score not between 0 and 84
     or jsonb_typeof(coalesce(p_moderation_reasons, '[]'::jsonb)) <> 'array' then
    raise exception 'Submission blocked';
  end if;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.concat_ws(
          E'\x1f',
          coalesce(btrim(p_name), ''),
          coalesce(p_platform_id, ''),
          coalesce(btrim(p_region), ''),
          coalesce(btrim(p_language), ''),
          coalesce(nullif(btrim(coalesce(p_framework, '')), ''), ''),
          coalesce(btrim(p_description), ''),
          coalesce(v_url, ''),
          coalesce(p_moderation_confidence, ''),
          coalesce(p_moderation_score::text, ''),
          coalesce(p_moderation_reasons, '[]'::jsonb)::text,
          coalesce(p_terms_version, ''),
          coalesce(p_standards_version, '')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_idempotency_key, 0)
  );
  select id, status, request_fingerprint
    into v_id, v_status, v_existing_fingerprint
    from public.server_submissions
    where submitted_by = p_user_id
      and idempotency_key = p_idempotency_key;
  if found then
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception 'Conflicting submission replay';
    end if;
    return jsonb_build_object(
      'id', v_id,
      'status', v_status,
      'idempotent', true,
      'termsVersion', p_terms_version,
      'standardsVersion', p_standards_version
    );
  end if;

  if (
    select count(*)
    from public.server_submissions
    where submitted_by = p_user_id
      and status in ('pending_review', 'changes_requested')
  ) >= 5 then
    raise exception 'Too many open submissions';
  end if;

  insert into public.server_submissions (
    submitted_by, platform_id, name, region, language, framework, description,
    community_url, moderation_confidence, moderation_score, moderation_reasons,
    request_id, idempotency_key, request_fingerprint, terms_version, standards_version
  ) values (
    p_user_id,
    p_platform_id,
    left(btrim(p_name), 80),
    left(btrim(p_region), 60),
    left(btrim(p_language), 60),
    nullif(left(btrim(p_framework), 80), ''),
    left(btrim(p_description), 1500),
    v_url,
    p_moderation_confidence,
    p_moderation_score,
    coalesce(p_moderation_reasons, '[]'::jsonb),
    p_request_id,
    p_idempotency_key,
    v_fingerprint,
    p_terms_version,
    p_standards_version
  )
  returning id, status into v_id, v_status;

  insert into public.moderation_queue (target_type, target_id, confidence, score, reasons)
  values (
    'server_submission',
    v_id::text,
    p_moderation_confidence,
    p_moderation_score,
    coalesce(p_moderation_reasons, '[]'::jsonb)
  );

  return jsonb_build_object(
    'id', v_id,
    'status', v_status,
    'moderation', p_moderation_confidence,
    'idempotent', false,
    'termsVersion', p_terms_version,
    'standardsVersion', p_standards_version
  );
end;
$$;

revoke execute on function public.create_server_submission_server_v2(
  uuid,text,text,text,text,text,text,text,text,integer,jsonb,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.create_server_submission_server_v2(
  uuid,text,text,text,text,text,text,text,text,integer,jsonb,text,text,text,text
) to service_role;
comment on function public.create_server_submission_server_v2(
  uuid,text,text,text,text,text,text,text,text,integer,jsonb,text,text,text,text
) is 'Service-role-only, replay-safe listing submission boundary with legal-version provenance.';

-- Versioned structured content. Definitions form the schema: staff can update
-- only known keys and each key accepts either bounded plain text or a boolean.
create table if not exists private.site_content_definitions (
  key text primary key check (key ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  value_type text not null check (value_type in ('string', 'boolean')),
  max_length integer not null check (max_length between 1 and 4000),
  default_value jsonb not null check (jsonb_typeof(default_value) in ('string', 'boolean')),
  description text not null check (char_length(description) between 3 and 300)
);

create table if not exists private.site_content (
  key text primary key references private.site_content_definitions(key) on delete restrict,
  draft_value jsonb not null check (jsonb_typeof(draft_value) in ('string', 'boolean')),
  published_value jsonb check (published_value is null or jsonb_typeof(published_value) in ('string', 'boolean')),
  current_version bigint not null default 1 check (current_version > 0),
  published_version bigint check (published_version is null or published_version > 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  published_at timestamptz
);

create table if not exists private.site_content_revisions (
  id bigint generated always as identity primary key,
  content_key text not null references private.site_content(key) on delete restrict,
  version bigint not null check (version > 0),
  value_type text not null check (value_type in ('string', 'boolean')),
  value jsonb not null check (jsonb_typeof(value) in ('string', 'boolean')),
  state text not null check (state in ('draft', 'published', 'rollback')),
  actor_id uuid references public.profiles(id) on delete set null,
  reason text not null check (char_length(reason) between 5 and 500),
  created_at timestamptz not null default timezone('utc', now()),
  unique (content_key, version)
);

alter table private.site_content_definitions enable row level security;
alter table private.site_content enable row level security;
alter table private.site_content_revisions enable row level security;
revoke all on table private.site_content_definitions from public, anon, authenticated, service_role;
revoke all on table private.site_content from public, anon, authenticated, service_role;
revoke all on table private.site_content_revisions from public, anon, authenticated, service_role;
revoke all on sequence private.site_content_revisions_id_seq from public, anon, authenticated, service_role;

drop trigger if exists site_content_revisions_immutable on private.site_content_revisions;
create trigger site_content_revisions_immutable
before update or delete on private.site_content_revisions
for each row execute procedure public.prevent_mutation();

insert into private.site_content_definitions (key, value_type, max_length, default_value, description)
values
  ('brand.name', 'string', 40, to_jsonb('BrowseRP'::text), 'Public product name.'),
  ('home.hero.eyebrow', 'string', 100, to_jsonb('Made for FiveM roleplay'::text), 'Short line above the home heading.'),
  ('home.hero.title', 'string', 120, to_jsonb('Find a server that feels right.'::text), 'Primary home page heading.'),
  ('home.hero.body', 'string', 500, to_jsonb('Search communities by region, framework and play style. Open a listing, understand the server, then decide if it is right for you.'::text), 'Home page introduction.'),
  ('directory.heading', 'string', 120, to_jsonb('Find the community you want to call home.'::text), 'Directory page heading.'),
  ('directory.intro', 'string', 500, to_jsonb('Search every published BrowseRP listing. Use the filters when you know what you want, or keep them open and see what is out there.'::text), 'Directory page introduction.'),
  ('listing.heading', 'string', 120, to_jsonb('Give players a clear reason to join.'::text), 'Owner submission page heading.'),
  ('listing.intro', 'string', 500, to_jsonb('Describe the community you have actually built. We review every submission before it becomes a public BrowseRP listing.'::text), 'Owner submission page introduction.'),
  ('dashboard.heading', 'string', 120, to_jsonb('Your server owner workspace'::text), 'Member dashboard heading.'),
  ('dashboard.intro', 'string', 500, to_jsonb('Sign in to manage listings, follow review progress and keep servers saved in one place.'::text), 'Member dashboard introduction.'),
  ('footer.tagline', 'string', 200, to_jsonb('A straightforward place to find and list FiveM roleplay communities.'::text), 'Public footer description.'),
  ('announcement.enabled', 'boolean', 5, 'false'::jsonb, 'Show or hide the public announcement.'),
  ('announcement.message', 'string', 240, to_jsonb('BrowseRP is open for server submissions.'::text), 'Public announcement text.')
on conflict (key) do nothing;

insert into private.site_content (
  key, draft_value, published_value, current_version, published_version, updated_at, published_at
)
select
  d.key,
  d.default_value,
  d.default_value,
  1,
  1,
  timezone('utc', now()),
  timezone('utc', now())
from private.site_content_definitions d
on conflict (key) do nothing;

insert into private.site_content_revisions (
  content_key, version, value_type, value, state, reason
)
select
  d.key,
  1,
  d.value_type,
  c.published_value,
  'published',
  'Initial v2 content'
from private.site_content c
join private.site_content_definitions d on d.key = c.key
where not exists (
  select 1
  from private.site_content_revisions r
  where r.content_key = c.key and r.version = 1
);

insert into public.permissions (key, description)
values
  ('content.edit', 'Create and update structured site content drafts.'),
  ('content.publish', 'Publish or roll back structured site content.')
on conflict (key) do update set description = excluded.description;

insert into public.staff_role_permissions (role_key, permission_key)
values
  ('owner', 'content.edit'),
  ('owner', 'content.publish')
on conflict (role_key, permission_key) do nothing;

create or replace function public.public_site_content()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(c.key, c.published_value order by c.key),
    '{}'::jsonb
  )
  from private.site_content c
  where c.published_value is not null;
$$;

create or replace function public.staff_list_site_content()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entries jsonb;
begin
  if not public.has_staff_permission('content.edit') then
    raise exception 'Content edit permission required' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', c.key,
        'type', d.value_type,
        'description', d.description,
        'value', c.draft_value,
        'draftValue', c.draft_value,
        'publishedValue', c.published_value,
        'version', c.current_version,
        'publishedVersion', c.published_version,
        'status', case
          when c.published_version = c.current_version then 'published'
          else 'draft'
        end,
        'updatedAt', c.updated_at,
        'publishedAt', c.published_at
      )
      order by c.key
    ),
    '[]'::jsonb
  )
  into v_entries
  from private.site_content c
  join private.site_content_definitions d on d.key = c.key;

  return v_entries;
end;
$$;

create or replace function public.staff_mutate_site_content(
  p_key text,
  p_value jsonb,
  p_action text,
  p_reason text,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_type text;
  v_max_length integer;
  v_current_version bigint;
  v_published_version bigint;
  v_draft jsonb;
  v_published jsonb;
  v_next jsonb;
  v_text text;
  v_next_version bigint;
  v_state text;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.has_staff_permission('content.edit') then
    raise exception 'Content edit permission required' using errcode = '42501';
  end if;
  if v_action not in ('save_draft', 'publish', 'rollback') then
    raise exception 'Invalid content action';
  end if;
  if v_action in ('publish', 'rollback')
     and not public.has_staff_permission('content.publish') then
    raise exception 'Content publish permission required' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'A reason between 5 and 500 characters is required';
  end if;

  select d.value_type, d.max_length
    into v_type, v_max_length
  from private.site_content_definitions d
  where d.key = v_key;
  if v_type is null then raise exception 'Unknown content key'; end if;

  select c.current_version, c.published_version, c.draft_value, c.published_value
    into v_current_version, v_published_version, v_draft, v_published
  from private.site_content c
  where c.key = v_key
  for update;
  if v_current_version is null then raise exception 'Content entry is not initialized'; end if;
  if p_expected_version is null or p_expected_version is distinct from v_current_version then
    raise exception 'Content changed since it was loaded' using errcode = '40001';
  end if;

  if p_value is not null then
    if jsonb_typeof(p_value) is distinct from v_type then
      raise exception 'Content value has the wrong type';
    end if;
    if v_type = 'string' then
      v_text := btrim(p_value #>> '{}');
      if char_length(v_text) not between 1 and v_max_length
         or position('<' in v_text) > 0
         or position('>' in v_text) > 0
         or regexp_replace(v_text, E'[\n\r\t]', '', 'g') ~ '[[:cntrl:]]' then
        raise exception 'Content must be bounded plain text without HTML';
      end if;
      v_next := to_jsonb(v_text);
    else
      v_next := p_value;
    end if;
  end if;

  v_next_version := v_current_version + 1;
  if v_action = 'save_draft' then
    if v_next is null then raise exception 'Draft content is required'; end if;
    update private.site_content
    set draft_value = v_next,
        current_version = v_next_version,
        updated_by = v_actor,
        updated_at = timezone('utc', now())
    where key = v_key;
    v_state := 'draft';
  elsif v_action = 'publish' then
    v_next := coalesce(v_next, v_draft);
    if v_next is null then raise exception 'Draft content is required'; end if;
    update private.site_content
    set draft_value = v_next,
        published_value = v_next,
        current_version = v_next_version,
        published_version = v_next_version,
        updated_by = v_actor,
        updated_at = timezone('utc', now()),
        published_at = timezone('utc', now())
    where key = v_key;
    v_state := 'published';
  else
    select r.value
      into v_next
    from private.site_content_revisions r
    where r.content_key = v_key
      and r.state in ('published', 'rollback')
      and r.version < coalesce(v_published_version, v_current_version)
    order by r.version desc
    limit 1;
    if v_next is null then raise exception 'No earlier published version is available'; end if;
    update private.site_content
    set draft_value = v_next,
        published_value = v_next,
        current_version = v_next_version,
        published_version = v_next_version,
        updated_by = v_actor,
        updated_at = timezone('utc', now()),
        published_at = timezone('utc', now())
    where key = v_key;
    v_state := 'rollback';
  end if;

  insert into private.site_content_revisions (
    content_key, version, value_type, value, state, actor_id, reason
  ) values (
    v_key, v_next_version, v_type, v_next, v_state, v_actor, v_reason
  );

  select c.draft_value, c.published_value, c.published_version
    into v_draft, v_published, v_published_version
  from private.site_content c
  where c.key = v_key;

  return jsonb_build_object(
    'key', v_key,
    'type', v_type,
    'value', v_draft,
    'draftValue', v_draft,
    'publishedValue', v_published,
    'version', v_next_version,
    'publishedVersion', v_published_version,
    'status', case when v_published_version = v_next_version then 'published' else 'draft' end,
    'action', v_action
  );
end;
$$;

revoke execute on function public.public_site_content() from public, anon, authenticated;
grant execute on function public.public_site_content() to anon, authenticated, service_role;

revoke execute on function public.staff_list_site_content() from public, anon;
grant execute on function public.staff_list_site_content() to authenticated;

revoke execute on function public.staff_mutate_site_content(text,jsonb,text,text,bigint)
  from public, anon;
grant execute on function public.staff_mutate_site_content(text,jsonb,text,text,bigint)
  to authenticated;

comment on function public.public_site_content()
  is 'Public read-only projection of published, schema-defined plain-text and boolean content.';
comment on function public.staff_list_site_content()
  is 'Discord staff content workspace projection; requires content.edit.';
comment on function public.staff_mutate_site_content(text,jsonb,text,text,bigint)
  is 'Optimistic, versioned draft/publish/rollback boundary with immutable revisions.';

commit;
