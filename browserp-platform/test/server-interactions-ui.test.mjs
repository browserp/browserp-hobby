import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(t, authenticated, api) {
  const dom = new JSDOM(read("server.html"), { url: "https://browserp.test/server/cali-rp", runScripts: "outside-only" });
  t.after(() => dom.window.close()); const w = dom.window; w.eval(read("server-interactions.js"));
  w.document.querySelectorAll("form,#vote-server-v3").forEach(form => { form.dataset.serverId = "fixture-server"; });
  w.BrowseRPServerInteractions.init({ api, session: { authenticated }, toast() {} });
  return { w, doc: w.document, submit: form => form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })) };
}
test("signed-out visitors see the sign-in requirement before they can write, with an exact server return", t => {
  let calls = 0; const h = harness(t, false, async () => { calls++; });
  for (const id of ["comment", "report"]) {
    const form = h.doc.querySelector(`#${id}-form-v3`);
    assert.equal(form.querySelector("textarea").disabled, true);
    assert.equal(form.querySelector(".field-v3").hidden, true);
    assert.equal(new URL(form.querySelector("a").href).searchParams.get("returnTo"), "/server/cali-rp");
    h.submit(form);
  }
  assert.equal(calls, 0); assert.equal(h.doc.querySelector("#vote-server-v3").textContent, "Sign in to vote");
});
test("comments and reports retain their text on failures and one pending action cannot submit twice", async t => {
  const calls = []; let reject;
  const h = harness(t, true, async (_path, options) => { calls.push(JSON.parse(options.body)); return new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }); });
  const form = h.doc.querySelector("#report-form-v3"), details = form.querySelector("textarea");
  details.value = "This fixture link redirects to an impersonation page.";
  form.querySelector("select").value = "impersonation";
  h.submit(form); h.submit(form); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { action: "report", serverId: "fixture-server", category: "impersonation", body: details.value });
  reject(Object.assign(new Error("Sign in required"), { status: 401 })); await tick();
  assert.equal(details.value, calls[0].body); assert.equal(form.querySelector("button").disabled, false);
  assert.equal(form.querySelector("a").hidden, false); assert.match(form.querySelector('[role="status"]').textContent, /text is still here/);
});
test("successful comments reset only after the server accepts them and votes use the returned total", async t => {
  const calls = []; const h = harness(t, true, async (_path, options) => { const body = JSON.parse(options.body); calls.push(body); return { result: { voteCount: 42 } }; });
  const form = h.doc.querySelector("#comment-form-v3"), input = form.querySelector("textarea"); input.value = "Helpful fixture comment";
  h.submit(form); await tick(); assert.equal(input.value, ""); assert.match(form.textContent, /sent for moderation/);
  const vote = h.doc.querySelector("#vote-server-v3"); vote.click(); vote.click(); await tick();
  assert.equal(calls.filter(item => item.action === "vote").length, 1); assert.equal(h.doc.querySelector("#server-votes-v3").textContent, "42 votes");
  assert.equal(vote.getAttribute("aria-pressed"), "true"); assert.equal(vote.disabled, true);
});
test("provider buttons retain a valid server destination and reject external or encoded redirect tricks", async t => {
  for (const destination of ["/server/cali-rp", "https://evil.example", "//evil.example", "/server/a?next=https://evil.example", "/server/%2f%2fevil.example"]) {
    const dom = new JSDOM(read("dashboard.html"), { url: `https://browserp.test/dashboard?returnTo=${encodeURIComponent(destination)}`, runScripts: "outside-only" });
    t.after(() => dom.window.close()); const w = dom.window;
    w.fetch = async path => ({ ok: true, json: async () => path === "/api/auth/providers" ? { providers: { discord: true, google: true } } : path === "/api/public/content" ? { content: {} } : { authenticated: false } });
    w.eval(read("browserp-portal-v2.js")); for (let i = 0; i < 4; i++) await tick();
    const providers = [...w.document.querySelectorAll('#portal-root a[href^="/api/auth/"]')]; assert.equal(providers.length, 2);
    for (const provider of providers) assert.equal(new URL(provider.href).searchParams.get("returnTo"), destination === "/server/cali-rp" ? destination : "/dashboard");
  }
});
