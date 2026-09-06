import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPublicPreviewServer } from "../public-preview.mjs";

const reply = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json", "Set-Cookie": "upstream=must-not-forward" } });
async function harness(t, fetchPublic) {
  const calls = [], local = [];
  const server = createPublicPreviewServer({
    fetchPublic: (...args) => { calls.push(args); return fetchPublic(...args); },
    localHandler(req, res) { local.push(req.url); res.writeHead(418); res.end("local route"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { calls, local, request: (path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options) };
}

test("public preview fixes the upstream origin and strips all incoming credentials and response cookies", async t => {
  const h = await harness(t, () => reply({ servers: [], total: 0 }));
  const response = await h.request("/api/servers?discover=true&query=test&url=https%3A%2F%2Fexample.org", {
    headers: { Authorization: "Bearer TEST_ONLY", Cookie: "local=TEST_ONLY", "X-Forwarded-Host": "example.org", "X-Test": "not-forwarded" }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("X-Robots-Tag"), /noindex/);
  const [url, options] = h.calls[0];
  assert.equal(new URL(url).origin, "https://www.browserp.com");
  assert.equal(new URL(url).pathname, "/api/servers");
  assert.equal(new URL(url).searchParams.get("query"), "test");
  assert.deepEqual(options.headers, { Accept: "application/json" });
  assert.equal(options.method, "GET");
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.equal(options.body, undefined);
});

test("public preview refuses writes and never proxies authentication, staff or private paths", async t => {
  const h = await harness(t, () => { throw new Error("Unexpected upstream read"); });
  for (const method of ["POST", "PATCH", "DELETE", "HEAD"]) {
    const response = await h.request("/api/servers", { method });
    assert.equal(response.status, 405); assert.equal(response.headers.get("Allow"), "GET");
  }
  for (const path of ["/api/auth/session", "/api/auth/providers", "/api/me/favorites", "/api/admin/overview", "/staffpanel", "/api/public/blogs/private", "/api/router?_route=admin/overview"]) {
    assert.equal((await h.request(path)).status, 418, path);
  }
  assert.equal(h.calls.length, 0); assert.equal(h.local.length, 7);
});

test("public preview exposes upstream failures instead of replacing them with empty content", async t => {
  const h = await harness(t, url => {
    if (new URL(url).searchParams.has("redirect")) return new Response(null, { status: 302, headers: { Location: "https://example.org/private" } });
    if (new URL(url).searchParams.has("network")) throw new Error("Network unavailable");
    return new Response("unavailable", { status: 503 });
  });
  for (const [path, status] of [["/api/public/blogs", 503], ["/api/servers?redirect=1", 502], ["/api/servers?network=1", 502]]) {
    const response = await h.request(path); assert.equal(response.status, status);
    const body = await response.json(); assert.match(body.error, /unavailable/); assert.equal(body.servers, undefined); assert.equal(body.posts, undefined);
  }
  const page = await h.request("/blog"); assert.equal(page.status, 503); assert.match(await page.text(), /We couldn’t load this page/);
  assert.equal(h.calls.length, 4, "redirects never cause an additional request");
});

test("public preview supplies local server-rendered directory and journal pages with public responses", async t => {
  const post = { slug: "preview-guide", title: "Public preview guide", excerpt: "A published guide.", body: "## Join a community\n\nRead its rules.", publishedAt: "2026-09-06T12:00:00Z" };
  const server = { slug: "preview-community", name: "Published preview community", platform_id: "fivem", description: "A published community.", region: "Europe", tags: [] };
  const h = await harness(t, target => {
    const url = new URL(target);
    if (url.pathname === "/api/public/blogs") return reply(url.searchParams.has("slug") ? { post } : { posts: [post] });
    return reply({ servers: [server], total: 1, facets: {}, nextOffset: null });
  });
  const directory = await h.request("/servers?q=community&platform=fivem");
  assert.equal(directory.status, 200); const html = await directory.text();
  assert.match(html, /Published preview community/); assert.match(html, /directory-controls\.js/);
  assert.equal(new URL(h.calls[0][0]).searchParams.get("query"), "community");
  assert.equal(new URL(h.calls[0][0]).searchParams.get("platform"), "fivem");
  const policy = directory.headers.get("Content-Security-Policy");
  assert.match(policy, /script-src 'self' 'nonce-/); assert.match(policy, /connect-src 'self'/); assert.doesNotMatch(policy, /upgrade-insecure-requests/);
  for (const path of ["/games/fivem", "/server/preview-community", "/blog", "/blog/preview-guide"]) {
    const response = await h.request(path); assert.equal(response.status, 200, path);
    assert.match(await response.text(), /Published preview community|Public preview guide/);
  }
  assert.equal(h.local.length, 0);
});

test("the opt-in preview command refuses production environments before listening", () => {
  const script = fileURLToPath(new URL("../public-preview.mjs", import.meta.url));
  for (const extra of [{ NODE_ENV: "production" }, { NODE_ENV: "development", VERCEL: "1" }]) {
    const child = spawnSync(process.execPath, [script], { env: { ...process.env, ...extra }, encoding: "utf8" });
    assert.notEqual(child.status, 0); assert.match(child.stderr, /local development only/);
  }
});
