import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { securityContext, securityFingerprintContext, unsealAddress } from "../lib/security.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(join(root, "supabase", "migrations", "20260819192413_platform_operations_and_trust.sql"), "utf8");
const interactionAcl = readFileSync(join(root, "supabase", "migrations", "20260819204725_member_interaction_acl.sql"), "utf8");
const router = readFileSync(join(root, "api", "router.js"), "utf8");
const staff = readFileSync(join(root, "public", "staffpanel-v3.js"), "utf8");
const health = readFileSync(join(root, "api", "health.js"), "utf8");

function response() {
  const headers = new Map();
  return {
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); }
  };
}

test("network evidence is masked, keyed, encrypted and recoverable only with the evidence key", () => {
  const oldPrivacy = process.env.PRIVACY_HASH_SECRET;
  const oldEvidence = process.env.NETWORK_EVIDENCE_KEY;
  process.env.PRIVACY_HASH_SECRET = "p".repeat(64);
  process.env.NETWORK_EVIDENCE_KEY = "11".repeat(32);
  try {
    const req = { headers: { "user-agent": "Mozilla/5.0 Windows Chrome/120.0" }, socket: { remoteAddress: "203.0.113.42" } };
    const res = response();
    const context = securityContext(req, res);
    assert.equal(context.maskedNetwork, "203.0.113.0/24");
    assert.equal(context.networkHash.length, 64);
    assert.equal(context.deviceHash.length, 64);
    assert.notEqual(context.networkCiphertext, "203.0.113.42");
    assert.equal(unsealAddress(context.networkCiphertext), "203.0.113.42");
    const fingerprint = securityFingerprintContext(req, res);
    assert.equal(fingerprint.maskedNetwork, "203.0.113.0/24");
    assert.equal(fingerprint.networkHash, context.networkHash);
  } finally {
    if (oldPrivacy === undefined) delete process.env.PRIVACY_HASH_SECRET; else process.env.PRIVACY_HASH_SECRET = oldPrivacy;
    if (oldEvidence === undefined) delete process.env.NETWORK_EVIDENCE_KEY; else process.env.NETWORK_EVIDENCE_KEY = oldEvidence;
  }
});

test("Cloudflare client addresses are trusted only on the proxied BrowseRP host", () => {
  const oldProxy = process.env.CLOUDFLARE_PROXY_ENABLED;
  const oldVercel = process.env.VERCEL;
  const oldPrivacy = process.env.PRIVACY_HASH_SECRET;
  const oldEvidence = process.env.NETWORK_EVIDENCE_KEY;
  process.env.CLOUDFLARE_PROXY_ENABLED = "1";
  process.env.VERCEL = "1";
  process.env.PRIVACY_HASH_SECRET = "p".repeat(64);
  process.env.NETWORK_EVIDENCE_KEY = "22".repeat(32);
  try {
    const base = { "user-agent": "Mozilla/5.0", "cf-ray": "8f1234567890abcd-LHR", "cf-connecting-ip": "198.51.100.44", "x-vercel-forwarded-for": "203.0.113.10" };
    const proxied = securityFingerprintContext({ headers: { ...base, host: "www.browserp.com" }, socket: {} }, response());
    const direct = securityFingerprintContext({ headers: { ...base, host: "browserp-hobby.vercel.app" }, socket: {} }, response());
    assert.equal(proxied.maskedNetwork, "198.51.100.0/24");
    assert.equal(direct.maskedNetwork, "203.0.113.0/24");
  } finally {
    if (oldProxy === undefined) delete process.env.CLOUDFLARE_PROXY_ENABLED; else process.env.CLOUDFLARE_PROXY_ENABLED = oldProxy;
    if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
    if (oldPrivacy === undefined) delete process.env.PRIVACY_HASH_SECRET; else process.env.PRIVACY_HASH_SECRET = oldPrivacy;
    if (oldEvidence === undefined) delete process.env.NETWORK_EVIDENCE_KEY; else process.env.NETWORK_EVIDENCE_KEY = oldEvidence;
  }
});

test("production health requires the protected network-evidence key", () => {
  assert.match(health, /NETWORK_EVIDENCE_KEY/);
  assert.match(health, /evidenceReady/);
});

test("staff MFA is staged without weakening Discord-only authorization", () => {
  assert.match(migration, /staff_mfa_required boolean not null default false/);
  assert.match(migration, /staff_mfa_enrollment_allowed/);
  assert.match(migration, /app_metadata'->>'provider',''\)='discord'/);
  assert.match(migration, /'\[\{"method":"totp"\}\]'/);
  assert.match(migration, /staff_activate_mfa_requirement/);
  assert.match(router, /auth\/mfa\/enroll/);
  assert.match(router, /auth\/mfa\/verify/);
});

test("member profiles use a narrow update RPC and queue changed content for screening", () => {
  assert.match(migration, /member_update_profile\(\s*p_display_name text,p_bio text,p_visibility text/);
  assert.match(migration, /profiles_content_review_state_update/);
  assert.match(migration, /bio_review_status/);
  assert.match(router, /"me\/profile": endpoint\(\["GET", "POST"\]/);
  assert.match(router, /profile\.updated/);
});

test("privacy reveals, per-person permissions and security bans remain owner controlled", () => {
  assert.match(migration, /staff_permission_overrides/);
  assert.match(migration, /security\.network\.approve/);
  assert.match(migration, /expires_at=case when p_approved then timezone\('utc',now\(\)\)\+interval '10 minutes'/);
  assert.match(migration, /network\.reveal\.viewed/);
  assert.match(migration, /The protected owner cannot be banned/);
  assert.match(migration, /delete from auth\.sessions where user_id=v_activity\.user_id/);
  assert.match(staff, /Request IP/);
  assert.doesNotMatch(staff, /canvas|audio fingerprint|hardwareConcurrency/i);
});

test("member votes, comments and reports cannot be invoked anonymously", () => {
  assert.match(interactionAcl, /member_server_interaction\(uuid,text,text,text\)/);
  assert.match(interactionAcl, /from public, anon, service_role/);
  assert.match(interactionAcl, /to authenticated/);
});

test("the public product is multi-page and hides the operations route", () => {
  const index = readFileSync(join(root, "public", "index.html"), "utf8");
  const files = ["about.html", "blog.html", "blog-post.html", "appeal.html", "advertise.html", "coins.html", "staffpanel.html", "staffpanel-security.html"];
  for (const file of files) assert.match(readFileSync(join(root, "public", file), "utf8"), /<!doctype html>/i, file);
  assert.doesNotMatch(index, /href=["']\/staffpanel/i);
  assert.match(index, /logo-lockup-v3/);
  assert.match(index, /browserp-mark-v3\.png/);
  assert.match(index, /data-ad-placement="top"/);
});

test("listing tags are canonical, unique and limited in the browser", () => {
  const directory = readFileSync(join(root, "public", "browserp-directory.js"), "utf8");
  assert.match(directory, /const LISTING_TAGS = Object\.freeze/);
  assert.match(directory, /selected >= 8/);
  const values = [...directory.matchAll(/\["([a-z0-9-]+)", "[^"]+"\]/g)].map((match) => match[1]);
  assert.equal(values.length, new Set(values).size);
  assert.ok(values.includes("economy"));
  assert.ok(values.includes("whitelisted"));
  assert.ok(values.includes("custom-clothing"));
});
