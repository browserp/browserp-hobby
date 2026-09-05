import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const reply = payload => ({ ok: true, json: async () => payload });
const submitted = (id, status = "pending_review") => ({ id, name: `${id} community`, status, created_at: "2026-09-05T10:00:00Z" });
function harness(t, submissions, feedback) {
  const dom = new JSDOM(read("dashboard.html"), { url: "https://browserp.test/dashboard", runScripts: "outside-only" });
  const w = dom.window; t.after(() => w.close()); const requests = [];
  w.fetch = async (path, options) => {
    requests.push({ path, options });
    if (path === "/api/submissions") return feedback();
    const payload = {
      "/api/auth/session": { authenticated: true, csrfToken: "fixture", user: { id: "owner-fixture", profile: { display_name: "Fixture owner" } } },
      "/api/public/content": { content: {} },
      "/api/me/overview": { overview: { submissions, servers: [{ name: "Existing live listing", slug: "existing", status: "published" }], favoriteServers: [], notifications: [] } },
      "/api/me/profile": { profile: { display_name: "Fixture owner" } },
      "/api/auth/providers": { providers: { discord: true, google: true } }
    }[path];
    assert.ok(payload, `Unexpected request ${path}`);
    return reply(payload);
  };
  w.eval(read("browserp-portal-v2.js"));
  return { w, doc: w.document, requests };
}

test("submission progress loads owned review feedback as text, updates decisions, and gives truthful next steps", async t => {
  const submissions = ["change", "reject", "approved", "pending"].map(id => submitted(id));
  const reviewed = [
    { ...submitted("change", "changes_requested"), review_note: '<img src=x onerror="alert(1)"> Please correct the Discord link.' },
    { ...submitted("reject", "rejected"), review_note: "The description must describe your community." },
    { ...submitted("approved", "approved"), review_note: "Listing approved." },
    submitted("pending"), submitted("older")
  ];
  const h = harness(t, submissions, () => reply({ submissions: reviewed })); await settle();
  const section = h.doc.querySelector("#submissions"); const rows = [...section.querySelectorAll(".portal-item")];
  assert.equal(rows.length, 4, "The overview's recent submissions and count stay in sync");
  assert.match(rows[0].textContent, /Changes requested.*Review feedback: <img src=x onerror="alert\(1\)"> Please correct the Discord link/);
  assert.equal(section.querySelector("img"), null, "Staff feedback is never interpreted as markup");
  assert.match(rows[0].textContent, /Changes are needed before this listing can be approved/);
  assert.match(rows[1].textContent, /wasn't approved.*before submitting again/);
  assert.match(rows[2].textContent, /Find your published listing under Your listings/);
  assert.match(rows[3].textContent, /don't need to send it again/);
  assert.equal(section.querySelectorAll('a[href="/legal#standards"]').length, 2);
  assert.equal(section.querySelectorAll('a[href="/list-server"]').length, 0, "No duplicate-submission shortcut pretends to edit the original");
  assert.equal(rows[0].querySelector('a[href="/list-server?submission=change"]')?.textContent, "Correct submission");
  assert.equal(rows[1].querySelector('a[href^="/list-server?submission="]'), null);
  assert.match(h.doc.querySelector("#listings").textContent, /Existing live listing/);
  const request = h.requests.find(request => request.path === "/api/submissions");
  assert.equal(request.options.method, "GET"); assert.equal(request.options.credentials, "same-origin");
  assert.equal(section.querySelector('[role="status"]').hidden, true);
});

test("failed review loading keeps the listing dashboard usable, and a locked retry recovers feedback", async t => {
  let attempts = 0, release;
  const h = harness(t, [submitted("change", "changes_requested")], () => {
    if (++attempts === 1) return { ok: false, status: 503, json: async () => ({ error: "Service unavailable" }) };
    return new Promise(resolve => { release = () => resolve(reply({ submissions: [{ ...submitted("change", "changes_requested"), review_note: "Please include your rules link." }] })); });
  });
  await settle();
  const section = h.doc.querySelector("#submissions"); const retry = section.querySelector("button");
  assert.match(section.textContent, /couldn't be loaded.*last known submission status/);
  assert.match(h.doc.querySelector("#listings").textContent, /Existing live listing/);
  assert.equal(retry.hidden, false); retry.click(); retry.click(); await settle();
  assert.equal(attempts, 2); assert.equal(retry.disabled, true);
  release(); await settle();
  assert.match(section.textContent, /Please include your rules link/); assert.equal(retry.hidden, true);
  assert.equal(section.querySelector('[role="status"]').hidden, true);
});

test("late review feedback cannot restore private data or issue retries after the session ends", async t => {
  let release;
  const h = harness(t, [submitted("private")], () => new Promise(resolve => { release = () => resolve(reply({ submissions: [{ ...submitted("private"), review_note: "Private review evidence" }] })); }));
  await settle(); const oldSection = h.doc.querySelector("#submissions"); const retry = oldSection.querySelector("button");
  h.w.dispatchEvent(new h.w.CustomEvent("browserp:session-ended", { detail: { reason: "connection-removed", remainingProviders: ["discord"] } }));
  await settle(); release(); await settle();
  assert.equal(h.doc.querySelector("#submissions"), null);
  assert.doesNotMatch(h.doc.body.textContent, /Private review evidence|private community|Existing live listing/);
  assert.doesNotMatch(oldSection.textContent, /Private review evidence/);
  const before = h.requests.length; retry.click(); await settle(); assert.equal(h.requests.length, before);
});

test("an empty submission overview needs no extra private request", async t => {
  const h = harness(t, [], () => { throw new Error("No feedback request expected"); }); await settle();
  assert.match(h.doc.querySelector("#submissions").textContent, /Nothing waiting for review/);
  assert.equal(h.requests.some(request => request.path === "/api/submissions"), false);
});
