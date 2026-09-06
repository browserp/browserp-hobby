import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createPublicPageHandler, publicServer, articleBody, scriptJSON, slot } from "../lib/public-pages.js";
// Production metadata is the baseline even when this suite runs in a preview build.
// The preview-specific case below explicitly exercises the stricter deployment policy.
beforeEach(t => {
  const prior = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  t.after(() => {
    if (prior === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prior;
  });
});
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const server = { id: "01234567-1234-1234-1234-0123456789ab", name: "Cali RP", slug: "cali-rp", platform_id: "fivem", region: "United States", language: "English", framework: "vMenu", access_type: "public", description: "A character-led community with public services.", tags: ["serious rp"], online: true, players: 123, capacity: 500, owner_id: "PRIVATE_OWNER", review_note: "PRIVATE_NOTE", quality_score: 999, logo_url: "https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/server-media/logo.png" };
const post = { title: "Choosing a community", slug: "choosing-a-community", excerpt: "Read the rules before joining.", body: "## Before you join\n\nRead the rules.\n\n- Be respectful\n- Ask for help", publishedAt: "2026-09-01T12:00:00Z", author_id: "PRIVATE_AUTHOR" };
const defaultData = { directory: async () => ({ servers: [server], total: 1 }), server: async slug => slug === server.slug ? { server, connect: "https://cfx.re/join/abcdef" } : null, posts: async slug => slug ? slug === post.slug ? post : null : [post] };
async function request(path, { data = defaultData, method = "GET", headers = {} } = {}) {
  const output = { headers: {}, statusCode: 0, body: "", setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(body) { this.body = body || ""; } };
  await createPublicPageHandler({ data })({ url: path, method, headers }, output);
  return { ...output, document: () => new JSDOM(output.body).window.document };
}
test("published game/directory pages arrive with unique content and crawlable server links", async () => {
  for (const path of ["/servers", "/games/fivem", "/api/router?_route=public/document&_path=/games/fivem"]) {
    const response = await request(path), doc = response.document();
    assert.equal(response.statusCode, 200, path);
    assert.equal(response.headers["x-robots-tag"], undefined, "Published production pages must remain crawlable");
    assert.equal(doc.querySelectorAll('a[href="/server/cali-rp"]').length, 1);
    assert.equal(doc.querySelector(".platform-badge-v5")?.textContent, "FiveM");
    assert.equal(doc.querySelectorAll(".platform-badge-v5 svg").length, 0);
    assert.equal(doc.querySelector('link[rel="canonical"]').href, `https://www.browserp.com${path === "/servers" ? path : "/games/fivem"}`);
    assert.doesNotMatch(response.body, /PRIVATE_|quality_score|owner_id|123 players/);
    assert.equal(doc.querySelector(".server-meta").textContent, "FiveMUnited StatesEnglishvMenuOpen to everyone");
    if (path !== "/servers") assert.match(doc.querySelector("h1").textContent, /FiveM/);
    assert.match(response.headers["content-security-policy"], /script-src 'self' 'nonce-/);
    assert.match(response.headers["cache-control"], /private, no-store/);
    assert.equal(response.headers["cdn-cache-control"], "no-store");
  }
});
test("directory pagination is real links and uses distinct canonical pages; arbitrary filters stay noindex", async () => {
  const data = { ...defaultData, directory: async filters => ({ total: 60, servers: [{ ...server, slug: `community-${filters.offset}` }] }) };
  let response = await request("/servers?offset=24", { data }); let doc = response.document();
  assert.equal(doc.querySelector('link[rel="canonical"]').href, "https://www.browserp.com/servers?offset=24");
  assert.equal(doc.querySelector('meta[name="robots"]').content, "index,follow");
  assert.deepEqual([...doc.querySelectorAll("[data-public-pagination] a")].map(a => a.getAttribute("href")), ["/servers", "/servers?offset=48"]);
  for (const path of ["/servers?q=cali", "/servers?access=public", "/games/fivem?mode=esx", "/servers?platform=fivem"]) {
    response = await request(path, { data }); doc = response.document();
    assert.equal(doc.querySelector('meta[name="robots"]').content, "noindex,follow", path);
    assert.equal(doc.querySelector('link[rel="canonical"]').href, `https://www.browserp.com${path}`, "Distinct filtered results must not claim to duplicate the unfiltered page");
  }
});

test("pagination rejects empty continuations, excludes arbitrary offsets, and removes tracking duplicates", async () => {
  const data = { ...defaultData, directory: async filters => ({ total: 60, servers: filters.offset < 60 ? [server] : [] }) };
  for (const path of ["/servers?offset=60", "/servers?offset=999999", "/games/fivem?offset=72", "/servers?q=missing&offset=72"]) {
    const response = await request(path, { data }); assert.equal(response.statusCode, 404, path); assert.match(response.headers["x-robots-tag"], /noindex/);
  }
  const irregular = (await request("/servers?offset=1", { data })).document();
  assert.equal(irregular.querySelector('meta[name="robots"]').content, "noindex,follow");
  const doc = (await request("/games/fivem?platform=fivem&offset=24&utm_source=share", { data })).document();
  assert.equal(doc.querySelector('link[rel="canonical"]').href, "https://www.browserp.com/games/fivem?offset=24");
  assert.deepEqual([...doc.querySelectorAll("[data-public-pagination] a")].map(a => a.getAttribute("href")), ["/games/fivem", "/games/fivem?offset=48"]);
  const first = (await request("/servers?utm_source=share", { data })).document();
  assert.equal(first.querySelector('link[rel="canonical"]').href, "https://www.browserp.com/servers");
  assert.equal(first.querySelector('meta[name="robots"]').content, "index,follow");
});

test("GTA VI and 6M pages arrive as upcoming information without listings, counts or submission actions", async () => {
  let directoryCalls = 0;
  const data = { ...defaultData, directory: async () => { directoryCalls++; throw new Error("Upcoming categories must not query playable servers"); } };
  for (const id of ["gta6", "6m"]) {
    const response = await request(`/games/${id}`, { data }), doc = response.document();
    assert.equal(response.statusCode, 200);
    assert.match(doc.title, /Coming soon/);
    assert.match(doc.querySelector("h1").textContent, /coming soon/i);
    assert.equal(doc.querySelector('meta[name="robots"]').content, "noindex,follow");
    assert.equal(doc.querySelector('link[rel="canonical"]').href, `https://www.browserp.com/games/${id}`);
    assert.equal(doc.querySelector("#game-results-v4").hidden, true);
    assert.equal(doc.querySelectorAll(".server-card").length, 0);
    assert.equal(doc.querySelector('#game-page-actions-v4 a[href^="/list-server"]'), null);
    assert.equal(doc.querySelector('#game-page-actions-v4 a[href="/games"]').textContent, "Explore available games");
    assert.doesNotMatch(doc.querySelector("#game-page-lead-v4").textContent, /\d+ players|\d+ servers|November 19/);
    assert.equal(doc.querySelector("#game-page-mark-v4 img").getAttribute("src"), "/assets/games/gta6-official.jpg");
    assert.equal(publicServer({ ...server, platform_id: id }), null, "Future categories cannot become public listings");
  }
  assert.equal(directoryCalls, 0);
  const hub = (await request("/games", { data })).document();
  assert.deepEqual([...hub.querySelectorAll("#game-hub-grid-v4 a")].map(link => link.getAttribute("href")), ["/games/fivem", "/games/redm", "/games/roblox", "/games/minecraft"]);
});
test("server detail keeps the existing controls, exact metadata order and real images without private fields", async () => {
  const response = await request("/server/cali-rp"), doc = response.document();
  assert.equal(response.statusCode, 200);
  assert.equal(doc.querySelector("h1").textContent, "Cali RP");
  assert.equal(doc.querySelector("#server-description-v3").textContent, server.description);
  assert.deepEqual([...doc.querySelectorAll("#server-info-v5 dt")].slice(0, 5).map(item => item.textContent), ["Game", "Region", "Language", "Server setup", "Access"]);
  assert.equal(doc.querySelector("#server-initials-v3 img").src, server.logo_url);
  assert.equal(doc.querySelector("#server-connect-v3").hidden, false);
  assert.equal(doc.querySelector("#comment-form-v3 textarea").disabled, true);
  assert.equal(doc.querySelector('meta[property="og:title"]').content, doc.title);
  assert.doesNotMatch(response.body, /PRIVATE_|owner_id|quality_score|123 players/);
  assert.equal(JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent)["@type"], "WebPage");
});
test("Roblox initial pages preserve application-led joining and never expose private authority evidence", async () => {
  const roblox = { ...server, platform_id: "roblox", roblox: { kind: "independent_community", experienceUrl: "https://www.roblox.com/games/123", joiningInstructions: "Join our community first.", authorityEvidence: "PRIVATE_AUTHORITY" } };
  let response = await request("/server/cali-rp", { data: { ...defaultData, server: async () => ({ server: roblox }) } });
  assert.match(response.body, /Join our community first/); assert.match(response.body, /Live player count not provided/); assert.doesNotMatch(response.body, /PRIVATE_AUTHORITY/);
  response = await request("/games/roblox", { data: { ...defaultData, directory: async () => ({ total: 0, servers: [] }) } });
  assert.ok(response.document().querySelector('a[href="/list-server?platform=roblox"]'));
});
test("unknown, unpublished, malformed and missing pages return 404; dependency outages return 503", async () => {
  for (const path of ["/server/missing", "/games/not-real", "/blog/unpublished", "/server/bad%3Cscript", "/api/router?_route=public/document&_path=https://evil.test"]) {
    const response = await request(path); assert.equal(response.statusCode, 404, path); assert.match(response.headers["x-robots-tag"], /noindex/); assert.doesNotMatch(response.body, /Loading server/);
  }
  for (const path of ["/server/cali-rp", "/games/fivem", "/servers", "/blog", "/blog/choosing-a-community", "/sitemap.xml"]) {
    const unavailable = async () => { throw Object.assign(new Error("PRIVATE_DATABASE_ERROR"), { status: 404 }); };
    const response = await request(path, { data: { directory: unavailable, server: unavailable, posts: unavailable } });
    assert.equal(response.statusCode, 503, path); assert.equal(response.headers["retry-after"], "60"); assert.doesNotMatch(response.body, /PRIVATE_DATABASE_ERROR/);
  }
  const head = await request("/server/cali-rp", { method: "HEAD" }); assert.equal(head.statusCode, 200); assert.equal(head.body, "");
  assert.equal((await request("/servers", { method: "POST" })).statusCode, 405);
});
test("legacy template URLs permanently redirect to the public page, never a user supplied host", async () => {
  for (const [from, to] of [["/game?game=fivem", "/games/fivem"], ["/game", "/games"], ["/game?game=fivem&access=public&offset=24&utm_source=old", "/games/fivem?access=public&offset=24"], ["/game?region=United+Kingdom", "/servers?region=United+Kingdom"], ["/server?slug=cali-rp", "/server/cali-rp"], ["/blog-post?slug=choosing-a-community", "/blog/choosing-a-community"]]) {
    const response = await request(from, { headers: { host: "evil.test", cookie: "private-session" } }); assert.equal(response.statusCode, 308); assert.equal(response.headers.location, to);
  }
});
test("published article text, social identity and safe structured data are present without JavaScript", async () => {
  const response = await request("/blog/choosing-a-community"), doc = response.document();
  assert.equal(doc.querySelector("h1").textContent, post.title);
  assert.equal(doc.querySelector("#journal-article-v6 h2").textContent, "Before you join");
  assert.equal(doc.querySelectorAll("#journal-article-v6 li").length, 2);
  assert.equal(doc.querySelector('meta[property="og:type"]').content, "article");
  assert.equal(JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent).publisher.name, "BrowseRP");
  const structured = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
  assert.equal(structured["@type"], "BlogPosting");
  assert.equal(structured.datePublished, doc.querySelector("#journal-date-v6").getAttribute("datetime"));
  assert.equal(structured.dateModified, undefined, "A publication date is not evidence of the last edit");
  assert.equal(structured.author, undefined, "Private author IDs cannot become an invented public byline");
  assert.deepEqual(structured.mainEntityOfPage.breadcrumb.itemListElement.map(item => item.item), ["https://www.browserp.com/", "https://www.browserp.com/blog", "https://www.browserp.com/blog/choosing-a-community"]);
  assert.doesNotMatch(response.body, /PRIVATE_AUTHOR|aggregateRating|reviewRating/);
  const index = await request("/blog"); assert.ok(index.document().querySelector('a[href="/blog/choosing-a-community"]'));
});

test("game and server share images identify the public page and retain the RP fallback without invented dimensions", async () => {
  for (const [id, width, height] of [["fivem", 825, 413], ["redm", 740, 423], ["minecraft", 640, 339], ["roblox", 1920, 1076]]) {
    const doc = (await request(`/games/${id}`)).document();
    assert.equal(doc.querySelector('meta[property="og:image"]').content, `https://www.browserp.com/assets/games/${id}-selected-v2.webp`);
    assert.equal(doc.querySelector('meta[property="og:image:type"]').content, "image/webp");
    assert.equal(doc.querySelector('meta[property="og:image:width"]').content, String(width));
    assert.equal(doc.querySelector('meta[property="og:image:height"]').content, String(height));
    assert.equal(doc.querySelector('meta[name="twitter:card"]').content, "summary_large_image");
    const structured = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
    assert.equal(structured.breadcrumb.itemListElement.at(-1).item, `https://www.browserp.com/games/${id}`);
  }
  for (const [overrides, expected] of [[{}, server.logo_url], [{ banner_url: server.logo_url.replace("logo.png", "banner.webp") }, server.logo_url.replace("logo.png", "banner.webp")], [{ logo_url: "/api/public/server-image?url=https://evil.test/secret.png" }, "https://www.browserp.com/browserp-mark-v3.png"], [{ logo_url: "https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/sign/server-media/private.png?token=SECRET" }, "https://www.browserp.com/browserp-mark-v3.png"]]) {
    const doc = (await request("/server/cali-rp", { data: { ...defaultData, server: async () => ({ server: { ...server, ...overrides } }) } })).document();
    assert.equal(doc.querySelectorAll('meta[property="og:image"]').length, 1);
    assert.equal(doc.querySelector('meta[property="og:image"]').content, expected);
    assert.equal(doc.querySelector('meta[name="twitter:image"]').content, expected);
    if (expected === server.logo_url) assert.equal(doc.querySelector('meta[property="og:image:width"]'), null);
    assert.equal(doc.querySelector('meta[property="og:site_name"]').content, "BrowseRP");
    const structured = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
    assert.equal(structured.breadcrumb.itemListElement.at(-1).name, doc.querySelector("h1").textContent);
    assert.equal(structured.primaryImageOfPage.url, expected);
  }
});

test("preview public documents and sitemaps explicitly prohibit indexing", async () => {
  const prior = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "preview";
    for (const path of ["/servers", "/servers?q=cali", "/server/cali-rp", "/games/fivem", "/games/gta6", "/blog/choosing-a-community", "/sitemap.xml"]) {
      const response = await request(path); assert.equal(response.statusCode, 200);
      assert.equal(response.headers["x-robots-tag"], "noindex, nofollow");
      if (path !== "/sitemap.xml") assert.equal(response.document().querySelector('meta[name="robots"]').content, "noindex,nofollow");
    }
  } finally { if (prior === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = prior; }
});
test("HTML, attribute, JSON and unsafe image inputs cannot break out into executable markup", async () => {
  const malicious = '<script>alert(1)</script> & "quote"';
  const response = await request("/server/cali-rp", { data: { ...defaultData, server: async () => ({ server: { ...server, name: malicious, description: '</script><script id="attack">alert(1)</script>', tags: [malicious], logo_url: 'javascript:alert(1)', owner_id: "SECRET", roblox: { authorityEvidence: "SECRET" } } }) } });
  const doc = response.document(); assert.equal(doc.querySelector("h1").textContent, malicious); assert.equal(doc.querySelector("#attack"), null);
  assert.equal(doc.querySelector("#server-initials-v3 img"), null); assert.doesNotMatch(response.body, /javascript:alert|SECRET/);
  assert.equal(JSON.parse(scriptJSON({ text: "</script>\u2028&" })).text, "</script>\u2028&");
  assert.doesNotMatch(articleBody(malicious), /<script>/);
  assert.equal(publicServer({ ...server, platform_id: "forza" }), null);
  assert.equal(slot('<div id="a"><div>nested</div></div><p>keep</p>', "a", "safe"), '<div id="a">safe</div><p>keep</p>');
});
test("sitemap includes every published listing and article beyond one page and excludes private/coming-soon routes", async () => {
  const rows = Array.from({ length: 125 }, (_, i) => ({ ...server, slug: `community-${i}` }));
  const seen = [];
  const response = await request("/sitemap.xml", { data: { ...defaultData, roster: async filters => { seen.push(filters.offset); return { total: rows.length, servers: rows.slice(filters.offset, filters.offset + filters.limit) }; } } });
  assert.equal(response.statusCode, 200); assert.deepEqual(seen, [0, 100]); assert.match(response.headers["content-type"], /xml/);
  assert.equal((response.body.match(/<loc>[^<]*\/server\//g) || []).length, 125);
  assert.match(response.body, /\/blog\/choosing-a-community/);
  assert.doesNotMatch(response.body, /\/list-server|\/staffpanel|\/profile|\/games\/(?:forza|gta6|6m)|PRIVATE_|<loc>[^<]*\?/);
  for (const directory of [async () => ({ total: 2, servers: [server] }), async () => ({ total: 1, servers: [{ ...server, slug: "../escape" }] })]) assert.equal((await request("/sitemap.xml", { data: { ...defaultData, directory } })).statusCode, 503);
});
test("deployment uses the existing router and exposes templates only through controlled public routes", () => {
  const config = JSON.parse(read("vercel.json"));
  for (const path of ["/servers", "/games/:slug", "/server/:slug", "/blog/:slug", "/sitemap.xml"]) assert.match(config.rewrites.find(row => row.source === path).destination, /^\/api\/router\?_route=public\/document&_path=/);
  assert.match(config.functions["api/router.js"].includeFiles, /public\//);
  assert.equal(existsSync(new URL("../public/sitemap.xml", import.meta.url)), false);
  assert.doesNotMatch(read("lib/public-pages.js"), /refresh:\s*true|useSecret:\s*true|getSession\(/);
  for (const page of ["find-server", "compare"]) assert.equal(new JSDOM(read(`public/${page}.html`)).window.document.querySelector('meta[name="robots"]').content, "noindex,follow");
});

test("real public data reader uses anonymous published RPCs and never forwards member cookies or triggers scrapers", async () => {
  const keys = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "NODE_ENV"];
  const prior = keys.map(key => [key, process.env[key]]), originalFetch = globalThis.fetch;
  Object.assign(process.env, { SUPABASE_URL: "https://public-reader.invalid", SUPABASE_PUBLISHABLE_KEY: "PUBLIC_KEY", SUPABASE_SECRET_KEY: "PRIVATE_SECRET", NODE_ENV: "production" });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const name = String(url).split("/").at(-1);
    const values = { search_server_directory: [server], public_server_import_details: [], public_server_engagement: { accessType: "public", cfxJoinUrl: "https://cfx.re/join/abcdef", comments: [], secret: "PRIVATE_ENGAGEMENT" }, search_public_directory: { total: 1, servers: [server] }, public_blog_index: [post] };
    assert.ok(Object.hasOwn(values, name), `Unexpected source request: ${name}`);
    return new Response(JSON.stringify(values[name]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
    await createPublicPageHandler()({ url: "/server/cali-rp", method: "GET", headers: { cookie: "session=PRIVATE_SESSION", authorization: "Bearer PRIVATE_MEMBER" } }, res);
    assert.equal(res.statusCode, 200); assert.doesNotMatch(res.body, /PRIVATE_/);
    for (const call of calls) {
      assert.match(call.url, /^https:\/\/public-reader\.invalid\/rest\/v1\/rpc\//);
      const headers = new Headers(call.options.headers); assert.equal(headers.get("apikey"), "PUBLIC_KEY"); assert.equal(headers.get("authorization"), null); assert.equal(headers.get("cookie"), null);
      assert.doesNotMatch(JSON.stringify(call.options), /PRIVATE_/);
    }
  } finally { globalThis.fetch = originalFetch; for (const [key, value] of prior) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test("enhancement replaces prerendered game navigation and retains directory links when its API is unavailable", async () => {
  const rendered = await request("/games/fivem");
  const dom = new JSDOM(rendered.body, { url: "https://www.browserp.com/games/fivem", runScripts: "outside-only" });
  try {
    const w = dom.window; w.fetch = async () => ({ ok: false });
    w.eval(read("public/discovery-model.js")); w.eval(read("public/browserp-platforms.js")); w.eval(read("public/smart-search.js")); w.eval(read("public/browserp-games.js"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(w.document.querySelectorAll("#game-page-nav-v4 a").length, 4);
    assert.equal(w.document.querySelectorAll("#game-page-mark-v4 img").length, 1);
    assert.equal(w.document.querySelector("#game-server-list-v4").hidden, false);
    assert.equal(w.document.querySelectorAll('a[href="/server/cali-rp"]').length, 1);
    assert.match(w.document.body.textContent, /Live updates are unavailable/);
    const input = w.document.querySelector("#directory-search"); input.value = "different"; input.dispatchEvent(new w.Event("input", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(w.document.querySelector("#game-server-list-v4").hidden, true, "Old results must not masquerade as a new query's matches");
  } finally { dom.window.close(); }
});

test("a transient article refresh failure keeps readable content; a withdrawn article clears it", async () => {
  for (const status of [503, 404]) {
    const rendered = await request("/blog/choosing-a-community");
    const dom = new JSDOM(rendered.body, { url: "https://www.browserp.com/blog/choosing-a-community", runScripts: "outside-only" });
    try {
      const w = dom.window; w.fetch = async () => ({ ok: false, status, json: async () => ({ error: "Unavailable" }) });
      w.eval(read("public/publishing-content.js")); w.eval(read("public/blog.js"));
      await new Promise(resolve => setImmediate(resolve));
      const article = w.document.querySelector("#journal-article-v6");
      assert.equal(article.textContent.includes("Read the rules"), status === 503);
      if (status === 404) assert.equal(w.document.querySelector("#journal-excerpt-v6").textContent, "");
    } finally { dom.window.close(); }
  }
});

test("a transient listing refresh failure preserves its public details; a missing listing removes them", async () => {
  for (const status of [503, 404]) {
    const rendered = await request("/server/cali-rp");
    const dom = new JSDOM(rendered.body, { url: "https://www.browserp.com/server/cali-rp", runScripts: "outside-only", pretendToBeVisual: true });
    try {
      const w = dom.window;
      w.matchMedia = () => ({ matches: true, addEventListener() {} });
      w.fetch = async path => String(path).startsWith("/api/servers") ? { ok: false, status, json: async () => ({}) } : { ok: true, json: async () => ({ authenticated: false, adverts: [], announcements: [] }) };
      w.eval(read("public/browserp-platforms.js")); w.eval(read("public/browserp-v3.js"));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(w.document.querySelector("#server-detail-v3").textContent.includes(server.description), status === 503);
      if (status === 503) assert.match(w.document.querySelector("#server-detail-v3").textContent, /Live updates are unavailable/);
    } finally { dom.window.close(); }
  }
});
