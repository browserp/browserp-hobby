import { csrfTokenForRequest, getSession, rest, rpc } from "./supabase.js";
import { discordClaimToken, verifyDiscordOwnership } from "./discord-claims.js";
import { sanitizePlainText } from "./moderation.js";
import { rateLimit } from "./rate-limit.js";
import { assertSameOrigin, readBody } from "./http.js";

export function recordId(value) {
  const id = String(value || "").toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw Object.assign(new Error("Choose a valid record."), { status: 400 });
  return id;
}
export function auditReason(value) {
  const reason = sanitizePlainText(value, 500);
  if (reason.length < 5) throw Object.assign(new Error("Add a reason of at least five characters."), { status: 400 });
  return reason;
}
export function expectedVersion(value) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) throw Object.assign(new Error("Reload this record before saving."), { status: 409 });
  return version;
}
async function serverForClaim(id) {
  const rows = await rest(`servers?select=id,name,slug,status,owner_id,community_url&id=eq.${recordId(id)}&status=eq.published&age_rating=neq.adult&limit=1`, { useSecret: true });
  if (!rows?.[0]) throw Object.assign(new Error("This server is not available for a claim."), { status: 404 });
  return rows[0];
}
function contextFor(server, session) {
  const returnTo = `/server/${encodeURIComponent(server.slug)}?claim=1`;
  return {
    serverId: server.id, serverName: server.name, communityUrl: server.community_url,
    claimable: !server.owner_id, isOwner: Boolean(session && server.owner_id === session.user.id),
    authenticated: Boolean(session), provider: session?.provider || null,
    reconnectUrl: `/api/auth/discord?claimGuilds=1&returnTo=${encodeURIComponent(returnTo)}`
  };
}
async function checkClaim(req, session, claim, server) {
  const proof = await verifyDiscordOwnership({ user: session.user, communityUrl: server.community_url, token: discordClaimToken(req, session.user.id) });
  const updated = await rpc("service_verify_server_claim", {
    p_claim_id: claim.id, p_user_id: session.user.id, p_discord_user_id: proof.discordUserId,
    p_guild_id: proof.guildId, p_community_url: server.community_url,
    p_is_owner: proof.isOwner, p_guild_name: proof.guildName, p_status: proof.status
  }, undefined, { useSecret: true });
  return updated;
}
export async function memberClaims(req, res, requestId) {
  if (req.method === "POST") assertSameOrigin(req);
  const session = await getSession(req, res, { required: req.method === "POST", ...(req.method === "POST" ? { provider: "discord" } : {}) });
  if (req.method === "GET") {
    const query = new URL(req.url, "https://browserp.local").searchParams;
    const server = await serverForClaim(query.get("serverId"));
    const claims = session?.provider === "discord" ? await rpc("member_server_claims", { p_server_id: server.id }, session.accessToken) : { items: [] };
    return { claims: claims.items || [], context: contextFor(server, session), csrfToken: session?.csrfToken || csrfTokenForRequest(req, res) };
  }
  await rateLimit(req, "server-claims", 10, 300);
  const body = await readBody(req, 8 * 1024);
  if (body.action === "request") {
    const server = await serverForClaim(body.serverId);
    const message = sanitizePlainText(body.message, 2000);
    if (message.length < 20) throw Object.assign(new Error("Explain your connection to this server in at least 20 characters."), { status: 400 });
    let evidenceUrl = null;
    if (body.evidenceUrl) {
      try { const url = new URL(body.evidenceUrl); if (url.protocol !== "https:" || url.username || url.password || url.href.length > 1000) throw new Error(); evidenceUrl = url.href; }
      catch { throw Object.assign(new Error("Use a valid HTTPS evidence link."), { status: 400 }); }
    }
    const claim = await rpc("member_server_claim", { p_server_id: server.id, p_message: message, p_evidence_url: evidenceUrl, p_request_id: requestId }, session.accessToken);
    const checked = await checkClaim(req, session, claim, server);
    return { claim: checked, verificationStatus: checked.verificationStatus, context: contextFor(server, session) };
  }
  if (body.action === "verify") {
    const id = recordId(body.claimId);
    const own = await rpc("member_server_claims", {}, session.accessToken);
    const claim = (own.items || []).find(item => item.id === id);
    if (!claim || claim.status !== "pending") throw Object.assign(new Error("This claim is not awaiting verification."), { status: 404 });
    const server = await serverForClaim(claim.serverId);
    const checked = await checkClaim(req, session, claim, server);
    return { claim: checked, verificationStatus: checked.verificationStatus, context: contextFor(server, session) };
  }
  throw Object.assign(new Error("Choose a valid claim action."), { status: 400 });
}
export async function staffClaims(req, res, requestId) {
  if (req.method === "POST") assertSameOrigin(req);
  const session = await getSession(req, res, { required: true, provider: "discord" });
  if (req.method === "GET") {
    const query = new URL(req.url, "https://browserp.local").searchParams;
    const workspace = await rpc("staff_server_claims", {
      p_status: (query.get("status") || "pending").slice(0, 30), p_verification: (query.get("verification") || "all").slice(0, 30),
      p_query: (query.get("q") || "").slice(0, 120), p_limit: 25, p_offset: Math.min(Math.max(Math.floor(Number(query.get("offset")) || 0), 0), 10000)
    }, session.accessToken);
    return { workspace: { ...workspace, canReview: true } };
  }
  await rateLimit(req, "staff-claims", 30, 300);
  const body = await readBody(req, 8 * 1024);
  if (!["approve", "deny"].includes(body.decision)) throw Object.assign(new Error("Choose approve or deny."), { status: 400 });
  const claim = await rpc("staff_decide_server_claim", { p_id: recordId(body.id), p_expected_version: expectedVersion(body.expectedVersion), p_decision: body.decision, p_reason: auditReason(body.reason), p_request_id: requestId }, session.accessToken);
  return { claim };
}
