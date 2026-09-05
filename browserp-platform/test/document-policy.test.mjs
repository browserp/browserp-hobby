import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import middleware, { config } from "../middleware.js";
import { BASE_DOCUMENT_POLICY, documentSecurityHeaders } from "../lib/document-policy.js";

const root = new URL("../", import.meta.url);
const vercel = JSON.parse(readFileSync(new URL("vercel.json", root), "utf8"));
const nonceFrom = value => value.match(/'nonce-([^']+)'/)?.[1];
const matches = path => config.matcher.some(pattern => new RegExp(`^${pattern}$`).test(path));

test("document policy adds exactly one 256-bit nonce and preserves every existing directive", () => {
  const existing = vercel.headers.flatMap(item => item.headers || []).filter(header => header.key.toLowerCase() === "content-security-policy");
  assert.equal(existing.length, 1); assert.equal(BASE_DOCUMENT_POLICY, existing[0].value);
  const headers = documentSecurityHeaders(), csp = headers["Content-Security-Policy"], nonce = nonceFrom(csp);
  assert.ok(nonce); assert.equal(Buffer.from(nonce, "base64").length, 32);
  assert.equal(csp.replace(` 'nonce-${nonce}'`, ""), BASE_DOCUMENT_POLICY);
  assert.equal(csp.match(/'nonce-/g).length, 1);
  assert.equal(csp.match(/script-src[^;]*/)[0], `script-src 'self' 'nonce-${nonce}'`);
  for (const directive of ["frame-src 'none'", "frame-ancestors 'none'", "object-src 'none'", "worker-src 'none'", "base-uri 'none'"]) assert.ok(csp.includes(directive));
  assert.equal(headers["Cache-Control"], "private, no-store, max-age=0");
  assert.equal(headers["CDN-Cache-Control"], "no-store"); assert.equal(headers["Cloudflare-CDN-Cache-Control"], "no-store");
  assert.doesNotMatch(headers["Cache-Control"], /no-transform/);
});

test("fresh document responses never reuse a nonce and reject malformed internal entropy", () => {
  const nonces = new Set(Array.from({ length: 1000 }, () => nonceFrom(documentSecurityHeaders()["Content-Security-Policy"])));
  assert.equal(nonces.size, 1000);
  for (const input of [null, "a".repeat(32), [], new Uint8Array(16), new Uint8Array(33), new Uint8ClampedArray(32)]) assert.throws(() => documentSecurityHeaders(input), /fresh 256-bit nonce/);
});

test("request headers, cookies and query parameters cannot choose or forward a document nonce", () => {
  const supplied = Buffer.alloc(32, 7).toString("base64");
  const requests = Array.from({ length: 3 }, () => new Request(`https://browserp.test/profile?nonce=${encodeURIComponent(supplied)}`, { headers: {
    "x-nonce": supplied, "x-browserp-nonce": supplied, "content-security-policy": `script-src 'nonce-${supplied}'`, cookie: `nonce=${supplied}`, "x-middleware-request-x-nonce": supplied
  } }));
  const nonces = requests.map(request => {
    const response = middleware(request), csp = response.headers.get("content-security-policy");
    assert.equal(response.headers.get("x-middleware-next"), "1"); assert.equal(response.headers.get("x-middleware-override-headers"), null);
    for (const name of ["x-nonce", "x-browserp-nonce", "x-middleware-request-x-nonce", "set-cookie"]) assert.equal(response.headers.get(name), null);
    assert.notEqual(nonceFrom(csp), supplied); return nonceFrom(csp);
  });
  assert.equal(new Set(nonces).size, requests.length);
});

test("matching includes document routes and excludes existing APIs, assets and crawler files", () => {
  for (const path of ["/", "/index.html", "/profile", "/staffpanel/overview", "/server/a-roleplay-server", "/games/fivem", "/games.html", "/blog/a-post"]) assert.equal(matches(path), true, path);
  for (const path of ["/api/me/profile", "/api/router", "/assets/example.avif", "/cdn-cgi/challenge-platform/scripts/jsd/api.js", "/_vercel/insights/script.js", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/browserp-v3.css", "/privacy-requests.js", "/favicon.ico"]) assert.equal(matches(path), false, path);
  const walk = (directory, prefix = "") => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name), `${prefix}${entry.name}/`) : [`/${prefix}${entry.name}`]);
  for (const file of walk(fileURLToPath(new URL("public", root)))) {
    if (file.endsWith(".html")) assert.equal(matches(file), true, file);
    else assert.equal(matches(file), false, `Static asset must retain its existing policy/cache: ${file}`);
  }
});

test("middleware bypasses API roots and changing methods; document HEAD has fresh private headers", () => {
  for (const [path, method] of [["/api", "GET"], ["/api/auth/session", "HEAD"], ["/profile", "POST"], ["/", "OPTIONS"], ["/profile", "DELETE"]]) {
    const response = middleware(new Request(`https://browserp.test${path}`, { method }));
    assert.equal(response.headers.get("x-middleware-next"), "1"); assert.equal(response.headers.get("content-security-policy"), null); assert.equal(response.headers.get("cache-control"), null);
  }
  const response = middleware(new Request("https://browserp.test/profile", { method: "HEAD", headers: { "if-none-match": '"old-nonce-body"' } }));
  assert.ok(nonceFrom(response.headers.get("content-security-policy"))); assert.match(response.headers.get("cache-control"), /no-store/);
  // The unit response only proves forwarding headers. A real Vercel/Cloudflare
  // preview must prove effective header precedence and conditional 304 behavior.
});

test("the middleware helper version is exact and agrees with the installed lockfile", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8"));
  assert.equal(pkg.dependencies["@vercel/functions"], "3.9.5");
  assert.equal(lock.packages["node_modules/@vercel/functions"].version, "3.9.5");
});
