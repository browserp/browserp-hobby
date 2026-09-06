import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createPublicPageHandler } from "../lib/public-pages.js";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const server = { id: "01234567-1234-1234-1234-0123456789ab", name: "County RP", slug: "county-rp", platform_id: "fivem", platform_name: "FiveM", description: "Build a character and meet your community.", region: "United States", language: "English", framework: "vMenu", tags: ["california", "businesses", "custom cars", 'x"><img src=x onerror=alert(1)>'] };

async function page(path) {
  const response = { setHeader() {}, end(body) { this.body = body; } };
  await createPublicPageHandler({ data: { server: async () => ({ server }), directory: async () => ({ total: 1, servers: [server] }) } })({ url: path, method: "GET", headers: {} }, response);
  assert.equal(response.statusCode, 200);
  return response.body;
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
  try { assertTagLinks(dom.window.document); }
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
  } finally { dom.window.close(); }
  const directory = new JSDOM(await page("/servers"));
  try {
    const card = directory.window.document.querySelector(".server-card");
    assert.equal(card.querySelectorAll(".server-tags span").length, 3);
    assert.equal(card.querySelectorAll("a").length, 0);
  } finally { directory.window.close(); }
});
