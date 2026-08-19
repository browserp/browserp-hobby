import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const migration = readFileSync(resolve(root, "supabase/migrations/20260819174759_discord_staff_role_allowlist.sql"), "utf8");
const router = readFileSync(resolve(root, "api/router.js"), "utf8");
const devServer = readFileSync(resolve(root, "dev-server.mjs"), "utf8");
const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));

test("staff access migration keeps a single protected owner and role-aware provisioning", () => {
  assert.match(migration, /add column if not exists role_key text/i);
  assert.match(migration, /discord_owner_allowlist_single_owner_idx[\s\S]*where enabled and role_key = 'owner'/i);
  assert.match(migration, /sm\.role_key = 'owner'[\s\S]*sm\.status = 'active'/i);
  assert.match(migration, /join private\.discord_owner_allowlist a[\s\S]*and a\.enabled[\s\S]*and a\.role_key = sm\.role_key/i);
  assert.match(migration, /create or replace function private\.grant_discord_owner/i);
  assert.match(migration, /values \(p_user_id, v_role_key, 'active'/i);
  assert.match(migration, /on conflict \(user_id\) do nothing/i);
  assert.match(migration, /function private\.staff_access_snapshot\(p_discord_user_id text\)[\s\S]*language sql\s+volatile/i);
  assert.doesNotMatch(migration, /on conflict \(user_id\) do update[\s\S]*status\s*=\s*'active'[\s\S]*private\.grant_discord_owner/i);
});

test("only the protected owner can mutate non-owner ranks with versioning and audit", () => {
  assert.match(migration, /create or replace function public\.staff_list_access\(\)/i);
  assert.match(migration, /create or replace function public\.staff_mutate_access\(/i);
  assert.match(migration, /role_key = 'owner'[\s\S]*Owner permission required/i);
  assert.match(migration, /v_existing\.role_key = 'owner'[\s\S]*protected owner cannot be changed/i);
  assert.match(migration, /administrator', 'senior_moderator', 'moderator', 'support'/i);
  assert.doesNotMatch(migration, /v_role_key not in \([^)]*'owner'/i);
  assert.match(migration, /v_existing\.version <> p_expected_version/i);
  assert.match(migration, /p_request_id !~\* '\^\[0-9a-f\][\s\S]*pg_advisory_xact_lock/i);
  assert.match(migration, /staff\.access\.' \|\| v_action/i);
  assert.match(migration, /insert into public\.staff_audit_events/i);
  assert.match(migration, /grant execute on function public\.staff_mutate_access[\s\S]*to authenticated/i);
});

test("private Discord identifiers are operational data rather than source code", () => {
  assert.doesNotMatch(migration, /values\s*\(\s*'[0-9]{17,20}'/i);
});

test("consolidated admin router validates and forwards owner staff mutations", () => {
  assert.match(router, /function staffAccessMutation\(body\)/);
  assert.match(router, /\^\[0-9\]\{17,20\}\$/);
  assert.match(router, /"admin\/staff": endpoint\(\["GET", "POST"\]/);
  assert.match(router, /rpc\("staff_list_access"/);
  assert.match(router, /rpc\("staff_mutate_access"/);
  assert.match(router, /p_expected_version: body\.expectedVersion/);
  assert.match(router, /p_request_id: id/);
  assert.match(router, /sanitizePlainText\(body\.reason, 500\)/);
  assert.match(migration, /reason between 5 and 500 characters/i);
  assert.ok(vercel.rewrites.some((rewrite) => rewrite.source === "/api/admin/staff" && rewrite.destination === "/api/router?_route=admin/staff"));
  assert.match(devServer, /\["GET \/api\/admin\/staff", \["api\/router\.js", "admin\/staff"\]\]/);
  assert.match(devServer, /\["POST \/api\/admin\/staff", \["api\/router\.js", "admin\/staff"\]\]/);
});
