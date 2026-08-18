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
