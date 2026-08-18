import assert from "node:assert/strict";
import test from "node:test";
import { createBrowseRPServer } from "../dev-server.mjs";

async function withServer(run) {
  const server = createBrowseRPServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("public pages and fallback API load without external secrets", async () => withServer(async (origin) => {
  const home = await fetch(origin);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Find a world/);
  for (const path of ["/dashboard", "/staff", "/developers", "/resources", "/legal", "/server/northstar-roleplay"]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
  }
  const directory = await fetch(`${origin}/api/servers?platform=fivem&online=true`);
  const payload = await directory.json();
  assert.equal(directory.status, 200);
  assert.ok(payload.servers.length >= 1);
  assert.ok(payload.servers.every((server) => server.platform_id === "fivem" && server.online));
}));

test("free tools execute through HTTP", async () => withServer(async (origin) => {
  const hash = await fetch(`${origin}/api/tools/joaat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: "adder" }) });
  assert.equal(hash.status, 200);
  assert.equal((await hash.json()).hexadecimal, "0xB779A091");
  const names = await fetch(`${origin}/api/tools/name-generator`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: "redm", theme: "community", style: "casual" }) });
  assert.equal(names.status, 200);
  assert.equal((await names.json()).generation, "local-rules");
}));

test("consolidated public and auth routes preserve their contracts", async () => withServer(async (origin) => {
  for (const path of ["/api/platforms", "/api/categories", "/api/public/overview", "/api/developers", "/api/resources", "/api/boosts/balance"]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") || "", /application\/json/);
  }
  const cached = await fetch(`${origin}/api/platforms`);
  assert.match(cached.headers.get("cache-control") || "", /s-maxage=/);
  const session = await fetch(`${origin}/api/auth/session`);
  assert.equal(session.status, 200);
  assert.equal((await session.json()).authenticated, false);
  const discord = await fetch(`${origin}/api/auth/discord`, { redirect: "manual" });
  assert.equal(discord.status, 302);
  assert.match(discord.headers.get("location") || "", /auth=backend-not-configured/);
  const member = await fetch(`${origin}/api/me/overview`);
  assert.equal(member.status, 401);
  const favorites = await fetch(`${origin}/api/me/favorites`);
  assert.equal(favorites.status, 401);
  const favoriteAction = await fetch(`${origin}/api/me/favorites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serverId: crypto.randomUUID() }) });
  assert.equal(favoriteAction.status, 401);
  const notifications = await fetch(`${origin}/api/me/notifications/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(notifications.status, 401);
  const staff = await fetch(`${origin}/api/admin/overview`);
  assert.equal(staff.status, 401);
  const staffAction = await fetch(`${origin}/api/admin/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "listing", id: crypto.randomUUID(), action: "approved", reason: "Reviewed and accepted" }) });
  assert.equal(staffAction.status, 401);
  const crossOriginAction = await fetch(`${origin}/api/admin/action`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.invalid" }, body: "{}" });
  assert.equal(crossOriginAction.status, 403);
}));
