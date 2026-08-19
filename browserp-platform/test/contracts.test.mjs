import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  SERVER_SUBMISSION_RPC,
  buildServerSubmissionRpcPayload
} from "../api/submissions.js";

const root = resolve(import.meta.dirname, "..");
const migrationDirectory = join(root, "supabase", "migrations");

function migration(name) {
  return readFileSync(join(migrationDirectory, name), "utf8");
}

test("privileged submissions use the production RPC name and payload contract", () => {
  const source = readFileSync(join(root, "api", "submissions.js"), "utf8");
  assert.equal(SERVER_SUBMISSION_RPC, "create_server_submission_server");
  assert.doesNotMatch(source, /developmentCatalogAllowed|rpc\("create_server_submission"/);
  assert.deepEqual(buildServerSubmissionRpcPayload("user-123", {
    name: "Northstar RP",
    platform: "fivem",
    region: "Europe",
    language: "English",
    framework: "QBCore",
    description: "A sufficiently detailed community description for review.",
    communityUrl: "https://example.com/community"
  }, {
    confidence: "likely_safe",
    score: 12,
    reasons: ["manual-review"]
  }), {
    p_user_id: "user-123",
    p_name: "Northstar RP",
    p_platform_id: "fivem",
    p_region: "Europe",
    p_language: "English",
    p_framework: "QBCore",
    p_description: "A sufficiently detailed community description for review.",
    p_community_url: "https://example.com/community",
    p_moderation_confidence: "likely_safe",
    p_moderation_score: 12,
    p_moderation_reasons: ["manual-review"]
  });
});

test("repository migrations reproduce the applied production history", () => {
  const names = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort();
  const productionHistory = [
    "20260819110256_server_slug_lookup.sql",
    "20260819112534_staff_review_details.sql",
    "20260819113549_staff_review_invoker.sql",
    "20260819114235_server_submission_boundary.sql",
    "20260819143942_critical_security_boundaries.sql",
    "20260819143947_public_server_join_links.sql",
    "20260819151759_release_hardening.sql",
    "20260819164347_v2_application_boundaries.sql",
    "20260819174759_discord_staff_role_allowlist.sql"
  ];

  for (const name of productionHistory) assert.ok(names.includes(name), name);
  assert.ok(!names.includes("20260819120000_server_only_submission.sql"));
  assert.ok(!names.includes("20260819130000_release_hardening.sql"));

  const allSql = names.map(migration).join("\n");
  assert.doesNotMatch(allSql, /create_server_submission_trusted/i);

  const submission = migration("20260819114235_server_submission_boundary.sql");
  assert.match(submission, /create or replace function public\.create_server_submission_server\s*\(/i);
  assert.match(submission, /security definer\s+set search_path = ''/i);
  assert.match(submission, /revoke execute[\s\S]*from public, anon, authenticated;/i);
  assert.match(submission, /grant execute[\s\S]*to service_role;/i);
  assert.match(submission, /status in \('pending_review', 'changes_requested'\)/i);
  assert.match(submission, /!~\* '\^https:\/\/'/i);
});

test("published listings expose only a reviewed HTTPS community link", () => {
  const directory = migration("20260819143947_public_server_join_links.sql");
  const app = readFileSync(join(root, "public", "app.js"), "utf8");
  const portal = readFileSync(join(root, "public", "portal.js"), "utf8");

  assert.match(directory, /where s\.status = 'published'/i);
  assert.match(directory, /s\.age_rating <> 'adult'/i);
  assert.match(directory, /p_slug text/);
  assert.match(directory, /s\.slug = lower\(trim\(p_slug\)\)/i);
  assert.match(directory, /case when s\.community_url ~\* '\^https:\/\/' then s\.community_url else null end as community_url/i);
  assert.match(directory, /revoke all on function public\.search_server_directory\(text,text,text,text,boolean,boolean,boolean,text,integer\) from public;/i);
  assert.match(directory, /grant execute on function public\.search_server_directory\(text,text,text,text,boolean,boolean,boolean,text,integer\) to anon, authenticated;/i);
  assert.match(directory, /revoke all on function public\.search_server_directory[\s\S]*from public;/i);
  assert.match(directory, /grant execute on function public\.search_server_directory[\s\S]*to anon, authenticated;/i);
  assert.match(app, /function safeHttpsUrl\(/);
  assert.match(portal, /const safeHttpsUrl = \(value\) =>/);
  assert.match(app, /rel=\"nofollow noopener noreferrer\"/);
  assert.match(portal, /rel=\"nofollow noopener noreferrer\"/);
});

test("staff evidence ends as SECURITY INVOKER and accepts production's flat response", () => {
  const details = migration("20260819112534_staff_review_details.sql");
  const invoker = migration("20260819113549_staff_review_invoker.sql");
  const portal = readFileSync(join(root, "public", "portal.js"), "utf8");

  assert.match(details, /security definer/i);
  assert.match(invoker, /alter function public\.staff_review_item\(text, text\) security invoker;/i);
  assert.match(details, /'kind', 'listing', 'id', s\.id/i);
  assert.match(portal, /item\?\.record \|\| item\?\.item \|\| item \|\| \{\}/);
});

test("the staff panel is a separate MFA-aware multi-page workspace", () => {
  const staff = readFileSync(join(root, "public", "staffpanel-v3.js"), "utf8");
  const login = readFileSync(join(root, "public", "staffpanel.html"), "utf8");
  const accounts = readFileSync(join(root, "public", "staffpanel-accounts.html"), "utf8");
  const vercel = readFileSync(join(root, "vercel.json"), "utf8");

  assert.match(staff, /\/api\/auth\/mfa\/enroll/);
  assert.match(staff, /\/api\/auth\/mfa\/verify/);
  assert.match(staff, /\/api\/admin\/permissions/);
  assert.match(staff, /Request IP/);
  assert.doesNotMatch(staff, /innerHTML/);
  assert.match(login, /noindex,nofollow,noarchive,nosnippet/);
  assert.match(accounts, /Full IP addresses are protected/);
  assert.match(vercel, /"source": "\/staffpanel\/accounts"/);
  assert.doesNotMatch(vercel, /"source": "\/staff"/);
});

test("critical security migration closes staff and fulfillment bypasses", () => {
  const security = migration("20260819143942_critical_security_boundaries.sql");
  const hardening = migration("20260819151759_release_hardening.sql");

  assert.match(security, /'providers'[\s\S]*= '\["discord"\]'::jsonb/i);
  assert.match(security, /from auth\.identities[\s\S]*i\.provider is distinct from 'discord'/i);
  assert.match(security, /and 1 = \([\s\S]*select count\(\*\)[\s\S]*from auth\.identities/i);
  assert.match(security, /join private\.discord_owner_allowlist[\s\S]*and a\.enabled/i);
  assert.match(security, /on conflict \(user_id\) do nothing;/i);
  assert.doesNotMatch(security, /on conflict \(user_id\) do update[\s\S]*status\s*=\s*'active'/i);
  assert.match(security, /tg_op = 'DELETE'[\s\S]*status = 'suspended'/i);
  assert.match(security, /multiple_identities_present/i);
  assert.match(security, /create trigger on_auth_staff_identity_changed[\s\S]*after insert or delete or update/i);

  assert.match(security, /nullif\(btrim\(p_fulfillment_secret\), ''\) is null/i);
  assert.match(security, /crypt\(p_fulfillment_secret, v_hash\) is distinct from v_hash/i);
  assert.match(security, /hashtextextended\(least\(p_stripe_event_id, p_stripe_session_id\), 0\)/i);
  assert.match(security, /hashtextextended\(greatest\(p_stripe_event_id, p_stripe_session_id\), 0\)/i);
  assert.ok(
    security.indexOf("where stripe_session_id = p_stripe_session_id")
      < security.indexOf("from public.promotion_products"),
    "idempotent replays must be returned before consulting the mutable catalog"
  );
  assert.match(security, /revoke execute on function public\.fulfill_stripe_checkout[\s\S]*from public, anon, authenticated;/i);
  assert.match(security, /grant execute on function public\.fulfill_stripe_checkout[\s\S]*to service_role;/i);

  assert.match(hardening, /revoke execute on function public\.create_server_submission[\s\S]*from public, anon, authenticated, service_role;/i);
  assert.doesNotMatch(hardening, /grant execute on function public\.create_server_submission[\s\S]*to service_role;/i);
});

test("production routes and legacy APIs match the deployed schema", () => {
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  const serverRoute = vercel.rewrites.find((rewrite) => rewrite.source === "/server/:slug");
  const resources = readFileSync(join(root, "api", "resources.js"), "utf8");

  assert.equal(serverRoute?.destination, "/server?slug=:slug");
  assert.match(resources, /resource_directory\?select=\*&order=published_at\.desc/);
  assert.doesNotMatch(resources, /featured\.desc|created_at\.desc/);
});

test("Stripe launch gates fail closed and local secret files are ignored", () => {
  const checkout = readFileSync(join(root, "api", "checkout.js"), "utf8");
  const webhook = readFileSync(join(root, "api", "webhooks", "stripe.js"), "utf8");
  const config = readFileSync(join(root, "lib", "config.js"), "utf8");
  const http = readFileSync(join(root, "lib", "http.js"), "utf8");
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");

  assert.match(checkout, /const quantity = Number\(body\.quantity \?\? 1\)/);
  assert.match(checkout, /integrationIdentifier\(`\$\{session\.user\.id\}:\$\{attemptId\}`\)/);
  assert.match(checkout, /await stripePrice\(price\)/);
  assert.match(webhook, /event\.livemode !== stripe\.liveMode/);
  assert.match(webhook, /verifyCheckoutMetadataSignature\(session\.metadata, stripe\.fulfillmentSecret\)/);
  assert.match(webhook, /browserp_integration !== "browserp_checkout_v1"[\s\S]*ignored: true/);
  assert.doesNotMatch(webhook, /browserp_product_key \|\| productKey/);
  assert.match(config, /expectedKeyMode = productionDeployment \? "live" : "test"/);
  assert.match(config, /fulfillmentReady: Boolean\(fulfillmentEnabled &&/);
  const rawBodyFunction = http.match(/export async function readRawBody[\s\S]*?\n}\n/)?.[0] || "";
  assert.ok(rawBodyFunction);
  assert.doesNotMatch(rawBodyFunction, /req\.body/);
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(ignore, /^\.vercel\/$/m);
  assert.match(ignore, /^\.npmrc$/m);
});
