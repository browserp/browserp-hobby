-- Direct Data API reads must honor the same session and profile visibility
-- boundaries as the guarded member APIs and public directory projections.
begin;

-- RLS callers cannot access private schema helpers or raw profiles. Expose
-- only the two boolean decisions needed by these policies, with explicit ACLs.
create or replace function public.member_table_read_allowed()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(private.member_access_allowed(),false);
$$;
revoke all on function public.member_table_read_allowed() from public,anon,authenticated,service_role;
grant execute on function public.member_table_read_allowed() to anon,authenticated;

create or replace function public.profile_is_public(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=p_user_id and p.profile_visibility='public');
$$;
revoke all on function public.profile_is_public(uuid) from public,anon,authenticated,service_role;
grant execute on function public.profile_is_public(uuid) to anon,authenticated;

alter policy servers_public_read on public.servers using (
  (status='published' and age_rating<>'adult')
  or (owner_id=(select auth.uid()) and (select public.member_table_read_allowed()))
  or public.has_staff_permission('servers.review')
);
alter policy server_tags_public_read on public.server_tags using (
  exists(select 1 from public.servers s where s.id=server_id and (
    (s.status='published' and s.age_rating<>'adult')
    or (s.owner_id=(select auth.uid()) and (select public.member_table_read_allowed()))
    or public.has_staff_permission('servers.review')
  ))
);
alter policy server_categories_public_read on public.server_categories using (
  exists(select 1 from public.servers s where s.id=server_id and (
    (s.status='published' and s.age_rating<>'adult')
    or (s.owner_id=(select auth.uid()) and (select public.member_table_read_allowed()))
    or public.has_staff_permission('servers.review')
  ))
);
alter policy reviews_public_read on public.reviews using (
  status='published'
  or (author_id=(select auth.uid()) and (select public.member_table_read_allowed()))
  or public.has_staff_permission('moderation.read')
);
alter policy developers_public_read on public.developer_profiles using (
  (status='published' and public.profile_is_public(user_id))
  or (user_id=(select auth.uid()) and (select public.member_table_read_allowed()))
  or public.has_staff_permission('developers.verify')
);
alter policy services_public_read on public.developer_services using (
  status='published'
  or (developer_id=(select auth.uid()) and (select public.member_table_read_allowed()))
  or public.has_staff_permission('developers.verify')
);
alter policy resources_public_read on public.resources using (
  (status='published' and public.profile_is_public(author_id))
  or (author_id=(select auth.uid()) and (select public.member_table_read_allowed()))
  or public.has_staff_permission('moderation.read')
);
alter policy blog_public_read on public.blog_posts using (
  status='published'
  or (author_id=(select auth.uid()) and (select public.member_table_read_allowed()))
  or public.has_staff_permission('moderation.read')
);

notify pgrst, 'reload schema';
commit;
