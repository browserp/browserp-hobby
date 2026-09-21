import { enrichRobloxApplications } from "../lib/roblox-listings.js";
import { enrichMinecraftServers, refreshDueMinecraftServers } from "../lib/minecraft-workflow.js";
import { endpoint, ok } from "../lib/api.js";
import { contentWritePaused } from "../lib/content-write-gate.js";
import { servers as fallbackServers } from "../lib/catalog.js";
import { developmentCatalogAllowed } from "../lib/config.js";
import { enrichImportedServers, refreshDueFiveMServers } from "../lib/fivem-workflow.js";
import { discoverServers } from "../lib/discovery.js";
import { filterServers } from "../lib/directory.js";
import { assertSameOrigin, json, publicJson, readBody } from "../lib/http.js";
import { assessContent, sanitizePlainText } from "../lib/moderation.js";
import { processContentCheck } from "../lib/content-moderation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { getSession, rpc } from "../lib/supabase.js";
import { readPlayerHistory } from "../lib/player-history.js";
import { readSimilarCommunities, selectSimilarCommunities } from "../lib/similar-communities.js";

function safeText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function activeFeaturedBoost(value) {
  const expiry = Date.parse(value?.expiresAt || "");
  return value && typeof value.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)
    && Number.isFinite(expiry) && expiry > Date.now();
}

export async function refreshDuePublicSources(sources = [
  { name: "fivem", refresh: refreshDueFiveMServers },
  { name: "minecraft", refresh: refreshDueMinecraftServers }
], warn = console.warn) {
  const outcomes = await Promise.allSettled(sources.map(({ refresh }) => Promise.resolve().then(refresh)));
  const failedSources = outcomes.flatMap((outcome, index) => outcome.status === "rejected" ? [sources[index].name] : []);
  if (failedSources.length) {
    warn(JSON.stringify({ event: "directory.source_refresh_failed", sources: failedSources }));
  }
  return { outcomes, failedSources };
}

export default endpoint(["GET", "POST"], async (req, res) => {
  const url = new URL(req.url, "http://browserp.local");
  if (req.method === "GET" && url.searchParams.has("history")) {
    return publicJson(res, await readPlayerHistory(req, url.searchParams), 60);
  }
  if (req.method === "GET" && url.searchParams.has("similar")) {
    const similarSlug = safeText(url.searchParams.get("similar"), 100).toLowerCase();
    let similar;
    try { similar = await readSimilarCommunities(similarSlug); }
    catch (error) {
      if (!developmentCatalogAllowed() || error.status === 400) throw error;
      const candidates = filterServers(fallbackServers, { limit: 60 });
      similar = selectSimilarCommunities(candidates.find(server => server.slug === similarSlug), candidates);
    }
    similar = await enrichRobloxApplications(await enrichMinecraftServers(await enrichImportedServers(similar, { refresh: false }), { refresh: false }));
    return publicJson(res, { servers: similar }, 60);
  }
  const filters = Object.fromEntries(url.searchParams.entries());
  const slug = safeText(filters.slug, 100).toLowerCase();
  if (req.method === "POST") {
    assertSameOrigin(req);
    const body = await readBody(req, 8 * 1024);
    const action = safeText(body.action, 20).toLowerCase();
    if (action === "comment" && contentWritePaused(res)) return;
    const session = await getSession(req, res, { required: true });
    await rateLimit(req, "server-interaction", 20, 300);
    const serverId = safeText(body.serverId, 40).toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(serverId) || !["vote", "unvote", "comment", "report"].includes(action)) {
      throw Object.assign(new Error("Choose a valid server action."), { status: 400 });
    }
    const hasParent = body.parentCommentId != null;
    if (hasParent && (action !== "comment" || typeof body.parentCommentId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.parentCommentId))) {
      throw Object.assign(new Error("Choose a published comment to reply to."), { status: 400 });
    }
    const text = sanitizePlainText(body.body, action === "report" ? 2000 : 1000);
    if (action === "report") {
      const moderation = assessContent({ body: text });
      if (moderation.action === "reject") throw Object.assign(new Error("This content cannot be submitted."), { status: 422 });
    }
    const result = hasParent ? await rpc("member_server_comment_reply", {
      p_server_id: serverId,
      p_parent_comment_id: body.parentCommentId.toLowerCase(),
      p_body: text || null
    }, session.accessToken) : await rpc("member_server_interaction", {
      p_server_id: serverId,
      p_action: action,
      p_body: text || null,
      p_category: action === "report" ? sanitizePlainText(body.category, 80) : null
    }, session.accessToken);
    let moderation = null;
    if (action === "comment") {
      const item = await rpc("member_content_moderation_item", { p_target: result.id, p_kind: "comment" }, session.accessToken);
      moderation = await processContentCheck(session, item.id);
      result.status = moderation.status === "blocked" ? "rejected" : moderation.status;
    }
    return ok(res, { result, ...(moderation ? { moderation } : {}) }, 201);
  }
  // Refresh failures must not take the public directory down. The stored
  // listing and status data remains valid while the next refresh retries.
  if (!slug) await refreshDuePublicSources();
  if (filters.discover === "true" && !slug) {
    const result = await discoverServers(filters);
    result.servers = await enrichRobloxApplications(await enrichMinecraftServers(await enrichImportedServers(result.servers)));
    return publicJson(res, result, 20);
  }
  let servers;
  try {
    servers = await rpc("search_server_directory", {
      p_slug: slug || null,
      p_query: safeText(filters.query, 120),
      p_platform: safeText(filters.platform || "all", 40),
      p_region: safeText(filters.region || "all", 60),
      p_online: filters.online === "true",
      p_verified: filters.verified === "true",
      p_beginner: filters.beginner === "true",
      p_sort: safeText(filters.sort || "recommended", 30),
      p_limit: Math.min(Math.max(Number(filters.limit) || 30, 1), 100)
    });
  } catch (error) {
    if (!developmentCatalogAllowed()) throw error;
    servers = filterServers(fallbackServers, { ...filters, slug });
  }
  if (!Array.isArray(servers)) servers = [];
  if (slug) servers = servers.filter((server) => String(server.slug || "").toLowerCase() === slug).slice(0, 1);
  let featuredBoost = null, boostedCandidate = null;
  if (!slug && filters.featured === "true") {
    try {
      featuredBoost = await rpc("public_featured_boost", {});
      if (activeFeaturedBoost(featuredBoost)) {
        const boosted = await rpc("search_server_directory", {
          p_slug: featuredBoost.slug, p_query: "", p_platform: "all", p_region: "all",
          p_online: false, p_verified: false, p_beginner: false, p_sort: "recommended", p_limit: 1
        });
        const first = Array.isArray(boosted) ? boosted.find((item) => item.slug === featuredBoost.slug) : null;
        const constrained = Boolean(filters.query || (filters.platform && filters.platform !== "all") || (filters.region && filters.region !== "all") || filters.online === "true" || filters.verified === "true" || filters.beginner === "true");
        if (first && (!constrained || servers.some((item) => item.id === first.id))) boostedCandidate = first;
      }
    } catch { featuredBoost = null; }
  }
  servers = await enrichMinecraftServers(await enrichImportedServers(servers, { refresh: Boolean(slug) }), { refresh: Boolean(slug) });
  servers = await enrichRobloxApplications(servers);
  // Resolve and enrich the promoted listing separately, then check the expiry
  // again immediately before sending. A slow request cannot extend a staff slot.
  if (boostedCandidate && activeFeaturedBoost(featuredBoost)) {
    try {
      const [enriched] = await enrichRobloxApplications(await enrichMinecraftServers(await enrichImportedServers([boostedCandidate], { refresh: false }), { refresh: false }));
      if (enriched?.id === boostedCandidate.id && activeFeaturedBoost(featuredBoost)) {
        servers = [enriched, ...servers.filter((item) => item.id !== enriched.id)].slice(0, Math.min(Math.max(Number(filters.limit) || 4, 1), 100));
      } else featuredBoost = null;
    } catch { featuredBoost = null; }
  } else featuredBoost = null;
  let engagement = null;
  if (slug && servers.length) {
    try { engagement = await rpc("public_server_engagement", { p_slug: slug }); }
    catch (error) { if (!developmentCatalogAllowed()) throw error; }
  }
  const payload = { servers, total: servers.length, engagement, featuredBoost };
  // A featured response can be revoked at any moment; CDN stale serving would
  // keep an expired or withdrawn promotion visible after its database removal.
  return filters.featured === "true" && !slug ? json(res, 200, payload) : publicJson(res, payload, slug ? 30 : 20);
});
