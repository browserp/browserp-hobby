import { getSession, rpc } from "./supabase.js";
import { fetchFiveMServer, fetchFiveMFeatured, parseFiveMJoinCode } from "./fivem-import.js";
import { persistServerImage } from "./server-media.js";
import { validatePublicDiscordInvite } from "./discord-claims.js";
import { assertSameOrigin, readBody } from "./http.js";
import { rateLimit } from "./rate-limit.js";
import { assessContent } from "./moderation.js";
import { supabaseConfig } from "./config.js";
import { auditReason, expectedVersion, recordId } from "./claim-workflow.js";

export function candidateForStorage(source) {
  return {
    joinCode: source.joinCode, name: source.name, description: source.description,
    region: source.region, language: source.language, framework: source.framework,
    accessType: source.access, discordUrl: source.links.communityUrl,
    websiteUrl: source.links.websiteUrl, joinUrl: source.links.cfxJoinUrl,
    tags: source.tags, keywords: source.keywords,
    bannerUrl: source.images.bannerUrl, logoUrl: source.images.logoUrl,
    players: source.players.online, capacity: source.players.max,
    online: source.players.status === "online" ? true : source.players.status === "offline" ? false : null,
    checkedAt: source.players.observedAt, warnings: source.issues,
    evidence: source.evidence, sourceUrl: source.source.url
  };
}
export async function checkCandidateDiscordInvite(source) {
  if (!source.links.communityUrl) return source;
  const check = await validatePublicDiscordInvite(source.links.communityUrl);
  if (check.status === "valid") return {
    ...source,
    evidence: [...source.evidence, { field: "links.communityGuildName", source: "Discord public invite API", value: check.guildName, confidence: "high" }].slice(-80)
  };
  return {
    ...source,
    links: { ...source.links, ...(check.status === "invalid" ? { communityUrl: null } : {}) },
    issues: [...source.issues, {
      code: check.status === "invalid" ? "invalid_discord_invite" : "unverified_discord_invite",
      field: "links.communityUrl", severity: "warning",
      message: check.status === "invalid"
        ? "Discord says this invite is invalid or no longer available. It was removed; add a working server invite during review."
        : "Discord could not check this invite right now. Confirm it during review before publishing."
    }].slice(-80)
  };
}

const EDIT_FIELDS = ["name", "description", "region", "language", "framework", "accessType", "discordUrl", "websiteUrl", "bannerUrl", "logoUrl", "tags", "keywords"];
export async function staffFiveM(req, res, requestId) {
  if (req.method === "POST") assertSameOrigin(req);
  const session = await getSession(req, res, { required: true, provider: "discord" });
  const query = new URL(req.url, "https://browserp.local").searchParams;
  const workspace = await rpc("staff_fivem_candidates", {
    p_status: req.method === "GET" ? (query.get("status") || "all").slice(0, 30) : "all",
    p_query: req.method === "GET" ? (query.get("q") || "").slice(0, 120) : "",
    p_limit: req.method === "GET" ? 25 : 1,
    p_offset: req.method === "GET" ? Math.min(Math.max(Math.floor(Number(query.get("offset")) || 0), 0), 10000) : 0
  }, session.accessToken);
  if (req.method === "GET") return { workspace: { ...workspace, canManage: true } };
  await rateLimit(req, "staff-fivem", 30, 300);
  const body = await readBody(req, 48 * 1024);
  if (body.action === "featured") return fetchFiveMFeatured({ limit: 20 });
  if (body.action === "fetch") {
    if (!Array.isArray(body.inputs) || !body.inputs.length || body.inputs.length > 3) throw Object.assign(new Error("Fetch up to three FiveM codes per request."), { status: 400 });
    const codes = [...new Set(body.inputs.map(parseFiveMJoinCode))];
    const results = await Promise.allSettled(codes.map(async (code) => {
      const source = await checkCandidateDiscordInvite(await fetchFiveMServer(code));
      return rpc("service_stage_fivem_candidate", { p_actor_id: session.user.id, p_candidate: candidateForStorage(source), p_request_id: `${requestId}:${code}` }, undefined, { useSecret: true });
    }));
    return { candidates: results.filter(r => r.status === "fulfilled").map(r => r.value), errors: results.flatMap((r, index) => r.status === "rejected" ? [{ joinCode: codes[index], message: r.reason?.message || "The server could not be fetched." }] : []) };
  }
  const id = recordId(body.id); const reason = auditReason(body.reason);
  if (body.action === "archive") return { result: await rpc("staff_dismiss_fivem_candidate", { p_id: id, p_expected_version: expectedVersion(body.expectedVersion), p_reason: reason, p_request_id: requestId }, session.accessToken) };
  const entry = await rpc("staff_fivem_candidate", { p_id: id }, session.accessToken);
  if (!entry) throw Object.assign(new Error("This import candidate is unavailable."), { status: 404 });
  if (body.action === "refresh") {
    if (!entry.serverId) throw Object.assign(new Error("Publish this candidate before refreshing its live count."), { status: 400 });
    const result = await refreshFiveMCode(entry.joinCode, { strict: true });
    return { result, message: result ? "The current FiveM observation was checked." : "This server was checked recently. Try again in one minute." };
  }
  if (body.action !== "publish") throw Object.assign(new Error("Choose a valid scraper action."), { status: 400 });
  const version = expectedVersion(body.expectedVersion);
  if (Number(entry.version) !== version) throw Object.assign(new Error("This candidate changed. Refresh before publishing."), { status: 409 });
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) throw Object.assign(new Error("Review the server details before publishing."), { status: 400 });
  const data = Object.fromEntries(EDIT_FIELDS.filter(key => Object.hasOwn(body.data, key)).map(key => [key, body.data[key]]));
  const merged = { ...entry.candidate, ...data };
  if (!Array.isArray(merged.tags) || merged.tags.some(tag => typeof tag !== "string")) throw Object.assign(new Error("Tags must be a list of short text labels."), { status: 400 });
  const assessment = assessContent({ name: merged.name, description: merged.description, tags: (merged.tags || []).join(", "), communityUrl: merged.discordUrl, websiteUrl: merged.websiteUrl });
  if (assessment.action === "reject") throw Object.assign(new Error("The reviewed listing does not meet the content standards."), { status: 422 });
  [data.bannerUrl, data.logoUrl] = await Promise.all([persistServerImage(merged.bannerUrl, entry.joinCode), persistServerImage(merged.logoUrl, entry.joinCode)]);
  const result = await rpc("staff_publish_fivem_candidate", { p_id: id, p_expected_version: version, p_data: data, p_reason: reason, p_request_id: requestId }, session.accessToken);
  return { result };
}
export async function refreshFiveMCode(joinCode, { strict = false } = {}) {
  const code = parseFiveMJoinCode(joinCode);
  const lease = await rpc("service_claim_fivem_refresh", { p_join_code: code }, undefined, { useSecret: true });
  if (!lease) return null;
  try {
    const source = await fetchFiveMServer(code);
    if (source.players.status !== "online" || source.players.online === null || source.players.max === null || !source.players.observedAt) throw new Error("FiveM has no current player observation for this server.");
    const [logoUrl, bannerUrl] = await Promise.all([
      source.images.logoUrl ? persistServerImage(source.images.logoUrl, code).catch(() => null) : null,
      source.images.bannerUrl ? persistServerImage(source.images.bannerUrl, code).catch(() => null) : null
    ]);
    return await rpc("service_refresh_fivem_source", {
      p_join_code: code,
      p_online: true,
      p_players: source.players.online,
      p_capacity: source.players.max,
      p_observed_at: source.players.observedAt,
      p_logo_url: logoUrl,
      p_banner_url: bannerUrl
    }, undefined, { useSecret: true });
  } catch (error) {
    await rpc("service_mark_fivem_unavailable", { p_join_code: code }, undefined, { useSecret: true });
    if (strict) throw error;
    return { online: false, players: null, capacity: null, unavailable: true };
  }
}
export async function refreshDueFiveMServers() {
  if (!supabaseConfig().privileged) return [];
  let due;
  try { due = await rpc("service_fivem_sources", { p_server_id: null, p_due_only: true, p_limit: 3 }, undefined, { useSecret: true }); }
  catch (error) { if (error.code === "PGRST202") return []; throw error; }
  const results = await Promise.allSettled((Array.isArray(due) ? due : []).slice(0, 3).map(item => refreshFiveMCode(item.joinCode)));
  return results.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
}

export async function enrichImportedServers(servers, { refresh = false } = {}) {
  const ids = servers.filter(s => /^[0-9a-f-]{36}$/i.test(s.id || "")).map(s => s.id).slice(0, 100);
  if (!ids.length) return servers;
  let details;
  try { details = await rpc("public_server_import_details", { p_server_ids: ids }); }
  catch (error) { if (error.code === "PGRST202") return servers; throw error; }
  const byId = new Map((details || []).map(item => [item.serverId, item]));
  const refreshed = new Map();
  if (refresh && supabaseConfig().privileged) {
    const due = (details || []).filter(item => item.imported && (!item.lastCheckedAt || Date.now() - Date.parse(item.lastCheckedAt) >= 60_000)).slice(0, 3);
    await Promise.allSettled(due.map(async item => { const result = await refreshFiveMCode(item.joinCode); if (result) refreshed.set(item.serverId, result); }));
  }
  return servers.map(server => {
    const info = byId.get(server.id); if (!info) return server;
    const live = refreshed.get(server.id);
    const checkedAt = live?.checkedAt || info.lastCheckedAt;
    const fresh = info.imported && checkedAt && Date.now() - Date.parse(checkedAt) <= 5 * 60_000 && (live ? !live.unavailable : !info.statusUnavailable);
    return {
      ...server, imported: info.imported, claimable: info.claimable, keywords: info.keywords || [], website_url: info.websiteUrl ?? server.website_url ?? null,
      ...(info.imported ? { logo_url: live?.logoUrl ?? info.logoUrl, banner_url: live?.bannerUrl ?? info.bannerUrl, checked_at: checkedAt,
        online: fresh ? (live?.online ?? server.online) : false,
        players: fresh ? (live?.players ?? server.players) : null,
        capacity: fresh ? (live?.capacity ?? server.capacity) : null } : {})
    };
  });
}
