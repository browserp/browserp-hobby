import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { articleBody, createPublicPageHandler } from "../lib/public-pages.js";
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const script = read("public/publishing-content.js");
function render(body) {
  const dom = new JSDOM('<main id="preview"></main><main id="initial"></main>', { url: "https://www.browserp.com/blog/guide", runScripts: "outside-only" });
  dom.window.eval(script);
  const preview = dom.window.document.querySelector("#preview"), initial = dom.window.document.querySelector("#initial");
  dom.window.BrowseRPContent.renderArticle(preview, body);
  initial.innerHTML = articleBody(body);
  assert.equal(preview.innerHTML, initial.innerHTML, "Staff/public DOM rendering must equal the initial HTML renderer");
  return { dom, preview, content: dom.window.BrowseRPContent };
}
test("labelled guide links work identically in headings, lists and paragraphs with escaped text and query strings", () => {
  const body = '# [Find a community](/servers?platform=fivem&q=public#filters)\n\nRead [their rules](https://example.com/rules?a=one&b=two), then [BrowseRP’s \"help\"](/community-standards).\n\n- [See games](/games)\n- [Ask for support](https://support.example.com/help)';
  const { dom, preview } = render(body);
  try {
    assert.deepEqual([...preview.children].map(node => node.tagName), ["H2", "P", "UL"]);
    const links = [...preview.querySelectorAll("a")];
    assert.equal(links.length, 5);
    assert.equal(links[0].getAttribute("href"), "/servers?platform=fivem&q=public#filters");
    assert.equal(links[1].href, "https://example.com/rules?a=one&b=two");
    assert.equal(links[2].textContent, 'BrowseRP’s "help"');
    for (const link of links) { assert.equal(link.rel, "noopener noreferrer"); assert.equal(link.hasAttribute("target"), false); }
    assert.equal(preview.querySelectorAll("h1,img,iframe,script").length, 0);
  } finally { dom.window.close(); }
});
test("unsafe, credentialed and local destinations remain readable source text instead of links", () => {
  const values = ["javascript:alert", "data:text/plain,hello", "file:///etc/passwd", "http://example.com/rules", "//example.com/rules", "https://user:secret@example.com/rules", "https://@example.com/rules", "https://localhost/rules", "https://wiki.local/rules", "https://wiki.internal/rules", "https://example.test/rules", "https://127.0.0.1/rules", "https://2130706433/rules", "https://0x7f000001/rules", "https://[::1]/rules", "https://example.com:444/rules", "https:\\example.com/rules", "/\\example.com/rules", "/%5cexample.com", "/rules%0aevil", 'https://example.com/"onclick=oops'];
  const body = values.map(value => `[Read rules](${value})`).join("\n\n");
  const { dom, preview, content } = render(body);
  try {
    assert.equal(preview.querySelectorAll("a").length, 0);
    for (const value of values) { assert.equal(content.articleLink(value), null, value); assert.ok(preview.textContent.includes(`[Read rules](${value})`), value); }
    assert.equal(preview.querySelectorAll("[onclick],script,img").length, 0);
  } finally { dom.window.close(); }
});
test("code, unsupported link syntax, bare URLs and raw HTML stay literal without embedding content", () => {
  const body = '[Outside](/servers)\n\n```markdown\n[Code link](/games)\n\n[Still code](https://example.com)\n```\n\n~~~\n[Tilde code](/games)\n~~~\n\n`[Inline code](/games)` and ``[Longer code](/games)``.\n\n![Image](https://example.com/image.png) and \\[Escaped](/games). [Parentheses](https://example.com/wiki/(RP))\n\nhttps://example.com/a_(b). <img src=x onerror=alert(1)> [<b>Text</b>](/games)\n\n```\n[Unclosed code](/games)';
  const { dom, preview } = render(body);
  try {
    assert.deepEqual([...preview.querySelectorAll("a")].map(a => a.textContent), ["Outside", "<b>Text</b>"]);
    assert.ok(preview.textContent.includes('[Still code](https://example.com)'));
    assert.ok(preview.textContent.includes('[Unclosed code](/games)'));
    assert.ok(preview.textContent.includes('[Parentheses](https://example.com/wiki/(RP))'));
    assert.ok(preview.textContent.includes('https://example.com/a_(b).'));
    assert.ok(preview.textContent.includes('<img src=x onerror=alert(1)>'));
    assert.equal(preview.querySelectorAll("img,b,script,[onerror]").length, 0);
  } finally { dom.window.close(); }
});
test("served article HTML contains the same usable links before and after enhancement", async () => {
  const body = "Read [our community standards](/community-standards) and [the public guide](https://example.com/guide).";
  const output = { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(value) { this.body = value; } };
  const data = { posts: async () => ({ slug: "guide", title: "Joining a community", body, excerpt: "Start here.", publishedAt: "2026-09-01T12:00:00Z" }) };
  await createPublicPageHandler({ data })({ url: "/blog/guide", method: "GET", headers: {} }, output);
  const dom = new JSDOM(output.body, { url: "https://www.browserp.com/blog/guide", runScripts: "outside-only" });
  try {
    assert.equal(output.statusCode, 200);
    const article = dom.window.document.querySelector("#journal-article-v6"), initial = article.innerHTML;
    assert.equal(article.querySelectorAll("a").length, 2);
    dom.window.eval(script); dom.window.BrowseRPContent.renderArticle(article, body);
    assert.equal(article.innerHTML, initial);
    assert.match(output.headers["content-security-policy"], /script-src 'self' 'nonce-/);
  } finally { dom.window.close(); }
});
test("initial directory cards use logo first, three existing features and honest Roblox status", async () => {
  const base = { name: "A community", slug: "community", platform_id: "roblox", description: "Community-led play.", region: "United States", language: "English", framework: "Experience", access_type: "unknown", tags: ["Story-led", '<img src=x onerror="oops">', "Newcomers", "Fourth"], logo_url: "https://www.browserp.com/assets/logo.png", banner_url: "https://www.browserp.com/assets/banner.png" };
  for (const row of [base, { ...base, logo_url: "" }, { ...base, logo_url: "", banner_url: "" }]) {
    const output = { setHeader() {}, end(value) { this.body = value; } };
    await createPublicPageHandler({ data: { directory: async () => ({ servers: [row], total: 1 }) } })({ url: "/servers", method: "GET", headers: {} }, output);
    const dom = new JSDOM(output.body);
    try {
      assert.equal(output.statusCode, 200);
      const card = dom.window.document.querySelector(".server-card");
      assert.deepEqual([...card.querySelectorAll(".server-tags span")].map(span => span.textContent), row.tags.slice(0, 3));
      assert.equal(card.querySelector(".server-description").nextElementSibling.className, "server-tags");
      assert.equal(card.querySelector(".server-tags").nextElementSibling.className, "server-card-bottom");
      assert.equal(card.querySelector(".status").textContent, "Community listing");
      assert.equal(card.querySelector(".status").classList.contains("online"), false);
      assert.match(card.querySelector(".server-card-bottom").textContent, /Live player count not provided/);
      assert.equal(card.querySelector(".server-card-media svg,.server-tags img"), null);
      assert.equal(card.querySelector(".server-card-media-image")?.getAttribute("src") || null, row.logo_url ? "/assets/logo.png" : row.banner_url ? "/assets/banner.png" : null);
      if (!row.logo_url && !row.banner_url) assert.equal(card.querySelector(".server-initials").textContent, "AC");
    } finally { dom.window.close(); }
  }
});
test("homepage declares BrowseRP once with its canonical publisher identity and loads coordinated touch feedback once", () => {
  const dom = new JSDOM(read("public/index.html"));
  try {
    const doc = dom.window.document, identities = [...doc.querySelectorAll('script[type="application/ld+json"]')].map(node => JSON.parse(node.textContent));
    assert.equal(identities.length, 1, "The homepage must publish one consistent site identity");
    const identity = identities[0], canonical = doc.querySelector('link[rel="canonical"]').href;
    assert.equal(identity["@context"], "https://schema.org");
    assert.equal(identity["@type"], "WebSite");
    assert.equal(identity["@id"], `${canonical}#website`);
    assert.equal(identity.name, "BrowseRP");
    assert.deepEqual(identity.alternateName, ["Browse RP", "browserp.com"]);
    assert.equal(identity.url, canonical);
    assert.equal(identity.publisher["@type"], "Organization");
    assert.equal(identity.publisher["@id"], `${canonical}#organization`);
    assert.equal(identity.publisher.name, identity.name);
    assert.deepEqual(identity.publisher.alternateName, identity.alternateName);
    assert.equal(identity.publisher.url, canonical);
    assert.equal(identity.publisher.logo["@type"], "ImageObject");
    assert.equal(identity.publisher.logo.url, doc.querySelector('meta[property="og:image"]').content);
    for (const dimension of ["width", "height"]) assert.equal(identity.publisher.logo[dimension], Number(doc.querySelector(`meta[property="og:image:${dimension}"]`).content));
    const scripts = [...doc.querySelectorAll("script[src]")].map(node => node.getAttribute("src"));
    assert.equal(scripts.filter(src => /^\/touch-feedback\.js\?v=[0-9.]+$/.test(src)).length, 1);
    assert.ok(scripts.findIndex(src => src.startsWith("/touch-feedback.js?")) < scripts.findIndex(src => src.startsWith("/browserp-v3.js")));
    assert.match(doc.querySelector('meta[property="og:image"]').content, /https:\/\/www.browserp.com\//);
  } finally { dom.window.close(); }
});
