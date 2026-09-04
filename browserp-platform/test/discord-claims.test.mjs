import test from "node:test";
import assert from "node:assert/strict";
import { sealDiscordToken, openDiscordToken, discordInvite, verifyDiscordOwnership } from "../lib/discord-claims.js";

const user = { id: "account-a", identities: [{ provider: "discord", provider_id: "123456789012345678" }] };
const guildId = "223456789012345678";
function fixture({ owner = true, userId = user.identities[0].provider_id, status = 200 } = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (status !== 200) return new Response("{}", { status });
    const body = url.endsWith("users/@me") ? { id: userId } : url.includes("guilds?")
      ? [{ id: guildId, owner, permissions: "8" }, { id: "323456789012345678", owner: true }]
      : { type: 0, guild: { id: guildId, name: "Roleplay community" } };
    return Response.json(body);
  };
  return { fetchImpl, requests };
}
test("Discord claim credentials are authenticated, account-bound and short-lived", () => {
  const now = Date.now(); const token = "a-private-provider-token";
  const sealed = sealDiscordToken("account-a", token, now);
  assert.ok(sealed); assert.equal(sealed.includes(token), false);
  assert.equal(openDiscordToken(sealed, "account-a", now + 1000), token);
  assert.equal(openDiscordToken(sealed, "account-b", now + 1000), null);
  assert.equal(openDiscordToken(sealed, "account-a", now + 600001), null);
  const parts = sealed.split("."); parts[2] = "A".repeat(parts[2].length);
  assert.equal(openDiscordToken(parts.join("."), "account-a", now), null);
});
test("Discord verification matches the stored community and requires actual guild ownership", async () => {
  const yes = fixture();
  const verified = await verifyDiscordOwnership({ user, communityUrl: "https://discord.gg/ExampleRP", token: "private-token", fetchImpl: yes.fetchImpl });
  assert.equal(verified.status, "verified"); assert.equal(verified.guildId, guildId);
  assert.ok(yes.requests.every(({ url, options }) => url.startsWith("https://discord.com/api/v10/") && options.redirect === "error"));
  assert.equal(yes.requests.find(r => r.url.includes("invites/")).options.headers.Authorization, undefined);
  const adminOnly = fixture({ owner: false });
  assert.equal((await verifyDiscordOwnership({ user, communityUrl: "https://discord.gg/ExampleRP", token: "private-token", fetchImpl: adminOnly.fetchImpl })).status, "not_owner");
});
test("Discord account mismatch, denied consent and unavailable upstream never verify a claim", async () => {
  const mismatch = fixture({ userId: "423456789012345678" });
  assert.equal((await verifyDiscordOwnership({ user, communityUrl: "https://discord.gg/RP", token: "private-token", fetchImpl: mismatch.fetchImpl })).status, "needs_discord");
  assert.equal(mismatch.requests.length, 1);
  for (const [status, expected] of [[401, "needs_discord"], [403, "needs_discord"], [429, "unavailable"], [502, "unavailable"]]) {
    assert.equal((await verifyDiscordOwnership({ user, communityUrl: "https://discord.gg/RP", token: "private-token", fetchImpl: fixture({ status }).fetchImpl })).status, expected);
  }
});
test("only exact Discord invite URLs can identify the community for a claim", () => {
  assert.equal(discordInvite("https://discord.com/invite/ExampleRP/").url, "https://discord.gg/ExampleRP");
  for (const value of ["https://discord.gg.evil.test/RP", "https://discord.gg@evil.test/RP", "https://cfx.re/join/abc123", "https://127.0.0.1/RP", "https://discord.gg/RP?url=https://evil.test", "roleplay"]) assert.equal(discordInvite(value), null);
});
