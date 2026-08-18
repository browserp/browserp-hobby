import { appUrl } from "../lib/config.js";
import { endpoint, ok } from "../lib/api.js";
import { categoriesFromServers, platforms as fallbackPlatforms, servers as fallbackServers } from "../lib/catalog.js";
import { redirect } from "../lib/http.js";
import {
  beginDiscordOAuth,
  finishDiscordOAuth,
  getSession,
  rest,
  rpc,
  signOut
} from "../lib/supabase.js";

const routes = {
  "auth/discord": endpoint("GET", async (req, res) => redirect(res, beginDiscordOAuth(req, res))),

  "auth/callback": endpoint("GET", async (req, res) => {
    try {
      const returnTo = await finishDiscordOAuth(req, res);
      return redirect(res, `${appUrl(req)}${returnTo}`);
    } catch {
      return redirect(res, `${appUrl(req)}/?auth=failed`);
    }
  }),

  "auth/session": endpoint("GET", async (req, res) => {
    const session = await getSession(req, res);
    if (!session) return ok(res, { authenticated: false, user: null });
    let profile = null;
    try {
      profile = (await rest(`profiles?select=id,username,display_name,avatar_url,bio,joined_at,profile_visibility&id=eq.${encodeURIComponent(session.user.id)}&limit=1`, { accessToken: session.accessToken }))?.[0] || null;
    } catch { /* Auth identity still works while profile provisioning catches up. */ }
    return ok(res, {
      authenticated: true,
      user: { id: session.user.id, email: session.user.email || null, profile }
    });
  }),

  "auth/logout": endpoint("POST", async (req, res) => {
    await signOut(req, res);
    return ok(res, { signedOut: true });
  }),

  "me/overview": endpoint("GET", async (req, res) => {
    const session = await getSession(req, res, { required: true });
    return ok(res, { overview: await rpc("member_dashboard_overview", {}, session.accessToken) });
  }),

  "admin/overview": endpoint("GET", async (req, res) => {
    const session = await getSession(req, res, { required: true });
    return ok(res, { overview: await rpc("staff_dashboard_overview", {}, session.accessToken) });
  }),

  platforms: endpoint("GET", async (_req, res) => {
    let platforms;
    try {
      platforms = await rest("platforms?select=id,name,short_name,accent&enabled=eq.true&order=sort_order.asc");
    } catch (error) {
      if (error.code !== "BACKEND_NOT_CONFIGURED" && error.status !== 404) console.warn("Platform fallback:", error.message);
      platforms = fallbackPlatforms;
    }
    return ok(res, { platforms });
  }),

  categories: endpoint("GET", async (_req, res) => {
    let categories;
    try {
      categories = await rest("category_directory?select=name,count&order=count.desc&limit=30");
    } catch (error) {
      if (error.code !== "BACKEND_NOT_CONFIGURED" && error.status !== 404) console.warn("Category fallback:", error.message);
      categories = categoriesFromServers();
    }
    return ok(res, { categories });
  }),

  "public/overview": endpoint("GET", async (_req, res) => {
    let overview;
    try {
      overview = await rpc("public_overview", {});
    } catch (error) {
      if (error.code !== "BACKEND_NOT_CONFIGURED" && error.status !== 404) console.warn("Overview fallback:", error.message);
      overview = {
        servers: fallbackServers.length,
        online: fallbackServers.filter((server) => server.online).length,
        verified: fallbackServers.filter((server) => server.verified).length,
        players: fallbackServers.reduce((sum, server) => sum + server.players, 0),
        pendingReviews: 0,
        boostsToday: 0,
        toolRunsToday: 0,
        moderationHealth: "Operational"
      };
    }
    return ok(res, { overview });
  })
};

export default async function router(req, res) {
  const requestUrl = new URL(req.url || "/api/router", appUrl(req));
  const route = req.browserpRoute || requestUrl.searchParams.get("_route") || "";
  const handler = routes[route];
  if (!handler) return ok(res, { error: "API route not found." }, 404);
  return handler(req, res);
}
