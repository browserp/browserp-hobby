import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/server-shortlist.js", import.meta.url), "utf8");
const compareSource = readFileSync(new URL("../public/server-compare.js", import.meta.url), "utf8");
const accountId = "00000000-0000-4000-8000-000000000001";
const otherAccountId = "00000000-0000-4000-8000-000000000002";
const serverId = "00000000-0000-4000-8000-000000000003";
const otherServerId = "00000000-0000-4000-8000-000000000004";
const server = { id: serverId, slug: "county-roleplay", name: "County Roleplay" };
const member = (id = accountId) => ({ authenticated: true, user: { id }, csrfToken: "initial-csrf" });
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function fixture(t, fetcher = async () => { throw Error("Unexpected request"); }, { html = "<main></main>", compare = true, timeout } = {}) {
  const dom = new JSDOM(html, { url: "https://browserp.test/servers", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [], navigation = [], timers = new Map();
  let timerId = 0;
  if (compare) w.eval(compareSource);
  // Use the real DOM but a navigation adapter: jsdom deliberately cannot follow
  // a full document navigation. Production source is executed without rewriting.
  vm.runInNewContext(source, {
    window: w, document: w.document, AbortController, AbortSignal: timeout ? { any: signals => AbortSignal.any(signals), timeout } : AbortSignal, DOMException,
    location: { assign: value => navigation.push(value), reload: () => navigation.push("reload") },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: (path, options = {}) => { const call = { path, options }; calls.push(call); return fetcher(path, options, calls.length); }
  });
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  const add = (values = server) => {
    const card = w.document.createElement("a"); card.className = "server-card"; card.href = `/server/${values.slug}`;
    const heading = w.document.createElement("h3"); heading.textContent = values.name; card.append(heading);
    const wrapper = w.BrowseRPShortlist.wrap(card, values); w.document.querySelector("main").append(wrapper); return wrapper;
  };
  return { w, calls, navigation, timers, add, api: w.BrowseRPShortlist,
    save: root => root.querySelector("[data-shortlist-save]"),
    compare: root => root.querySelector("[data-shortlist-compare]"),
    status: () => w.document.querySelector("[data-shortlist-status]")?.textContent || "",
    posts: () => calls.filter(call => call.options.method === "POST") };
}

test("shortlist controls are labelled sibling buttons, never nested within a server link, including detail remounts", async t => {
  const h = fixture(t), wrapper = h.add();
  assert.equal(wrapper.tagName, "ARTICLE");
  assert.equal(wrapper.querySelector("a.server-card").nextElementSibling.className, "server-shortlist-actions");
  assert.equal(wrapper.querySelector("a button"), null);
  assert.equal(wrapper.querySelector("[role=group]").getAttribute("aria-label"), "Shortlist County Roleplay");
  for (const button of wrapper.querySelectorAll("button")) assert.equal(button.type, "button");
  assert.equal(h.save(wrapper).getAttribute("aria-pressed"), "false");
  assert.equal(h.save(wrapper).disabled, true, "a not-yet-resolved session cannot save");
  assert.equal(h.compare(wrapper).getAttribute("aria-label"), "Add County Roleplay to comparison");
  assert.equal(wrapper.querySelector("[data-shortlist-open]").hidden, true);
  const detail = h.w.document.createElement("section");
  detail.innerHTML = '<div class="detail-actions-v3"><a href="https://community.example">Join community</a></div><p>Existing content</p>';
  h.w.document.body.append(detail);
  h.api.mountDetail(detail, server); h.api.mountDetail(detail, server);
  assert.equal(detail.querySelectorAll(".server-shortlist-actions").length, 1);
  assert.equal(detail.querySelector(".detail-actions-v3").nextElementSibling.classList.contains("shortlist-detail-v9"), true);
  assert.equal(detail.querySelector("a button"), null);
  assert.match(detail.textContent, /Existing content/);
});

test("SSR cards remain navigable and comparable without inventing a saveable UUID, and enhancement is not duplicated", async t => {
  const h = fixture(t, undefined, { html: '<main><a class="server-card" href="/server/rendered-community"><h3>Rendered community</h3></a></main>' });
  await h.api.setSession({ authenticated: false });
  h.w.document.dispatchEvent(new h.w.Event("DOMContentLoaded"));
  const wrapper = h.w.document.querySelector(".server-shortlist-card");
  assert.equal(h.w.document.querySelectorAll(".server-shortlist-card").length, 1);
  assert.equal(wrapper.querySelector("a.server-card").getAttribute("href"), "/server/rendered-community");
  assert.equal(wrapper.querySelector(".server-shortlist-actions").dataset.serverId, "");
  assert.equal(h.save(wrapper).disabled, true);
  assert.equal(h.compare(wrapper).disabled, false);
  const unsafe = h.add({ ...server, slug: "../staffpanel" });
  assert.equal(unsafe.tagName, "A"); assert.equal(unsafe.querySelector("button"), null);
  const escaped = h.add({ ...server, name: '<img src=x onerror="bad()">' });
  assert.equal(escaped.querySelector("img"), null);
  assert.equal(h.calls.length, 0);
});

test("compare enforces three selections and repaints every duplicate card on model and cross-tab events", async t => {
  const h = fixture(t), cards = [h.add(), h.add(), ...["second", "third", "fourth"].map(slug => h.add({ ...server, slug, name: slug }))];
  await h.api.setSession({ authenticated: false });
  h.compare(cards[0]).click();
  assert.equal(h.compare(cards[1]).getAttribute("aria-pressed"), "true");
  h.compare(cards[2]).click(); h.compare(cards[3]).click(); h.compare(cards[4]).click();
  assert.equal(h.w.BrowseRPCompare.selected().length, 3);
  assert.equal(h.compare(cards[4]).getAttribute("aria-pressed"), "false");
  assert.match(h.status(), /up to three servers/);
  for (const card of cards) {
    const link = card.querySelector("[data-shortlist-open]");
    assert.equal(link.hidden, false); assert.equal(link.textContent, "Compare (3/3)");
    assert.equal(link.getAttribute("href"), "/compare?servers=county-roleplay,second,third");
  }
  h.w.BrowseRPCompare.remove(server.slug);
  assert.equal(h.compare(cards[0]).getAttribute("aria-pressed"), "false");
  assert.equal(h.compare(cards[1]).getAttribute("aria-pressed"), "false");
  h.w.localStorage.clear();
  h.w.dispatchEvent(new h.w.StorageEvent("storage", { key: null, storageArea: h.w.localStorage }));
  assert.equal(cards.every(card => card.querySelector("[data-shortlist-open]").hidden), true);
  assert.equal(h.calls.length, 0, "comparison is independent of private save requests");
});

test("signed-out save opens sign-in with the server return destination and makes no private request", async t => {
  const h = fixture(t), card = h.add();
  await h.api.setSession({ authenticated: false });
  assert.equal(h.save(card).disabled, false);
  h.save(card).click();
  assert.deepEqual(h.navigation, ["/dashboard?returnTo=%2Fserver%2Fcounty-roleplay"]);
  assert.equal(h.calls.length, 0);
});

test("signed-in cards share one private read and save with fresh CSRF and account binding, painting only the server result", async t => {
  let favorited = true;
  const h = fixture(t, async (path, options) => {
    if (path === "/api/auth/session") return response({ ...member(), csrfToken: "fresh-csrf" });
    if (options.method === "POST") return response({ result: { serverId, favorited, count: Number(favorited) } });
    return response({ serverIds: [] });
  });
  const a = h.add(), b = h.add();
  await h.api.setSession(member());
  assert.equal(h.calls.length, 1);
  for (const card of [a, b]) assert.equal(h.save(card).disabled, false);
  h.save(a).click(); await tick();
  assert.equal(h.posts().length, 1);
  const options = h.posts()[0].options;
  assert.deepEqual(JSON.parse(options.body), { serverId, accountId });
  assert.equal(options.headers["X-BrowseRP-CSRF"], "fresh-csrf");
  assert.equal(options.headers["Content-Type"], "application/json");
  for (const call of h.calls) {
    assert.equal(call.options.credentials, "same-origin"); assert.equal(call.options.cache, "no-store");
    assert.ok(call.options.signal);
  }
  for (const card of [a, b]) assert.equal(h.save(card).getAttribute("aria-pressed"), "true");
  assert.equal(h.w.localStorage.length, 0, "account favorites are not persisted in browser storage");
  favorited = false; h.save(b).click(); await tick();
  assert.equal(h.posts().length, 2);
  for (const card of [a, b]) assert.equal(h.save(card).getAttribute("aria-pressed"), "false");
});

test("a save in flight disables all cards for that UUID and ignores repeated clicks", async t => {
  const pending = deferred();
  const h = fixture(t, async (path, options) => options.method === "POST" ? pending.promise
    : path === "/api/auth/session" ? response({ ...member(), csrfToken: "fresh" }) : response({ serverIds: [] }));
  const a = h.add(), b = h.add(); await h.api.setSession(member());
  h.save(a).click(); h.save(b).click(); await tick();
  assert.equal(h.posts().length, 1);
  assert.equal(h.save(a).disabled, true); assert.equal(h.save(b).disabled, true);
  assert.equal(h.save(a).getAttribute("aria-busy"), "true");
  h.save(b).dispatchEvent(new h.w.Event("click")); await tick();
  assert.equal(h.posts().length, 1, "guard also rejects programmatically dispatched duplicate clicks");
  pending.resolve(response({ result: { favorited: true } })); await tick();
  assert.equal(h.save(a).disabled, false); assert.equal(h.save(b).textContent, "Saved");
});

test("a changed, signed-out or incomplete preflight session never sends the save", async t => {
  for (const fresh of [member(otherAccountId), { authenticated: false }, { authenticated: true, user: { id: accountId } }]) {
    const h = fixture(t, async path => path === "/api/auth/session" ? response(fresh) : response({ serverIds: [serverId] }));
    const card = h.add(); await h.api.setSession(member());
    h.save(card).click(); await tick();
    assert.equal(h.posts().length, 0);
    assert.equal(h.save(card).getAttribute("aria-pressed"), "false");
    assert.match(h.status(), /sign-in changed/);
  }
});

test("switching accounts aborts an old favorites read and ignores its eventual response", async t => {
  const oldRead = deferred(); let reads = 0;
  const h = fixture(t, async () => ++reads === 1 ? oldRead.promise : response({ serverIds: [otherServerId] }));
  const oldCard = h.add(), newCard = h.add({ ...server, id: otherServerId, slug: "other-server" });
  const previous = h.api.setSession(member());
  await h.api.setSession(member(otherAccountId));
  assert.equal(h.calls[0].options.signal.aborted, true);
  oldRead.resolve(response({ serverIds: [serverId] })); await previous;
  assert.equal(h.save(oldCard).getAttribute("aria-pressed"), "false");
  assert.equal(h.save(newCard).getAttribute("aria-pressed"), "true");
  assert.equal(h.w.localStorage.length, 0);
});

test("late save responses from the previous account cannot restore its private state or show a success notice", async t => {
  const oldWrite = deferred();
  const h = fixture(t, async (path, options) => options.method === "POST" ? oldWrite.promise
    : path === "/api/auth/session" ? response({ ...member(), csrfToken: "fresh" }) : response({ serverIds: [] }));
  const card = h.add(); await h.api.setSession(member());
  h.save(card).click(); await tick();
  assert.equal(h.posts().length, 1);
  await h.api.setSession(member(otherAccountId));
  assert.equal(h.posts()[0].options.signal.aborted, true);
  oldWrite.resolve(response({ result: { favorited: true } })); await tick();
  assert.equal(h.save(card).getAttribute("aria-pressed"), "false");
  assert.equal(h.status(), "");
  assert.equal(h.save(card).getAttribute("aria-busy"), "false");
});

test("uncertain network, server-error and malformed-success writes lock that server against accidental retry", async t => {
  for (const failure of ["network", "server", "malformed"]) {
    const h = fixture(t, async (path, options) => {
      if (path === "/api/auth/session") return response({ ...member(), csrfToken: "fresh" });
      if (options.method === "POST") {
        if (failure === "network") throw TypeError("Failed to fetch");
        if (failure === "server") return response({ error: "Temporary failure" }, 503);
        return response({ result: { favorited: "true" } });
      }
      return response({ serverIds: [] });
    });
    const card = h.add(); await h.api.setSession(member());
    h.save(card).click(); await tick();
    assert.equal(h.posts().length, 1);
    assert.equal(h.save(card).disabled, true);
    assert.equal(h.save(card).textContent, "Check saved servers");
    assert.match(h.status(), /couldn’t confirm that save/);
    h.save(card).dispatchEvent(new h.w.Event("click")); await tick();
    assert.equal(h.posts().length, 1);
    await h.api.setSession(member());
    assert.equal(h.save(card).disabled, false, "an explicit fresh saved-state read recovers the control");
  }
});

test("a transient preflight failure leaves a retryable control because no non-idempotent save was sent", async t => {
  const h = fixture(t, async path => path === "/api/auth/session" ? response({ error: "Temporarily unavailable" }, 503) : response({ serverIds: [] }));
  const card = h.add(); await h.api.setSession(member());
  h.save(card).click(); await tick();
  assert.equal(h.posts().length, 0);
  assert.equal(h.save(card).disabled, false);
  assert.equal(h.save(card).getAttribute("aria-busy"), "false");
  assert.match(h.status(), /Temporarily unavailable/);
});

test("malformed or failed private reads remain unknown and cannot silently enable a toggle", async t => {
  for (const data of [null, {}, { serverIds: "not-an-array" }, { error: "Temporary failure" }]) {
    const h = fixture(t, async () => response(data, data?.error ? 503 : 200));
    const card = h.add(); await h.api.setSession(member());
    assert.equal(h.save(card).disabled, true);
    assert.match(h.save(card).title, /Refresh to check/);
    h.save(card).dispatchEvent(new h.w.Event("click")); await tick();
    assert.equal(h.calls.length, 1);
    assert.equal(h.posts().length, 0);
  }
});

test("session-ended and pagehide erase private state and abort pending work without clearing public comparison", async t => {
  for (const event of ["browserp:session-ended", "pagehide"]) {
    const pending = deferred();
    const h = fixture(t, async path => path === "/api/auth/session" ? pending.promise : response({ serverIds: [serverId] }));
    const card = h.add(); await h.api.setSession(member());
    h.compare(card).click(); h.save(card).click(); await tick();
    h.w.dispatchEvent(new h.w.Event(event));
    assert.equal(h.calls.at(-1).options.signal.aborted, true);
    assert.equal(h.save(card).getAttribute("aria-pressed"), "false");
    assert.equal(h.save(card).getAttribute("aria-busy"), "false");
    assert.equal(h.status(), "");
    assert.equal(h.compare(card).getAttribute("aria-pressed"), "true", "public comparison is independent of the private account");
    assert.deepEqual(Object.keys(h.w.localStorage), ["browserp-compare-v1"]);
    pending.resolve(response({ ...member(), csrfToken: "late" })); await tick();
    assert.equal(h.posts().length, 0);
    assert.equal(h.save(card).getAttribute("aria-pressed"), "false");
  }
});

test("request timeouts fail closed on private reads, permit retry before a save, and prevent retry after a save was sent", async t => {
  for (const stage of ["read", "preflight", "write"]) {
    const clocks = [];
    const h = fixture(t, async (path, options) => {
      const current = options.method === "POST" ? "write" : path === "/api/auth/session" ? "preflight" : "read";
      if (stage === current) return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
      return current === "preflight" ? response({ ...member(), csrfToken: "fresh" }) : response({ serverIds: [] });
    }, { timeout(delay) { const controller = new AbortController(); clocks.push({ delay, controller }); return controller.signal; } });
    const card = h.add(), initializing = h.api.setSession(member());
    if (stage !== "read") { await initializing; h.save(card).click(); }
    await tick();
    assert.ok(clocks.length > 0);
    assert.equal(clocks.every(clock => clock.delay === 12000), true);
    clocks.at(-1).controller.abort(new DOMException("Request timed out", "TimeoutError"));
    await initializing; await tick();
    assert.equal(h.save(card).disabled, stage !== "preflight");
    assert.equal(h.posts().length, stage === "write" ? 1 : 0);
    if (stage === "write") {
      assert.equal(h.save(card).textContent, "Check saved servers");
      h.save(card).dispatchEvent(new h.w.Event("click")); await tick();
      assert.equal(h.posts().length, 1);
    }
    if (stage === "read") assert.match(h.save(card).title, /Refresh to check/);
  }
});
