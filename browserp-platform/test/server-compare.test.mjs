import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const script = readFileSync(new URL("../public/server-compare.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../public/compare.html", import.meta.url), "utf8");
const context = { URLSearchParams, Date, Intl }; vm.runInNewContext(script, context);
const { create, facts, clean, key: KEY } = context.BrowseRPCompareModel;
const json = value => JSON.parse(JSON.stringify(value));
const storage = initial => { const data = new Map(Object.entries(initial || {})); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), data }; };
const now = Date.now();
const server = (slug, extra = {}) => ({ slug, name: `Community ${slug}`, platform_id: "fivem", region: "United Kingdom", language: "English", framework: "vMenu", access_type: "public", tags: ["economy", "custom cars"], online: true, players: 32, capacity: 64, checked_at: new Date(now).toISOString(), ...extra });
const settle = () => new Promise(resolve => setImmediate(resolve));

test("comparison shortlist caps at three public slugs and stores no fetched or private data", () => {
  const persisted = storage(), changes = [], model = create(persisted, detail => changes.push(detail));
  for (const slug of ["first-server", "second-server", "third-server"]) assert.equal(model.toggle({ slug, name: slug, owner_id: "PRIVATE", accessToken: "SECRET" }).ok, true);
  assert.equal(model.toggle({ slug: "fourth-server" }).reason, "full");
  assert.equal(model.toggle({ slug: "../staffpanel" }).reason, "invalid");
  assert.equal(model.toggle({ slug: "https://evil.test" }).reason, "invalid");
  assert.equal(model.has("second-server"), true);
  assert.equal(model.href(), "/compare?servers=first-server,second-server,third-server");
  assert.doesNotMatch(persisted.getItem(KEY), /PRIVATE|SECRET|owner_id|accessToken/);
  assert.deepEqual(Object.keys(JSON.parse(persisted.getItem(KEY))[0]), ["slug", "name"]);
  const snapshot = model.selected(); snapshot[0].slug = "tampered";
  assert.equal(model.selected()[0].slug, "first-server");
  assert.equal(model.toggle({ slug: "second-server" }).ok, true);
  assert.equal(model.has("second-server"), false);
  model.clear(); assert.equal(model.selected().length, 0); assert.equal(changes.at(-1).count, 0);
});

test("corrupt storage, duplicates and blocked browser storage do not break the shortlist", () => {
  const malformed = storage({ [KEY]: "not JSON" }); const model = create(malformed);
  assert.deepEqual(json(model.selected()), []);
  assert.equal(model.toggle({ slug: "valid-server" }).ok, true);
  assert.deepEqual(json(clean([{ slug: "same" }, { slug: "same", name: "Duplicate" }, { slug: "<script>" }, { slug: "valid" }, { slug: "last" }, { slug: "fourth" }])), [{ slug: "same", name: "" }, { slug: "valid", name: "" }, { slug: "last", name: "" }]);
  const blocked = create({ getItem() { throw Error("Blocked"); }, setItem() { throw Error("Blocked"); } });
  const added = blocked.toggle({ slug: "temporary" });
  assert.equal(added.ok, true); assert.equal(added.persisted, false); assert.equal(blocked.has("temporary"), true);
  blocked.remove("temporary"); assert.equal(blocked.has("temporary"), false);
});

test("comparison reports unknown, stale and unavailable values without invented live counts", () => {
  assert.equal(facts(server("fresh"), now).count, "32 / 64");
  assert.equal(facts(server("fresh"), now).state, "Reported online");
  const stale = facts(server("old", { checked_at: new Date(now - 6 * 60_000).toISOString() }), now);
  assert.equal(stale.count, "Not available"); assert.equal(stale.state, "Not recently verified");
  const unknown = facts({ platform_id: "fivem" }, now);
  assert.equal(unknown.region, "Not provided"); assert.equal(unknown.access, "Not confirmed"); assert.equal(unknown.count, "Not available");
  assert.equal(facts(server("offline", { online: false }), now).state, "Reported offline");
  assert.equal(facts(server("empty", { players: 0 }), now).count, "0 / 64");
  assert.equal(facts(server("missing", { players: null }), now).count, "Not available");
  assert.equal(facts(server("future", { checked_at: new Date(now + 1).toISOString() }), now).count, "Not available");
  assert.equal(facts(server("future", { checked_at: new Date(now + 120_000).toISOString() }), now).count, "Not available");
  assert.equal(facts(server("wrong", { players: 80, capacity: 64 }), now).count, "Not available");
  assert.equal(facts(server("network", { count_scope: "network" }), now).count, "32 / 64 across the network");
  assert.equal(facts(server("roblox", { platform_id: "roblox" }), now).count, "Not provided for this listing type");
});

async function setup(url = "https://www.browserp.com/compare", respond = slug => ({ ok: true, servers: [server(slug)] })) {
  const dom = new JSDOM(page, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, requests = [];
  w.fetch = async (path, options) => {
    requests.push({ path, options });
    const slug = new URL(path, w.location.origin).searchParams.get("slug"), data = respond(slug);
    return { ok: data.ok, status: data.status || (data.ok ? 200 : 503), json: async () => ({ servers: data.servers, engagement: data.engagement }) };
  };
  w.eval(script); await settle();
  return { dom, w, requests };
}

test("shared comparison loads only three sanitized public listings through the existing API", async () => {
  const { dom, w, requests } = await setup("https://www.browserp.com/compare?servers=first,first,../private,second,third,fourth");
  try {
    assert.deepEqual(requests.map(request => request.path), ["/api/servers?slug=first", "/api/servers?slug=second", "/api/servers?slug=third"]);
    for (const request of requests) { assert.equal(request.options.credentials, "omit"); assert.equal(Object.keys(request.options.headers).join(","), "Accept"); }
    assert.equal(w.document.querySelectorAll(".compare-server-heading").length, 3);
    assert.equal(w.document.querySelector("#compare-count").textContent, "3 of 3 selected");
    assert.equal(w.document.querySelector("#compare-results").getAttribute("aria-busy"), "false");
    assert.match(w.document.querySelector(".compare-table").textContent, /United Kingdom/);
    assert.doesNotMatch(w.localStorage.getItem(KEY), /players|capacity|framework|online|checked_at/);
    w.document.querySelector(".compare-remove").click(); await settle();
    assert.equal(w.document.querySelectorAll(".compare-server-heading").length, 2);
    w.document.querySelector("#compare-clear").click(); await settle();
    assert.equal(w.document.querySelector("#compare-empty").hidden, false);
    assert.equal(w.document.querySelector("#compare-share").disabled, true);
  } finally { dom.window.close(); }
});

test("withdrawn and failed listings are clearly unavailable and never shown as zero players", async () => {
  const { dom, w } = await setup("https://www.browserp.com/compare?servers=removed,failed", slug => slug === "removed" ? { ok: false, status: 404 } : { ok: false, status: 503 });
  try {
    assert.match(w.document.querySelector("#compare-results").textContent, /no longer available/);
    assert.match(w.document.querySelector("#compare-results").textContent, /could not be loaded/);
    assert.doesNotMatch(w.document.querySelector("#compare-results").textContent, /0 players|Reported online/);
    assert.equal(w.document.querySelectorAll(".compare-server-name[href]").length, 0);
  } finally { dom.window.close(); }
});

test("server labels and tags render as text, and private payload fields stay out of the comparison", async () => {
  const { dom, w } = await setup("https://www.browserp.com/compare?servers=safe", slug => ({ ok: true, servers: [server(slug, { name: '<img src=x onerror="alert(1)">', tags: ["<script>bad()</script>"], owner_id: "PRIVATE_OWNER", secret: "PRIVATE_SECRET" })] }));
  try {
    const results = w.document.querySelector("#compare-results");
    assert.equal(results.querySelectorAll("script,img[onerror]").length, 0);
    assert.match(results.textContent, /<script>bad\(\)<\/script>/);
    assert.doesNotMatch(results.innerHTML, /PRIVATE_OWNER|PRIVATE_SECRET/);
    w.document.querySelector("#compare-share").click(); await settle();
    const copy = w.document.querySelector("#compare-share-url");
    assert.equal(copy.hidden, false);
    assert.equal(copy.value, "https://www.browserp.com/compare?servers=safe");
    assert.equal(w.document.activeElement, copy);
  } finally { dom.window.close(); }
});

test("comparison without a shortlist is an accessible empty state with no API calls", async () => {
  const { dom, w, requests } = await setup();
  try {
    assert.equal(requests.length, 0);
    assert.equal(w.document.querySelector("#compare-empty").hidden, false);
    assert.equal(w.document.querySelector("#compare-table-wrap").hidden, true);
    assert.equal(w.document.querySelector("#compare-results").getAttribute("aria-label"), "Server comparison");
    assert.equal(w.document.querySelector("#compare-results").tabIndex, 0);
  } finally { dom.window.close(); }
});
