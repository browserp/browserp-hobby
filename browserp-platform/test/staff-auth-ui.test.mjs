import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const session = { authenticated: true, provider: "discord", staffAccess: true, csrfToken: "fixture-csrf", aal: "aal1", mfa: { required: true, factors: [] } };
const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
async function harness(t, fetch, page = "scrapers") {
  const dom = new JSDOM(read(`staffpanel-${page}.html`), { url: `https://browserp.test/staffpanel/${page}`, runScripts: "outside-only" });
  const w = dom.window; t.after(() => w.close()); w.matchMedia = () => ({ matches: true }); w.fetch = fetch;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  let moderation;
  w.BrowseRPStaffModeration = { init: async options => { moderation = options; } };
  w.eval(read("staffpanel-v3.js")); await tick();
  return { w, $: selector => w.document.querySelector(selector), text: () => w.document.body.textContent, moderation: () => moderation,
    button: text => [...w.document.querySelectorAll("button")].find(button => button.textContent === text),
    submit: form => form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })) };
}

test("staff session outages show a retry state rather than pretending the user signed out", async t => {
  const h = await harness(t, async () => { throw new Error("Connection unavailable"); });
  assert.match(h.text(), /Staff access could not be checked/); assert.ok(h.button("Try again"));
  assert.equal(h.$('a[href^="/api/auth/discord"]'), null); assert.match(h.$('[role="status"]').textContent, /Connection unavailable/);
  h.$(".skip-link").click(); assert.equal(h.w.document.activeElement, h.$(".staff-login-card-v3"));
});

test("staff access gates never leave a menu for a removed navigation panel", async t => {
  const states = [
    { authenticated: false },
    { ...session, staffAccess: false },
    session,
    { ...session, mfa: { required: true, factors: [{ id: "factor-fixture", status: "verified" }] } }
  ];
  for (const value of states) {
    const h = await harness(t, async () => json(value));
    const menu = h.$("#staff-menu-v3");
    assert.ok(h.$(".staff-login-card-v3"));
    assert.equal(h.$(".staff-sidebar-v3"), null);
    assert.equal(menu.hidden, true); assert.equal(menu.disabled, true);
    assert.equal(menu.hasAttribute("aria-controls"), false);
    menu.click();
    assert.equal(menu.getAttribute("aria-expanded"), "false");
    assert.equal(h.w.document.body.classList.contains("staff-menu-open"), false);
  }
});

test("MFA setup failure remains visible and the user can retry without duplicate requests", async t => {
  let finish; const calls = [];
  const h = await harness(t, async (path, options) => {
    if (path === "/api/auth/session") return json(session);
    calls.push({ path, options }); return new Promise(resolve => { finish = resolve; });
  });
  const button = h.button("Set up authenticator"); button.click(); button.click();
  assert.equal(calls.length, 1); assert.equal(button.disabled, true);
  assert.equal(calls[0].options.headers["X-BrowseRP-CSRF"], "fixture-csrf"); assert.equal(calls[0].options.credentials, "same-origin");
  finish(json({ error: "Authenticator service unavailable. Please try again." }, 503)); await tick();
  assert.match(h.$(".staff-enrollment-status-v3").textContent, /Authenticator service unavailable/); assert.equal(button.disabled, false);
  button.click(); assert.equal(calls.length, 2); finish(json({ error: "Retry later" }, 503)); await tick();
});

test("MFA verification rejects malformed codes and keeps failed valid entries editable", async t => {
  let finish; const calls = [];
  const h = await harness(t, async (path, options) => {
    if (path === "/api/auth/session") return json({ ...session, mfa: { required: true, factors: [{ id: "factor-fixture", status: "verified" }] } });
    calls.push({ path, options }); return new Promise(resolve => { finish = resolve; });
  });
  const input = h.$('[name="code"]'); const form = input.form;
  input.value = "abcd"; h.submit(form); assert.equal(calls.length, 0);
  input.value = "123456"; h.submit(form); h.submit(form); assert.equal(calls.length, 1);
  assert.equal(form.getAttribute("aria-busy"), "true"); assert.equal(input.disabled, true);
  assert.deepEqual(JSON.parse(calls[0].options.body), { factorId: "factor-fixture", code: "123456" });
  finish(json({ error: "That code expired. Enter a new code." }, 422)); await tick();
  assert.equal(input.disabled, false); assert.equal(input.value, "123456"); assert.equal(form.hasAttribute("aria-busy"), false); assert.match(form.textContent, /That code expired/);
});

test("denied staff access offers explicit sign-out with CSRF and no automatic account changes", async t => {
  const calls = [];
  const h = await harness(t, async (path, options) => {
    calls.push({ path, options }); return json(path === "/api/auth/session" ? { ...session, staffAccess: false } : { signedOut: true });
  });
  assert.equal(calls.length, 1); assert.match(h.text(), /Staff access required/);
  h.button("Sign out").click(); await tick();
  assert.equal(calls[1].path, "/api/auth/logout"); assert.equal(calls[1].options.method, "POST"); assert.equal(calls[1].options.headers["X-BrowseRP-CSRF"], "fixture-csrf");
  assert.match(h.text(), /Continue with Discord/); assert.match(h.$('a[href^="/api/auth/discord"]').href, /returnTo=%2Fstaffpanel%2Fscrapers$/);
});

test("staff can use a named backup at the MFA gate and changing factors clears the previous code", async t => {
  const calls = [];
  const h = await harness(t, async (path, options) => {
    if (path === "/api/auth/session") return json({ ...session, mfa: { required: true, factors: [{ id: "main", friendlyName: "Main phone", status: "verified" }, { id: "backup", friendlyName: "Backup phone", status: "verified" }] } });
    calls.push({ path, options }); return json({ error: "Fixture code rejected" }, 422);
  });
  const select = h.$('[name="authenticator"]'); assert.ok(select); assert.equal(select.options[1].textContent, "Backup phone");
  h.$('[name="code"]').value = "111111"; select.value = "backup"; select.dispatchEvent(new h.w.Event("change"));
  const input = h.$('[name="code"]'); assert.equal(input.value, ""); input.value = "222222"; h.submit(input.form); await tick();
  assert.deepEqual(JSON.parse(calls[0].options.body), { factorId: "backup", code: "222222" });
});

test("an unfinished initial authenticator can resume and restarting requires an explicit confirmation", async t => {
  const calls=[];
  const h=await harness(t,async(path,options)=>{
    if(path==="/api/auth/session")return json({...session,mfa:{required:true,factors:[{id:"pending",friendlyName:"BrowseRP staff",status:"unverified"}]}});
    calls.push({path,options});return path==="/api/auth/mfa/enroll"?json({factor:{id:"replacement",secret:"NEWSETUPKEY",qrCode:"data:image/svg+xml;base64,PHN2Zy8+"}}):json({error:"Fixture verification rejected"},422);
  });
  assert.match(h.text(),/Finish authenticator setup/);assert.equal(h.button("Set up authenticator"),undefined);
  const input=h.$('[name="code"]');input.value="123456";h.submit(input.form);await tick();
  assert.deepEqual(JSON.parse(calls[0].options.body),{factorId:"pending",code:"123456"});
  h.button("Start again").click();await tick();assert.equal(calls.length,1);assert.ok(h.$("dialog"));h.button("Cancel").click();await tick();assert.equal(calls.length,1);assert.equal(h.$('[name="code"]').value,"123456");
  h.button("Start again").click();await tick();h.submit(h.$("dialog form"));await tick();
  assert.deepEqual(JSON.parse(calls[1].options.body),{action:"restart",factorId:"pending"});assert.match(h.text(),/Scan the QR code/);assert.equal(h.$("code").hidden,true);
});

test("expired staff access clears a previously open mobile menu and leaves the sign-in card reachable", async t => {
  const h = await harness(t, async () => json({ ...session, mfa: { required: false } }), "moderation");
  h.$("#staff-menu-v3").click(); assert.equal(h.w.document.body.classList.contains("staff-menu-open"), true);
  h.moderation().onAuthFailure();
  assert.equal(h.w.document.body.classList.contains("staff-menu-open"), false); assert.equal(h.$("#staff-menu-v3").getAttribute("aria-expanded"), "false");
  assert.equal(h.$("#staff-menu-v3").hidden, true); assert.equal(h.$("#staff-menu-v3").disabled, true);
  assert.equal(h.w.document.activeElement, h.$(".staff-login-card-v3"));
  h.$("#staff-menu-v3").click(); assert.equal(h.w.document.body.classList.contains("staff-menu-open"), false);
  assert.ok(h.$(".staff-login-card-v3")); h.$(".skip-link").click(); assert.equal(h.w.document.activeElement, h.$(".staff-login-card-v3"));
});

test("recorded staff action dialogs expose an accessible name and cancellation makes no mutation", async t => {
  const calls = [];
  const h = await harness(t, async (path, options) => { calls.push({ path, options }); return json({ ...session, mfa: { required: false } }); }, "moderation");
  const pending = h.moderation().actions.applyBan({ userId: "fixture-user", displayName: "Fixture member" }); await tick();
  const dialog = h.$("dialog"); assert.ok(dialog); assert.equal(dialog.getAttribute("aria-label"), dialog.querySelector("h2").textContent);
  h.button("Cancel").click(); await pending; assert.equal(calls.filter(call => call.options.method === "POST").length, 0);
});
