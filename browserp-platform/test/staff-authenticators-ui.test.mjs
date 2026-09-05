import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
const script = readFileSync(new URL("../public/staff-authenticators.js", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const primary = { id: "first", label: "Main phone", status: "verified" };
const backup = { id: "backup", label: "Backup phone", status: "verified" };
const pending = { id: "pending", label: "Spare device", status: "unverified" };
const payload = (factors = [primary]) => ({ authenticators: { factors, maxFactors: 3, canAdd: factors.length < 3 } });
async function harness(t, handler = async () => payload()) {
  const dom = new JSDOM('<details id="overview-authenticators"><summary>Your sign-in security</summary><div data-authenticators-content></div></details>', { url: "https://browserp.test/staffpanel/overview", runScripts: "outside-only" });
  const w = dom.window; t.after(() => w.close()); const calls = []; w.eval(script);
  const controller = w.BrowseRPStaffAuthenticators.init({ api: async (path, options) => { calls.push({ path, options }); return handler(path, options); } });
  const root = w.document.querySelector("details");
  return { w, root, calls, controller, $: selector => w.document.querySelector(selector), text: () => root.textContent,
    button: text => [...root.querySelectorAll("button")].find(item => item.textContent === text),
    async open() { root.open = true; root.dispatchEvent(new w.Event("toggle")); await tick(); },
    async close() { root.open = false; root.dispatchEvent(new w.Event("toggle")); await tick(); },
    submit(form) { form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); } };
}

test("personal sign-in security loads on opening and hides removal of the only verified factor", async t => {
  const h = await harness(t); assert.equal(h.calls.length, 0); await h.open();
  assert.match(h.text(), /Main phone/); assert.match(h.text(), /Keep until a backup is verified/);
  assert.equal(h.button("Remove"), undefined); assert.ok(h.button("Add backup authenticator"));
  assert.equal(h.calls[0].path, "/api/admin/authenticators");
});

test("backup enrollment blocks duplicate requests, hides the setup key, and clears secrets on close", async t => {
  let finish;
  const h = await harness(t, async (path, options) => options ? new Promise(resolve => { finish = resolve; }) : payload());
  await h.open(); h.button("Add backup authenticator").click(); const input = h.$('[name="label"]'); input.value = "Spare device";
  h.submit(input.form); h.submit(input.form); assert.equal(h.calls.filter(call => call.options).length, 1); assert.equal(input.disabled, true);
  finish({ ...payload([primary, pending]), setup: { ...pending, qrCode: "data:image/svg+xml;base64,PHN2Zy8+", secret: "ABCDEFGHIJKLMNOP" } }); await tick();
  assert.equal(h.$("code").hidden, true); h.button("Show setup key").click(); assert.equal(h.$("code").hidden, false);
  assert.equal(h.$('img').alt, "BrowseRP backup authenticator QR code");
  await h.close(); assert.equal(h.$("code"), null); assert.equal(h.$("img"), null); assert.doesNotMatch(h.text(), /ABCDEFGHIJKLMNOP/);
});

test("backup verification requires a complete code and preserves an unfinished setup after invalid proof", async t => {
  const h = await harness(t, async (path, options) => { if (options) throw new Error("That code expired. Enter the next code."); return payload([primary, pending]); });
  await h.open(); h.button("Finish setup").click(); const input = h.$('[name="code"]');
  input.value = "123"; h.submit(input.form); assert.equal(h.calls.filter(call => call.options).length, 0);
  input.value = "123456"; h.submit(input.form); await tick(); assert.equal(input.disabled, false); assert.match(h.text(), /That code expired/);
  assert.deepEqual(JSON.parse(h.calls.find(call => call.options).options.body), { action: "verify", factorId: "pending", code: "123456" });
});

test("removing a verified factor requires another factor's code and shows the retained factor", async t => {
  const h = await harness(t, async (path, options) => options ? payload([backup]) : payload([primary, backup]));
  await h.open(); h.button("Remove").click(); const select = h.$('[name="alternate"]'); assert.equal(select.options.length, 1); assert.equal(select.value, backup.id);
  const input = h.$('[name="code"]'); input.value = "654321"; h.submit(input.form); await tick();
  assert.deepEqual(JSON.parse(h.calls.find(call => call.options).options.body), { action: "remove", factorId: "first", alternateFactorId: "backup", code: "654321" });
  assert.equal(h.$("form"), null); assert.match(h.text(), /Authenticator removed/); assert.match(h.text(), /Backup phone/); assert.equal(h.button("Remove"), undefined);
});

test("network errors give an explicit retry and never pretend a factor was removed", async t => {
  let failure = true;
  const h = await harness(t, async () => { if (failure) throw new Error("Sign-in service unavailable."); return payload([primary, backup]); });
  await h.open(); assert.match(h.text(), /Sign-in service unavailable/); assert.ok(h.button("Refresh authenticators"));
  failure = false; h.button("Refresh authenticators").click(); await tick(); assert.match(h.text(), /Main phone/);
});

test("closing during enrollment discards a late setup secret instead of reopening the form", async t => {
  let finish; const h = await harness(t, async (path, options) => options ? new Promise(resolve => { finish = resolve; }) : payload());
  await h.open(); h.button("Add backup authenticator").click(); const input = h.$('[name="label"]'); input.value = "Spare device"; h.submit(input.form);
  await h.close(); finish({ ...payload([primary, pending]), setup: { ...pending, secret: "ABCDEFGHIJKLMNOP" } }); await tick();
  assert.equal(h.root.open, false); assert.equal(h.$("code"), null); assert.equal(h.$("form"), null); assert.doesNotMatch(h.text(), /ABCDEFGHIJKLMNOP/);
  h.controller.destroy();
});

test("factor labels are text, so external markup cannot become a control or image", async t => {
  const h = await harness(t, async () => payload([{ ...primary, label: '<img src=x onerror="alert(1)">' }]));
  await h.open(); assert.equal(h.$("img"), null); assert.match(h.text(), /<img/);
});
