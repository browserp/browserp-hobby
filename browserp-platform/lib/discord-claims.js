import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { env, isProductionRuntime } from "./config.js";
import { cookie, cookieName, cookieValue, parseCookies, setCookies } from "./http.js";

const CONTEXT = "browserp-discord-claim-proof-v1";
const TOKEN_TTL = 10 * 60;
function key() {
  const secret = env("PRIVACY_HASH_SECRET");
  if (!secret && isProductionRuntime()) throw Object.assign(new Error("Discord ownership checks are temporarily unavailable."), { status: 503 });
  return createHmac("sha256", secret || "browserp-development-only").update(CONTEXT).digest();
}
export function sealDiscordToken(userId, token, now = Date.now()) {
  if (typeof token !== "string" || token.length < 10 || token.length > 1500 || /[\s\x00-\x1f]/.test(token)) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(CONTEXT));
  const payload = JSON.stringify({ userId, token, expiresAt: now + TOKEN_TTL * 1000 });
  const bytes = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), bytes.toString("base64url")].join(".");
}
export function openDiscordToken(value, userId, now = Date.now()) {
  try {
    if (typeof value !== "string" || value.length > 3000) return null;
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(parts[1], "base64url"));
    decipher.setAAD(Buffer.from(CONTEXT));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8"));
    if (payload.userId !== userId || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= now || payload.expiresAt > now + TOKEN_TTL * 1000) return null;
    return typeof payload.token === "string" ? payload.token : null;
  } catch { return null; }
}
export function setDiscordClaimToken(res, session) {
  const value = sealDiscordToken(session.user?.id, session.provider_token);
  if (value) setCookies(res, [cookie(cookieName("brp_discord_claim"), value, { maxAge: TOKEN_TTL, sameSite: "Lax" })]);
}
export function discordClaimToken(req, userId) {
  return openDiscordToken(cookieValue(parseCookies(req), "brp_discord_claim"), userId);
}
export function discordInvite(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
    const host = url.hostname.toLowerCase();
    const match = ["discord.gg", "www.discord.gg"].includes(host)
      ? /^\/([a-z0-9_-]{2,100})\/?$/i.exec(url.pathname)
      : ["discord.com", "www.discord.com", "discordapp.com", "www.discordapp.com"].includes(host)
        ? /^\/invite\/([a-z0-9_-]{2,100})\/?$/i.exec(url.pathname) : null;
    return match ? { code: match[1], url: `https://discord.gg/${match[1]}` } : null;
  } catch { return null; }
}
export function discordIdentity(user) {
  const identity = user?.identities?.find((item) => item.provider === "discord");
  const id = String(identity?.provider_id || identity?.identity_data?.provider_id || identity?.identity_data?.sub || "");
  return /^[0-9]{17,20}$/.test(id) ? id : null;
}
async function discordJson(path, token, fetchImpl) {
  const response = await fetchImpl(`https://discord.com/api/v10/${path}`, {
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    redirect: "error", signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw Object.assign(new Error("Discord could not verify ownership."), { status: response.status });
  if (Number(response.headers.get("content-length")) > 2_000_000) throw new Error("Discord response too large.");
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 2_000_000) throw new Error("Discord response too large."); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function verifyDiscordOwnership({ user, communityUrl, token, fetchImpl = fetch, now = Date.now() }) {
  const discordUserId = discordIdentity(user);
  const base = { discordUserId, communityUrl, guildId: null, guildName: null, isOwner: null, checkedAt: new Date(now).toISOString() };
  if (!discordUserId || !token) return { ...base, status: "needs_discord" };
  const invite = discordInvite(communityUrl);
  if (!invite) return { ...base, status: "unavailable" };
  try {
    const me = await discordJson("users/@me", token, fetchImpl);
    if (String(me?.id) !== discordUserId) return { ...base, status: "needs_discord" };
    const [guilds, invitation] = await Promise.all([
      discordJson("users/@me/guilds?limit=200", token, fetchImpl),
      discordJson(`invites/${encodeURIComponent(invite.code)}`, null, fetchImpl)
    ]);
    const guildId = String(invitation?.guild?.id || "");
    if (!Array.isArray(guilds) || !/^[0-9]{17,20}$/.test(guildId) || (invitation.type !== undefined && invitation.type !== 0)) return { ...base, status: "unavailable" };
    const matchingGuild = guilds.find((guild) => String(guild?.id) === guildId);
    // A full page without the guild is inconclusive; never label an unseen page as proof of non-ownership.
    if (!matchingGuild && guilds.length >= 200) return { ...base, status: "unavailable" };
    const isOwner = matchingGuild?.owner === true;
    // Administrator/Manage Guild permissions do not establish actual guild ownership.
    return { ...base, guildId, guildName: String(invitation.guild.name || "Discord community").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100), isOwner, status: isOwner ? "verified" : "not_owner" };
  } catch (error) {
    return { ...base, status: [401, 403].includes(error?.status) ? "needs_discord" : "unavailable" };
  }
}
