import { endpoint, ok } from "../lib/api.js";
import { servers as fallbackServers } from "../lib/catalog.js";
import { developmentCatalogAllowed } from "../lib/config.js";
import { discoverServers } from "../lib/discovery.js";
import { filterServers } from "../lib/directory.js";
import { assertSameOrigin, publicJson, readBody } from "../lib/http.js";
import { assessContent, sanitizePlainText } from "../lib/moderation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { getSession, rpc } from "../lib/supabase.js";

function safeText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

export default endpoint(["GET", "POST"], async (req, res) => {
  const url = new URL(req.url, "http://browserp.local");
  const filters = Object.fromEntries(url.searchParams.entries());
  const slug = safeText(filters.slug, 100).toLowerCase();
  if (req.method === "POST") {
    assertSameOrigin(req);
    const session = await getSession(req, res, { required: true });
    await rateLimit(req, "server-interaction", 20, 300);
    const body = await readBody(req, 8 * 1024);
    const action = safeText(body.action, 20).toLowerCase();
    const serverId = safeText(body.serverId, 40).toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(serverId) || !["vote", "unvote", "comment", "report"].includes(action)) {
      throw Object.assign(new Error("Choose a valid server action."), { status: 400 });
    }
    const text = sanitizePlainText(body.body, action === "report" ? 2000 : 1000);
    if (["comment", "report"].includes(action)) {
      const moderation = assessContent({ body: text });
      if (moderation.action === "reject") throw Object.assign(new Error("This content cannot be submitted."), { status: 422 });
    }
    const result = await rpc("member_server_interaction", {
      p_server_id: serverId,
      p_action: action,
      p_body: text || null,
      p_category: action === "report" ? sanitizePlainText(body.category, 80) : null
    }, session.accessToken);
    return ok(res, { result }, 201);
  }
  if (filters.discover === "true" && !slug) return publicJson(res, await discoverServers(filters), 20);
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
  let engagement = null;
  if (slug && servers.length) {
    try { engagement = await rpc("public_server_engagement", { p_slug: slug }); }
    catch (error) { if (!developmentCatalogAllowed()) throw error; }
  }
  return publicJson(res, { servers, total: servers.length, engagement }, slug ? 30 : 20);
});
