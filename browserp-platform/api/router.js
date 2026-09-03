import { createHash, randomBytes } from "node:crypto";
import { endpoint, ok } from "../lib/api.js";
import { appUrl, developmentCatalogAllowed, supabaseConfig } from "../lib/config.js";
import { categoriesFromServers, platforms as fallbackPlatforms, servers as fallbackServers } from "../lib/catalog.js";
import { assertSameOrigin, cookieValue, parseCookies, publicJson, readBody, redirect, safeReturnPath } from "../lib/http.js";
import { assessDisplayName, sanitizePlainText } from "../lib/moderation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { recordAccountActivity, unsealAddress } from "../lib/security.js";
import { moderationMutation, moderationQuery } from "../lib/staff-moderation.js";
import {
  authCapabilities,
  beginOAuth,
  csrfTokenForRequest,
  enrollTotp,
  finishOAuth,
  getSession,
  rest,
  rpc,
  signOut,
  uploadStorageObject,
  verifyTotp
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

export function staffAccessMutation(body) {
  const discordUserId = String(body.discordUserId || "").trim();
  const action = String(body.action || "").trim().toLowerCase();
  const roleKey = String(body.roleKey || "").trim().toLowerCase();
  const reason = sanitizePlainText(body.reason, 500);
  const expectedVersion = Number(body.expectedVersion);

  if (!/^[0-9]{17,20}$/.test(discordUserId)) {
    throw Object.assign(new Error("Enter a valid Discord user ID."), { status: 400 });
  }
  if (!["assign", "change_role", "suspend", "reactivate", "revoke"].includes(action)) {
    throw Object.assign(new Error("Choose a valid staff access action."), { status: 400 });
  }
  if (["assign", "change_role"].includes(action) && (roleKey === "owner" || !/^[a-z0-9_]{2,40}$/.test(roleKey))) {
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

export function customRoleMutation(body) {
  const key = String(body.key || "").trim().toLowerCase();
  const name = sanitizePlainText(body.name, 60);
  const description = sanitizePlainText(body.description, 300);
  const expectedVersion = Number(body.expectedVersion);
  if ((key && !/^custom_[a-z0-9_]{1,33}$/.test(key)) || name.length < 2 || description.length < 5) {
    throw Object.assign(new Error("Check the custom role name and description."), { status: 400 });
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw Object.assign(new Error("Reload roles before saving."), { status: 409 });
  }
  const blocked = new Set(["staff.manage", "staff.permissions.manage", "security.network.approve"]);
  if (!Array.isArray(body.permissions) || body.permissions.length > 80 || body.permissions.some((key) => typeof key !== "string" || !/^[a-z][a-z0-9_.]{2,79}$/.test(key) || blocked.has(key))) {
    throw Object.assign(new Error("Choose valid assignable permissions."), { status: 400 });
  }
  return { key: key || null, name, description, permissions: [...new Set(body.permissions)], expectedVersion, reason: reason(body.reason, 5) };
}

function optionalTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw Object.assign(new Error("Choose a valid date and time."), { status: 400 });
  }
  return new Date(value).toISOString();
}

function uuid(value, message = "Choose a valid record.") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw Object.assign(new Error(message), { status: 400 });
  }
  return normalized;
}

function reason(value, minimum = 10) {
  const normalized = sanitizePlainText(value, 500);
  if (normalized.length < minimum) {
    throw Object.assign(new Error(`Add a reason of at least ${minimum} characters.`), { status: 400 });
  }
  return normalized;
}

function plainBlock(value, limit, label) {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!text || text.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw Object.assign(new Error(`${label} is missing or too long.`), { status: 400 });
  }
  return text;
}

function qrCodeDataUri(value) {
  const source = String(value || "").trim();
  if (!source) return null;
  if (/^data:image\/svg\+xml(?:;base64)?,/i.test(source)) return source;
  if (/^<svg[\s>]/i.test(source)) {
    return `data:image/svg+xml;base64,${Buffer.from(source, "utf8").toString("base64")}`;
  }
  return null;
}

function profilePictureBytes(value) {
  const source = String(value || "");
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
  if (!match || source.length > 1_450_000) throw Object.assign(new Error("Choose a cropped PNG profile picture under 1 MB."), { status: 400 });
  const bytes = Buffer.from(match[1], "base64");
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 70 || bytes.length > 1_048_576 || !bytes.subarray(0, 8).equals(signature)) {
    throw Object.assign(new Error("The uploaded profile picture is not a valid PNG image."), { status: 400 });
  }
  let offset = 8;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  const allowedChunks = new Set(["IHDR", "IDAT", "IEND", "sRGB", "gAMA", "cHRM", "pHYs"]);
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (!allowedChunks.has(type) || length > 1_048_576 || end > bytes.length) {
      throw Object.assign(new Error("The profile picture contains unsupported image data."), { status: 400 });
    }
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) throw Object.assign(new Error("The profile picture header is invalid."), { status: 400 });
      const width = bytes.readUInt32BE(offset + 8);
      const height = bytes.readUInt32BE(offset + 12);
      if (width !== 512 || height !== 512 || bytes[offset + 16] !== 8 || ![2, 6].includes(bytes[offset + 17])) {
        throw Object.assign(new Error("Crop the profile picture to the required 512 × 512 size."), { status: 400 });
      }
      sawHeader = true;
    }
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length) throw Object.assign(new Error("The profile picture has invalid trailing data."), { status: 400 });
      sawEnd = true;
      break;
    }
    offset = end;
  }
  if (!sawHeader || !sawImageData || !sawEnd) throw Object.assign(new Error("The uploaded profile picture is incomplete."), { status: 400 });
  return bytes;
}

async function recordActivitySafely(req, res, details) {
  try { await recordAccountActivity(req, res, details); }
  catch (error) {
    // Authentication must not fail because the audit store is momentarily
    // unavailable. No IP, user agent, token or other evidence is logged here.
    console.warn("Account activity recording unavailable", { code: error?.code || "ACTIVITY_UNAVAILABLE" });
  }
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

  "auth/callback": endpoint("GET", async (req, res, requestId) => {
    try {
      const { returnTo, provider, user } = await finishOAuth(req, res);
      await recordActivitySafely(req, res, {
        userId: user.id,
        eventType: "auth.signed_in",
        provider,
        requestId
      });
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
      profile = (await rest(`profiles?select=id,username,display_name,avatar_url,avatar_review_status,bio,bio_review_status,joined_at,profile_visibility&id=eq.${encodeURIComponent(session.user.id)}&limit=1`, { useSecret: true }))?.[0] || null;
    } catch { /* Auth identity remains usable while profile provisioning catches up. */ }
    let staffAccess = false;
    try { staffAccess = await rpc("staff_mfa_enrollment_allowed", {}, session.accessToken) === true; } catch { /* Staff entry remains hidden if the permission check is unavailable. */ }
    let staffMfaRequired = true;
    if (staffAccess) {
      try {
        const securityStatus = await rpc("staff_mfa_policy", {}, session.accessToken);
        staffMfaRequired = securityStatus?.staffMfaRequired !== false;
      } catch { /* Fail closed if the staff MFA policy cannot be read. */ }
    }
    return ok(res, {
      authenticated: true,
      staffAccess,
      provider: session.provider,
      aal: session.aal,
      mfa: {
        required: staffAccess ? staffMfaRequired : null,
        enrolled: session.factors.some((factor) => factor?.status === "verified"),
        factors: session.factors.map((factor) => ({
          id: factor.id,
          status: factor.status,
          friendlyName: factor.friendly_name || "Authenticator app"
        }))
      },
      csrfToken: session.csrfToken,
      user: { id: session.user.id, email: session.user.email || null, profile }
    });
  }),

  "auth/mfa/enroll": endpoint("POST", async (req, res, requestId) => {
    assertSameOrigin(req);
    const session = await getSession(req, res, { required: true, provider: "discord" });
    await rateLimit(req, "mfa-enroll", 5, 3600);
    const allowed = await rpc("staff_mfa_enrollment_allowed", {}, session.accessToken);
    if (allowed !== true) throw Object.assign(new Error("An active BrowseRP staff assignment is required."), { status: 403 });
    const body = await readBody(req, 4 * 1024);
    const friendlyName = sanitizePlainText(body.friendlyName || "BrowseRP staff", 50);
    const factor = await enrollTotp(session.accessToken, friendlyName || "BrowseRP staff");
    await recordActivitySafely(req, res, {
      userId: session.user.id,
      eventType: "auth.mfa_enrolled",
      provider: "discord",
      requestId
    });
    return ok(res, {
      factor: {
        id: factor?.id,
        qrCode: qrCodeDataUri(factor?.totp?.qr_code),
        secret: factor?.totp?.secret,
        uri: factor?.totp?.uri
      }
    }, 201);
  }),

  "auth/mfa/verify": endpoint("POST", async (req, res, requestId) => {
    assertSameOrigin(req);
    const session = await getSession(req, res, { required: true, provider: "discord" });
    await rateLimit(req, "mfa-verify", 8, 600);
    const body = await readBody(req, 4 * 1024);
    const factorId = uuid(body.factorId, "Choose the authenticator factor again.");
    const code = String(body.code || "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) throw Object.assign(new Error("Enter the six-digit authenticator code."), { status: 400 });
    const verified = await verifyTotp(res, session.accessToken, factorId, code, session.csrfToken);
    let mfaRequirementActivated = false;
    try {
      const securityStatus = await rpc("staff_security_status", {}, verified.access_token);
      if (securityStatus?.isOwner === true && securityStatus?.staffMfaRequired !== true) {
        await rpc("staff_activate_mfa_requirement", {
          p_reason: "Initial owner authenticator verified; mandatory staff MFA enabled.",
          p_request_id: requestId
        }, verified.access_token);
        mfaRequirementActivated = true;
      }
    } catch (error) {
      console.warn(JSON.stringify({
        level: "warning",
        event: "staff.mfa.enforcement_deferred",
        requestId,
        code: error?.code || "UNKNOWN"
      }));
    }
    await recordActivitySafely(req, res, {
      userId: session.user.id,
      eventType: "auth.mfa_verified",
      provider: "discord",
      requestId
    });
    return ok(res, { verified: true, aal: "aal2", mfaRequirementActivated });
  }),

  "auth/logout": endpoint("POST", async (req, res) => {
    assertSameOrigin(req);
    const session = await getSession(req, res);
    if (session) await recordActivitySafely(req, res, {
      userId: session.user.id,
      eventType: "auth.signed_out",
      provider: session.provider
    });
    await signOut(req, res);
    return ok(res, { signedOut: true });
  }),

  "me/overview": endpoint("GET", async (req, res) => {
    const session = await getSession(req, res, { required: true });
    return ok(res, { overview: await rpc("member_dashboard_overview", {}, session.accessToken) });
  }),

  "me/profile": endpoint(["GET", "POST"], async (req, res) => {
    if (req.method === "POST") assertSameOrigin(req);
    const session = await getSession(req, res, { required: true });
    if (req.method === "GET") {
      const profile = (await rest(
        `profiles?select=display_name,bio,profile_visibility,avatar_url,avatar_review_status,bio_review_status&id=eq.${encodeURIComponent(session.user.id)}&limit=1`,
        { useSecret: true }
      ))?.[0] || null;
      return ok(res, { profile });
    }
    await rateLimit(req, "profile-update", 12, 900);
    const body = await readBody(req, 8 * 1024);
    const identityName = session.user?.user_metadata?.global_name
      || session.user?.user_metadata?.full_name
      || session.user?.user_metadata?.name
      || session.user?.user_metadata?.user_name
      || session.user?.user_metadata?.preferred_username
      || body.displayName;
    const nameAssessment = assessDisplayName(identityName);
    const displayName = nameAssessment.value;
    const bio = String(body.bio || "").replace(/\r\n?/g, "\n").trim();
    const visibility = String(body.visibility || "public").trim().toLowerCase();
    if (!nameAssessment.allowed) {
      throw Object.assign(new Error(`${nameAssessment.reason} Change it on Discord or Google, then try again.`), { status: 422 });
    }
    if (bio.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(bio)
      || !["public", "members", "private"].includes(visibility)) {
      throw Object.assign(new Error("Check your display name, bio and visibility."), { status: 400 });
    }
    const profile = await rpc("member_update_profile", {
      p_display_name: displayName, p_bio: bio, p_visibility: visibility
    }, session.accessToken);
    await recordActivitySafely(req, res, {
      userId: session.user.id, eventType: "profile.updated", provider: session.provider,
      metadata: { bioSubmitted: Boolean(bio), identityNameSynchronized: true }
    });
    return ok(res, { profile });
  }),

  "me/avatar": endpoint("POST", async (req, res, requestId) => {
    assertSameOrigin(req);
    const session = await getSession(req, res, { required: true });
    await rateLimit(req, "profile-avatar", 6, 3600);
    const body = await readBody(req, 1_500_000);
    const bytes = profilePictureBytes(body.imageData);
    const objectPath = `${session.user.id}/${Date.now()}-${randomBytes(12).toString("hex")}.png`;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await uploadStorageObject("profile-media", objectPath, bytes, "image/png");
    const asset = (await rest("uploaded_assets", {
      method: "POST",
      body: {
        owner_id: session.user.id,
        bucket: "profile-media",
        object_path: objectPath,
        media_type: "avatar",
        mime_type: "image/png",
        byte_size: bytes.length,
        sha256,
        moderation_status: "approved",
        moderation_result: { source: "member-crop", requestId, publication: "immediate", safety: "validated-raster" }
      },
      useSecret: true,
      headers: { Prefer: "return=representation" }
    }))?.[0];
    if (!asset?.id) throw Object.assign(new Error("The profile picture could not be registered."), { status: 502 });
    const avatarUrl = `${supabaseConfig().url}/storage/v1/object/public/profile-media/${objectPath}`;
    const profile = await rpc("member_set_profile_avatar", {
      p_avatar_url: avatarUrl,
      p_asset_id: asset.id
    }, session.accessToken);
    await recordActivitySafely(req, res, {
      userId: session.user.id,
      eventType: "profile.media_submitted",
      provider: session.provider,
      requestId,
      metadata: { assetId: asset.id, byteSize: bytes.length, sha256, publication: "immediate" }
    });
    return ok(res, { profile, avatarUrl }, 201);
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
    const range = new URL(req.url, appUrl(req)).searchParams.get("range");
    if (range && !["30d", "90d", "180d", "1y", "max"].includes(range)) {
      throw Object.assign(new Error("Choose a valid time frame."), { status: 400 });
    }
    const overview = range
      ? { website: await rpc("staff_website_overview", { p_range: range }, session.accessToken) }
      : await rpc("staff_dashboard_overview", {}, session.accessToken);
    return ok(res, { overview });
  }),

  "admin/moderation": endpoint(["GET", "POST"], async (req, res, id) => {
    if (req.method === "POST") assertSameOrigin(req);
    const session = await getSession(req, res, { required: true, provider: "discord" });
    if (req.method === "GET") {
      const query = moderationQuery(new URL(req.url, appUrl(req)).searchParams);
      if (query.kind === "summary") return ok(res, { summary: await rpc("staff_moderation_summary", {}, session.accessToken) });
      return ok(res, { workspace: await rpc("staff_moderation_records", {
        p_kind: query.kind, p_filters: query.filters, p_cursor: query.cursor, p_limit: query.limit
      }, session.accessToken) });
    }
    await rateLimit(req, "staff-moderation", 30, 300);
    const body = moderationMutation(await readBody(req, 96 * 1024));
    try {
      return ok(res, { result: await rpc("staff_moderation_mutate", {
        p_kind: body.kind, p_id: body.id, p_action: body.action, p_data: body.data,
        p_expected_version: body.expectedVersion, p_reason: body.reason, p_request_id: id
      }, session.accessToken) });
    } catch (error) {
      if (error.code === "40001" || error.code === "23505") error.status = 409;
      throw error;
    }
  }),

  "admin/item": endpoint("GET", async (req, res) => {
    const session = await getSession(req, res, { required: true, provider: "discord" });
    const requestUrl = new URL(req.url || "/api/admin/item", appUrl(req));
    const kind = sanitizePlainText(requestUrl.searchParams.get("kind"), 20);
    const itemId = sanitizePlainText(requestUrl.searchParams.get("id"), 80);
    if (!kind || !itemId) throw Object.assign(new Error("Choose a queue item."), { status: 400 });
    const item = kind === "comment"
      ? await rpc("staff_comment_review_item", { p_queue_id: uuid(itemId, "Choose a valid comment review.") }, session.accessToken)
      : await rpc("staff_review_item", { p_kind: kind, p_item_id: itemId }, session.accessToken);
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
    const result = kind === "comment"
      ? await rpc("staff_resolve_comment_review", {
        p_queue_id: uuid(itemId, "Choose a valid comment review."),
        p_action: action,
        p_reason: reason,
        p_request_id: id
      }, session.accessToken)
      : await rpc("staff_resolve_queue_item", {
        p_kind: kind,
        p_item_id: itemId,
        p_action: action,
        p_reason: reason,
        p_request_id: id
      }, session.accessToken);
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

  "admin/roles": endpoint(["GET", "POST"], async (req, res, id) => {
    if (req.method === "POST") assertSameOrigin(req);
    const session = await getSession(req, res, { required: true, provider: "discord" });
    if (req.method === "GET") return ok(res, { control: await rpc("staff_role_control", {}, session.accessToken) });
    await rateLimit(req, "staff-roles", 20, 300);
    const body = customRoleMutation(await readBody(req, 16 * 1024));
    try {
      return ok(res, { result: await rpc("staff_mutate_role", {
        p_key: body.key, p_name: body.name, p_description: body.description,
        p_permissions: body.permissions, p_expected_version: body.expectedVersion,
        p_reason: body.reason, p_request_id: id
      }, session.accessToken) });
    } catch (error) {
      if (error.code === "40001" || error.code === "23505") error.status = 409;
      throw error;
    }
  }),

  "admin/announcements": endpoint(["GET", "POST"], async (req, res, id) => {
    if (req.method === "POST") assertSameOrigin(req);
    const session = await getSession(req, res, { required: true, provider: "discord" });
    if (req.method === "GET") return ok(res, { announcements: await rpc("staff_announcement_control", {}, session.accessToken) });
    await rateLimit(req, "staff-announcements", 20, 300);
    const body = await readBody(req, 12 * 1024);
    const action = String(body.action || "").trim().toLowerCase();
    const level = String(body.level || "info").trim().toLowerCase();
    const expectedVersion = body.id ? Number(body.expectedVersion) : null;
    if (!["save", "publish", "archive"].includes(action) || !["info", "success", "warning"].includes(level)) {
      throw Object.assign(new Error("Choose a valid announcement action and style."), { status: 400 });
    }
    if (body.id && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) {
      throw Object.assign(new Error("Reload announcements before saving."), { status: 409 });
    }
    try {
      return ok(res, { result: await rpc("staff_mutate_announcement", {
        p_id: body.id ? uuid(body.id) : null, p_action: action,
        p_title: sanitizePlainText(body.title, 120), p_body: action === "archive" ? "" : plainBlock(body.body, 1000, "Announcement message"),
        p_level: level, p_starts_at: optionalTimestamp(body.startsAt), p_ends_at: optionalTimestamp(body.endsAt),
        p_expected_version: expectedVersion, p_reason: reason(body.reason, 5), p_request_id: id
      }, session.accessToken) });
    } catch (error) {
      if (error.code === "40001") error.status = 409;
      throw error;
    }
  }),

  "admin/permissions": endpoint(["GET", "POST"], async (req, res, id) => {
    if (req.method === "POST") assertSameOrigin(req);
    const session = await getSession(req, res, { required: true, provider: "discord" });
    if (req.method === "GET") {
      return ok(res, { control: await rpc("staff_permission_control", {}, session.accessToken) });
    }
    await rateLimit(req, "staff-permissions", 30, 300);
    const body = await readBody(req, 8 * 1024);
    const discordUserId = String(body.discordUserId || "").trim();
    const permissionKey = String(body.permissionKey || "").trim().toLowerCase();
    const allowed = body.allowed === null ? null : Boolean(body.allowed);
    if (!/^[0-9]{17,20}$/.test(discordUserId) || !/^[a-z][a-z0-9_.-]{2,79}$/.test(permissionKey)) {
      throw Object.assign(new Error("Choose a valid staff account and permission."), { status: 400 });
    }
    return ok(res, { result: await rpc("staff_mutate_permission", {
      p_discord_user_id: discordUserId,
      p_permission_key: permissionKey,
      p_allowed: allowed,
      p_reason: reason(body.reason, 5),
      p_request_id: id
    }, session.accessToken) });
  }),

  "admin/security": endpoint(["GET", "POST"], async (req, res, id) => {
    if (req.method === "POST") assertSameOrigin(req);
    const session = await getSession(req, res, { required: true, provider: "discord" });
    if (req.method === "GET") {
      const view = new URL(req.url, appUrl(req)).searchParams.get("view");
      const sections = { status: ["staff_security_status", "status"], requests: ["staff_network_reveal_control", "revealRequests"], retention: ["staff_account_retention", "retention"], flags: ["staff_security_flag_control", "flags"], policy: ["staff_mfa_policy", "policy"] };
      if (view) {
        if (!Object.hasOwn(sections, view)) throw Object.assign(new Error("Choose a valid security section."), { status: 400 });
        const [method, key] = sections[view];
        return ok(res, { [key]: await rpc(method, {}, session.accessToken) });
      }
      const [status, activity, revealRequests, flags, retention] = await Promise.all([
        rpc("staff_security_status", {}, session.accessToken),
        rpc("staff_account_activity", { p_limit: 150 }, session.accessToken),
        rpc("staff_network_reveal_control", {}, session.accessToken),
        rpc("staff_security_flag_control", {}, session.accessToken),
        rpc("staff_account_retention", {}, session.accessToken)
      ]);
      return ok(res, {
        status,
        activity: Array.isArray(activity) ? activity : [],
        revealRequests: Array.isArray(revealRequests) ? revealRequests : [],
        flags: Array.isArray(flags) ? flags : [],
        retention: Array.isArray(retention) ? retention : []
      });
    }
    await rateLimit(req, "staff-security", 20, 300);
    const body = await readBody(req, 8 * 1024);
    const action = String(body.action || "").trim().toLowerCase();
    let result;
    if (action === "activate_mfa") {
      result = await rpc("staff_activate_mfa_requirement", {
        p_reason: reason(body.reason, 5), p_request_id: id
      }, session.accessToken);
    } else if (action === "revoke_sessions") {
      result = await rpc("staff_revoke_account_sessions", {
        p_user_id: uuid(body.userId, "Choose a valid account."),
        p_reason: reason(body.reason), p_request_id: id
      }, session.accessToken);
    } else if (action === "request_network") {
      const activityId = Number(body.activityId);
      if (!Number.isSafeInteger(activityId) || activityId < 1) throw Object.assign(new Error("Choose a valid activity record."), { status: 400 });
      result = await rpc("staff_request_network_reveal", {
        p_activity_id: activityId, p_reason: reason(body.reason)
      }, session.accessToken);
    } else if (action === "decide_network") {
      result = await rpc("staff_decide_network_reveal", {
        p_request_id: uuid(body.requestId, "Choose a valid reveal request."),
        p_approved: body.approved === true,
        p_reason: reason(body.reason)
      }, session.accessToken);
    } else if (action === "reveal_network") {
      const activityId = Number(body.activityId);
      if (!Number.isSafeInteger(activityId) || activityId < 1) throw Object.assign(new Error("Choose a valid activity record."), { status: 400 });
      const evidence = await rpc("staff_network_reveal_evidence", {
        p_activity_id: activityId,
        p_request_id: body.requestId ? uuid(body.requestId, "Choose a valid reveal request.") : null
      }, session.accessToken);
      result = { address: unsealAddress(evidence?.ciphertext), expiresInSeconds: 60 };
    } else if (action === "resolve_flag") {
      const eventId = Number(body.eventId);
      if (!Number.isSafeInteger(eventId) || eventId < 1) throw Object.assign(new Error("Choose a valid security signal."), { status: 400 });
      result = await rpc("staff_resolve_security_flag", {
        p_event_id: eventId, p_reason: reason(body.reason, 5), p_request_id: id
      }, session.accessToken);
    } else {
      throw Object.assign(new Error("Choose a valid security action."), { status: 400 });
    }
    return ok(res, { result });
  }),

  "admin/profiles": endpoint(["GET", "POST"], async (req, res, id) => {
    if (req.method === "POST") assertSameOrigin(req);
    const session = await getSession(req, res, { required: true, provider: "discord" });
    if (req.method === "GET") {
      const profiles = await rpc("staff_profile_review_queue", {}, session.accessToken);
      return ok(res, { profiles: Array.isArray(profiles) ? profiles : [] });
    }
    await rateLimit(req, "staff-profile-review", 30, 300);
    const body = await readBody(req, 8 * 1024);
    const field = String(body.field || "").trim().toLowerCase();
    const action = String(body.action || "").trim().toLowerCase();
    if (field !== "bio" || !["approve", "reject"].includes(action)) {
      throw Object.assign(new Error("Choose a valid profile-review action."), { status: 400 });
    }
    return ok(res, { result: await rpc("staff_review_profile_content", {
      p_user_id: uuid(body.userId, "Choose a valid account."),
      p_field: field,
      p_action: action,
      p_reason: reason(body.reason, 5),
      p_request_id: id
    }, session.accessToken) });
  }),

  "admin/adverts": endpoint(["GET", "POST"], async (req, res, id) => {
    if (req.method === "POST") assertSameOrigin(req);
    const session = await getSession(req, res, { required: true, provider: "discord" });
    if (req.method === "GET") {
      const adverts = await rpc("staff_advert_control", {}, session.accessToken);
      return ok(res, { adverts: Array.isArray(adverts) ? adverts : [] });
    }
    await rateLimit(req, "staff-adverts", 30, 300);
    const body = await readBody(req, 16 * 1024);
    const action = String(body.action || "").trim().toLowerCase();
    if (!["save", "activate", "pause", "archive"].includes(action)) throw Object.assign(new Error("Choose a valid advert action."), { status: 400 });
    const placement = String(body.placement || "").trim().toLowerCase();
    const version = Number(body.expectedVersion || 0);
    if (!Number.isSafeInteger(version) || version < 0) throw Object.assign(new Error("Reload the advert before saving."), { status: 409 });
    return ok(res, { result: await rpc("staff_mutate_advert", {
      p_id: body.id ? uuid(body.id, "Choose a valid advert.") : null,
      p_action: action,
      p_name: sanitizePlainText(body.name, 100),
      p_placement: placement,
      p_headline: sanitizePlainText(body.headline, 100),
      p_body: sanitizePlainText(body.body, 300),
      p_cta_label: sanitizePlainText(body.ctaLabel, 40),
      p_destination_url: String(body.destinationUrl || "").trim().slice(0, 500),
      p_image_url: String(body.imageUrl || "").trim().slice(0, 500) || null,
      p_starts_at: body.startsAt || null,
      p_ends_at: body.endsAt || null,
      p_expected_version: version,
      p_reason: reason(body.reason, 5),
      p_request_id: id
    }, session.accessToken) });
  }),

  "admin/blogs": endpoint(["GET", "POST"], async (req, res, id) => {
    if (req.method === "POST") assertSameOrigin(req);
    const session = await getSession(req, res, { required: true, provider: "discord" });
    if (req.method === "GET") {
      const posts = await rpc("staff_blog_control", {}, session.accessToken);
      return ok(res, { posts: Array.isArray(posts) ? posts : [] });
    }
    await rateLimit(req, "staff-blogs", 20, 300);
    const body = await readBody(req, 96 * 1024);
    const action = String(body.action || "").trim().toLowerCase();
    if (!["save", "publish", "archive"].includes(action)) throw Object.assign(new Error("Choose a valid blog action."), { status: 400 });
    const slug = String(body.slug || "").trim().toLowerCase();
    return ok(res, { result: await rpc("staff_mutate_blog", {
      p_id: body.id ? uuid(body.id, "Choose a valid blog post.") : null,
      p_action: action,
      p_title: sanitizePlainText(body.title, 140),
      p_slug: slug,
      p_excerpt: sanitizePlainText(body.excerpt, 400),
      p_body: action === "archive" && !body.body ? "Archived post content remains unchanged." : plainBlock(body.body, 20_000, "Blog body"),
      p_seo_title: sanitizePlainText(body.seoTitle, 160),
      p_seo_description: sanitizePlainText(body.seoDescription, 300),
      p_reason: reason(body.reason, 5),
      p_request_id: id
    }, session.accessToken) });
  }),

  "admin/bans": endpoint(["GET", "POST"], async (req, res, id) => {
    if (req.method === "POST") assertSameOrigin(req);
    const session = await getSession(req, res, { required: true, provider: "discord" });
    if (req.method === "GET") return ok(res, { control: await rpc("staff_ban_control", {}, session.accessToken) });
    await rateLimit(req, "staff-bans", 15, 300);
    const body = await readBody(req, 12 * 1024);
    const action = String(body.action || "").trim().toLowerCase();
    let result;
    if (action === "apply") {
      const activityId = Number(body.activityId);
      if (!Number.isSafeInteger(activityId) || activityId < 1) throw Object.assign(new Error("Choose a valid account activity."), { status: 400 });
      result = await rpc("staff_apply_security_ban", {
        p_activity_id: activityId,
        p_target_type: String(body.targetType || "").trim().toLowerCase(),
        p_scope: String(body.scope || "platform").trim().toLowerCase(),
        p_reason_code: sanitizePlainText(body.reasonCode, 80),
        p_reason: reason(body.reason),
        p_permanent: body.permanent !== false,
        p_request_id: id
      }, session.accessToken);
    } else if (action === "decide_appeal") {
      result = await rpc("staff_decide_security_appeal", {
        p_appeal_id: uuid(body.appealId, "Choose a valid appeal."),
        p_approved: body.approved === true,
        p_reason: reason(body.reason),
        p_request_id: id
      }, session.accessToken);
    } else if (action === "revoke") {
      result = await rpc("staff_revoke_security_ban", {
        p_ban_id: uuid(body.banId, "Choose a valid ban."),
        p_reason: reason(body.reason),
        p_request_id: id
      }, session.accessToken);
    } else throw Object.assign(new Error("Choose a valid ban action."), { status: 400 });
    return ok(res, { result });
  }),

  "public/appeals": endpoint("POST", async (req, res) => {
    assertSameOrigin(req);
    await rateLimit(req, "ban-appeal", 3, 3600);
    const body = await readBody(req, 8 * 1024);
    const reference = String(body.reference || "").trim().toUpperCase();
    const email = String(body.email || "").trim().toLowerCase();
    const statement = plainBlock(body.statement, 3000, "Appeal statement");
    if (!/^BRP-[A-Z0-9]{10}$/.test(reference) || email.length > 254) {
      throw Object.assign(new Error("Enter the ban reference and contact email exactly as shown."), { status: 400 });
    }
    return ok(res, { appeal: await rpc("submit_security_ban_appeal_server", {
      p_reference: reference,
      p_contact_email: email,
      p_statement: statement
    }, undefined, { useSecret: true }) }, 201);
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
  }),

  "public/adverts": endpoint("GET", async (req, res) => {
    const requestUrl = new URL(req.url || "/api/public/adverts", appUrl(req));
    const placement = sanitizePlainText(requestUrl.searchParams.get("placement") || "top", 30);
    if (!["top", "side", "directory", "server_detail"].includes(placement)) {
      throw Object.assign(new Error("Choose a valid advert placement."), { status: 400 });
    }
    const adverts = await rpc("public_advertisements", { p_placement: placement });
    return publicJson(res, { adverts: Array.isArray(adverts) ? adverts : [] }, 60);
  }),

  "public/announcements": endpoint("GET", async (_req, res) => {
    try { return ok(res, { announcements: await rpc("public_active_announcements", {}) }); }
    catch (error) { if (!developmentCatalogAllowed()) throw error; return ok(res, { announcements: [] }); }
  }),

  "public/blogs": endpoint("GET", async (req, res) => {
    const requestUrl = new URL(req.url || "/api/public/blogs", appUrl(req));
    const slug = sanitizePlainText(requestUrl.searchParams.get("slug"), 160).toLowerCase();
    if (slug && !/^[a-z0-9-]{3,160}$/.test(slug)) throw Object.assign(new Error("Blog article not found."), { status: 404 });
    if (slug) {
      const post = await rpc("public_blog_post", { p_slug: slug });
      if (!post) throw Object.assign(new Error("Blog article not found."), { status: 404 });
      return publicJson(res, { post }, 120);
    }
    const posts = await rpc("public_blog_index", {});
    return publicJson(res, { posts: Array.isArray(posts) ? posts : [] }, 120);
  })
};

export default async function router(req, res) {
  const requestUrl = new URL(req.url || "/api/router", appUrl(req));
  const route = req.browserpRoute || requestUrl.searchParams.get("_route") || "";
  const handler = routes[route];
  if (!handler) return ok(res, { error: "API route not found." }, 404);
  return handler(req, res);
}
