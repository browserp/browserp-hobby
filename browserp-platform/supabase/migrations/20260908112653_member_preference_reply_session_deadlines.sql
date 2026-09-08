begin;

-- These write paths can wait after their initial authorization. Retain the
-- existing member boundary, but do not extend session/ban deadlines to the
-- transaction's fixed now(). This helper is private and runs only within the
-- authenticated SECURITY DEFINER RPCs below.
create function private.require_member_write_session(p_actor uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare checked_at timestamptz;
begin
  if p_actor is distinct from private.require_active_member() then
    raise exception 'An active, unrestricted sign-in is required.' using errcode='42501';
  end if;
  checked_at:=clock_timestamp();
  if not exists(select 1 from auth.sessions s where s.user_id=p_actor
      and s.id::text=(select auth.jwt())->>'session_id'
      and (s.not_after is null or s.not_after>checked_at))
    or exists(select 1 from public.security_bans b where b.user_id=p_actor
      and b.target_type='account' and b.revoked_at is null
      and b.starts_at<=checked_at and (b.ends_at is null or b.ends_at>checked_at)) then
    raise exception 'An active, unrestricted sign-in is required.' using errcode='42501';
  end if;
end;
$$;
revoke all on function private.require_member_write_session(uuid) from public,anon,authenticated,service_role;

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
  perform private.require_member_write_session(actor);
  select coalesce((select version from private.member_recommendation_preferences where user_id = actor), 0) into current_version;

  if p_choice = 'accepted' then
    if p_expected_version <> current_version or current_version = 9007199254740991 then
      raise exception 'Your preference changed. Refresh it before choosing to allow recommendations again.' using errcode = 'PT409';
    end if;
    perform private.enforce_member_rate_limit('recommendation-accept', 30, 600);
  end if;
  perform private.require_member_write_session(actor);
  -- Rejection stays outside the acceptance quota and ignores an obsolete
  -- expected version. At the maximum JSON-safe version it remains possible,
  -- while acceptance stays disabled instead of reusing a consent token.
  insert into private.member_recommendation_preferences (user_id, schema_version, choice, version, updated_at)
  values (actor, 1, p_choice, least(current_version + 1, 9007199254740991), clock_timestamp())
  on conflict (user_id) do update set
    schema_version = excluded.schema_version,
    choice = excluded.choice,
    version = excluded.version,
    updated_at = excluded.updated_at
  returning * into preference;

  -- A delayed write must roll back along with its quota update if access ended.
  perform private.require_member_write_session(actor);
  return jsonb_build_object(
    'accountId', actor, 'schemaVersion', preference.schema_version,
    'choice', preference.choice, 'version', preference.version,
    'updatedAt', preference.updated_at
  );
end;
$$;
revoke all on function public.member_set_recommendation_preferences(integer,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.member_set_recommendation_preferences(integer,text,bigint) to authenticated;

create or replace function public.member_server_comment_reply(p_server_id uuid,p_parent_comment_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_active_member(); result jsonb;
begin
  -- Retain eligibility while the comment and its review entry are created.
  perform 1 from public.servers where id=p_server_id and status='published' and age_rating<>'adult' for share;
  if not found then raise exception 'Server not found.' using errcode='PT404'; end if;
  perform 1 from public.server_comments where id=p_parent_comment_id and server_id=p_server_id and status='published' for share;
  if not found then raise exception 'This comment is unavailable for replies.' using errcode='PT404'; end if;
  perform private.require_member_write_session(actor);

  -- The existing RPC still owns body validation, the single quota charge and
  -- ordinary moderation. A failure after it returns rolls all its writes back.
  result:=public.member_server_interaction(p_server_id,'comment',p_body,null);
  perform private.require_member_write_session(actor);
  update public.server_comments set parent_comment_id=p_parent_comment_id
    where id=(result->>'id')::uuid and server_id=p_server_id
      and author_id=actor and status='pending_review';
  if not found then raise exception 'The reply could not be created.' using errcode='PT409'; end if;
  perform private.require_member_write_session(actor);
  return result||jsonb_build_object('parentCommentId',p_parent_comment_id);
end;
$$;
revoke all on function public.member_server_comment_reply(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.member_server_comment_reply(uuid,uuid,text) to authenticated;

notify pgrst,'reload schema';
commit;
