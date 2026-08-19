import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalCommunityUrl } from "../api/submissions.js";
import { assertCsrf, readBody, requestId } from "../lib/http.js";

const root = resolve(import.meta.dirname, "..");

test("v2 canonicalizes trusted community links and rejects unsafe destinations", () => {
  assert.equal(canonicalCommunityUrl("https://discord.com/invite/Browse_RP"), "https://discord.gg/Browse_RP");
  assert.equal(canonicalCommunityUrl("https://cfx.re/join/abc123/"), "https://cfx.re/join/abc123");
  assert.throws(() => canonicalCommunityUrl("http://discord.gg/example"));
  assert.throws(() => canonicalCommunityUrl("https://127.0.0.1/example"));
  assert.throws(() => canonicalCommunityUrl("https://tinyurl.com/example"));
});

test("v2 JSON parsing enforces MIME, size and object-only bodies", async () => {
  await assert.rejects(readBody({ headers: {}, body: {} }), (error) => error.status === 415);
  await assert.rejects(readBody({ headers: { "content-type": "application/json", "content-length": "99" }, body: {} }, 10), (error) => error.status === 413);
  await assert.rejects(readBody({ headers: { "content-type": "application/json" }, body: [] }), (error) => error.status === 400);
  assert.deepEqual(await readBody({ headers: { "content-type": "application/json" }, body: { safe: true } }), { safe: true });
});

test("v2 CSRF uses a matching synchronizer token and internal request IDs", () => {
  const token = "a".repeat(43);
  assert.doesNotThrow(() => assertCsrf({ method: "POST", headers: { cookie: `brp_csrf=${token}`, "x-browserp-csrf": token } }));
  assert.throws(() => assertCsrf({ method: "POST", headers: { cookie: `brp_csrf=${token}`, "x-browserp-csrf": "b".repeat(43) } }));
  assert.notEqual(requestId({ headers: { "x-request-id": "caller-controlled" } }), "caller-controlled");
});

test("v2 submission and CMS boundaries remain server-authorized and safely rendered", () => {
  const migration = readFileSync(resolve(root, "supabase/migrations/20260819164347_v2_application_boundaries.sql"), "utf8");
  const directory = readFileSync(resolve(root, "public/browserp-directory.js"), "utf8");
  const shell = readFileSync(resolve(root, "public/browserp-shell.js"), "utf8");
  const submissionGrantBlock = migration.slice(
    migration.indexOf("revoke execute on function public.create_server_submission_server_v2"),
    migration.indexOf("-- Versioned structured content")
  );
  assert.match(submissionGrantBlock, /grant execute[\s\S]*to service_role;/);
  assert.doesNotMatch(submissionGrantBlock, /to (?:anon|authenticated);/);
  assert.match(migration, /alter table private\.site_content_revisions enable row level security;/);
  assert.match(directory, /"Idempotency-Key": submissionAttemptKey/);
  assert.match(directory, /agreement: data\.agreement === "on"/);
  assert.match(shell, /element\.textContent = text/);
  assert.doesNotMatch(shell, /innerHTML/);
});
