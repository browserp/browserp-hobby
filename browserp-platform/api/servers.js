import { endpoint, ok } from "../lib/api.js";
import { servers as fallbackServers } from "../lib/catalog.js";
import { filterServers } from "../lib/directory.js";
import { rpc } from "../lib/supabase.js";

export default endpoint("GET", async (req, res) => {
  const url = new URL(req.url, "http://browserp.local");
  const filters = Object.fromEntries(url.searchParams.entries());
  let servers;
  try {
    servers = await rpc("search_server_directory", {
      p_query: String(filters.query || "").slice(0, 120),
      p_platform: String(filters.platform || "all").slice(0, 40),
      p_region: String(filters.region || "all").slice(0, 60),
      p_online: filters.online === "true",
      p_verified: filters.verified === "true",
      p_beginner: filters.beginner === "true",
      p_sort: String(filters.sort || "recommended").slice(0, 30),
      p_limit: Math.min(Number(filters.limit) || 30, 100)
    });
  } catch (error) {
    if (error.code !== "BACKEND_NOT_CONFIGURED" && error.status !== 404) console.warn("Directory fallback:", error.message);
    servers = filterServers(fallbackServers, filters);
  }
  return ok(res, { servers, total: servers.length });
});
