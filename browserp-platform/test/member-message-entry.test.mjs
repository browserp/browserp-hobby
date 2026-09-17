import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const json = value => ({ ok: true, status: 200, json: async () => value });

test("profile Message action hides for self and preserves the recipient for other members and guests", async t => {
  for (const [profile, label] of [[{ username: "gamer_one" }, null], [{ username: "other_member" }, "Message"], [null, "Sign in to message"]]) {
    const dom = new JSDOM('<a id="member-message-v7" data-username="gamer_one" href="/dashboard?message=gamer_one#inbox" hidden>Message</a>',
      { url: "https://browserp.test/user/gamer_one", runScripts: "outside-only" });
    t.after(() => dom.window.close());
    dom.window.fetch = async () => json(profile ? { authenticated: true, user: { profile }, csrfToken: "fixture" } : { authenticated: false });
    dom.window.eval(read("member-public.js"));
    await tick();
    const action = dom.window.document.querySelector("#member-message-v7");
    assert.equal(action.hidden, label === null);
    if (label) assert.equal(action.textContent, label);
    assert.equal(action.getAttribute("href"), "/dashboard?message=gamer_one#inbox");
  }
});

test("signed-out dashboard OAuth keeps a validated recipient and rejects malformed recipients", async t => {
  for (const [query, expected] of [["?message=gamer_one#inbox", "/dashboard?message=gamer_one"], ["?message=bad%2Fname#inbox", "/dashboard"]]) {
    const dom = new JSDOM(read("dashboard.html"), { url: `https://browserp.test/dashboard${query}`, runScripts: "outside-only" });
    t.after(() => dom.window.close());
    dom.window.fetch = async path => json(path === "/api/auth/session" ? { authenticated: false, user: null }
      : path === "/api/auth/providers" ? { providers: { discord: true, google: false } } : { content: {} });
    dom.window.eval(read("browserp-portal-v2.js"));
    await tick();
    const provider = dom.window.document.querySelector('a[href^="/api/auth/discord"]');
    assert.ok(provider, "sign-in action remains available");
    assert.equal(new URL(provider.href, dom.window.location.href).searchParams.get("returnTo"), expected);
  }
});
