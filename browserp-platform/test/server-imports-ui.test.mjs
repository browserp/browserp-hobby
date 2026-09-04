import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fixture = () => ({ id: "fixture-server", slug: "fixture-city", name: "Fixture City", platform_id: "fivem", platform_name: "FiveM", description: "A synthetic roleplay community used to verify server details.", region: "United Kingdom", language: "French", framework: "QBCore", access_type: "allowlisted", imported: true, claimable: true, players: 0, max_players: 64, online: true, checked_at: new Date().toISOString(), tags: ["roleplay"], community_url: null, cfx_join_url: "https://cfx.re/join/abc123", logo_url: "https://frontend.cfx-services.net/api/servers/icon/abc123/42.png", banner_url: "https://i.imgur.com/fixture.png" });
const tick = async () => { for (let n = 0; n < 4; n++) await new Promise((resolve) => setImmediate(resolve)); };
async function harness(records) {
  const dom = new JSDOM(read("public/server.html"), { url: "https://browserp.test/server/fixture-city", runScripts: "outside-only", pretendToBeVisual: true });
  const { window: w } = dom;
  const timers = [], requests = [], claims = [];
  let visibility = "visible", serverRequest = 0;
  Object.defineProperty(w.document, "visibilityState", { get: () => visibility });
  w.matchMedia = () => ({ matches: true, addEventListener() {} });
  w.setInterval = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
  w.clearInterval = () => {};
  w.fetch = async (path) => {
    requests.push(path);
    if (path === "/api/auth/session") return { ok: true, json: async () => ({ authenticated: false }) };
    if (path.startsWith("/api/servers?slug=")) {
      const record = records[Math.min(serverRequest++, records.length - 1)];
      return record instanceof Error ? { ok: false, status: 502, json: async () => ({ error: record.message }) } : { ok: true, json: async () => ({ servers: [record], engagement: {} }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  w.BrowseRPServerClaims = { init({ server, root }) { claims.push(server); root.hidden = false; const input = w.document.createElement("textarea"); input.id = "claim-draft"; input.value = "Keep this unfinished claim"; root.append(input); } };
  w.eval(read("public/browserp-platforms.js")); w.eval(read("public/browserp-v3.js")); await tick();
  return { dom, w, timers, requests, claims, $: (selector) => w.document.querySelector(selector), visibility(value) { visibility = value; } };
}

test("Imported server details keep metadata order, display real zero and isolate media behind reviewed sources", async () => {
  const h = await harness([fixture()]);
  try {
    assert.equal(h.$("#server-name-v3").textContent, "Fixture City");
    assert.equal(h.$("#server-status-v3").textContent, "0 / 64 online");
    assert.deepEqual([...h.w.document.querySelectorAll("#server-info-v5 dt")].slice(0, 5).map((element) => element.textContent), ["Game", "Region", "Language", "Server setup", "Access"]);
    assert.equal(h.$("#server-info-v5 .server-info-card-v5:nth-child(3) dd").textContent, "French");
    assert.equal(h.$("#server-info-v5 .server-info-card-v5:nth-child(4) dd").textContent, "QBCore");
    assert.ok(h.$("#server-checked-v3 time").dateTime);
    assert.equal(h.$("#server-join-v3").hidden, true, "A missing community link must not become a link to the homepage");
    assert.equal(h.$("#server-connect-v3").href, "https://cfx.re/join/abc123");
    assert.equal(h.$("#server-website-v3").hidden, true, "An absent website must not become a homepage link");
    assert.equal(h.$("#server-website-v3").hasAttribute("href"), false);
    for (const image of h.w.document.querySelectorAll(".server-import-logo-v3,.server-import-banner-v3")) { assert.ok(image.getAttribute("src").startsWith("/api/public/server-image?url=")); assert.equal(image.referrerPolicy, "no-referrer"); }
    assert.equal(h.claims.length, 1); assert.equal(h.$("#server-claim-panel").hidden, false);
  } finally { h.dom.window.close(); }
});

test("Signed Cfx icon versions render a reviewed logo and unknown access stays explicitly unconfirmed", async () => {
  const h = await harness([{ ...fixture(), logo_url: "https://frontend.cfx-services.net/api/servers/icon/abc123/-580691816.png", access_type: "unknown" }]);
  try {
    assert.equal(h.$(".server-import-logo-v3").getAttribute("src"), "/api/public/server-image?url=https%3A%2F%2Ffrontend.cfx-services.net%2Fapi%2Fservers%2Ficon%2Fabc123%2F-580691816.png");
    assert.equal(h.$("#server-info-v5 .server-info-card-v5:nth-child(5) dd").textContent, "Not confirmed");
  } finally { h.dom.window.close(); }
});

test("Player refresh changes only status, pauses while hidden, and preserves an unfinished claim", async () => {
  const initial = fixture(), later = { ...initial, players: 17, checked_at: new Date().toISOString() };
  const h = await harness([initial, later, new Error("Upstream unavailable")]);
  try {
    const timer = h.timers.find((entry) => entry.delay === 60_000); assert.ok(timer);
    const before = h.requests.length; h.visibility("hidden"); await timer.callback(); assert.equal(h.requests.length, before);
    h.visibility("visible"); await timer.callback(); await tick();
    assert.equal(h.$("#server-status-v3").textContent, "17 / 64 online");
    assert.equal(h.$("#server-info-v5 .server-info-card-v5:last-child dd").textContent, "17 / 64 online");
    assert.equal(h.$("#claim-draft").value, "Keep this unfinished claim"); assert.equal(h.claims.length, 1);
    await timer.callback(); await tick();
    assert.equal(h.$("#server-status-v3").textContent, "Player count unavailable");
    assert.match(h.$("#server-checked-v3").textContent, /Last checked.*Waiting for a fresh FiveM update/);
    assert.equal(h.$("#claim-draft").value, "Keep this unfinished claim"); assert.equal(h.claims.length, 1);
  } finally { h.dom.window.close(); }
});

test("Missing, inconsistent and stale counts never render as a fabricated live zero", async () => {
  for (const patch of [{ players: null }, { players: 65 }, { checked_at: new Date(Date.now() - 600_000).toISOString() }, { checked_at: null }, { online: null }]) {
    const h = await harness([{ ...fixture(), ...patch }]);
    try { assert.equal(h.$("#server-status-v3").textContent, "Player count unavailable", JSON.stringify(patch)); assert.equal(h.$("#server-info-v5 .server-info-card-v5:last-child dd").textContent, "Player count unavailable"); }
    finally { h.dom.window.close(); }
  }
});

test("Untrusted media and Discord links disguised as game connect links are not rendered", async () => {
  const h = await harness([{ ...fixture(), logo_url: "/api/public/server-image?url=https%3A%2F%2F127.0.0.1%2Fprivate.png", banner_url: "https://evil.example/track.png", cfx_join_url: "https://discord.gg/not-a-join-link" }]);
  try { assert.equal(h.$(".server-import-logo-v3"), null); assert.equal(h.$(".server-import-banner-v3"), null); assert.equal(h.$("#server-connect-v3").hidden, true); assert.equal(h.$("#server-initials-v3").textContent, "FC"); }
  finally { h.dom.window.close(); }
});

test("A reviewed official website remains separate from Discord and the Cfx game connection", async () => {
  const h = await harness([{ ...fixture(), website_url: "https://community.example/apply?from=directory#requirements", community_url: "https://discord.gg/community" }]);
  try {
    const website = h.$("#server-website-v3");
    assert.equal(website.hidden, false);
    assert.equal(website.textContent, "Official website");
    assert.equal(website.href, "https://community.example/apply?from=directory#requirements");
    assert.equal(website.target, "_blank");
    assert.equal(website.rel, "noopener noreferrer");
    assert.equal(h.$("#server-join-v3").href, "https://discord.gg/community");
    assert.equal(h.$("#server-connect-v3").href, "https://cfx.re/join/abc123");
    assert.deepEqual([...h.w.document.querySelectorAll("#server-info-v5 dt")].slice(0, 5).map(element => element.textContent), ["Game", "Region", "Language", "Server setup", "Access"]);
  } finally { h.dom.window.close(); }
});

test("Missing, executable, credential-bearing and malformed website URLs never become public links", async () => {
  for (const website_url of [null, "", "javascript:alert(1)", "data:text/html,hello", "http://community.example", "//community.example", "/community", "https:community.example", "https://user:password@community.example", "https://user@community.example", "https://community.example/a b", "https://community.example/\napply", "https:\\community.example", { url: "https://community.example" }]) {
    const h = await harness([{ ...fixture(), website_url }]);
    try {
      assert.equal(h.$("#server-website-v3").hidden, true, JSON.stringify(website_url));
      assert.equal(h.$("#server-website-v3").hasAttribute("href"), false, JSON.stringify(website_url));
      assert.equal(h.$("#server-connect-v3").hidden, false, "An invalid website must not hide the valid game connection");
    } finally { h.dom.window.close(); }
  }
});
