import test from "node:test";
import assert from "node:assert/strict";
import { refreshDuePublicSources } from "../api/servers.js";

test("public directory reads continue when a due source refresh fails", async () => {
  const calls = [], warnings = [];
  const result = await refreshDuePublicSources([
    { name: "fivem", refresh: async () => { calls.push("fivem"); throw Object.assign(new Error("statement timeout"), { code: "57014" }); } },
    { name: "minecraft", refresh: async () => { calls.push("minecraft"); return [{ serverId: "fixture" }]; } }
  ], warning => warnings.push(JSON.parse(warning)));

  assert.deepEqual(calls.sort(), ["fivem", "minecraft"]);
  assert.deepEqual(result.failedSources, ["fivem"]);
  assert.equal(result.outcomes[0].status, "rejected");
  assert.equal(result.outcomes[1].status, "fulfilled");
  assert.deepEqual(warnings, [{ event: "directory.source_refresh_failed", sources: ["fivem"] }]);
});

test("synchronous refresh failures are isolated too", async () => {
  const result = await refreshDuePublicSources([
    { name: "fivem", refresh: () => { throw new Error("synchronous failure"); } },
    { name: "minecraft", refresh: () => [] }
  ], () => {});

  assert.deepEqual(result.failedSources, ["fivem"]);
});
