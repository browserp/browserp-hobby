import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
async function dashboard(t, servers) {
  const dom = new JSDOM(read("dashboard.html"), { url: "https://browserp.test/dashboard", runScripts: "outside-only" });
  const w = dom.window; t.after(() => w.close());
  const requests = [];
  w.fetch = async (path, options) => {
    requests.push({ path, method: options.method });
    const payload = {
      "/api/auth/session": { authenticated: true, user: { profile: { display_name: "Fixture owner" } }, csrfToken: "fixture" },
      "/api/public/content": { content: {} },
      "/api/me/overview": { overview: { servers, profile: { display_name: "Fixture owner" }, submissions: [], favoriteServers: [], notifications: [] } },
      "/api/me/profile": { profile: { display_name: "Fixture owner", profile_visibility: "public" } }
    }[path];
    assert.ok(payload, `Unexpected request: ${path}`);
    return { ok: true, json: async () => payload };
  };
  w.eval(read("owner-badge.js")); w.eval(read("browserp-portal-v2.js"));
  for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve));
  const $ = selector => w.document.querySelector(selector);
  assert.equal($("#portal-root").getAttribute("aria-busy"), "false");
  assert.ok(requests.every(request => request.method === "GET"));
  return { $, w };
}
const listing = status => ({ id: `${status}-fixture`, name: `${status} community`, slug: `${status}-community`, status, updated_at: "2026-09-04T09:00:00Z" });

test("dashboard counts only published records while retaining the full recent listing history and status badges", async t => {
  const statuses = ["draft", "pending_review", "published", "suspended", "rejected", "archived"];
  const h = await dashboard(t, statuses.map(listing));
  const metric = h.$('[aria-label="Account summary"] .metric-v2');
  assert.equal(metric.querySelector("strong").textContent, "1");
  assert.equal(metric.querySelector("span").textContent, "Published listings");
  assert.match(metric.querySelector("small").textContent, /recent listings/);
  assert.equal(h.$('.portal-nav a[href="#account"]').textContent, "Profile & privacy");
  assert.equal(h.$("#listings h2").textContent, "Your listings");
  assert.match(h.$("#listings .portal-panel-head p").textContent, /including archived entries/);
  assert.equal(h.w.document.querySelectorAll("#listings .portal-item").length, 6);
  const archived = [...h.w.document.querySelectorAll("#listings .portal-item")].find(item => item.textContent.includes("archived community"));
  assert.match(archived.textContent, /Archived/);
  assert.equal(archived.querySelector("a"), null);
  const publicLinks = [...h.w.document.querySelectorAll('#listings a[href^="/server/"]')];
  assert.deepEqual(publicLinks.map(link => link.getAttribute("href")), ["/server/published-community"]);
  assert.equal(h.w.document.querySelectorAll("#listings [data-owner-badge-action]").length, 1);
});

test("dashboard section navigation shows one focused panel without discarding other account controls", async t => {
  const h = await dashboard(t, [listing("published")]);
  const ids = ["listings", "submissions", "saved", "recent", "notifications", "content-status", "account"];
  assert.deepEqual(ids.map(id => h.$(`#${id}`).id), ids, "all account sections remain available in the dashboard");
  assert.equal(h.$("#listings").hidden, false);
  assert.ok(ids.slice(1).every(id => h.$(`#${id}`).hidden), "the initial tab keeps the long dashboard collapsed");

  const bio = h.$('#account textarea[name="bio"]');
  bio.value = "Keep this unfinished profile note";
  h.$('.portal-nav a[href="#saved"]').click();
  assert.equal(h.w.location.hash, "#saved");
  assert.equal(h.$("#saved").hidden, false);
  assert.ok(ids.filter(id => id !== "saved").every(id => h.$(`#${id}`).hidden));
  assert.equal(h.$('.portal-nav a[href="#saved"]').getAttribute("aria-current"), "page");
  assert.equal(h.w.document.activeElement, h.$("#saved h2"));

  h.w.location.hash = "#account"; h.w.dispatchEvent(new h.w.Event("hashchange"));
  assert.equal(h.$("#account").hidden, false, "a direct account link opens its containing panel");
  assert.equal(h.$('#account textarea[name="bio"]').value, "Keep this unfinished profile note", "switching sections does not rebuild the profile form");

  const childTarget = h.w.document.createElement("span"); childTarget.id = "account-preferences"; h.$("#account").append(childTarget);
  h.w.location.hash = "#account-preferences"; h.w.dispatchEvent(new h.w.Event("hashchange"));
  assert.equal(h.$("#account").hidden, false, "a direct child target keeps its parent section active");

  h.w.history.replaceState(null, "", "#recent"); h.w.dispatchEvent(new h.w.Event("popstate"));
  assert.equal(h.$("#recent").hidden, false, "history navigation restores the selected section");
  assert.equal(h.$('.portal-nav a[href="#recent"]').getAttribute("aria-current"), "page");
});

test("an archived-only account shows zero published listings without hiding the archive", async t => {
  const h = await dashboard(t, [{ ...listing("archived"), name: "FloridaDOJRO" }]);
  assert.equal(h.$('[aria-label="Account summary"] .metric-v2 strong').textContent, "0");
  assert.match(h.$("#listings").textContent, /FloridaDOJRO/);
  assert.match(h.$("#listings").textContent, /Archived/);
  assert.equal(h.$('#listings a[href^="/server/"]'), null);
  assert.equal(h.$("#listings [data-owner-badge-action]"), null);
  assert.doesNotMatch(h.$("#listings").textContent, /No listings yet|Your published listings/);
});

test("an account with no listings retains its creation action and accurate empty state", async t => {
  const h = await dashboard(t, []);
  assert.equal(h.$('[aria-label="Account summary"] .metric-v2 strong').textContent, "0");
  assert.match(h.$("#listings").textContent, /No listings yet/);
  assert.ok([...h.w.document.querySelectorAll('#listings a[href="/list-server"]')].some(link => link.textContent === "Create a listing"));
});
