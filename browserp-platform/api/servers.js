import { endpoint } from "../lib/api.js";
import { servers as fallbackServers } from "../lib/catalog.js";
import { developmentCatalogAllowed } from "../lib/config.js";
import { filterServers } from "../lib/directory.js";
import { publicJson } from "../lib/http.js";
import { rpc } from "../lib/supabase.js";

function safeText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

export default endpoint("GET", async (req, res) => {
  const url = new URL(req.url, "http://browserp.local");
  const filters = Object.fromEntries(url.searchParams.entries());
  const slug = safeText(filters.slug, 100).toLowerCase();
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
  return publicJson(res, { servers, total: servers.length }, slug ? 30 : 20);
});
