import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = name => readFileSync(new URL(`../public/${name}.js`, import.meta.url), "utf8");
const tick = async () => { for (let index = 0; index < 4; index += 1) await new Promise(resolve => setImmediate(resolve)); };
function harness(name, fetch) {
  const dom = new JSDOM('<body><main id="root"></main></body>', { url: "https://browserp.test/server/test-community", runScripts: "outside-only" });
  const w = dom.window;
  // jsdom has no native top layer. Browser checks cover modal focus containment.
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  if (fetch) w.fetch = fetch;
  w.eval(source(name));
  const root = w.document.querySelector("#root");
  return { dom, w, root, $: selector => w.document.querySelector(selector), click: text => { const el = [...w.document.querySelectorAll("button")].find(button => button.textContent === text); assert.ok(el, `Button: ${text}`); el.click(); return el; }, submit: selector => w.document.querySelector(selector).dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })) };
}
const candidate = { joinCode: "abc123", name: "Community fixture", description: "A friendly roleplay community with detailed stories and regular community events.", region: "Europe", language: "English", framework: "QBCore", accessType: "public", discordUrl: "https://discord.gg/example", websiteUrl: "", joinUrl: "https://cfx.re/join/abc123", tags: ["serious roleplay"], keywords: ["city stories"], logoUrl: "", bannerUrl: "", players: null, capacity: null, online: null, checkedAt: null, warnings: [{ severity: "warning", field: "description", message: "Source text is self-reported." }], evidence: [{ field: "name", value: "Community fixture", source: "FiveM listing", confidence: "high" }], sourceUrl: "https://servers.fivem.net/servers/detail/abc123" };
const record = (data = {}) => ({ id: "import-fixture", joinCode: "abc123", status: "pending", version: 7, candidate: { ...candidate }, serverId: null, ...data });
const claim = (data = {}) => ({ id: "claim-fixture", serverId: "server-fixture", serverName: "Community fixture", serverSlug: "community-fixture", status: "pending", verificationStatus: "pending_check", version: 4, message: "I own this community and can provide the server host records.", evidenceUrl: "https://example.com/proof", claimantName: "Community owner", discordUserId: "123456789012345678", createdAt: "2026-09-04T00:00:00Z", ...data });
const memberContext = { claimable: true, authenticated: true, isOwner: false, provider: "discord", reconnectUrl: "/api/auth/discord?claim=server-fixture" };
const json = payload => ({ ok: true, status: 200, json: async () => payload });

test("FiveM sources are fetched one at a time; partial errors remain visible and featured suggestions never publish", async t => {
  const h = harness("staff-fivem"); t.after(() => h.dom.window.close()); const calls = []; let active = 0; let maxActive = 0;
  const api = async (path, options = {}) => {
    if (!options.body) return { workspace: { items: [], total: 0, canManage: true } };
    const body = JSON.parse(options.body); calls.push(body);
    if (body.action === "featured") return { servers: [{ joinCode: "abc123", name: "Suggested fixture" }] };
    active += 1; maxActive = Math.max(maxActive, active); await tick(); active -= 1;
    if (body.inputs[0] === "bad123") throw new Error("This source is unavailable");
    return { candidates: [record()], errors: [] };
  };
  await h.w.BrowseRPStaffFiveM.init({ root: h.root, api });
  h.click("Find featured servers"); await tick(); h.click("Suggested fixture");
  assert.equal(calls.length, 1); assert.equal(h.$('[name="inputs"]').value, "abc123");
  h.$('[name="inputs"]').value = "abc123 bad123 xyz789 abc123"; h.submit(".fivem-fetch form");
  for (let index = 0; index < 8; index += 1) await tick();
  assert.equal(maxActive, 1);
  assert.deepEqual(calls.filter(call => call.action === "fetch").map(call => call.inputs), [["abc123"], ["bad123"], ["xyz789"]]);
  assert.ok(calls.every(call => call.action !== "publish"));
  assert.match(h.$(".fivem-fetch .fivem-status").textContent, /2 sources fetched.*1 could not/);
  assert.match(h.$(".fivem-errors").textContent, /bad123: This source is unavailable/);
  assert.throws(() => h.w.BrowseRPStaffFiveM.parseInputs(Array.from({ length: 11 }, (_, i) => `code${i}`).join(" ")), /between 1 and 10/);
});

test("FiveM review preserves metadata order and unknown fields while rendering source text safely", async t => {
  const h = harness("staff-fivem"); t.after(() => h.dom.window.close());
  const item = record({ candidate: { ...candidate, name: '<img src=x onerror="alert(1)">', region: null, language: null, framework: null, accessType: null, logoUrl: "https://cdn.example/logo.png" } });
  await h.w.BrowseRPStaffFiveM.init({ root: h.root, api: async () => ({ workspace: { items: [item], total: 1, canManage: true } }), imageUrl: url => `/api/public/server-image?url=${encodeURIComponent(url)}` });
  h.click("Review"); await tick();
  const order = [...h.$(".fivem-fields").children].slice(2, 7).map(label => label.firstElementChild.textContent);
  assert.deepEqual(order, ["Platform", "Region", "Language", "Framework / mode", "Access"]);
  for (const field of ["region", "language", "framework", "accessType"]) assert.equal(h.$(`[name="${field}"]`).value, "");
  assert.match(h.$(".fivem-editor > .fivem-help").textContent, /Unknown players.*unknown capacity.*Online status unknown/);
  assert.equal(h.$("img[onerror]"), null); assert.equal(h.$(".fivem-media img").getAttribute("src").startsWith("/api/public/server-image?"), true);
  assert.equal(h.$('[name="discordUrl"]').value, candidate.discordUrl); assert.equal(h.$(".fivem-join a").href, candidate.joinUrl);
  assert.equal([...h.root.querySelectorAll("button")].find(button => button.textContent === "Refresh live player count").hidden, true);
  for (const unsafe of ["javascript:alert(1)", "https://user:pass@example.com", "https://example.com/a b"]) assert.equal(h.w.BrowseRPStaffFiveM.secureUrl(unsafe), null);
});

test("FiveM publishing requires confirmation and sends current version; a failed save preserves edits", async t => {
  const h = harness("staff-fivem"); t.after(() => h.dom.window.close()); const posts = [];
  await h.w.BrowseRPStaffFiveM.init({ root: h.root, api: async (_path, options = {}) => {
    if (options.body) { posts.push(JSON.parse(options.body)); throw new Error("Candidate changed. Reload before publishing."); }
    return { workspace: { items: [record()], total: 1, canManage: true } };
  } });
  h.click("Review"); await tick();
  h.$('[name="name"]').value = "Reviewed community name"; h.$('[name="reason"]').value = "Confirmed community details"; h.submit(".fivem-editor"); await tick();
  assert.equal(posts.length, 0); assert.equal(h.$("dialog").open, true);
  h.click("Cancel"); await tick(); assert.equal(posts.length, 0);
  h.submit(".fivem-editor"); await tick(); h.submit("dialog form"); await tick();
  assert.equal(posts.length, 1); assert.equal(posts[0].expectedVersion, 7); assert.equal(posts[0].data.language, "English"); assert.equal(posts[0].data.framework, "QBCore");
  assert.equal(h.$('[name="name"]').value, "Reviewed community name"); assert.equal(h.$('[name="reason"]').value, "Confirmed community details");
  assert.equal(h.$('[name="name"]').disabled, false); assert.match(h.$(".fivem-editor .fivem-status").textContent, /Candidate changed/);
});

test("FiveM status and page controls request server-side pages instead of filtering the first page", async t => {
  const h = harness("staff-fivem"); t.after(() => h.dom.window.close()); const paths = [];
  await h.w.BrowseRPStaffFiveM.init({ root: h.root, api: async path => { paths.push(path); return { workspace: { items: Array.from({ length: 25 }, (_, i) => record({ id: `record-${i}` })), total: 60, canManage: true } }; } });
  h.click("Next"); await tick(); assert.match(paths.at(-1), /status=pending&offset=25/);
  h.$('[aria-label="Import status"]').value = "published"; h.$('[aria-label="Import status"]').dispatchEvent(new h.w.Event("change")); await tick();
  assert.match(paths.at(-1), /status=published&offset=0/); assert.equal(h.$(".fivem-pagination span").textContent, "1–25 of 60");
});

test("published live-count checks preserve unsaved listing edits and do not publish them", async t => {
  const h = harness("staff-fivem"); t.after(() => h.dom.window.close()); const posts = [];
  await h.w.BrowseRPStaffFiveM.init({ root: h.root, api: async (_path, options = {}) => { if (options.body) { posts.push(JSON.parse(options.body)); return { result: { players: 0, capacity: 64, checkedAt: "2026-09-04T00:45:00Z" } }; } return { workspace: { items: [record({ status: "published", serverId: "server-fixture" })], total: 1, canManage: true } }; } });
  h.click("Review"); await tick(); h.$('[name="name"]').value = "Unsaved review"; h.$('[name="reason"]').value = "Check current player count";
  h.click("Refresh live player count"); await tick(); h.submit("dialog form"); await tick();
  assert.equal(posts[0].action, "refresh"); assert.equal(posts[0].data, undefined); assert.equal(h.$('[name="name"]').value, "Unsaved review"); assert.equal(h.$('[name="reason"]').value, "Check current player count");
  assert.match(h.$(".fivem-editor .fivem-status").textContent, /Latest FiveM observation: 0 \/ 64 players.*4 Sept 2026, 00:45 UTC/);
  assert.match(h.$(".fivem-editor > .fivem-help").textContent, /Imported snapshot/);
});

test("ownership forms use the supplied CSRF token and keep a failed request editable", async t => {
  const calls = [];
  const h = harness("server-claims", async (path, options) => { if (options.body) { calls.push({ path, ...options }); return { ok: false, status: 409, json: async () => ({ error: "Please review the supplied evidence." }) }; } return json({ claims: [], csrfToken: "fixture-csrf", context: memberContext }); });
  t.after(() => h.dom.window.close()); await h.w.BrowseRPServerClaims.init({ server: { id: "server-fixture" }, root: h.root });
  assert.equal(h.$(".claims-form").hidden, false);
  h.$('[name="message"]').value = "I own this community and have the hosting account."; h.$('[name="evidenceUrl"]').value = "https://example.com/ownership"; h.submit(".claims-form"); await tick();
  assert.equal(calls.length, 1); assert.equal(calls[0].headers["X-BrowseRP-CSRF"], "fixture-csrf"); assert.equal(calls[0].credentials, "same-origin");
  assert.equal(JSON.parse(calls[0].body).serverId, "server-fixture"); assert.equal(h.$('[name="message"]').value, "I own this community and have the hosting account.");
  assert.match(h.$(".claims-form .claims-status").textContent, /supplied evidence/);
});

test("Discord verification is explicitly separate from staff approval, including private claim history", async t => {
  let verified = false; const posts = [];
  const h = harness("server-claims", async (_path, options) => { if (options.body) { posts.push(JSON.parse(options.body)); verified = true; return json({}); } return json({ csrfToken: "fixture-csrf", claims: [claim({ verificationStatus: verified ? "verified" : "pending_check", guildName: "Fixture Discord" })], context: { ...memberContext, claimable: false } }); });
  t.after(() => h.dom.window.close()); await h.w.BrowseRPServerClaims.init({ server: { id: "server-fixture" }, root: h.root });
  assert.equal(h.$(".claims-form").hidden, true); h.click("Verify Discord ownership"); await tick();
  assert.deepEqual(posts, [{ action: "verify", claimId: "claim-fixture" }]);
  assert.match(h.$(".claims-history").textContent, /Discord owner verified/); assert.match(h.$(".claims-history").textContent, /staff still need to approve/); assert.match(h.$(".claims-history").textContent, /Awaiting staff review/);
});

test("ownership consent links stay on this site and successful requests cannot be accidentally resubmitted after a refresh error", async t => {
  let submitted = false;
  const h = harness("server-claims", async (_path, options) => { if (options.body) { submitted = true; return json({}); } if (submitted) throw new Error("Status offline"); return json({ csrfToken: "fixture-csrf", claims: [], context: memberContext }); });
  t.after(() => h.dom.window.close()); await h.w.BrowseRPServerClaims.init({ server: { id: "server-fixture" }, root: h.root });
  for (const value of ["//example.com", "/\\example.com", "javascript:alert(1)", "/api/auth/discord\n"]) assert.equal(h.w.BrowseRPServerClaims.sameOriginPath(value), null);
  assert.equal(h.w.BrowseRPServerClaims.sameOriginPath(memberContext.reconnectUrl), memberContext.reconnectUrl);
  h.$('[name="message"]').value = "I own this community and manage its hosting."; h.submit(".claims-form"); await tick();
  assert.equal(h.$(".claims-form").hidden, true); assert.match(h.$(".claims-status").textContent, /claim was submitted.*could not refresh/);
});

test("staff claim filters include unverified ownership and hide decisions without review access", async t => {
  const h = harness("staff-claims"); t.after(() => h.dom.window.close()); const paths = [];
  await h.w.BrowseRPStaffClaims.init({ root: h.root, api: async path => { paths.push(path); return { workspace: { items: [claim()], total: 26, canReview: false } }; } });
  assert.equal([...h.root.querySelectorAll("button")].some(button => button.textContent === "Review approval"), false);
  h.$('[name="verification"]').value = "unverified"; h.$('[name="verification"]').dispatchEvent(new h.w.Event("change")); await tick(); assert.match(paths.at(-1), /verification=unverified/);
  h.click("Next"); await tick(); assert.match(paths.at(-1), /offset=25/);
});

test("staff approval needs a reason and explicit confirmation; failed decisions retain the current version and reason", async t => {
  const h = harness("staff-claims"); t.after(() => h.dom.window.close()); const posts = [];
  await h.w.BrowseRPStaffClaims.init({ root: h.root, api: async (_path, options = {}) => { if (options.body) { posts.push(JSON.parse(options.body)); throw new Error("The claim was updated. Refresh first."); } return { workspace: { items: [claim({ verificationStatus: "verified" })], total: 1, canReview: true } }; } });
  h.click("Review approval"); assert.equal(posts.length, 0); assert.match(h.$("dialog").textContent, /also supports ownership of this game server/);
  h.submit("dialog form"); await tick(); assert.equal(posts.length, 0);
  h.$('dialog [name="reason"]').value = "Confirmed game server ownership with supporting records"; h.submit("dialog form"); await tick();
  assert.deepEqual(posts[0], { id: "claim-fixture", expectedVersion: 4, decision: "approve", reason: "Confirmed game server ownership with supporting records" });
  assert.equal(h.$("dialog").open, true); assert.equal(h.$('dialog [name="reason"]').disabled, false); assert.match(h.$('dialog [name="reason"]').value, /Confirmed game server/); assert.match(h.$("dialog .staff-claims-status").textContent, /claim was updated/);
});
