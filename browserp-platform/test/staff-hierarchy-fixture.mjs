import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { privacyFileFixture } from "./privacy-file-fixture.mjs";

const base = new URL("../supabase/migrations/", import.meta.url);
export const read = name => readFileSync(new URL(name, base), "utf8");
export const fn = (sql, name) => {
  const match = sql.match(new RegExp(`create(?: or replace)? function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`));
  if (!match) throw new Error(`Missing real function: ${name}`);
  return match[0];
};
const table = (sql, name) => sql.match(new RegExp(`create table(?: if not exists)? ${name.replaceAll(".", "\\.")} \\([\\s\\S]*?\\n\\);`))[0];
export const migrationName = "20260909105431_staff_capability_hierarchy.sql";

export async function staffHierarchyFixture(t, { apply = true } = {}) {
  const h = await privacyFileFixture(t), { db, owner, a, b, sid, admin, call } = h;
  const core = read("202608180001_browserp_core.sql"), ops = read("20260819192413_platform_operations_and_trust.sql");
  const security = read("20260904092528_enforce_member_security_boundaries.sql");
  await admin(`update public.staff_roles set rank=1000 where key='owner';
    alter table private.discord_owner_allowlist add primary key(discord_user_id),add note text,
      add updated_at timestamptz default now(),add version bigint not null default 1;
    update private.discord_owner_allowlist set discord_user_id='111111111111111111' where role_key='owner';
    update auth.identities set provider_id='111111111111111111' where user_id='${owner}';
    alter table auth.users add raw_user_meta_data jsonb default '{}';
    drop table public.staff_permission_overrides;`);
  await admin(table(ops, "public.staff_permission_overrides"));
  for (const name of ["private.network_evidence", "public.network_reveal_requests"]) await admin(table(ops, name));
  await admin(ops.match(/create unique index if not exists security_bans_active_target_idx[\s\S]*?;/)[0]);
  const roleSeed = core.match(/insert into public.staff_roles \(key, name, description, rank, protected\) values[\s\S]*?;/)[0];
  await admin(roleSeed.replace(/;$/, " on conflict(key) do nothing;"));
  // Use the actual permission catalogue seed statements, without applying
  // unrelated hosted extensions or background schedules in this local fixture.
  for (const name of readdirSync(base).filter(x => x.endsWith(".sql") && x < migrationName).sort()) {
    for (const match of read(name).matchAll(/insert into public\.permissions\s*\([^;]*?\)\s*values(?:'(?:''|[^'])*'|[^';])*;/g)) {
      let sql = match[0]; if (!/on conflict/i.test(sql)) sql = sql.replace(/;$/, " on conflict(key) do nothing;");
      await admin(sql);
    }
  }
  for (const match of core.matchAll(/insert into public\.staff_role_permissions \(role_key, permission_key\)[\s\S]*?;/g)) await admin(match[0].replace(/;$/, " on conflict do nothing;"));
  const access = read("20260819174759_discord_staff_role_allowlist.sql");
  await admin(fn(ops.includes("function private.staff_access_snapshot(") ? ops : access, "private.staff_access_snapshot"));
  await admin(fn(ops, "public.staff_mutate_permission"));
  await admin(read("20260903225214_custom_staff_roles.sql"));
  await admin(read("20260903225222_website_overview_announcements.sql"));
  await admin(read("20260903233151_unified_moderation_workspace.sql"));
  await admin(read("20260908101606_account_erasure_preflight.sql"));
  await admin(fn(read("20260908112653_member_preference_reply_session_deadlines.sql"), "private.require_member_write_session"));
  await admin(fn(read("20260820023114_profile_avatar_immediate_name_filter.sql"), "private.profile_display_name_allowed"));
  await admin(fn(security, "public.member_set_profile_avatar"));
  await admin("alter table public.server_comments add parent_comment_id uuid references public.server_comments(id),add edited_at timestamptz;");
  await admin(read("20260909092918_guarded_content_moderation.sql"));
  await admin(read("20260909104051_member_export_content_moderation.sql"));
  await admin(`insert into public.staff_roles(key,name,description,rank,protected,is_custom,version)
    values('custom_full_access','Direct Manager','Existing management role fixture.',799,false,true,2);`);
  const ids = { owner, member: a, otherMember: b };
  const discord = { owner: "111111111111111111" };
  const roles = ["custom_full_access", "head_administrator", "administrator", "senior_moderator", "moderator", "community_moderator", "support"];
  // Create auth/profile rows before assigning the new ranks. Real profile
  // staging stays enabled; the fixture does not bypass the identity guard.
  for (const [i, role] of roles.entries()) {
    ids[role] = `00000000-0000-4000-8000-${String(10 + i).padStart(12, "0")}`;
    discord[role] = String(111111111111110010n + BigInt(i));
    await admin(`begin;insert into auth.users(id) values('${ids[role]}');
      insert into auth.identities(user_id,provider,provider_id) values('${ids[role]}','discord','${discord[role]}');
      insert into auth.sessions(id,user_id) values('${sid(ids[role])}','${ids[role]}');
      insert into public.profiles(id,username,display_name) values('${ids[role]}','fixture_${role}','BrowseRP member');commit;`);
  }
  const login = async (role = "owner", extra = {}) => h.login(ids[role] || role, { aal: "aal2", app_metadata: { provider: "discord" }, ...extra });
  const assignFixtureRoles = async () => {
    for (const role of roles) await admin(`insert into public.staff_memberships(user_id,role_key,reason)
      values('${ids[role]}','${role}','Isolated hierarchy fixture');
      insert into private.discord_owner_allowlist(discord_user_id,enabled,role_key) values('${discord[role]}',true,'${role}');`);
  };
  if (apply) { await admin(read(migrationName)); await assignFixtureRoles(); }
  const mutate = (who, role, action = "assign", version = 0, overrides = {}) => call("staff_mutate_access", [
    discord[who] || who, action, role, overrides.reason || "A reviewed fixture staff change.", version, overrides.key || randomUUID()
  ]);
  const restrict = (target = a, minutes = 60) => call("staff_restrict_account", [target, minutes, "fixture", "A reviewed fixture account restriction.", randomUUID()], "uuid,integer,text,text,text");
  return { ...h, login, ids, discord, mutate, restrict, assignFixtureRoles };
}
