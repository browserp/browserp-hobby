import { endpoint, ok } from "../lib/api.js";
import { appUrl, developmentCatalogAllowed } from "../lib/config.js";
import { categoriesFromServers, platforms as fallbackPlatforms, servers as fallbackServers } from "../lib/catalog.js";
import { assertSameOrigin, parseCookies, publicJson, readBody, redirect, safeReturnPath } from "../lib/http.js";
import { sanitizePlainText } from "../lib/moderation.js";
import { rateLimit } from "../lib/rate-limit.js";
import {
  authCapabilities,
  beginOAuth,
  finishOAuth,
  getSession,
  rest,
  rpc,
  signOut
} from "../lib/supabase.js";

function authFailure(req, res, provider, returnTo, state) {
  const destination = new URL(returnTo, appUrl(req));
  destination.searchParams.set("auth", state || `${provider}-not-configured`);
  return redirect(res, destination.toString());
}

function providerRoute(provider) {
  return endpoint("GET", async (req, res) => {
    const requestUrl = new URL(req.url || `/api/auth/${provider}`, appUrl(req));
    const returnTo = safeReturnPath(requestUrl.searchParams.get("returnTo"), "/dashboard");
    let capabilities;
    try {
      capabilities = await authCapabilities();
    } catch (error) {
      if (error.code === "BACKEND_NOT_CONFIGURED") return authFailure(req, res, provider, returnTo, "backend-not-configured");
      throw error;
    }
    if (!capabilities[provider]) return authFailure(req, res, provider, returnTo);
    return redirect(res, beginOAuth(req, res, provider));
  });
}

const routes = {
  "auth/providers": endpoint("GET", async (_req, res) => {
    try {
      return ok(res, { configured: true, providers: await authCapabilities() });
    } catch (error) {
      if (error.code === "BACKEND_NOT_CONFIGURED") {
        return ok(res, { configured: false, providers: { discord: false, google: false } });
      }
      throw error;
    }
  }),

  "auth/discord": providerRoute("discord"),
  "auth/google": providerRoute("google"),

  "auth/callback": endpoint("GET", async (req, res) => {
    try {
      const { returnTo } = await finishOAuth(req, res);
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
    } catch { /* Auth identity remains usable while profile provisioning catches up. */ }
    return ok(res, {
      authenticated: true,
      provider: session.provider,
      user: { id: session.user.id, email: session.user.email || null, profile }
    });
  }),

  "auth/logout": endpoint("POST", async (req, res) => {
    assertSameOrigin(req);
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
    await rateLimit(req, "favorite-toggle", 40, 300);
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
    await rateLimit(req, "notification-read", 10, 300);
    return ok(res, { markedRead: await rpc("mark_notifications_read", {}, session.accessToken) });
  }),

  "admin/overview": endpoint("GET", async (req, res) => {
    const session = await getSession(req, res, { required: true, provider: "discord" });
    return ok(res, { overview: await rpc("staff_dashboard_overview", {}, session.accessToken) });
  }),

  "admin/item": endpoint("GET", async (req, res) => {
    const session = await getSession(req, res, { required: true, provider: "discord" });
    const requestUrl = new URL(req.url || "/api/admin/item", appUrl(req));
    const kind = sanitizePlainText(requestUrl.searchParams.get("kind"), 20);
    const itemId = sanitizePlainText(requestUrl.searchParams.get("id"), 80);
    if (!kind || !itemId) throw Object.assign(new Error("Choose a queue item."), { status: 400 });
    const item = await rpc("staff_review_item", { p_kind: kind, p_item_id: itemId }, session.accessToken);
    if (!item) throw Object.assign(new Error("Queue item was not found or is no longer visible."), { status: 404 });
    return ok(res, { item });
  }),

  "admin/action": endpoint("POST", async (req, res, id) => {
    assertSameOrigin(req);
    const session = await getSession(req, res, { required: true, provider: "discord" });
    await rateLimit(req, "staff-action", 40, 300);
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
    try {
      const platforms = await rest("platforms?select=id,name,short_name,accent&enabled=eq.true&order=sort_order.asc");
      return publicJson(res, { platforms: Array.isArray(platforms) ? platforms : [] }, 300);
    } catch (error) {
      if (!developmentCatalogAllowed()) throw error;
      return publicJson(res, { platforms: fallbackPlatforms }, 300);
    }
  }),

  categories: endpoint("GET", async (_req, res) => {
    try {
      const categories = await rest("category_directory?select=name,count&order=count.desc&limit=30");
      return publicJson(res, { categories: Array.isArray(categories) ? categories : [] }, 60);
    } catch (error) {
      if (!developmentCatalogAllowed()) throw error;
      return publicJson(res, { categories: categoriesFromServers() }, 60);
    }
  }),

  "public/overview": endpoint("GET", async (_req, res) => {
    try {
      return publicJson(res, { overview: await rpc("public_overview", {}) }, 30);
    } catch (error) {
      if (!developmentCatalogAllowed()) throw error;
      return publicJson(res, {
        overview: {
          servers: fallbackServers.length,
          online: fallbackServers.filter((server) => server.online).length,
          verified: fallbackServers.filter((server) => server.verified).length,
          players: fallbackServers.reduce((sum, server) => sum + server.players, 0),
          pendingReviews: 0,
          boostsToday: 0,
          toolRunsToday: 0,
          moderationHealth: "Development catalog"
        }
      }, 30);
    }
  })
};

export default async function router(req, res) {
  const requestUrl = new URL(req.url || "/api/router", appUrl(req));
  const route = req.browserpRoute || requestUrl.searchParams.get("_route") || "";
  const handler = routes[route];
  if (!handler) return ok(res, { error: "API route not found." }, 404);
  return handler(req, res);
}
