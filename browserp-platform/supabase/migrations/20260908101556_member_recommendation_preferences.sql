-- Account-bound optional recommendation consent only. Browsing history,
-- session/security data, theme and user metadata never enter this record.
create table private.member_recommendation_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null check (schema_version = 1),
  choice text not null check (choice in ('accepted', 'rejected')),
  version bigint not null check (version between 1 and 9007199254740991),
  updated_at timestamptz not null
);
alter table private.member_recommendation_preferences enable row level security;
revoke all on table private.member_recommendation_preferences from public, anon, authenticated, service_role;

create or replace function public.member_recommendation_preferences()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := private.require_active_member();
  preference private.member_recommendation_preferences%rowtype;
begin
  select * into preference from private.member_recommendation_preferences where user_id = actor;
  return jsonb_build_object(
    'accountId', actor, 'schemaVersion', 1,
    'choice', preference.choice, 'version', coalesce(preference.version, 0),
    'updatedAt', preference.updated_at
  );
end;
$$;
revoke all on function public.member_recommendation_preferences() from public, anon, authenticated, service_role;
grant execute on function public.member_recommendation_preferences() to authenticated;

create or replace function public.member_set_recommendation_preferences(
  p_schema_version integer, p_choice text, p_expected_version bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.require_active_member();
  current_version bigint;
  preference private.member_recommendation_preferences%rowtype;
begin
  if p_schema_version is distinct from 1 or p_choice is null
     or p_choice not in ('accepted', 'rejected') or p_expected_version is null
     or p_expected_version not between 0 and 9007199254740991 then
    raise exception 'Choose a valid recommendation preference and saved version.' using errcode = 'PT400';
  end if;

  -- This lock also serialises the first write, when no preference row exists.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-recommendations:' || actor::text, 0));
  -- Recheck after waiting for an account write. The shared helper uses now(),
  -- which is fixed at transaction start; check the real session deadline
  -- against clock_timestamp() as well so a wait cannot extend that deadline.
  perform private.require_active_member();
  if not exists (
    select 1 from auth.sessions s where s.user_id = actor
      and s.id::text = (select auth.jwt())->>'session_id'
      and (s.not_after is null or s.not_after > clock_timestamp())
  ) then
    raise exception 'Sign in again before changing recommendation preferences.' using errcode = 'PT401';
  end if;
  select coalesce((select version from private.member_recommendation_preferences where user_id = actor), 0) into current_version;

  if p_choice = 'accepted' then
    if p_expected_version <> current_version or current_version = 9007199254740991 then
      raise exception 'Your preference changed. Refresh it before choosing to allow recommendations again.' using errcode = 'PT409';
    end if;
    perform private.enforce_member_rate_limit('recommendation-accept', 30, 600);
  end if;
  -- Rejection is deliberately outside the acceptance quota and ignores an
  -- obsolete expected version: a late acceptance must not overwrite it.
  -- At the maximum JSON-safe version, rejection remains possible; acceptance
  -- is terminally disabled instead of overflowing or reusing a consent token.
  insert into private.member_recommendation_preferences (user_id, schema_version, choice, version, updated_at)
  values (actor, 1, p_choice, least(current_version + 1, 9007199254740991), clock_timestamp())
  on conflict (user_id) do update set
    schema_version = excluded.schema_version,
    choice = excluded.choice,
    version = excluded.version,
    updated_at = excluded.updated_at
  returning * into preference;

  return jsonb_build_object(
    'accountId', actor, 'schemaVersion', preference.schema_version,
    'choice', preference.choice, 'version', preference.version,
    'updatedAt', preference.updated_at
  );
end;
$$;
revoke all on function public.member_set_recommendation_preferences(integer, text, bigint) from public, anon, authenticated, service_role;
grant execute on function public.member_set_recommendation_preferences(integer, text, bigint) to authenticated;
