import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const settle = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); };
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const id = "bbbbbbbb-0000-4000-8000-000000000001";
const session = { authenticated: true, csrfToken: "fixture-csrf", user: { id: owner, profile: { display_name: "Fixture owner" } } };
const roblox = { kind: "independent_community", experienceUrl: "https://www.roblox.com/games/123456789", communityGroupUrl: "https://www.roblox.com/communities/7654321/Community", joiningInstructions: "Join our community Discord, read the rules and apply to take part in our organised evening roleplay sessions.", applicantRole: "Community owner", authorityEvidence: "I manage the community's public group and can place a staff verification reference there for review." };
const record = { id, name: "Original Roblox community", platform_id: "roblox", region: "United Kingdom", language: "English", framework: "Emergency Response: Liberty County", description: "An established emergency-service roleplay community with regular hosted sessions and clear rules for new players.", community_url: "https://discord.gg/community", cfx_join_url: "", access_type: "allowlisted", tags: ["serious-roleplay"], status: "changes_requested", review_note: "Please explain the joining process.", review_version: 3, queue_version: 1, roblox };
const reply = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload });
function setup(t, override = () => undefined, query = "?platform=roblox") {
  const console = new VirtualConsole();
  const navigation = []; console.on("jsdomError", error => navigation.push(error.message));
  const dom = new JSDOM(read("list-server.html"), { virtualConsole: console, url: `https://browserp.test/list-server${query}`, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window; t.after(() => w.close()); const calls = [];
  w.fetch = async (path, options = {}) => {
    const call = { path, options, body: options.body && JSON.parse(options.body) }; calls.push(call);
    const custom = await override(call); if (custom !== undefined) return custom;
    if (path === "/api/platforms") return reply({ platforms: ["fivem", "redm", "roblox", "minecraft"].map(id => ({ id, name: id })) });
    if (path === "/api/auth/session") return reply(session);
    if (path === "/api/auth/providers") return reply({ providers: { discord: true, google: true } });
    if (path.startsWith("/api/submissions?id=")) return reply({ submission: record });
    if (path === "/api/submissions") return reply({ submission: { id, status: "pending_review", review_version: 4 } });
    throw new Error(`Unexpected fixture URL: ${path}`);
  };
  w.eval(read("submission-correction.js")); w.eval(read("browserp-directory.js"));
  const form = w.document.querySelector("#listing-form");
  return { w, form, doc: w.document, calls, navigation, send: () => form.dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true })) };
}
function fill(h) {
  const values = { name: "Fixture Roblox community", framework: "Emergency Response: Liberty County", description: record.description, communityUrl: record.community_url };
  for (const [key, value] of Object.entries(values)) h.form.elements.namedItem(key).value = value;
  for (const field of h.form.querySelectorAll("[data-roblox-key]")) field.value = roblox[field.dataset.robloxKey];
  h.form.elements.agreement.checked = true;
}
const writes = h => h.calls.filter(call => ["POST", "PATCH"].includes(call.options.method));

test("Roblox CTA selection survives sign-in and other query values cannot become destinations", async t => {
  const h = setup(t, call => call.path === "/api/auth/session" ? reply({ authenticated: false }) : undefined); await settle();
  assert.equal(h.form.hidden, true); assert.equal(h.form.elements.platform.value, "roblox");
  for (const link of h.doc.querySelectorAll("[data-auth-provider]")) assert.equal(new URL(link.href).searchParams.get("returnTo"), "/list-server?platform=roblox");
  const invalid = setup(t, undefined, "?platform=https://example.com"); await settle();
  assert.equal(invalid.form.elements.platform.value, "fivem");
  assert.equal(new URL(invalid.doc.querySelector('[data-auth-provider="discord"]').href).searchParams.get("returnTo"), "/list-server");
});

test("Roblox application collects the complete private/public contract and binds creation to its signed-in owner", async t => {
  const h = setup(t); await settle(); fill(h);
  const group = h.doc.querySelector("[data-roblox-fields]");
  assert.equal(group.hidden, false); assert.equal(group.disabled, false);
  assert.equal(h.form.elements.framework.required, true); assert.equal(h.form.elements.communityUrl.required, true);
  assert.match(group.textContent, /private to you and authorised reviewers/); assert.match(group.textContent, /passwords, account cookies, API keys/);
  assert.match(h.doc.querySelector("#listing-access-help").textContent, /reviewed separately/);
  h.form.elements.cfxJoinUrl.value = "https://cfx.re/join/unrelated";
  h.send(); await settle(); const [sent] = writes(h);
  assert.ok(sent); assert.equal(sent.body.expectedAccountId, owner); assert.deepEqual(sent.body.roblox, roblox);
  assert.equal(sent.body.cfxJoinUrl, ""); assert.equal(sent.body.language, "English"); assert.equal(sent.body.framework, "Emergency Response: Liberty County");
  assert.equal(sent.options.headers["X-BrowseRP-CSRF"], "fixture-csrf"); assert.ok(sent.options.headers["Idempotency-Key"]);
  assert.equal(h.form.elements.robloxAuthorityEvidence.value, ""); assert.equal(h.form.elements.platform.value, "roblox");
  assert.match(h.doc.querySelector("#listing-status").textContent, /Listing received/);
});

test("unsafe or wrong-type Roblox links are explained before anything is sent", async t => {
  const h = setup(t); await settle(); fill(h);
  const link = h.form.elements.robloxExperienceUrl;
  for (const value of ["https://roblox.com.evil.test/games/123", "https://user@www.roblox.com/games/123", "https://www.roblox.com:443/games/123", "https://www.roblox.com/games/123?privateServerLinkCode=secret", "https://www.roblox.com/games/123#secret", "https://www.roblox.com/communities/123", "https://www.roblox.com/share?code=secret", "https://www.roblox.com/games/0", "http://www.roblox.com/games/123"]) {
    link.value = value; h.send(); await settle(); assert.equal(writes(h).length, 0, value); assert.match(link.validationMessage, /public/);
  }
  link.value = roblox.experienceUrl; h.form.elements.robloxCommunityGroupUrl.value = "https://www.roblox.com/games/123";
  h.send(); await settle(); assert.equal(writes(h).length, 0); assert.match(h.form.elements.robloxCommunityGroupUrl.validationMessage, /communities/);
  h.form.elements.robloxCommunityGroupUrl.value = ""; h.send(); await settle(); assert.equal(writes(h).length, 1);
});

test("switching away disables Roblox validation, omits its private details and clears non-Cfx connect links", async t => {
  const h = setup(t); await settle(); fill(h);
  h.form.elements.platform.value = "fivem"; h.form.elements.platform.dispatchEvent(new h.w.Event("change", { bubbles: true }));
  h.form.elements.cfxJoinUrl.value = "https://cfx.re/join/abc123";
  h.form.elements.platform.value = "minecraft"; h.form.elements.platform.dispatchEvent(new h.w.Event("change", { bubbles: true }));
  assert.equal(h.form.elements.cfxJoinUrl.value, ""); assert.equal(h.doc.querySelector("[data-roblox-fields]").disabled, true);
  assert.equal(h.form.elements.framework.required, false); assert.equal(h.form.elements.communityUrl.required, false);
  h.send(); await settle(); const [sent] = writes(h); assert.equal(sent.body.roblox, null); assert.equal(sent.body.cfxJoinUrl, "");
  assert.doesNotMatch(sent.options.body, /authorityEvidence|staff verification/);
});

test("pending creation locks duplicate clicks and uncertain retry preserves the original body and key", async t => {
  let release, attempts = 0;
  const h = setup(t, call => { if (call.options.method === "POST" && ++attempts === 1) return new Promise(resolve => { release = () => resolve(reply({ error: "Temporary failure" }, 503)); }); });
  await settle(); fill(h); h.send(); h.send(); await settle(); assert.equal(attempts, 1); assert.equal(h.doc.querySelector("#submit-listing").disabled, true);
  release(); await settle(); assert.equal(h.form.querySelector(".form-grid-v3").inert, true); assert.match(h.doc.querySelector("#listing-status").textContent, /Retry the same application safely/);
  h.form.elements.robloxAuthorityEvidence.value = "Changed programmatically after the first attempt.";
  h.send(); await settle(); const sent = writes(h);
  assert.equal(sent.length, 2); assert.equal(sent[0].options.body, sent[1].options.body); assert.equal(sent[0].options.headers["Idempotency-Key"], sent[1].options.headers["Idempotency-Key"]);
});

test("switching account before create or an uncertain retry clears the private draft and sends no new write", async t => {
  for (const retry of [false, true]) {
    let sessions = 0;
    const h = setup(t, call => {
      if (call.path === "/api/auth/session") return reply(++sessions > (retry ? 2 : 1) ? { ...session, user: { id: other } } : session);
      if (call.options.method === "POST") return reply({ error: "Temporary failure" }, 503);
    });
    await settle(); fill(h); h.send(); await settle(); if (retry) { h.send(); await settle(); }
    assert.equal(writes(h).length, retry ? 1 : 0); assert.equal(h.form.hidden, true); assert.equal(h.form.elements.robloxAuthorityEvidence.value, "");
    assert.doesNotMatch(h.doc.body.textContent, /Fixture owner/); assert.match(h.doc.querySelector("#listing-auth-gate").textContent, /account changed or its session ended/);
  }
});

test("create session checks on returning to a tab invalidate a different owner without submitting", async t => {
  let sessions = 0; const h = setup(t, call => call.path === "/api/auth/session" ? reply(++sessions === 1 ? session : { ...session, user: { id: other } }) : undefined);
  await settle(); fill(h); h.w.dispatchEvent(new h.w.Event("focus")); await settle();
  assert.equal(h.form.hidden, true); assert.equal(h.form.elements.robloxAuthorityEvidence.value, ""); assert.equal(writes(h).length, 0);
});

test("navigation clears private create snapshots and late success cannot restore a previous account", async t => {
  let release; const h = setup(t, call => call.options.method === "POST" ? new Promise(resolve => { release = () => resolve(reply({ submission: { id } })); }) : undefined);
  await settle(); fill(h); h.send(); await settle(); h.w.dispatchEvent(new h.w.PageTransitionEvent("pagehide", { persisted: true }));
  assert.equal(h.form.hidden, true); assert.equal(h.form.elements.robloxAuthorityEvidence.value, "");
  release(); await settle(); assert.equal(h.doc.querySelector("#listing-status").textContent, ""); assert.equal(h.doc.querySelector("#site-toast").textContent, "");
  h.w.dispatchEvent(new h.w.PageTransitionEvent("pageshow", { persisted: true })); assert.ok(h.navigation.some(message => /navigation/.test(message)));
});

test("Roblox corrections preload complete details and send the same application with version and owner binding", async t => {
  const h = setup(t, undefined, `?submission=${id}`); await settle();
  for (const field of h.form.querySelectorAll("[data-roblox-key]")) assert.equal(field.value, roblox[field.dataset.robloxKey]);
  assert.equal(h.form.elements.framework.value, record.framework); h.form.elements.agreement.checked = true;
  h.form.elements.robloxJoiningInstructions.value += " New players can ask for an introduction session.";
  h.send(); await settle(); const [sent] = writes(h);
  assert.equal(sent.options.method, "PATCH"); assert.equal(sent.body.submissionId, id); assert.equal(sent.body.expectedAccountId, owner);
  assert.equal(sent.body.expectedVersion, 3); assert.equal(sent.body.expectedQueueVersion, 1);
  assert.equal(sent.body.roblox.authorityEvidence, roblox.authorityEvidence); assert.match(sent.body.roblox.joiningInstructions, /introduction session/);
});

test("correction refresh preserves unsent Roblox edits and compares private evidence safely as text", async t => {
  let loads = 0; const evidence = '<img src=x onerror="bad()"> Our owner can place a public verification reference in the community group.';
  const h = setup(t, call => {
    if (call.path.startsWith("/api/submissions?id=")) return reply({ submission: { ...record, review_version: ++loads + 2, roblox: { ...roblox, authorityEvidence: evidence } } });
    if (call.options.method === "PATCH") return reply({ error: "Review changed. Load the latest review." }, 409);
  }, `?submission=${id}`);
  await settle(); h.form.elements.robloxJoiningInstructions.value = roblox.joiningInstructions + " Keep this unsent change.";
  h.form.elements.agreement.checked = true; h.send(); await settle(); h.doc.querySelector(".submission-correction-v3 button").click(); await settle();
  assert.match(h.form.elements.robloxJoiningInstructions.value, /unsent change/); assert.equal(h.form.elements.agreement.checked, false);
  assert.equal(h.doc.querySelector(".submission-correction-v3 img"), null); assert.match(h.doc.querySelector(".submission-correction-v3").textContent, /Your control evidence — private/);
  h.form.elements.platform.value = "fivem"; h.form.elements.platform.dispatchEvent(new h.w.Event("change", { bubbles: true }));
  h.form.elements.agreement.checked = true; h.send(); await settle(); assert.equal(writes(h).at(-1).body.roblox, null);
});

test("Roblox game page links to the application and never displays an experience total for a manual community", t => {
  const dom = new JSDOM(read("game.html"), { url: "https://browserp.test/games/roblox", runScripts: "outside-only" }); const w = dom.window; t.after(() => w.close());
  w.BrowseRPPlatforms = { theme() {}, idFor: server => server.platform_id, metadata: () => w.document.createElement("div") };
  w.BrowseRPSearch = { mount: ({ list, render }) => render(list, [{ name: "Community fixture", slug: "fixture", platform_id: "roblox", applicationOnly: true, online: true, players: 99000 }]) };
  w.eval(read("browserp-games.js"));
  assert.ok(w.document.querySelector('#game-page-actions-v4 a[href="/list-server?platform=roblox"]'));
  assert.ok(w.document.querySelector('#game-server-empty-v4 a[href="/list-server?platform=roblox"]'));
  const card = w.document.querySelector(".server-card"); assert.match(card.textContent, /Live player count not provided/); assert.doesNotMatch(card.textContent, /99,000|Online now/);
});

test("Roblox staff section opens the existing filtered queue with active application guidance", async t => {
  const dom = new JSDOM('<body data-staff-page="scrapers"><nav class="staff-nav-v3"><a href="/staffpanel/moderation">Moderation</a></nav><h1 id="scrapers-title"></h1><div id="scrapers-content"></div></body>', { url: "https://browserp.test/staffpanel/scrapers#roblox", runScripts: "outside-only" });
  const w = dom.window; t.after(() => w.close()); w.eval(read("staff-scrapers.js")); w.BrowseRPStaffScrapers.init({}); await settle();
  assert.equal(w.document.querySelector("#scrapers-title").textContent, "Roblox applications");
  assert.ok(w.document.querySelector('a[href="/staffpanel/moderation#queue?platform=roblox"]'));
  assert.ok(w.document.querySelector('a[href="/list-server?platform=roblox"]'));
  assert.doesNotMatch(w.document.querySelector("#scrapers-content").textContent, /tools are not active|in development|Coming soon/);
});

test("creator-run applications explain the different authority requirement and retain their kind", async t => {
  const h = setup(t); await settle(); fill(h);
  h.form.elements.robloxKind.value = "creator_experience"; h.form.elements.robloxKind.dispatchEvent(new h.w.Event("change", { bubbles: true }));
  assert.match(h.doc.querySelector("#roblox-kind-help").textContent, /creator team control the Roblox experience/);
  h.send(); await settle(); assert.equal(writes(h)[0].body.roblox.kind, "creator_experience");
});

test("a rejected field can be corrected with a fresh request while session loss clears the form", async t => {
  let count = 0;
  const h = setup(t, call => call.options.method === "POST" && ++count === 1 ? reply({ error: "Please clarify your joining instructions." }, 400) : undefined);
  await settle(); fill(h); h.send(); await settle(); assert.equal(h.form.querySelector(".form-grid-v3").inert, false);
  h.form.elements.robloxJoiningInstructions.value += " Our welcome team will guide you through the process."; h.send(); await settle();
  const sent = writes(h); assert.equal(sent.length, 2); assert.notEqual(sent[0].options.body, sent[1].options.body); assert.notEqual(sent[0].options.headers["Idempotency-Key"], sent[1].options.headers["Idempotency-Key"]);
  const denied = setup(t, call => call.options.method === "POST" ? reply({ error: "Account changed." }, 403) : undefined);
  await settle(); fill(denied); denied.send(); await settle(); assert.equal(denied.form.hidden, true); assert.equal(denied.form.elements.robloxAuthorityEvidence.value, "");
  denied.send(); await settle(); assert.equal(writes(denied).length, 1);
});

test("a sign-out during initial create loading cannot reveal a late authenticated form", async t => {
  let release;
  const h = setup(t, call => call.path === "/api/auth/session" ? new Promise(resolve => { release = () => resolve(reply(session)); }) : undefined);
  await settle(); h.w.dispatchEvent(new h.w.CustomEvent("browserp:session-ended")); release(); await settle();
  assert.equal(h.form.hidden, true); assert.equal(h.doc.querySelector("#listing-account-notice").textContent, ""); h.send(); await settle(); assert.equal(writes(h).length, 0);
});
