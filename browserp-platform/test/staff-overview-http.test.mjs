import test from "node:test";
import assert from "node:assert/strict";
import { createBrowseRPServer } from "../dev-server.mjs";

test("website overview, roles and announcement management require sign-in over HTTP", async () => {
  const server = createBrowseRPServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ["/api/admin/overview?range=30d", "/api/admin/roles", "/api/admin/announcements"]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 401, path);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const payload = await response.json();
      assert.equal(typeof payload.error, "string");
      assert.equal(payload.overview, undefined);
      assert.equal(payload.control, undefined);
    }
    for (const path of ["/api/admin/roles", "/api/admin/announcements"]) {
      const response = await fetch(origin + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://untrusted.example" }, body: "{}" });
      assert.equal(response.status, 403, path);
    }
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
