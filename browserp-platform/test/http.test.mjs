import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { createBrowseRPServer, staffDemoAllowed } from "../dev-server.mjs";

const isolatedProviderEnvironment = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "APP_URL",
  "VERCEL",
  "VERCEL_ENV",
  "NODE_ENV",
  "BROWSERP_LOCAL_STAFF_DEMO"
];

async function withServer(run, options = {}) {
  const changedKeys = new Set([...isolatedProviderEnvironment, ...Object.keys(options.environment || {})]);
  const previousEnvironment = new Map([...changedKeys].map((key) => [key, process.env[key]]));
  for (const key of isolatedProviderEnvironment) delete process.env[key];
  for (const [key, value] of Object.entries(options.environment || {})) process.env[key] = String(value);

  let server;
  try {
    server = createBrowseRPServer(options);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  }
  finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("the synthetic staff demo capability is opt-in and loopback-only", () => {
  const allowed = {
    hostHeader: "127.0.0.1:8080",
    remoteAddress: "127.0.0.1",
    environment: { BROWSERP_LOCAL_STAFF_DEMO: "1", NODE_ENV: "development" }
  };
  assert.equal(staffDemoAllowed(allowed), true);
  assert.equal(staffDemoAllowed({ ...allowed, hostHeader: "localhost:8080", remoteAddress: "::ffff:127.0.0.1" }), true);
  assert.equal(staffDemoAllowed({ ...allowed, hostHeader: "[::1]:8080", remoteAddress: "::1" }), true);
  assert.equal(staffDemoAllowed({ ...allowed, hostHeader: "localhost.evil.example" }), false);
  assert.equal(staffDemoAllowed({ ...allowed, hostHeader: "0.0.0.0:8080" }), false);
  assert.equal(staffDemoAllowed({ ...allowed, remoteAddress: "192.168.1.20" }), false);
  assert.equal(staffDemoAllowed({ ...allowed, environment: { NODE_ENV: "development" } }), false);
  assert.equal(staffDemoAllowed({ ...allowed, environment: { BROWSERP_LOCAL_STAFF_DEMO: "1", NODE_ENV: "production" } }), false);
  assert.equal(staffDemoAllowed({ ...allowed, environment: { BROWSERP_LOCAL_STAFF_DEMO: "1", NODE_ENV: "development", VERCEL: "1" } }), false);
  assert.equal(staffDemoAllowed({ ...allowed, environment: { BROWSERP_LOCAL_STAFF_DEMO: "1", NODE_ENV: "development", VERCEL_ENV: "preview" } }), false);
});

test("the local staff demo serves fictional read-only data from a dev-only route", async () => withServer(async (origin) => {
  const missingFlag = await fetch(`${origin}/__dev/staff-demo`);
  assert.equal(missingFlag.status, 404);

  const response = await fetch(`${origin}/__dev/staff-demo?staffDemo=1`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json();
  assert.equal(payload.mode, "synthetic-read-only");
  assert.equal(payload.sample, true);
  assert.equal(payload.overview.listingQueue[0].id, "sample-listing");
  assert.ok(payload.evidence["listing:sample-listing"]);

  const post = await fetch(`${origin}/__dev/staff-demo?staffDemo=1`, { method: "POST" });
  assert.equal(post.status, 405);
}, { environment: { BROWSERP_LOCAL_STAFF_DEMO: "1", NODE_ENV: "development" } }));

test("the synthetic staff demo route is absent from a production runtime", async () => withServer(async (origin) => {
  const response = await fetch(`${origin}/__dev/staff-demo?staffDemo=1`);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
}, { environment: { BROWSERP_LOCAL_STAFF_DEMO: "1", NODE_ENV: "production" } }));

test("public pages and fallback API load without external secrets", async () => withServer(async (origin) => {
  const home = await fetch(origin);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Find the world you want to[\s\S]*live in/);
  for (const path of ["/servers", "/list-server", "/dashboard", "/staffpanel", "/legal", "/about", "/blog", "/appeal", "/advertise", "/coins", "/server/northstar-roleplay"]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
    if (path === "/staffpanel") {
      assert.match(response.headers.get("x-robots-tag") || "", /noindex, nofollow, noarchive/);
    }
  }

  for (const path of ["/", "/servers", "/list-server", "/dashboard", "/legal", "/about", "/blog", "/server/northstar-roleplay"]) {
    const response = await fetch(`${origin}${path}`);
    assert.doesNotMatch(await response.text(), /href=["']\/staffpanel/i, path);
  }

  assert.equal((await fetch(`${origin}/developers`)).status, 404);
  assert.equal((await fetch(`${origin}/resources`)).status, 404);

  const directory = await fetch(`${origin}/api/servers?platform=fivem&online=true`);
  const payload = await directory.json();
  assert.equal(directory.status, 200);
  assert.deepEqual(payload.servers, []);
  assert.equal(payload.total, 0);

  const developers = await (await fetch(`${origin}/api/developers`)).json();
  const resources = await (await fetch(`${origin}/api/resources`)).json();
  assert.deepEqual(developers.developers, []);
  assert.deepEqual(resources.resources, []);
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
  const staffItem = await fetch(`${origin}/api/admin/item?kind=listing&id=${crypto.randomUUID()}`);
  assert.equal(staffItem.status, 401);
  const staffAction = await fetch(`${origin}/api/admin/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "listing", id: crypto.randomUUID(), action: "approved", reason: "Reviewed and accepted" }) });
  assert.equal(staffAction.status, 401);
  const crossOriginAction = await fetch(`${origin}/api/admin/action`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.invalid" }, body: "{}" });
  assert.equal(crossOriginAction.status, 403);

  const checkout = await fetch(`${origin}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: "{}"
  });
  assert.equal(checkout.status, 503);
  assert.match((await checkout.json()).error, /payments are currently disabled/i);
}));

test("signed unrelated Stripe sessions are ignored before fulfillment readiness", async () => {
  const previousWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const previousKey = process.env.STRIPE_SECRET_KEY;
  const previousFulfillment = process.env.STRIPE_FULFILLMENT_ENABLED;
  const originalConsoleError = console.error;
  try {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_test";
    process.env.STRIPE_SECRET_KEY = "sk_test_local";
    process.env.STRIPE_FULFILLMENT_ENABLED = "false";
    console.error = () => {};

    await withServer(async (origin) => {
      const send = async (metadata) => {
        const body = JSON.stringify({
          id: "evt_localtest",
          type: "checkout.session.completed",
          livemode: false,
          data: { object: { object: "checkout.session", livemode: false, metadata } }
        });
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
          .update(`${timestamp}.${body}`)
          .digest("hex");
        return fetch(`${origin}/api/webhooks/stripe`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "stripe-signature": `t=${timestamp},v1=${signature}`
          },
          body
        });
      };

      const unrelated = await send({});
      assert.equal(unrelated.status, 200);
      assert.equal((await unrelated.json()).ignored, true);

      const marked = await send({ browserp_integration: "browserp_checkout_v1" });
      assert.equal(marked.status, 503);
    });
  } finally {
    console.error = originalConsoleError;
    if (previousWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousWebhookSecret;
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
    if (previousFulfillment === undefined) delete process.env.STRIPE_FULFILLMENT_ENABLED;
    else process.env.STRIPE_FULFILLMENT_ENABLED = previousFulfillment;
  }
});
