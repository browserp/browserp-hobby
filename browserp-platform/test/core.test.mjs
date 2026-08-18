import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { filterServers } from "../lib/directory.js";
import { servers } from "../lib/catalog.js";
import { assessContent, sanitizePlainText } from "../lib/moderation.js";
import { calculateDiscoveryScore } from "../lib/ranking.js";
import { verifyStripeSignature } from "../lib/stripe.js";
import { generateNames, joaat } from "../lib/tools.js";
import { clientSignal } from "../lib/http.js";

test("JOAAT produces the expected unsigned hash", () => {
  assert.equal(joaat("adder"), 3078201489);
});

test("name generation is deterministic and local", () => {
  const first = generateNames({ platform: "fivem", theme: "city", style: "serious" });
  const second = generateNames({ platform: "fivem", theme: "city", style: "serious" });
  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
});

test("directory filtering and ranking preserve organic weight", () => {
  const results = filterServers(servers, { platform: "minecraft", beginner: "true" });
  assert.equal(results.length, 1);
  assert.equal(results[0].slug, "everwild-realms");
  const weakButBoosted = { quality_score: 10, engagement_score: 10, uptime_percent: 50, players: 1, capacity: 100, verified: false, boost_score: 100 };
  const strongOrganic = { quality_score: 95, engagement_score: 90, uptime_percent: 99, players: 80, capacity: 100, verified: true, boost_score: 0 };
  assert.ok(calculateDiscoveryScore(strongOrganic) > calculateDiscoveryScore(weakButBoosted));
});

test("content moderation blocks credential theft patterns", () => {
  const result = assessContent({ description: "Please share your password and send your recovery code to verify." });
  assert.equal(result.confidence, "blocked");
  assert.equal(result.action, "reject");
  assert.equal(sanitizePlainText("<b>Hello</b>\u0000", 50), "bHello/b");
});

test("Stripe webhook verification checks timestamp and HMAC", () => {
  const body = Buffer.from('{"id":"evt_test"}');
  const secret = "whsec_test";
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret), true);
  assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=bad`, secret), false);
});

test("production network-signal hashing fails closed without its secret", () => {
  const previousVercel = process.env.VERCEL;
  const previousSecret = process.env.PRIVACY_HASH_SECRET;
  try {
    process.env.VERCEL = "1";
    delete process.env.PRIVACY_HASH_SECRET;
    const request = { headers: { "x-forwarded-for": "192.0.2.10" }, socket: {} };
    assert.throws(() => clientSignal(request), /privacy hashing is not configured/i);
    process.env.PRIVACY_HASH_SECRET = "test-only-secret";
    assert.match(clientSignal(request), /^[a-f0-9]{64}$/);
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (previousSecret === undefined) delete process.env.PRIVACY_HASH_SECRET;
    else process.env.PRIVACY_HASH_SECRET = previousSecret;
  }
});
