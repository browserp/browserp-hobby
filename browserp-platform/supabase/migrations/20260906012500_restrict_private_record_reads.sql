-- Preserve the existing public API view names and columns before removing
-- raw private-table reads. These views are deliberately public projections:
-- their explicit predicates replace the underlying profile RLS dependency.
-- A security barrier keeps caller predicates outside that visibility boundary.
begin;

create or replace view public.developer_directory
with (security_invoker = false, security_barrier = true)
as
select dp.user_id as id, p.display_name, p.username,
       case when p.avatar_review_status = 'approved' then p.approved_avatar_url else null::text end as avatar_url,
       dp.headline, dp.specialties, dp.portfolio_url, dp.verified, dp.created_at
from public.developer_profiles dp
join public.profiles p on p.id = dp.user_id
where dp.status = 'published' and p.profile_visibility = 'public';

create or replace view public.resource_directory
with (security_invoker = false, security_barrier = true)
as
select r.id, r.title, r.slug, r.summary, r.resource_type, r.download_count as downloads,
       r.published_at, p.name as platform_name, pr.display_name as author_name
from public.resources r
join public.profiles pr on pr.id = r.author_id and pr.profile_visibility = 'public'
left join public.platforms p on p.id = r.platform_id and p.enabled
where r.status = 'published';

-- The views publish only these chosen fields and are not client write routes.
revoke all on table public.developer_directory, public.resource_directory from public, anon, authenticated;
grant select on table public.developer_directory, public.resource_directory to anon, authenticated;

-- A signed access token may remain valid after its Auth session has ended.
-- Private records must therefore pass the existing current-session functions
-- or the guarded website API, rather than an old auth.uid()-only row policy.
-- Preserve service access, RLS, and every existing function grant.
revoke all on table
  public.profiles,
  public.reports,
  public.bans,
  public.ban_appeals,
  public.uploaded_assets,
  public.server_endpoints,
  public.account_trust,
  public.favorites,
  public.notifications,
  public.staff_memberships,
  public.promotion_orders,
  public.promotion_credit_ledger,
  public.boosts,
  public.ad_campaigns,
  public.applications,
  public.server_submissions
from public, anon, authenticated;

-- Column grants are independent of table grants. Clear only client privileges
-- on any explicitly granted columns of these same private records.
do $private_column_access$
declare r record;
begin
  for r in
    select n.nspname, c.relname, string_agg(format('%I', a.attname), ', ' order by a.attnum) columns
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid=a.attrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any(array[
      'profiles','reports','bans','ban_appeals','uploaded_assets','server_endpoints',
      'account_trust','favorites','notifications','staff_memberships','promotion_orders',
      'promotion_credit_ledger','boosts','ad_campaigns','applications','server_submissions'
    ]) and a.attnum>0 and not a.attisdropped and a.attacl is not null
    group by n.nspname,c.relname
  loop
    execute format('revoke all (%s) on table %I.%I from public, anon, authenticated',r.columns,r.nspname,r.relname);
  end loop;
end;
$private_column_access$;

notify pgrst, 'reload schema';
commit;
