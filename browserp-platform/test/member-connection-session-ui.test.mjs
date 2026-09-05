import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const sensitiveName = "Fixture private profile name";
const identity = "11111111-1111-4111-8111-111111111111";
const connected = ["discord", "google"].map(provider => ({ provider, connected: true, enabled: true, canConnect: false, canDisconnect: provider === "google", identityId: identity }));
function harness(t, page, handler = () => undefined) {
  const dom = new JSDOM(read(`${page}.html`), { url: `https://browserp.test/${page}`, runScripts: "outside-only" });
  t.after(() => dom.window.close()); const w = dom.window; const calls = []; const events = [];
  w.addEventListener("browserp:session-ended", event => events.push(JSON.parse(JSON.stringify(event.detail))));
  w.fetch = async (path, options = {}) => {
    calls.push({ path, options }); const value = await handler(path, options); if (value !== undefined) return value;
    const payload = path === "/api/auth/session" ? { authenticated: true, csrfToken: "fixture-csrf", user: { id: "fixture-user", displayName: sensitiveName } }
      : path === "/api/public/content" ? { content: {} }
      : path === "/api/me/profile" ? { profile: { display_name: sensitiveName, bio: "Private fixture biography", avatar_url: "https://example.test/private-avatar.png" } }
      : path === "/api/me/overview" ? { overview: { servers: [{ name: "Private fixture server", status: "draft" }], profile: { display_name: sensitiveName } } }
      : path === "/api/me/connections" ? { connections: { accountId: "fixture-user", canManage: true, providers: connected } }
      : path === "/api/auth/providers" ? { providers: { discord: true, google: true } } : {};
    return { ok: true, json: async () => payload };
  };
  w.eval(read("member-connections.js")); w.eval(read("browserp-portal-v2.js"));
  return { w, doc: w.document, calls, events };
}

test("disconnect clears profile and dashboard immediately and offers only the retained sign-in", async t => {
  for (const page of ["profile", "dashboard"]) for (const outcome of ["global", "local", "ambiguous"]) await t.test(`${page}: ${outcome}`, async t => {
    let releaseProviders; let changed = false;
    const h = harness(t, page, (path, options) => {
      if (path === "/api/me/connections" && options.method === "POST") {
        changed = true;
        return { ok: outcome !== "ambiguous", status: outcome === "ambiguous" ? 401 : 200, json: async () => outcome === "ambiguous" ? { error: "We couldn’t confirm the change. You’re signed out here." } : { disconnected: true, sessionsEnded: outcome === "global", signInProviders: ["discord"] } };
      }
      if (path === "/api/auth/providers" && changed) return new Promise(resolve => { releaseProviders = () => resolve({ ok: true, json: async () => ({ providers: { discord: true, google: true } }) }); });
    });
    await settle();
    const oldForm = h.doc.querySelector(".profile-form-v2"); assert.ok(oldForm); assert.match(h.doc.body.textContent, new RegExp(sensitiveName));
    const cropper = h.doc.createElement("dialog"); cropper.className = "avatar-crop-dialog-v3"; cropper.textContent = "Private crop preview"; h.doc.body.append(cropper);
    const button = [...h.doc.querySelectorAll("button")].find(item => item.textContent === "Disconnect Google"); button.click();
    h.doc.querySelector('.member-connection-confirmation button:last-child').click(); await settle();
    assert.equal(h.doc.querySelector(".profile-form-v2"), null);
    assert.equal(h.doc.querySelector(".avatar-crop-dialog-v3"), null);
    assert.equal(h.doc.querySelector('img[src*="private-avatar"]'), null);
    assert.doesNotMatch(h.doc.body.textContent, /Fixture private profile name|Private fixture biography|Private fixture server|Private crop preview/);
    assert.equal(h.events.length, 1);
    assert.deepEqual(Object.keys(h.events[0]).sort(), ["reason", "remainingProviders"]);
    assert.deepEqual(h.events[0].remainingProviders, ["discord"]); assert.doesNotMatch(JSON.stringify(h.events), new RegExp(identity));
    assert.equal(h.events[0].reason, outcome === "global" ? "connection-removed" : outcome === "local" ? "connection-removed-local" : "connection-unconfirmed");
    const requestsBeforeDetachedSubmit = h.calls.length;
    oldForm.dispatchEvent(new h.w.Event("submit", { bubbles: true, cancelable: true })); await tick();
    assert.equal(h.calls.length, requestsBeforeDetachedSubmit, "detached form cannot reuse cleared credentials");
    releaseProviders(); await settle();
    const login = [...h.doc.querySelectorAll('#portal-root a[href^="/api/auth/"]')]; assert.equal(login.length, 1);
    assert.match(login[0].href, /\/auth\/discord\?/); assert.equal(new URL(login[0].href).searchParams.get("returnTo"), `/${page}`);
    assert.equal(h.doc.activeElement, h.doc.querySelector(".access-gate-v2"));
    assert.equal(h.doc.querySelectorAll('.access-gate-v2 img[src="/browserp-mark-v3.png"]').length, 1);
  });
});

test("a late private page response cannot restore account data after session ending", async t => {
  let releaseProfile; const h = harness(t, "profile", path => path === "/api/me/profile" ? new Promise(resolve => { releaseProfile = () => resolve({ ok: true, json: async () => ({ profile: { display_name: sensitiveName, bio: "Private late response" } }) }); }) : undefined);
  await settle(); assert.ok(releaseProfile);
  h.w.dispatchEvent(new h.w.CustomEvent("browserp:session-ended", { detail: { reason: "connection-removed", remainingProviders: ["discord", "javascript:alert(1)"] } }));
  await settle(); releaseProfile(); await settle();
  assert.equal(h.doc.querySelector(".profile-form-v2"), null); assert.doesNotMatch(h.doc.body.textContent, /Private late response|Fixture private profile name/);
  const links = h.doc.querySelectorAll('#portal-root a[href^="/api/auth/"]'); assert.equal(links.length, 1); assert.match(links[0].href, /\/auth\/discord\?/);
});
