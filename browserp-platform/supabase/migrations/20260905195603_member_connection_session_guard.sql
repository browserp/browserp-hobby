-- Account identity changes require the original, recent OAuth authentication,
-- not the issue time of a refreshed JWT. The lookup returns only the caller's
-- own eligibility; auth session rows and other members' data stay private.
create or replace function public.member_connection_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  claims jsonb := (select auth.jwt());
  active boolean := false;
  staff boolean := false;
  authenticated_at numeric;
begin
  active := coalesce(private.member_access_allowed(),false);
  if active then
    active := exists(select 1 from auth.sessions s where s.user_id=actor
      and s.id::text=claims->>'session_id' and (s.not_after is null or s.not_after>now()));
  end if;
  if not active then return jsonb_build_object('active',false); end if;
  staff := exists(select 1 from public.staff_memberships where user_id=actor);
  select max((entry->>'timestamp')::numeric) into authenticated_at
    from jsonb_array_elements(case when jsonb_typeof(claims->'amr')='array' then claims->'amr' else '[]'::jsonb end) entry
    where entry->>'method'='oauth' and jsonb_typeof(entry->'timestamp')='number'
      and entry->>'timestamp' ~ '^[0-9]{1,12}$';
  return jsonb_build_object('active',true,'staff',staff,'userId',actor,
    'sessionId',claims->>'session_id','authenticatedAt',authenticated_at,
    'recent',coalesce(authenticated_at between extract(epoch from now())-600 and extract(epoch from now())+30,false));
end;
$$;
revoke all on function public.member_connection_status() from public,anon,authenticated,service_role;
grant execute on function public.member_connection_status() to authenticated;

-- Serialise website unlink requests across tabs and devices. A bounded lease
-- survives an ambiguous provider timeout so retries first reread actual state.
create table if not exists private.member_connection_operations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null
);
alter table private.member_connection_operations enable row level security;
revoke all on table private.member_connection_operations from public,anon,authenticated,service_role;

create or replace function public.member_connection_operation(p_action text,p_token uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  access jsonb := public.member_connection_status();
  operation uuid;
begin
  if not coalesce((access->>'active')::boolean,false) then raise exception 'Sign in again to manage connected accounts.' using errcode='PT401'; end if;
  if coalesce((access->>'staff')::boolean,false) then raise exception 'Staff accounts must keep their assigned Discord sign-in.' using errcode='42501'; end if;
  if p_action='release' then
    delete from private.member_connection_operations where user_id=actor and token=p_token;
    return null;
  end if;
  if p_action is distinct from 'begin' then raise exception 'Choose a valid account action.' using errcode='22023'; end if;
  if not coalesce((access->>'recent')::boolean,false) then raise exception 'Sign in again before changing your connected accounts.' using errcode='PT428'; end if;
  perform private.enforce_member_rate_limit('account-connections',6,600);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-connections:'||actor::text,0));
  delete from private.member_connection_operations where user_id=actor and expires_at<=now();
  if exists(select 1 from private.member_connection_operations where user_id=actor) then
    raise exception 'Another account change is finishing. Wait a moment, then refresh your connections.' using errcode='PT409';
  end if;
  operation := pg_catalog.gen_random_uuid();
  insert into private.member_connection_operations values(actor,operation,now()+interval '90 seconds');
  return operation;
end;
$$;
revoke all on function public.member_connection_operation(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.member_connection_operation(text,uuid) to authenticated;
