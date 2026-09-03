import assert from "node:assert/strict";
import test from "node:test";
import { moderationMutation, moderationQuery } from "../lib/staff-moderation.js";
import { createBrowseRPServer } from "../dev-server.mjs";

test("private moderation searches preserve filters and validate paging bounds", () => {
  const cursor = { createdAt: "2026-09-01T00:00:00.000Z", id: "223" };
  const params = new URLSearchParams({ view: "activity", q: "Two words", status: "all", cursor: JSON.stringify(cursor), limit: "25", from: "2026-08-01", to: "2026-09-04", verified: "false" });
  assert.deepEqual(moderationQuery(params), { kind: "activity", filters: { q: "Two words", status: "all", verified: false, from: "2026-08-01T00:00:00.000Z", to: "2026-09-04T23:59:59.999Z" }, cursor, limit: 25 });
  for (const query of ["view=auth", "limit=10000", "limit=2.5", "online=maybe", "cursor=null", "cursor=%7B%22id%22:1%7D", "from=2026-10-01&to=2026-09-01", `q=${"x".repeat(201)}`]) assert.throws(() => moderationQuery(new URLSearchParams(query)), { status: 400 });
});

test("moderation changes require a known action, explicit version and audited reason", () => {
  const change = { kind: "report", action: "delete", id: "00000000-0000-4000-8000-000000000001", expectedVersion: 4, reason: "Duplicate report retained in history", data: {} };
  assert.deepEqual(moderationMutation(change), change);
  for (const override of [{ kind: "role" }, { action: "purge" }, { id: "other" }, { reason: "" }, { reason: "<script>" }, { data: [] }]) assert.throws(() => moderationMutation({ ...change, ...override }), { status: 400 });
  assert.throws(() => moderationMutation({ ...change, expectedVersion: 0 }), { status: 409 });
});

test("moderation records and security sections stay private over HTTP", async () => {
  const server = createBrowseRPServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ["/api/admin/moderation?view=members", "/api/admin/moderation?view=audit", "/api/admin/security?view=requests"]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 401); assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await response.json()).workspace, undefined);
    }
    const response = await fetch(`${origin}/api/admin/moderation`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://untrusted.example" }, body: "{}" });
    assert.equal(response.status, 403);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
