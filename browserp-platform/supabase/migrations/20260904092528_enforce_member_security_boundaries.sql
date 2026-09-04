-- Enforce member access at the Data API boundary as well as the website API.
-- Tokens from ended sessions and actively account-banned users cannot mutate
-- records, even when calling an authenticated RPC directly.
create or replace function private.member_access_allowed()
returns boolean language sql stable security definer set search_path='' as $$
 select (select private.has_current_auth_session())
   and exists(select 1 from auth.users u where u.id=(select auth.uid()) and u.deleted_at is null and not coalesce(u.is_anonymous,false))
   and not exists(select 1 from public.security_bans b where b.user_id=(select auth.uid())
     and b.target_type='account' and b.revoked_at is null and b.starts_at<=now()
     and (b.ends_at is null or b.ends_at>now()));
$$;
revoke all on function private.member_access_allowed() from public,anon,authenticated,service_role;

create or replace function private.require_active_member()
returns uuid language plpgsql stable security definer set search_path='' as $$
begin
 if not private.member_access_allowed() then
   raise exception 'An active, unrestricted sign-in is required' using errcode='42501';
 end if;
 return (select auth.uid());
end;
$$;
revoke all on function private.require_active_member() from public,anon,authenticated,service_role;

create or replace function private.enforce_member_rate_limit(p_action text,p_limit integer,p_window_seconds integer)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_active_member();
begin
 if not public.consume_rate_limit(pg_catalog.md5('member:'||actor::text),'member-db:'||p_action,p_limit,p_window_seconds) then
   raise exception 'Too many requests. Please wait and try again.' using errcode='PT429';
 end if;
end;
$$;
revoke all on function private.enforce_member_rate_limit(text,integer,integer) from public,anon,authenticated,service_role;

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
  perform private.require_active_member();
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
revoke execute on function public.grant_daily_boost(uuid) from public,anon,authenticated,service_role;
grant execute on function public.grant_daily_boost(uuid) to authenticated;

create or replace function public.mark_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
begin
  perform private.require_active_member();
  perform private.enforce_member_rate_limit('notification-read',10,300);
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  update public.notifications
  set read_at = timezone('utc', now())
  where user_id = v_user and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.mark_notifications_read() from public,anon,authenticated,service_role;
grant execute on function public.mark_notifications_read() to authenticated;

create or replace function public.member_server_claim(p_server_id uuid,p_message text,p_evidence_url text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); s public.servers%rowtype; c public.server_claim_requests%rowtype; note text:=btrim(coalesce(p_message,'')); evidence text:=nullif(btrim(coalesce(p_evidence_url,'')),''); has_discord boolean;
begin
  perform private.require_active_member();
 if actor is null or not exists(select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=actor and u.deleted_at is null and not coalesce(u.is_anonymous,false)) then raise exception 'Sign in to request a server claim' using errcode='42501'; end if;
 if exists(select 1 from public.security_bans b where b.user_id=actor and b.target_type='account' and b.revoked_at is null and b.starts_at<=now() and (b.ends_at is null or b.ends_at>now())) then raise exception 'This account cannot request a server claim' using errcode='42501'; end if;
 if char_length(note) not between 20 and 2000 or char_length(coalesce(p_request_id,'')) not between 8 and 120 then raise exception 'Explain your connection to the server (20 to 2000 characters)'; end if;
 if evidence is not null and (char_length(evidence)>1000 or evidence !~* '^https://[^/@[:space:]]+([/?][^[:space:]]*)?$') then raise exception 'Evidence must use a valid HTTPS link'; end if;
 select * into c from public.server_claim_requests where claimant_id=actor and request_id=p_request_id;
 if found then if c.server_id<>p_server_id or c.message<>note or c.evidence_url is distinct from evidence then raise exception 'This request identifier was already used'; end if; return private.server_claim_json(c); end if;
 perform pg_advisory_xact_lock(hashtextextended('browserp.server-claim.'||actor::text,0));
 select * into s from public.servers where id=p_server_id for update;
 if not found or s.status<>'published' or s.age_rating='adult' then raise exception 'This server is unavailable'; end if;
 if s.owner_id is not null then raise exception 'This server already has an owner'; end if;
 select * into c from public.server_claim_requests where server_id=s.id and claimant_id=actor and status='pending';
 if found then return private.server_claim_json(c); end if;
 if (select count(*) from public.server_claim_requests where claimant_id=actor and created_at>now()-interval '24 hours')>=5 then raise exception 'You can submit up to five claim requests per day'; end if;
 select exists(select 1 from auth.identities where user_id=actor and provider='discord') into has_discord;
 insert into public.server_claim_requests(server_id,claimant_id,message,evidence_url,community_url,request_id,verification_status)
 values(s.id,actor,note,evidence,s.community_url,p_request_id,case when has_discord then 'pending_check' else 'needs_discord' end) returning * into c;
 return private.server_claim_json(c);
end;
$$;
revoke execute on function public.member_server_claim(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.member_server_claim(uuid,text,text,text) to authenticated;

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
  perform private.require_active_member();
  perform private.enforce_member_rate_limit('server-interaction',20,300);
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
revoke execute on function public.member_server_interaction(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.member_server_interaction(uuid,text,text,text) to authenticated;

create or replace function public.member_set_profile_avatar(p_avatar_url text,p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid := (select auth.uid());
  v_path text;
begin
  perform private.require_active_member();
  perform private.enforce_member_rate_limit('profile-avatar',6,3600);
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select a.object_path into v_path
  from public.uploaded_assets a
  where a.id=p_asset_id and a.owner_id=v_user and a.bucket='profile-media'
    and a.media_type='avatar' and a.mime_type='image/png'
    and a.byte_size between 70 and 1048576 and a.moderation_status in ('quarantined','approved');
  if v_path is null or p_avatar_url !~* '^https://kywabzfgjoqiznnxygbq[.]supabase[.]co/storage/v1/object/public/profile-media/'
     or p_avatar_url not like '%/'||v_path then
    raise exception 'Invalid profile-media upload';
  end if;
  update public.uploaded_assets
  set moderation_status='approved',
      moderation_result=coalesce(moderation_result,'{}'::jsonb)||jsonb_build_object('publication','immediate','safety','validated-raster'),
      reviewed_at=timezone('utc',now()),reviewed_by=null
  where id=p_asset_id;
  update public.profiles set avatar_url=p_avatar_url,updated_at=timezone('utc',now()) where id=v_user;
  if not found then raise exception 'Profile not found'; end if;
  return (select jsonb_build_object(
    'avatarUrl',p.avatar_url,'avatarStatus',p.avatar_review_status,
    'displayName',p.display_name,'bio',p.bio,'bioStatus',p.bio_review_status,
    'visibility',p.profile_visibility
  ) from public.profiles p where p.id=v_user);
end;
$$;
revoke execute on function public.member_set_profile_avatar(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.member_set_profile_avatar(text,uuid) to authenticated;

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
  perform private.require_active_member();
  perform private.enforce_member_rate_limit('profile-update',12,900);
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not private.profile_display_name_allowed(v_name)
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
revoke execute on function public.member_update_profile(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.member_update_profile(text,text,text) to authenticated;

create or replace function public.toggle_favorite(p_server_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_deleted integer;
  v_favorited boolean;
begin
  perform private.require_active_member();
  perform private.enforce_member_rate_limit('favorite-toggle',40,300);
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.servers
    where id = p_server_id and status = 'published' and age_rating <> 'adult'
  ) then raise exception 'Server not found'; end if;

  delete from public.favorites where user_id = v_user and server_id = p_server_id;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    insert into public.favorites (user_id, server_id) values (v_user, p_server_id);
    v_favorited := true;
  else
    v_favorited := false;
  end if;

  return jsonb_build_object(
    'serverId', p_server_id,
    'favorited', v_favorited,
    'count', (select count(*) from public.favorites where user_id = v_user)
  );
end;
$$;
revoke execute on function public.toggle_favorite(uuid) from public,anon,authenticated,service_role;
grant execute on function public.toggle_favorite(uuid) to authenticated;

create or replace function public.daily_boost_balance()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_active_member();
  return (
select jsonb_build_object(
    'dailyAllowance', 3,
    'used', count(*)::integer,
    'remaining', greatest(0, 3 - count(*))::integer
  )
  from public.boosts
  where actor_id = (select auth.uid()) and source='daily_free' and boost_date=timezone('utc', now())::date
  );
end;
$$;
revoke execute on function public.daily_boost_balance() from public,anon,authenticated,service_role;
grant execute on function public.daily_boost_balance() to authenticated;

create or replace function public.promotion_credit_balance(p_user_id uuid default null)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_active_member();
  return (
select coalesce(sum(delta),0)::integer from public.promotion_credit_ledger
  where user_id = coalesce(p_user_id, (select auth.uid()))
    and (p_user_id is null or p_user_id = (select auth.uid()) or public.has_staff_permission('settings.manage'))
  );
end;
$$;
revoke execute on function public.promotion_credit_balance(uuid) from public,anon,authenticated,service_role;
grant execute on function public.promotion_credit_balance(uuid) to authenticated;

create or replace function public.member_favorite_ids()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_active_member();
  return (
select case when (select auth.uid()) is null then '[]'::jsonb else coalesce(
    (
      select jsonb_agg(f.server_id order by f.created_at desc)
      from public.favorites f
      join public.servers s on s.id = f.server_id
      where f.user_id = (select auth.uid())
        and s.status = 'published'
        and s.age_rating <> 'adult'
    ),
    '[]'::jsonb
  ) end
  );
end;
$$;
revoke execute on function public.member_favorite_ids() from public,anon,authenticated,service_role;
grant execute on function public.member_favorite_ids() to authenticated;

create or replace function public.member_dashboard_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_active_member();
  return (
select case when (select auth.uid()) is null then null else jsonb_build_object(
    'profile', (select to_jsonb(p) from (select id,username,display_name,avatar_url,bio,joined_at from public.profiles where id=(select auth.uid())) p),
    'servers', (select coalesce(jsonb_agg(to_jsonb(s) order by s.updated_at desc),'[]'::jsonb) from (select id,name,slug,status,verified,updated_at from public.servers where owner_id=(select auth.uid()) order by updated_at desc limit 20) s),
    'submissions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (select id,name,status,created_at from public.server_submissions where submitted_by=(select auth.uid()) order by created_at desc limit 20) x),
    'favoriteServers', (select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc),'[]'::jsonb) from (select s.id,s.name,s.slug,fa.created_at from public.favorites fa join public.servers s on s.id=fa.server_id where fa.user_id=(select auth.uid()) and s.status='published' and s.age_rating<>'adult' order by fa.created_at desc limit 20) f),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]'::jsonb) from (select id,kind,title,body,action_url,read_at,created_at from public.notifications where user_id=(select auth.uid()) order by created_at desc limit 20) n),
    'promotionCredits', public.promotion_credit_balance(),
    'unreadNotifications', (select count(*) from public.notifications where user_id=(select auth.uid()) and read_at is null),
    'favorites', (select count(*) from public.favorites where user_id=(select auth.uid()))
  ) end
  );
end;
$$;
revoke execute on function public.member_dashboard_overview() from public,anon,authenticated,service_role;
grant execute on function public.member_dashboard_overview() to authenticated;

create or replace function public.member_server_claims(p_server_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); result jsonb;
begin
  perform private.require_active_member();
 if actor is null then raise exception 'Sign in to view your claims' using errcode='42501'; end if;
 select jsonb_build_object('items',coalesce(jsonb_agg(private.server_claim_json(c) order by c.created_at desc),'[]'::jsonb),'total',count(*)) into result from (select * from public.server_claim_requests where claimant_id=actor and (p_server_id is null or server_id=p_server_id) order by created_at desc limit 100) c;
 return result;
end;
$$;
revoke execute on function public.member_server_claims(uuid) from public,anon,authenticated,service_role;
grant execute on function public.member_server_claims(uuid) to authenticated;

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
      and (select private.member_access_allowed())
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
revoke execute on function public.has_staff_permission(text) from public,anon,authenticated,service_role;
grant execute on function public.has_staff_permission(text) to anon,authenticated;

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
      and (select private.member_access_allowed())
      and coalesce((select auth.jwt())->'app_metadata'->>'provider','')='discord'
      and coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"oauth"}]'::jsonb
      and 1=(select count(*) from auth.identities x where x.user_id=sm.user_id)
  );
$$;
revoke execute on function public.staff_mfa_enrollment_allowed() from public,anon,authenticated,service_role;
grant execute on function public.staff_mfa_enrollment_allowed() to authenticated;

