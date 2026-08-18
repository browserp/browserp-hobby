-- Tighten automatically granted function privileges and cover foreign keys.
begin;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.prevent_mutation() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.detect_mass_ban_pattern() from public, anon, authenticated;

revoke execute on function public.create_server_submission(text,text,text,text,text,text,text,text,integer,jsonb) from public, anon;
grant execute on function public.create_server_submission(text,text,text,text,text,text,text,text,integer,jsonb) to authenticated;

revoke execute on function public.daily_boost_balance() from public, anon;
grant execute on function public.daily_boost_balance() to authenticated;

revoke execute on function public.grant_daily_boost(uuid) from public, anon;
grant execute on function public.grant_daily_boost(uuid) to authenticated;

revoke execute on function public.member_dashboard_overview() from public, anon;
grant execute on function public.member_dashboard_overview() to authenticated;

revoke execute on function public.promotion_credit_balance(uuid) from public, anon;
grant execute on function public.promotion_credit_balance(uuid) to authenticated;

revoke execute on function public.staff_dashboard_overview() from public, anon;
grant execute on function public.staff_dashboard_overview() to authenticated;

revoke execute on function public.fulfill_stripe_checkout(text,text,text,uuid,text,integer,integer,text,jsonb) from public, authenticated;
grant execute on function public.fulfill_stripe_checkout(text,text,text,uuid,text,integer,integer,text,jsonb) to anon;

-- These are intentionally public, narrowly validated RPC boundaries.
revoke execute on function public.consume_rate_limit(text,text,integer,integer) from public;
grant execute on function public.consume_rate_limit(text,text,integer,integer) to anon, authenticated;
revoke execute on function public.has_staff_permission(text) from public;
grant execute on function public.has_staff_permission(text) to anon, authenticated;
revoke execute on function public.public_overview() from public;
grant execute on function public.public_overview() to anon, authenticated;
revoke execute on function public.record_tool_run(text) from public;
grant execute on function public.record_tool_run(text) to anon, authenticated;
revoke execute on function public.search_server_directory(text,text,text,boolean,boolean,boolean,text,integer) from public;
grant execute on function public.search_server_directory(text,text,text,boolean,boolean,boolean,text,integer) to anon, authenticated;

-- Explicit deny policies document that direct access is never permitted.
create policy rate_limit_buckets_no_direct_access on public.rate_limit_buckets
  as restrictive for all to public using (false) with check (false);
create policy tool_events_no_direct_access on public.tool_events
  as restrictive for all to public using (false) with check (false);

create index if not exists ad_campaigns_image_asset_idx on public.ad_campaigns(image_asset_id);
create index if not exists ad_campaigns_owner_idx on public.ad_campaigns(owner_id);
create index if not exists ad_campaigns_server_idx on public.ad_campaigns(server_id);
create index if not exists applications_applicant_idx on public.applications(applicant_id);
create index if not exists applications_reviewer_idx on public.applications(reviewed_by);
create index if not exists ban_appeals_appellant_idx on public.ban_appeals(appellant_id);
create index if not exists ban_appeals_reviewer_idx on public.ban_appeals(reviewed_by);
create index if not exists bans_actor_idx on public.bans(actor_id);
create index if not exists bans_revoked_by_idx on public.bans(revoked_by);
create index if not exists bans_user_idx on public.bans(user_id);
create index if not exists blog_posts_author_idx on public.blog_posts(author_id);
create index if not exists boosts_actor_idx on public.boosts(actor_id);
create index if not exists developer_services_developer_idx on public.developer_services(developer_id);
create index if not exists favorites_server_idx on public.favorites(server_id);
create index if not exists moderation_queue_assignee_idx on public.moderation_queue(assigned_to);
create index if not exists moderation_queue_resolver_idx on public.moderation_queue(resolved_by);
create index if not exists promotion_credit_ledger_creator_idx on public.promotion_credit_ledger(created_by);
create index if not exists promotion_credit_ledger_user_idx on public.promotion_credit_ledger(user_id);
create index if not exists promotion_orders_product_idx on public.promotion_orders(product_key);
create index if not exists promotion_orders_user_idx on public.promotion_orders(user_id);
create index if not exists reports_assignee_idx on public.reports(assigned_to);
create index if not exists reports_reporter_idx on public.reports(reporter_id);
create index if not exists resource_downloads_user_idx on public.resource_downloads(user_id);
create index if not exists resources_author_idx on public.resources(author_id);
create index if not exists resources_asset_idx on public.resources(download_asset_id);
create index if not exists resources_platform_idx on public.resources(platform_id);
create index if not exists review_reactions_user_idx on public.review_reactions(user_id);
create index if not exists reviews_author_idx on public.reviews(author_id);
create index if not exists security_events_actor_idx on public.security_events(actor_id);
create index if not exists security_events_resolver_idx on public.security_events(resolved_by);
create index if not exists server_categories_category_idx on public.server_categories(category_id);
create index if not exists server_submissions_platform_idx on public.server_submissions(platform_id);
create index if not exists server_submissions_reviewer_idx on public.server_submissions(reviewed_by);
create index if not exists server_submissions_submitter_idx on public.server_submissions(submitted_by);
create index if not exists servers_owner_idx on public.servers(owner_id);
create index if not exists servers_platform_idx on public.servers(platform_id);
create index if not exists staff_memberships_granter_idx on public.staff_memberships(granted_by);
create index if not exists staff_memberships_role_idx on public.staff_memberships(role_key);
create index if not exists staff_role_permissions_permission_idx on public.staff_role_permissions(permission_key);
create index if not exists system_settings_updater_idx on public.system_settings(updated_by);
create index if not exists tool_events_user_idx on public.tool_events(user_id);
create index if not exists uploaded_assets_owner_idx on public.uploaded_assets(owner_id);
create index if not exists uploaded_assets_reviewer_idx on public.uploaded_assets(reviewed_by);
create index if not exists user_badges_awarder_idx on public.user_badges(awarded_by);
create index if not exists user_badges_badge_idx on public.user_badges(badge_id);

commit;
