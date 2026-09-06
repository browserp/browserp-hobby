import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import middleware from "../middleware.js";
import router from "../api/router.js";
import { createBrowseRPServer } from "../dev-server.mjs";
import { staffDocumentName } from "../lib/staff-document-path.js";

const pages = ["overview", "moderation", "scrapers", "profiles", "accounts", "staff", "security", "content"];
const aliases = pages.flatMap(page => [`/staffpanel/${page}`, `/staffpanel-${page}`, `/staffpanel-${page}.html`, `/staffpanel/${page}.html`]);
const login = readFileSync(new URL("../public/staffpanel.html", import.meta.url), "utf8");
const overview = readFileSync(new URL("../public/staffpanel-overview.html", import.meta.url), "utf8");
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("all workspace document aliases are rewritten to the server guard before static HTML", () => {
  for (const path of [...aliases, "/staffpanel", "/staffpanel.html", "/staffpanel/overview/", "/%73taffpanel-overview.html"]) {
    assert.ok(staffDocumentName(path), path);
    const result = middleware(new Request(`https://browserp.test${path}?_route=admin/staff&_path=/staffpanel`));
    const destination = new URL(result.headers.get("x-middleware-rewrite"));
    assert.equal(destination.pathname, "/api/router");
    assert.equal(destination.searchParams.get("_route"), "staff/document");
    assert.equal(destination.searchParams.get("_path"), path);
    assert.match(result.headers.get("cache-control"), /private, no-store/);
  }
  for (const path of ["/staffpanel-v3.js", "/staffpanel-v3.css", "/staffpanel/../index", "/staffpanel/unknown", "/staffpanel%2f..%2findex"]) assert.equal(staffDocumentName(path), null, path);
});

test("anonymous HTTP requests receive only the generic shell for every staff workspace alias", async t => {
  const server = createBrowseRPServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const path of aliases) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 401, path);
    assert.equal(await response.text(), login, path);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    assert.equal(response.headers.get("cdn-cache-control"), "no-store");
    assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
  }
  const head = await fetch(origin + "/staffpanel-overview.html", { method: "HEAD" });
  assert.equal(head.status, 401); assert.equal(await head.text(), "");
  assert.equal((await fetch(origin + "/staffpanel")).status, 200);
});

test("workspace HTML requires current server staff authorization and the required verified TOTP", async () => {
  const values = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "", APP_URL: "http://localhost:8080", NODE_ENV: "test", VERCEL: "0", VERCEL_ENV: "" };
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, values);
  try {
    for (const fixture of [
      { name: "ordinary member spoofing client role", policyStatus: 403, status: 403 },
      { name: "revoked staff session", policyStatus: 403, aal: "aal2", totp: true, status: 403 },
      { name: "Google member", provider: "google", status: 403 },
      { name: "MFA outstanding", status: 403 },
      { name: "AAL2 without TOTP", aal: "aal2", status: 403 },
      { name: "TOTP factor no longer verified", aal: "aal2", totp: true, factorStatus: "unverified", status: 403 },
      { name: "policy outage", policyStatus: 503, status: 503 },
      { name: "malformed policy", malformed: true, status: 503 },
      { name: "verified current staff", aal: "aal2", totp: true, status: 200 },
      { name: "explicit optional MFA", required: false, status: 200 }
    ]) {
      const provider = fixture.provider || "discord", calls = [];
      globalThis.fetch = async (url, options) => {
        const path = new URL(url).pathname; calls.push(path);
        if (path === "/auth/v1/user") return json({ id: "fixture-user", app_metadata: { provider, providers: [provider] }, identities: [{ provider }], user_metadata: { role: "owner", staff: true }, factors: [{ factor_type: "totp", status: fixture.factorStatus || "verified", id: "private-factor" }] });
        if (path === "/rest/v1/rpc/staff_mfa_policy") {
          assert.match(options.headers.Authorization, /^Bearer fixture\./);
          return json(fixture.policyStatus ? { message: "private-role-mapping must stay private", code: "42501" } : fixture.malformed ? {} : { staffMfaRequired: fixture.required !== false }, fixture.policyStatus || 200);
        }
        throw new Error(`Unexpected private request ${path}`);
      };
      const access = `fixture.${Buffer.from(JSON.stringify({ sub: "fixture-user", aal: fixture.aal || "aal1", amr: fixture.totp ? [{ method: "totp" }] : [] })).toString("base64url")}.fixture`;
      const headers = new Map();
      const res = { setHeader: (key, value) => headers.set(key.toLowerCase(), value), getHeader: key => headers.get(key.toLowerCase()), end(value) { this.body = value; } };
      await router({ browserpRoute: "staff/document", method: "GET", url: "/api/router?_route=staff/document&_path=/staffpanel-overview.html", headers: { host: "localhost:8080", cookie: `brp_access=${access}; brp_csrf=${"c".repeat(43)}` } }, res);
      assert.equal(res.statusCode, fixture.status, fixture.name);
      assert.equal(res.body, fixture.status === 200 ? overview : login, fixture.name);
      assert.doesNotMatch(res.body, /private-role-mapping|private-factor|fixture-user/);
      assert.deepEqual(calls, provider === "google" ? ["/auth/v1/user"] : ["/auth/v1/user", "/rest/v1/rpc/staff_mfa_policy"], fixture.name);
      assert.match(headers.get("cache-control"), /private, no-store/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});
