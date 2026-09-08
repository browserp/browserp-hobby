import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("../public/recommendations.js", import.meta.url), "utf8"), context);
const { choiceKey, accountKey, create } = context.BrowseRPConsentModel;
const historyKey = context.BrowseRPRecommendationModel.key;
const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002";
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (choice = null, version = 0, accountId = A) => ({ accountId, schemaVersion: 1, choice, version, updatedAt: null });
function fixture(initial = {}, remote = response()) {
  const values = new Map(Object.entries(initial));
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let clock = Date.now();
  const model = context.BrowseRPRecommendationModel.create(storage, () => clock), calls = [];
  const h = { values, storage, model, calls, session: { authenticated: true, csrfToken: "csrf-fixture", user: { id: A } }, remote,
    override: null, advance: ms => clock += ms };
  h.consent = create({ storage, model, now: () => clock, request: async (url, options = {}) => {
    calls.push({ url, options });
    if (h.override) { const value = h.override(url, options); if (value !== undefined) return value; }
    if (url === "/api/auth/session") return h.session;
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      if (body.choice === "accepted" && body.expectedVersion !== h.remote.version) throw Error("409 conflict");
      h.remote = response(body.choice, h.remote.version + 1, h.session.user.id);
    }
    return h.remote;
  } });
  return h;
}

test("cached acceptance cannot collect while account/pref loading, failed, paused or expired", async () => {
  const h = fixture({ [choiceKey]: "accepted", [accountKey]: A }, response("accepted", 2));
  assert.equal(h.consent.enabled(), false);
  await h.consent.sync(); assert.equal(h.consent.enabled(), true);
  h.advance(30000); assert.equal(h.consent.enabled(), false);
  await h.consent.sync(); h.consent.pause(); assert.equal(h.consent.enabled(), false);
  h.override = () => { throw Error("offline"); };
  await h.consent.sync(); assert.equal(h.consent.enabled(), false); assert.equal(h.consent.getState().phase, "error");
});

test("local rejection overrides stale accepted account values, including after offline retry", async () => {
  const h = fixture({ [choiceKey]: "rejected" }, response("accepted", 8));
  h.override = (url, options) => { if (options.method === "POST") throw Error("offline"); };
  await h.consent.sync(); assert.equal(h.consent.enabled(), false); assert.equal(h.values.get(choiceKey), "rejected");
  h.override = null; await h.consent.sync();
  assert.equal(h.remote.choice, "rejected"); assert.equal(h.consent.enabled(), false);
  assert.equal(h.values.has(historyKey), false);
});

test("fresh remote acceptance works on a new device and sends no browsing history", async () => {
  const h = fixture({}, response("accepted", 5));
  await h.consent.sync(); assert.equal(h.consent.enabled(), true);
  h.model.record({ slug: "local-private-interest", platform_id: "fivem", region: "UK" });
  await h.consent.sync();
  assert.doesNotMatch(JSON.stringify(h.calls), /local-private-interest|views|region|slug/);
  assert.equal(h.model.read().views.length, 1);
});

test("remote rejection clears history and requires an explicit new local acceptance", async () => {
  const h = fixture({ [accountKey]: A }, response("accepted", 1));
  await h.consent.sync(); h.model.record({ slug: "old-interest", platform_id: "fivem", region: "UK" });
  h.remote = response("rejected", 2); await h.consent.sync();
  assert.equal(h.values.has(historyKey), false); assert.equal(h.values.get(choiceKey), "rejected");
  h.remote = response("accepted", 3); await h.consent.sync(); assert.equal(h.consent.enabled(), false);
  assert.equal(h.consent.choose(true), true); assert.equal(h.consent.enabled(), false);
  await tick(); assert.equal(h.consent.enabled(), true); assert.equal(h.remote.choice, "accepted");
});

test("acceptance conflict fails closed without automatic overwrite or opt-in retry", async () => {
  const h = fixture(); await h.consent.sync(); h.remote = response("rejected", 1);
  h.consent.choose(true); await tick();
  assert.equal(h.consent.enabled(), false); assert.equal(h.remote.choice, "rejected");
  assert.equal(h.calls.filter(c => c.options.method === "POST").length, 1);
});

test("rejecting while acceptance is in flight ignores the stale acceptance response", async () => {
  const h = fixture(); await h.consent.sync(); let resolve;
  h.override = (url, options) => options.method === "POST" && JSON.parse(options.body).choice === "accepted" ? new Promise(r => { resolve = r; }) : undefined;
  h.consent.choose(true); h.consent.choose(false); await tick();
  resolve(response("accepted", 1)); await tick();
  assert.equal(h.consent.enabled(), false); assert.equal(h.values.get(choiceKey), "rejected");
});

test("rejection remains effective when local history removal fails", async () => {
  const h = fixture({ [accountKey]: A }, response("accepted", 1)); await h.consent.sync();
  h.storage.removeItem = () => { throw Error("blocked storage"); };
  h.consent.choose(false); assert.equal(h.consent.enabled(), false); await tick();
  assert.equal(h.consent.enabled(), false); assert.equal(h.consent.getState().localSaveFailed, true);
  assert.equal(h.values.get(choiceKey), "rejected"); assert.equal(h.remote.choice, "rejected");
});

test("account switch clears history, never inherits acceptance, and discards old pending response", async () => {
  const h = fixture({ [accountKey]: A }, response("accepted", 1)); await h.consent.sync();
  h.model.record({ slug: "a-private-history", platform_id: "fivem", region: "UK" });
  let resolve; h.override = url => url === "/api/me/preferences" ? new Promise(r => { resolve = r; }) : undefined;
  const pending = h.consent.sync(); await tick();
  h.override = null; h.session.user.id = B; h.remote = response(null, 0, B); await h.consent.sync();
  resolve(response("accepted", 1)); await pending;
  assert.equal(h.consent.getState().accountId, B); assert.equal(h.consent.enabled(), false);
  assert.equal(h.values.has(historyKey), false);
});

test("guest acceptance stays local; signing in never uploads it as account acceptance", async () => {
  const h = fixture(); h.session = { authenticated: false };
  await h.consent.sync(); assert.equal(h.consent.choose(true), true); assert.equal(h.consent.enabled(), true);
  h.session = { authenticated: true, user: { id: A } }; await h.consent.sync();
  assert.equal(h.consent.enabled(), false); assert.equal(h.calls.some(c => c.options.method === "POST"), false);
});

test("malformed, wrong-account and unsupported-version responses stay off", async () => {
  for (const remote of [response("accepted", 1, B), { ...response("accepted", 1), schemaVersion: 2 }, response("accepted", 0), { ...response("accepted", 1), version: "1" }]) {
    const h = fixture({}, remote); await h.consent.sync(); assert.equal(h.consent.enabled(), false); assert.equal(h.consent.getState().phase, "error");
  }
});

test("loading choices cannot accept an unknown account, but rejection is remembered", async () => {
  const h = fixture(); assert.equal(h.consent.choose(true), false); assert.equal(h.consent.enabled(), false);
  h.consent.choose(false); await tick(); assert.equal(h.values.get(choiceKey), "rejected");
  assert.equal(h.remote.choice, "rejected"); assert.equal(h.consent.enabled(), false);
});

test("another tab's rejection gates immediately even before the storage event arrives", async () => {
  const h = fixture({}, response("accepted", 1)); await h.consent.sync();
  h.values.set(choiceKey, "rejected"); assert.equal(h.consent.enabled(), false);
});

test("an in-flight acceptance cannot overwrite a newer same-value rejection in another tab", async () => {
  const h = fixture({ [choiceKey]: "rejected" }, response("rejected", 1)); await h.consent.sync();
  let resolve; h.override = (_url, options) => options.method === "POST" ? new Promise(r => { resolve = r; }) : undefined;
  h.consent.choose(true);
  h.values.set(context.BrowseRPConsentModel.decisionKey, "a-new-local-rejection");
  resolve(response("accepted", 2)); await tick();
  assert.equal(h.consent.enabled(), false); assert.equal(h.values.get(choiceKey), "rejected");
});

test("rejection survives quota failure plus an offline write and later accepted remote reads", async () => {
  const h = fixture({}, response("accepted", 1)); await h.consent.sync();
  h.model.record({ slug: "must-clear", platform_id: "fivem", region: "UK" });
  h.storage.setItem = () => { throw Error("quota"); };
  h.override = (_url, options) => { if (options.method === "POST") throw Error("offline"); };
  h.consent.choose(false); await tick();
  assert.equal(h.values.has(historyKey), false, "removal is still attempted when writes fail");
  await h.consent.sync();
  assert.equal(h.consent.enabled(), false); assert.equal(h.consent.getState().phase, "error");
});
