-- Persist member favourites and make dashboard notifications actionable.
begin;

create or replace function public.member_favorite_ids()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
  ) end;
$$;

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
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  update public.notifications
  set read_at = timezone('utc', now())
  where user_id = v_user and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
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
    'servers', (select coalesce(jsonb_agg(to_jsonb(s) order by s.updated_at desc),'[]'::jsonb) from (select id,name,slug,status,verified,updated_at from public.servers where owner_id=(select auth.uid()) order by updated_at desc limit 20) s),
    'submissions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (select id,name,status,created_at from public.server_submissions where submitted_by=(select auth.uid()) order by created_at desc limit 20) x),
    'favoriteServers', (select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc),'[]'::jsonb) from (select s.id,s.name,s.slug,fa.created_at from public.favorites fa join public.servers s on s.id=fa.server_id where fa.user_id=(select auth.uid()) and s.status='published' and s.age_rating<>'adult' order by fa.created_at desc limit 20) f),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]'::jsonb) from (select id,kind,title,body,action_url,read_at,created_at from public.notifications where user_id=(select auth.uid()) order by created_at desc limit 20) n),
    'promotionCredits', public.promotion_credit_balance(),
    'unreadNotifications', (select count(*) from public.notifications where user_id=(select auth.uid()) and read_at is null),
    'favorites', (select count(*) from public.favorites where user_id=(select auth.uid()))
  ) end;
$$;

revoke all on function public.member_favorite_ids() from public, anon;
revoke all on function public.toggle_favorite(uuid) from public, anon;
revoke all on function public.mark_notifications_read() from public, anon;
revoke all on function public.member_dashboard_overview() from public, anon;
grant execute on function public.member_favorite_ids() to authenticated;
grant execute on function public.toggle_favorite(uuid) to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
grant execute on function public.member_dashboard_overview() to authenticated;

commit;
