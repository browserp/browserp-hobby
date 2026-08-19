import { endpoint, ok } from "../lib/api.js";
import { appUrl, developmentCatalogAllowed, supabaseConfig } from "../lib/config.js";
import { categoriesFromServers, platforms as fallbackPlatforms, servers as fallbackServers } from "../lib/catalog.js";
import { assertSameOrigin, cookieValue, parseCookies, publicJson, readBody, redirect, safeReturnPath } from "../lib/http.js";
import { sanitizePlainText } from "../lib/moderation.js";
import { rateLimit } from "../lib/rate-limit.js";
import {
  authCapabilities,
  beginOAuth,
  csrfTokenForRequest,
  finishOAuth,
  getSession,
  rest,
  rpc,
  signOut
} from "../lib/supabase.js";

const PUBLIC_OVERVIEW_FIELDS = ["servers", "online", "verified", "players"];

function publicOverviewFields(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(PUBLIC_OVERVIEW_FIELDS.map((key) => {
    const number = Number(source[key]);
    return [key, Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0];
  }));
}

function safeServerRead() {
  return supabaseConfig().privileged ? { useSecret: true } : {};
}

function contentMutation(body) {
  const key = String(body.key || "").trim().toLowerCase();
  const action = String(body.action || "").trim().toLowerCase();
  const reason = sanitizePlainText(body.reason, 500);
  const expectedVersion = Number(body.expectedVersion);
  if (!/^[a-z][a-z0-9_.-]{2,79}$/.test(key)) {
    throw Object.assign(new Error("Choose a valid content field."), { status: 400 });
  }
  if (!["save_draft", "publish", "rollback"].includes(action)) {
    throw Object.assign(new Error("Choose a valid content action."), { status: 400 });
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw Object.assign(new Error("Reload the content editor before saving."), { status: 409 });
  }
  if (reason.length < 5) {
    throw Object.assign(new Error("Add a short reason for this content change."), { status: 400 });
  }

  let value = body.value;
  if (value !== undefined && typeof value !== "string" && typeof value !== "boolean") {
    throw Object.assign(new Error("Content values must be plain text or a true/false setting."), { status: 400 });
  }
  if (typeof value === "string") {
    value = value.trim();
    if (!value || value.length > 4_000 || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      throw Object.assign(new Error("Content must be plain text between 1 and 4,000 characters."), { status: 400 });
    }
  }
  if (action === "save_draft" && value === undefined) {
    throw Object.assign(new Error("Enter content before saving a draft."), { status: 400 });
  }
  return { key, action, reason, expectedVersion, value: value ?? null };
}

function staffAccessMutation(body) {
  const discordUserId = String(body.discordUserId || "").trim();
  const action = String(body.action || "").trim().toLowerCase();
  const roleKey = String(body.roleKey || "").trim().toLowerCase();
  const reason = sanitizePlainText(body.reason, 500);
  const expectedVersion = Number(body.expectedVersion);
  const assignableRoles = new Set(["administrator", "senior_moderator", "moderator", "support"]);

  if (!/^[0-9]{17,20}$/.test(discordUserId)) {
    throw Object.assign(new Error("Enter a valid Discord user ID."), { status: 400 });
  }
  if (!["assign", "change_role", "suspend", "reactivate", "revoke"].includes(action)) {
    throw Object.assign(new Error("Choose a valid staff access action."), { status: 400 });
  }
  if (["assign", "change_role"].includes(action) && !assignableRoles.has(roleKey)) {
    throw Object.assign(new Error("Choose an assignable staff rank."), { status: 400 });
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw Object.assign(new Error("Staff access changed. Reload before trying again."), { status: 409 });
  }
  if (reason.length < 5) {
    throw Object.assign(new Error("Add a reason of at least five characters."), { status: 400 });
  }

  return { discordUserId, action, roleKey: roleKey || null, reason, expectedVersion };
}

function authFailure(req, res, provider, returnTo, state) {
  const destination = new URL(returnTo, appUrl(req));
  destination.searchParams.set("auth", state || `${provider}-not-configured`);
  return redirect(res, destination.toString());
}

function providerRoute(provider) {
  return endpoint("GET", async (req, res) => {
    assertSameOrigin(req);
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
      const returnTo = safeReturnPath(cookieValue(parseCookies(req), "brp_auth_return"), "/dashboard");
      const destination = new URL(returnTo, appUrl(req));
      destination.searchParams.set("auth", "failed");
      return redirect(res, destination.toString());
    }
  }),

  "auth/session": endpoint("GET", async (req, res) => {
    const csrfToken = csrfTokenForRequest(req, res);
    const session = await getSession(req, res);
    if (!session) return ok(res, { authenticated: false, user: null, csrfToken });
    let profile = null;
    try {
      profile = (await rest(`profiles?select=id,username,display_name,avatar_url,bio,joined_at,profile_visibility&id=eq.${encodeURIComponent(session.user.id)}&limit=1`, { useSecret: true }))?.[0] || null;
    } catch { /* Auth identity remains usable while profile provisioning catches up. */ }
    return ok(res, {
      authenticated: true,
      provider: session.provider,
      csrfToken: session.csrfToken,
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

  "admin/content": endpoint(["GET", "POST"], async (req, res) => {
    if (req.method === "POST") assertSameOrigin(req);
    const session = await getSession(req, res, { required: true, provider: "discord" });
    if (req.method === "GET") {
      const entries = await rpc("staff_list_site_content", {}, session.accessToken);
      return ok(res, { entries: Array.isArray(entries) ? entries : [] });
    }
    await rateLimit(req, "staff-content", 30, 300);
    const body = contentMutation(await readBody(req, 12 * 1024));
    let result;
    try {
      result = await rpc("staff_mutate_site_content", {
        p_key: body.key,
        p_value: body.value,
        p_action: body.action,
        p_reason: body.reason,
        p_expected_version: body.expectedVersion
      }, session.accessToken);
    } catch (error) {
      if (error.code === "40001") error.status = 409;
      throw error;
    }
    return ok(res, { result });
  }),

  "admin/staff": endpoint(["GET", "POST"], async (req, res, id) => {
    if (req.method === "POST") assertSameOrigin(req);
    const session = await getSession(req, res, { required: true, provider: "discord" });
    if (req.method === "GET") {
      const staff = await rpc("staff_list_access", {}, session.accessToken);
      return ok(res, { staff: staff && typeof staff === "object" ? staff : { members: [], roles: [] } });
    }

    await rateLimit(req, "staff-access", 20, 300);
    const body = staffAccessMutation(await readBody(req, 12 * 1024));
    let result;
    try {
      result = await rpc("staff_mutate_access", {
        p_discord_user_id: body.discordUserId,
        p_action: body.action,
        p_role_key: body.roleKey,
        p_reason: body.reason,
        p_expected_version: body.expectedVersion,
        p_request_id: id
      }, session.accessToken);
    } catch (error) {
      if (error.code === "40001" || error.code === "23505") error.status = 409;
      throw error;
    }
    return ok(res, { result });
  }),

  platforms: endpoint("GET", async (_req, res) => {
    try {
      const platforms = await rest("platforms?select=id,name,short_name,accent&enabled=eq.true&order=sort_order.asc", safeServerRead());
      return publicJson(res, { platforms: Array.isArray(platforms) ? platforms : [] }, 300);
    } catch (error) {
      if (!developmentCatalogAllowed()) throw error;
      return publicJson(res, { platforms: fallbackPlatforms }, 300);
    }
  }),

  categories: endpoint("GET", async (_req, res) => {
    try {
      const categories = await rest("category_directory?select=name,count&order=count.desc&limit=30", safeServerRead());
      return publicJson(res, { categories: Array.isArray(categories) ? categories : [] }, 60);
    } catch (error) {
      if (!developmentCatalogAllowed()) throw error;
      return publicJson(res, { categories: categoriesFromServers() }, 60);
    }
  }),

  "public/overview": endpoint("GET", async (_req, res) => {
    try {
      return publicJson(res, { overview: publicOverviewFields(await rpc("public_overview", {})) }, 30);
    } catch (error) {
      if (!developmentCatalogAllowed()) throw error;
      return publicJson(res, {
        overview: publicOverviewFields({
          servers: fallbackServers.length,
          online: fallbackServers.filter((server) => server.online).length,
          verified: fallbackServers.filter((server) => server.verified).length,
          players: fallbackServers.reduce((sum, server) => sum + server.players, 0)
        })
      }, 30);
    }
  }),

  "public/content": endpoint("GET", async (_req, res) => {
    try {
      const content = await rpc("public_site_content", {}, undefined, safeServerRead());
      return publicJson(res, { content: content && typeof content === "object" ? content : {} }, 60);
    } catch (error) {
      if (!developmentCatalogAllowed()) throw error;
      return publicJson(res, { content: {} }, 60);
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
