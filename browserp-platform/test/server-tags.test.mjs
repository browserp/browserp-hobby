import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createPublicPageHandler } from "../lib/public-pages.js";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const server = { id: "01234567-1234-1234-1234-0123456789ab", name: "County RP", slug: "county-rp", platform_id: "fivem", platform_name: "FiveM", description: "Build a character and meet your community.", region: "United States", language: "English", framework: "vMenu", access_type: "allowlisted", tags: ["california", "businesses", "custom cars", 'x"><img src=x onerror=alert(1)>'] };

async function page(path, record = server) {
  const response = { setHeader() {}, end(body) { this.body = body; } };
  await createPublicPageHandler({ data: { server: async () => ({ server: record }), directory: async () => ({ total: 1, servers: [record] }) } })({ url: path, method: "GET", headers: {} }, response);
  assert.equal(response.statusCode, 200);
  return response.body;
}

const categories = [
  { label: "Game", key: "platform", value: "fivem", other: { platform_id: "redm", platform_name: "RedM" } },
  { label: "Region", key: "region", value: "United States", other: { region: "United Kingdom" } },
  { label: "Language", key: "language", value: "English", other: { language: "French" } },
  { label: "Server setup", key: "mode", value: "vmenu", other: { framework: "QBCore" } },
  { label: "Access", key: "access", value: "whitelisted", other: { access_type: "public" } }
];

function assertCategoryLinks(document, record = server) {
  for (const selector of ["#server-meta-v3", "#server-info-v5"]) {
    const links = [...document.querySelectorAll(`${selector} a[href^="/servers?"]`)];
    assert.equal(links.length, categories.length, `${selector} should expose the five existing directory categories`);
    for (const [index, item] of categories.entries()) {
      const link = links[index], destination = new URL(link.getAttribute("href"), "https://www.browserp.com");
      assert.equal(destination.pathname, "/servers");
      assert.ok(destination.searchParams.has(item.key), `${item.label} must select its matching filter`);
      assert.equal(link.textContent.trim(), index === 0 ? "FiveM" : [record.region, record.language, record.framework, "Approval required"][index - 1]);
      const filters = globalThis.BrowseRPDiscovery.normalize(Object.fromEntries(destination.searchParams));
      assert.equal(filters[item.key], item.value, `${item.label} URL must resolve to its category`);
      assert.equal(globalThis.BrowseRPDiscovery.matches(record, filters), true, `${item.label} link must include this listing`);
      assert.equal(globalThis.BrowseRPDiscovery.matches({ ...record, ...item.other }, filters), false, `${item.label} link must exclude a different category`);
    }
  }
}

function assertNoNestedLinks(document) {
  const card = document.querySelector(".server-card");
  assert.ok(card, "The listing card remains available");
  const anchors = card.matches("a") ? [card, ...card.querySelectorAll("a")] : [...card.querySelectorAll("a")];
  assert.ok(anchors.some(link => new URL(link.getAttribute("href"), "https://www.browserp.com").pathname === "/server/county-rp"), "The card retains its listing navigation");
  for (const link of anchors) assert.equal(link.parentElement?.closest("a"), null, "Cards must never nest category links inside a listing link");
}

function assertTagLinks(document) {
  const links = [...document.querySelectorAll("#server-tags-v3 a")];
  assert.equal(links.length, server.tags.length);
  for (const [index, link] of links.entries()) {
    const destination = new URL(link.getAttribute("href"), "https://www.browserp.com");
    assert.equal(destination.origin, "https://www.browserp.com");
    assert.equal(destination.pathname, "/servers");
    assert.equal(destination.searchParams.get("platform"), "fivem");
    assert.equal(destination.searchParams.get("feature"), server.tags[index]);
    assert.equal(link.textContent, server.tags[index]);
    assert.equal(link.getAttribute("aria-label"), `Browse FiveM servers tagged ${server.tags[index]}`);
    assert.equal(link.querySelector("img,script"), null, "Tag text cannot turn into markup");
    const filters = globalThis.BrowseRPDiscovery.normalize(Object.fromEntries(destination.searchParams));
    assert.equal(globalThis.BrowseRPDiscovery.matches(server, filters), true, "Clicking a tag finds servers carrying that tag");
    assert.equal(globalThis.BrowseRPDiscovery.matches({ ...server, tags: ["different"] }, filters), false, "The tag is an exact feature filter, not a broad text search");
  }
}

test("server-detail tags are safe functional directory filters in the initial HTML", async () => {
  const dom = new JSDOM(await page("/server/county-rp"));
  try {
    assertTagLinks(dom.window.document);
    assertCategoryLinks(dom.window.document);
    const california = [...dom.window.document.querySelectorAll("#server-tags-v3 a")].find(link => link.textContent === "california");
    assert.equal(new URL(california.getAttribute("href"), "https://www.browserp.com").searchParams.get("feature"), "california", "California remains a direct category link");
  }
  finally { dom.window.close(); }
});

test("live server refresh preserves clickable tag filters and directory cards contain no nested links", async () => {
  const dom = new JSDOM(await page("/server/county-rp"), { url: "https://www.browserp.com/server/county-rp", runScripts: "outside-only", pretendToBeVisual: true });
  try {
    const w = dom.window;
    w.document.querySelector("#server-tags-v3").replaceChildren();
    w.matchMedia = () => ({ matches: true, addEventListener() {} });
    w.fetch = async path => ({ ok: true, json: async () => String(path).startsWith("/api/servers") ? { servers: [server], engagement: {} } : { authenticated: false, adverts: [], announcements: [] } });
    w.eval(read("public/browserp-platforms.js"));
    w.eval(read("public/browserp-v3.js"));
    await new Promise(resolve => setImmediate(resolve));
    assertTagLinks(w.document);
    assertCategoryLinks(w.document);
  } finally { dom.window.close(); }
  const directory = new JSDOM(await page("/servers"));
  try {
    assertNoNestedLinks(directory.window.document);
  } finally { directory.window.close(); }
});

test("missing or unconfirmed metadata is presented without a false category link", async () => {
  const incomplete = { ...server, region: "", language: "", framework: "", access_type: "unknown" };
  const dom = new JSDOM(await page("/server/county-rp", incomplete));
  try {
    assert.deepEqual([...dom.window.document.querySelectorAll("#server-meta-v3 a[href^='/servers?']")].map(link => new URL(link.getAttribute("href"), "https://www.browserp.com").searchParams.keys().next().value), ["platform"]);
    assert.deepEqual([...dom.window.document.querySelectorAll("#server-info-v5 a[href^='/servers?']")].map(link => new URL(link.getAttribute("href"), "https://www.browserp.com").searchParams.keys().next().value), ["platform"]);
    assert.match(dom.window.document.querySelector("#server-info-v5").textContent, /Not confirmed/);
  } finally { dom.window.close(); }
  const live = new JSDOM(await page("/server/county-rp", incomplete), { url: "https://www.browserp.com/server/county-rp", runScripts: "outside-only", pretendToBeVisual: true });
  try {
    const w = live.window;
    w.matchMedia = () => ({ matches: true, addEventListener() {} });
    w.fetch = async path => ({ ok: true, json: async () => String(path).startsWith("/api/servers") ? { servers: [incomplete], engagement: {} } : { authenticated: false, adverts: [], announcements: [] } });
    w.eval(read("public/browserp-platforms.js")); w.eval(read("public/browserp-v3.js"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(w.document.querySelectorAll("#server-meta-v3 a[href^='/servers?']").length, 1);
    assert.equal(w.document.querySelectorAll("#server-info-v5 a[href^='/servers?']").length, 1);
  } finally { live.window.close(); }
});
