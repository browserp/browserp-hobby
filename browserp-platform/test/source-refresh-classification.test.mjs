import test from "node:test";
import assert from "node:assert/strict";
import { refreshCfxCode } from "../lib/fivem-workflow.js";
import { refreshMinecraftCode } from "../lib/minecraft-workflow.js";
import { scheduledStatusRefresh } from "../lib/status-refresh-workflow.js";

const serverId = "00000000-0000-4000-8000-000000000101", minecraftCode = "abcdef012345";
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const raw = (stale = false) => ({ EndPoint: "abc123", Data: { clients: 0, svMaxclients: 64,
  lastSeen: new Date(Date.now() - (stale ? 301_000 : 1000)).toISOString(),
  vars: { gamename: "gta5", sv_projectName: "Fixture RP", sv_projectDesc: "A fixture community for source status checks." } } });

function backend(t, { mode = "save-failure", controller } = {}) {
  const names = [], original = globalThis.fetch;
  const environment = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_fixture" };
  const before = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => { globalThis.fetch = original; for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  globalThis.fetch = async value => {
    const url = new URL(value), name = url.pathname.split("/").at(-1); names.push(name);
    if (url.hostname === "frontend.cfx-services.net") {
      if (mode === "fetch-failure") return reply({}, 503);
      if (mode === "abort-before-save") controller.abort();
      return reply(raw(mode === "stale"));
    }
    assert.equal(url.hostname, "fixture.supabase.co", "no real backend can be contacted");
    if (name === "service_minecraft_sources") return reply([{ serverId, joinCode: minecraftCode, address: "play.fixture.example.org:25565", edition: "java" }]);
    if (/^service_claim_/.test(name)) return reply(true);
    if (/^service_mark_/.test(name)) return reply(true);
    if (/^service_refresh_/.test(name)) {
      if (mode === "abort-during-save") { controller.abort(); return reply({}); }
      if (mode === "save-failure") return reply({ message: "Private database fixture detail", code: "XX000" }, 503);
      if (mode === "stale-at-save") return reply({ message: "A current verified player observation is required", code: "P0001" }, 400);
      return reply({ serverId, unchanged: true, checkedAt: "2026-09-07T12:00:00Z" });
    }
    throw new Error(`Unexpected fixture request: ${name}`);
  };
  const minecraftSource = async () => {
    if (mode === "fetch-failure") throw new Error("Minecraft did not answer its status check.");
    if (mode === "abort-before-save") controller.abort();
    return { players: 0, capacity: 64, checkedAt: new Date().toISOString() };
  };
  return { names, run: (platform, strict = false) => platform === "fivem"
    ? refreshCfxCode("abc123", { strict, signal: controller?.signal })
    : refreshMinecraftCode(minecraftCode, { serverId, strict, fetchServer: minecraftSource, signal: controller?.signal }) };
}

for (const platform of ["fivem", "minecraft"]) {
  test(`${platform}: failed persistence rejects in ordinary and strict modes without marking the source unavailable`, async t => {
    const h = backend(t);
    for (const strict of [false, true]) await assert.rejects(h.run(platform, strict), { status: 503, code: "XX000" });
    assert.equal(h.names.filter(name => /^service_refresh_/.test(name)).length, 2);
    assert.equal(h.names.some(name => /^service_mark_/.test(name)), false);
  });
  test(`${platform}: upstream failure still marks unavailable and strict mode reports the source error`, async t => {
    const h = backend(t, { mode: "fetch-failure" });
    assert.equal((await h.run(platform)).unavailable, true);
    await assert.rejects(h.run(platform, true));
    assert.equal(h.names.filter(name => /^service_mark_/.test(name)).length, 2);
    assert.equal(h.names.some(name => /^service_refresh_/.test(name)), false);
  });
  test(`${platform}: unchanged snapshot results are preserved`, async t => {
    const h = backend(t, { mode: "unchanged" });
    assert.deepEqual(await h.run(platform), { serverId, unchanged: true, checkedAt: "2026-09-07T12:00:00Z" });
    assert.equal(h.names.some(name => /^service_mark_/.test(name)), false);
  });
  for (const mode of ["abort-before-save", "abort-during-save"]) test(`${platform}: ${mode} never changes source availability`, async t => {
    const h = backend(t, { mode, controller: new AbortController() });
    await assert.rejects(h.run(platform), { name: "AbortError" });
    assert.equal(h.names.some(name => /^service_mark_/.test(name)), false);
    assert.equal(h.names.filter(name => /^service_refresh_/.test(name)).length, mode === "abort-before-save" ? 0 : 1);
  });
}
test("Cfx timestamps older than five minutes remain unavailable without an attempted save", async t => {
  const h = backend(t, { mode: "stale" }); assert.equal((await h.run("fivem")).unavailable, true);
  assert.equal(h.names.some(name => /^service_refresh_/.test(name)), false);
  assert.equal(h.names.filter(name => /^service_mark_/.test(name)).length, 1);
});
test("a Cfx timestamp rejected at save time propagates without a false source failure", async t => {
  const h = backend(t, { mode: "stale-at-save" }); await assert.rejects(h.run("fivem"), { code: "P0001" });
  assert.equal(h.names.some(name => /^service_mark_/.test(name)), false);
});
test("the real refresh adapters put failed saves into the scheduler failure counter", async t => {
  const h = backend(t); let finished;
  const result = await scheduledStatusRefresh({ headers: { authorization: `Bearer ${"a".repeat(64)}`, "content-type": "application/json" }, body: {} }, {
    now: () => 100,
    callRpc: async (name, body) => {
      if (name === "service_claim_status_refresh") return "00000000-0000-4000-8000-000000000999";
      if (name === "service_cfx_sources") return [{ serverId, platform: "fivem", joinCode: "abc123" }];
      if (name === "service_minecraft_sources") return [{ serverId, joinCode: minecraftCode }];
      if (name === "service_finish_status_refresh") { finished = body.p_summary; return true; }
      throw new Error(`Unexpected scheduler RPC ${name}`);
    },
    refreshCfx: () => h.run("fivem"), refreshMinecraft: () => h.run("minecraft"),
    cleanupMedia: async () => {}, cleanupExports: async () => {}
  });
  assert.deepEqual(result.summary, { requested: 2, checked: 0, unchanged: 0, unavailable: 0, skipped: 0, failed: 2, deferred: 0, durationMs: 0 });
  assert.deepEqual(finished, result.summary);
  assert.equal(h.names.some(name => /^service_mark_/.test(name)), false);
});
