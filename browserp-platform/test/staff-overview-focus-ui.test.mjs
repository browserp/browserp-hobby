import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));

async function overview(t, hash = "") {
  const dom = new JSDOM(read("staffpanel-overview.html"), { url: `https://browserp.test/staffpanel/overview${hash}`, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.matchMedia = () => ({ matches: false });
  w.fetch = async () => ({ ok: true, json: async () => ({ authenticated: true, provider: "discord", staffAccess: true, staff: true, user: { id: "staff-one" }, mfa: { required: false }, csrfToken: "fixture" }) });
  w.BrowseRPStaffOverview = { init: async () => ({ destroy() {} }) };
  w.eval(read("staffpanel-v3.js"));
  for (let index = 0; index < 4; index += 1) await tick();
  return { w, $: selector => w.document.querySelector(selector) };
}

test("Overview deep links open and focus the requested staff tool", async t => {
  const h = await overview(t, "#overview-users");
  assert.equal(h.w.document.activeElement, h.$("#overview-users h2"));

  h.w.location.hash = "#overview-authenticators";
  h.w.dispatchEvent(new h.w.Event("hashchange"));
  assert.equal(h.$("#overview-authenticators").open, true);
  assert.equal(h.w.document.activeElement, h.$("#overview-authenticators summary"));
});
