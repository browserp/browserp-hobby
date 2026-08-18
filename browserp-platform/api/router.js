import { appUrl } from "../lib/config.js";
import { endpoint, ok } from "../lib/api.js";
import { categoriesFromServers, platforms as fallbackPlatforms, servers as fallbackServers } from "../lib/catalog.js";
import { parseCookies, publicJson, readBody, redirect, safeReturnPath } from "../lib/http.js";
import { sanitizePlainText } from "../lib/moderation.js";
import { rateLimit } from "../lib/rate-limit.js";
import {
  authCapabilities,
  beginDiscordOAuth,
  finishDiscordOAuth,
  getSession,
  rest,
  rpc,
  signOut
} from "../lib/supabase.js";

function assertSameOrigin(req) {
  const requestOrigin = String(req.headers?.origin || "");
  if (requestOrigin && requestOrigin !== new URL(appUrl(req)).origin) {
    throw Object.assign(new Error("Cross-origin account actions are not allowed."), { status: 403 });
  }
}

const routes = {
  "auth/discord": endpoint("GET", async (req, res) => {
    const requestUrl = new URL(req.url || "/api/auth/discord", appUrl(req));
    const returnTo = safeReturnPath(requestUrl.searchParams.get("returnTo"), "/dashboard");
    const authFailure = (state) => {
      const destination = new URL(returnTo, appUrl(req));
      destination.searchParams.set("auth", state);
      return redirect(res, destination.toString());
    };
    let capabilities;
    try {
      capabilities = await authCapabilities();
    } catch (error) {
      if (error.code === "BACKEND_NOT_CONFIGURED") return authFailure("backend-not-configured");
      throw error;
    }
    if (!capabilities.discord) {
      return authFailure("discord-not-configured");
    }
    return redirect(res, beginDiscordOAuth(req, res));
  }),

  "auth/callback": endpoint("GET", async (req, res) => {
    try {
      const returnTo = await finishDiscordOAuth(req, res);
      return redirect(res, `${appUrl(req)}${returnTo}`);
    } catch {
      const returnTo = safeReturnPath(parseCookies(req).brp_auth_return, "/dashboard");
      const destination = new URL(returnTo, appUrl(req));
      destination.searchParams.set("auth", "failed");
      return redirect(res, destination.toString());
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

  "me/favorites": endpoint(["GET", "POST"], async (req, res) => {
    const session = await getSession(req, res, { required: true });
    if (req.method === "GET") {
      return ok(res, { serverIds: await rpc("member_favorite_ids", {}, session.accessToken) });
    }
    assertSameOrigin(req);
    await rateLimit(req, "favorite-toggle", 40, 300, session.accessToken);
    const body = await readBody(req, 8 * 1024);
    const serverId = sanitizePlainText(body.serverId, 40);
    if (!/^[0-9a-f-]{36}$/i.test(serverId)) {
      throw Object.assign(new Error("Choose a valid server."), { status: 400 });
    }
    return ok(res, { result: await rpc("toggle_favorite", { p_server_id: serverId }, session.accessToken) });
  }),

  "me/notifications/read": endpoint("POST", async (req, res) => {
    assertSameOrigin(req);
    const session = await getSession(req, res, { required: true });
    await rateLimit(req, "notification-read", 10, 300, session.accessToken);
    return ok(res, { markedRead: await rpc("mark_notifications_read", {}, session.accessToken) });
  }),

  "admin/overview": endpoint("GET", async (req, res) => {
    const session = await getSession(req, res, { required: true });
    return ok(res, { overview: await rpc("staff_dashboard_overview", {}, session.accessToken) });
  }),

  "admin/action": endpoint("POST", async (req, res, id) => {
    assertSameOrigin(req);
    const session = await getSession(req, res, { required: true });
    await rateLimit(req, "staff-action", 40, 300, session.accessToken);
    const body = await readBody(req, 16 * 1024);
    const kind = sanitizePlainText(body.kind, 20);
    const itemId = sanitizePlainText(body.id, 80);
    const action = sanitizePlainText(body.action, 40);
    const reason = sanitizePlainText(body.reason, 1_000);
    if (!kind || !itemId || !action || reason.length < 5) {
      throw Object.assign(new Error("A queue item, action and reason of at least five characters are required."), { status: 400 });
    }
    const result = await rpc("staff_resolve_queue_item", {
      p_kind: kind,
      p_item_id: itemId,
      p_action: action,
      p_reason: reason,
      p_request_id: id
    }, session.accessToken);
    return ok(res, { result });
  }),

  platforms: endpoint("GET", async (_req, res) => {
    let platforms;
    try {
      platforms = await rest("platforms?select=id,name,short_name,accent&enabled=eq.true&order=sort_order.asc");
    } catch (error) {
      if (error.code !== "BACKEND_NOT_CONFIGURED" && error.status !== 404) console.warn("Platform fallback:", error.message);
      platforms = fallbackPlatforms;
    }
    return publicJson(res, { platforms }, 300);
  }),

  categories: endpoint("GET", async (_req, res) => {
    let categories;
    try {
      categories = await rest("category_directory?select=name,count&order=count.desc&limit=30");
    } catch (error) {
      if (error.code !== "BACKEND_NOT_CONFIGURED" && error.status !== 404) console.warn("Category fallback:", error.message);
      categories = categoriesFromServers();
    }
    return publicJson(res, { categories }, 60);
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
    return publicJson(res, { overview }, 30);
  })
};

export default async function router(req, res) {
  const requestUrl = new URL(req.url || "/api/router", appUrl(req));
  const route = req.browserpRoute || requestUrl.searchParams.get("_route") || "";
  const handler = routes[route];
  if (!handler) return ok(res, { error: "API route not found." }, 404);
  return handler(req, res);
}
