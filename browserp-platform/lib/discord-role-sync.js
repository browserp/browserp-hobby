import { rpc } from "./supabase.js";
import { readBody } from "./http.js";

const SNOWFLAKE = /^[0-9]{17,20}$/;
const MANAGE_ROLES = 1n << 28n;
// Ordinary community capabilities inherited from @everyone are tolerated;
// moderation, administration and unknown future powers are not.
const BOT_BASELINE = [6n, 10n, 11n, 14n, 15n, 16n, 18n, 20n, 21n, 25n, 26n, 31n, 35n, 36n, 37n, 38n, 39n, 42n, 45n, 46n, 49n, 50n]
  .reduce((bits, bit) => bits | (1n << bit), 0n);
const failure = (code, status = 503, retrySeconds = 300) => Object.assign(new Error("Discord role synchronization needs attention."), { code, status, retrySeconds });
const id = value => { if (typeof value !== "string" || !SNOWFLAKE.test(value)) throw failure("configuration_error"); return value; };

export function validateDiscordSyncConfiguration(body) {
  if (!Array.isArray(body.protectedRoleIds) || body.protectedRoleIds.length < 1 || body.protectedRoleIds.length > 20 ||
      ![body.guildId, body.botUserId, ...body.protectedRoleIds].every(value => typeof value === "string" && SNOWFLAKE.test(value)) ||
      !body.mappings || typeof body.mappings !== "object" || Array.isArray(body.mappings) ||
      Object.entries(body.mappings).some(([key, value]) => !["administrator", "senior_moderator", "moderator", "support"].includes(key) || typeof value !== "string" || !SNOWFLAKE.test(value)) ||
      typeof body.enabled !== "boolean" || typeof body.revokeOnly !== "boolean" || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) {
    throw Object.assign(new Error("Supply the reviewed Discord configuration with exact text IDs."), { status: 400 });
  }
  const mapped = Object.values(body.mappings);
  if (new Set(mapped).size !== mapped.length || mapped.some(roleId => roleId === body.guildId || body.protectedRoleIds.includes(roleId))) {
    throw Object.assign(new Error("Use a distinct, unprotected Discord role for each site rank."), { status: 400 });
  }
}

export function discordSyncRuntime(env = process.env) {
  return {
    environmentAllowed: !env.VERCEL_ENV || env.VERCEL_ENV === "production",
    applicationEnabled: env.DISCORD_ROLE_SYNC_ENABLED === "true",
    botTokenConfigured: Boolean(env.DISCORD_ROLE_SYNC_BOT_TOKEN)
  };
}

// Only call after the owner/MFA/current-session database guard has succeeded.
// This check reads Discord metadata; it cannot assign or remove member roles.
export async function inspectDiscordSyncReadiness(config, { env = process.env, fetchImpl = fetch } = {}) {
  const runtime = discordSyncRuntime(env);
  if (!runtime.environmentAllowed) return { ready: false, code: "preview_disabled", message: "Role synchronization is available only on the intended production deployment." };
  if (!runtime.botTokenConfigured) return { ready: false, code: "token_missing", message: "The server-side bot credential has not been configured." };
  if (!Object.keys(config.mappings).length && !config.revokeOnly) return { ready: false, code: "mapping_missing", message: "Map at least one approved site rank, or choose removal only." };
  try {
    const boundary = await validateDiscordRoleBoundary(discordRoleClient(env.DISCORD_ROLE_SYNC_BOT_TOKEN, { fetchImpl }), config);
    const roles = [];
    for (const [siteRole, roleId] of Object.entries(config.mappings)) {
      boundary.assertRole(roleId, { adding: !config.revokeOnly });
      roles.push({ siteRole, roleId, name: boundary.roleName(roleId) });
    }
    for (const roleId of config.managedRoleIds || []) boundary.assertRole(roleId);
    return { ready: true, code: "ready", message: "Bot identity, permissions and role hierarchy passed. Review channel access separately before enabling.", roles };
  } catch (error) {
    const messages = {
      rate_limited: "Discord asked us to wait. Try the check again later.",
      forbidden: "The bot could not read this server. Check its credential, membership and permissions.",
      configuration_error: "Check the bot identity, protected roles and hierarchy. Mapped roles must be unmanaged labels with no server-wide permissions."
    };
    return { ready: false, code: messages[error.code] ? error.code : "provider_unavailable", message: messages[error.code] || "Discord could not be checked. No settings were enabled." };
  }
}

export async function ownerDiscordRoleSync(method, body, accessToken, { callRpc = rpc, env = process.env, fetchImpl = fetch } = {}) {
  // This RPC enforces an active owner, current session and MFA before any
  // credential presence, configuration or provider metadata is disclosed.
  const control = await callRpc("staff_discord_role_sync_control", {}, accessToken);
  const runtime = discordSyncRuntime(env);
  if (method === "GET") return { control, runtime };
  const action = body.action || "save";
  if (!["save", "check"].includes(action) || Object.keys(body).some(key => !["action", "guildId", "botUserId", "protectedRoleIds", "mappings", "enabled", "revokeOnly", "expectedVersion", "reason"].includes(key))) {
    throw Object.assign(new Error("Choose a valid role-sync action. Credentials are configured only on the server."), { status: 400 });
  }
  validateDiscordSyncConfiguration(body);
  if (body.expectedVersion !== control.version) throw Object.assign(new Error("Configuration changed. Reload before checking or saving."), { status: 409 });
  if (control.guildId && control.guildId !== body.guildId) throw Object.assign(new Error("The configured server cannot be changed without a reviewed cleanup."), { status: 400 });
  const candidate = { ...body, managedRoleIds: control.managedRoleIds || [] };
  if (action === "check") return { readiness: await inspectDiscordSyncReadiness(candidate, { env, fetchImpl }), runtime };
  if (body.enabled) {
    const readiness = await inspectDiscordSyncReadiness(candidate, { env, fetchImpl });
    if (!readiness.ready) throw Object.assign(new Error(readiness.message), { status: 409 });
  }
  if (typeof body.reason !== "string" || body.reason.trim().length < 10 || body.reason.trim().length > 500) throw Object.assign(new Error("Give a review reason between 10 and 500 characters."), { status: 400 });
  const result = await callRpc("staff_configure_discord_role_sync", {
    p_guild_id: body.guildId, p_bot_user_id: body.botUserId, p_protected_role_ids: body.protectedRoleIds,
    p_mappings: body.mappings, p_enabled: body.enabled, p_revoke_only: body.revokeOnly,
    p_expected_version: body.expectedVersion, p_reason: body.reason.trim()
  }, accessToken);
  return { result };
}

export function discordRoleClient(token, { fetchImpl = fetch, signal } = {}) {
  if (!token || /[\r\n]/.test(token)) throw failure("configuration_error");
  return async (method, path) => {
    if (!["GET", "PUT", "DELETE"].includes(method) || !/^\/(?:users\/@me|guilds\/[0-9]{17,20}(?:\/roles|\/members\/[0-9]{17,20}(?:\/roles\/[0-9]{17,20})?)?)$/.test(path)) throw failure("configuration_error");
    let response;
    try {
      response = await fetchImpl(`https://discord.com/api/v10${path}`, {
        method, headers: { Authorization: `Bot ${token}`, ...(method !== "GET" ? { "X-Audit-Log-Reason": "BrowseRP%20authoritative%20site%20role%20reconciliation" } : {}) },
        redirect: "error", credentials: "omit",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000)
      });
    } catch { throw failure("retry"); }
    if (response.status === 429) {
      const body = await response.json().catch(() => ({}));
      const seconds = Number(body.retry_after ?? response.headers.get("retry-after"));
      throw failure("rate_limited", 429, Number.isFinite(seconds) && seconds > 0 ? Math.min(2147483000, Math.ceil(seconds)) : 300);
    }
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) throw failure("forbidden", response.status);
    if (!response.ok) throw failure("retry");
    return response.status === 204 ? true : response.json().catch(() => { throw failure("retry"); });
  };
}

export async function validateDiscordRoleBoundary(client, config) {
  const guildId = id(config.guildId), botUserId = id(config.botUserId);
  const me = await client("GET", "/users/@me");
  if (me?.id !== botUserId || me.bot !== true) throw failure("configuration_error");
  const guild = await client("GET", `/guilds/${guildId}`);
  const roles = await client("GET", `/guilds/${guildId}/roles`);
  const bot = await client("GET", `/guilds/${guildId}/members/${botUserId}`);
  if (!guild || !Array.isArray(roles) || !Array.isArray(bot?.roles) || !Array.isArray(config.protectedRoleIds) || !config.protectedRoleIds.length) throw failure("configuration_error");
  const byId = new Map(roles.map(role => [role.id, role]));
  const botRoles = [byId.get(guildId), ...bot.roles.map(roleId => byId.get(roleId))].filter(Boolean);
  const permissions = botRoles.reduce((bits, role) => bits | BigInt(role.permissions), 0n);
  if (!(permissions & MANAGE_ROLES) || (permissions & ~(MANAGE_ROLES | BOT_BASELINE))) throw failure("configuration_error");
  const highest = Math.max(...botRoles.map(role => role.position));
  const protectedIds = new Set(config.protectedRoleIds.map(id));
  if ([...protectedIds].some(roleId => !byId.has(roleId) || byId.get(roleId).position <= highest)) throw failure("configuration_error");
  return {
    ownerId: id(guild.owner_id),
    roleName: roleId => byId.get(roleId)?.name || "Deleted role",
    assertRole(roleId, { adding = false } = {}) {
      id(roleId);
      const role = byId.get(roleId);
      // A deleted retired role needs no DELETE. A deleted current mapping is an error.
      if (!role) { if (adding) throw failure("configuration_error"); return false; }
      if (roleId === guildId || protectedIds.has(roleId) || role.managed || role.position >= highest) throw failure("configuration_error");
      if (adding && (BigInt(role.permissions) !== 0n || /^(?:ownership|owner|security)$/i.test(role.name.trim()))) throw failure("configuration_error");
      return true;
    }
  };
}

// The ledger already contains this identity before any Discord mutation. Even
// an uncertain PUT followed by a process crash is therefore reconciled later.
export async function reconcileDiscordMember({ client, config, boundary, discordUserId, snapshot, record }) {
  const userId = id(discordUserId), memberPath = `/guilds/${id(config.guildId)}/members/${userId}`;
  if (userId === boundary.ownerId || userId === config.botUserId) { await record("protected"); return; }
  let state = await snapshot();
  const managed = () => {
    if (!Array.isArray(state.managedRoleIds) || state.managedRoleIds.length > 100) throw failure("configuration_error");
    const set = new Set(state.managedRoleIds.map(id));
    if (state.desiredRoleId !== null && !set.has(state.desiredRoleId)) throw failure("configuration_error");
    return set;
  };
  managed();
  const member = await client("GET", memberPath);
  if (!member) { await record("absent"); return; }
  if (member.user?.bot || !Array.isArray(member.roles)) throw failure("configuration_error");
  const actual = new Set(member.roles.map(id));
  for (const roleId of actual) {
    state = await snapshot();
    if (!managed().has(roleId) || state.desiredRoleId === roleId) continue;
    if (boundary.assertRole(roleId)) {
      await client("DELETE", `${memberPath}/roles/${roleId}`);
      await record("removed", roleId);
    }
    actual.delete(roleId);
  }
  state = await snapshot();
  managed();
  const wanted = state.desiredRoleId;
  if (!wanted || actual.has(wanted)) { await record("unchanged"); return; }
  // Refresh the role hierarchy/permissions immediately before a grant as an
  // owner may have changed Discord roles during this run.
  const freshBoundary = await validateDiscordRoleBoundary(client, config);
  freshBoundary.assertRole(wanted, { adding: true });
  state = await snapshot();
  if (state.desiredRoleId !== wanted || !managed().has(wanted) || [...actual].some(roleId => managed().has(roleId) && roleId !== wanted)) throw failure("retry");
  try {
    const added = await client("PUT", `${memberPath}/roles/${wanted}`);
    if (!added) { await record("absent"); return; }
    state = await snapshot();
    if (state.desiredRoleId !== wanted || !managed().has(wanted)) throw failure("retry");
    await record("added", wanted);
  } catch (error) {
    // Prefer loss of privilege over an unconfirmed grant. If cleanup also
    // fails, the durable identity + retired-role ledger remains retryable.
    if (error.code !== "rate_limited" && error.code !== "forbidden") {
      try { await client("DELETE", `${memberPath}/roles/${wanted}`); await record("removed", wanted); }
      catch (cleanupError) {
        if (["rate_limited", "forbidden"].includes(cleanupError.code)) throw cleanupError;
        // The next scheduled reconciliation retries other cleanup failures.
      }
    }
    throw error;
  }
}

export async function scheduledDiscordRoleSync(req, {
  callRpc = rpc, env = process.env, fetchImpl = fetch, now = Date.now, budgetMs = 30000
} = {}) {
  const authorization = req.headers?.authorization;
  if (typeof authorization !== "string" || !/^Bearer [a-f0-9]{64}$/.test(authorization)) throw Object.assign(new Error("Scheduler authorization required."), { status: 401 });
  if (Object.keys(await readBody(req, 128)).length) throw Object.assign(new Error("This endpoint does not accept member or role inputs."), { status: 400 });
  if (!discordSyncRuntime(env).environmentAllowed || env.DISCORD_ROLE_SYNC_ENABLED !== "true") return { accepted: false, reason: "disabled" };
  if (!env.DISCORD_ROLE_SYNC_BOT_TOKEN) throw failure("configuration_error");
  const signal = AbortSignal.timeout(Math.min(Math.max(budgetMs, 1), 30000));
  const invoke = (name, args) => callRpc(name, args, undefined, { useSecret: true, signal });
  const config = await invoke("service_claim_discord_role_sync", { p_token: authorization.slice(7) });
  if (!config) return { accepted: false, reason: "disabled_busy_or_backoff" };
  const client = discordRoleClient(env.DISCORD_ROLE_SYNC_BOT_TOKEN, { fetchImpl, signal });
  const ids = await invoke("service_read_discord_role_sync", { p_run_id: config.runId });
  if (!Array.isArray(ids) || ids.length > 20) throw failure("configuration_error");
  const summary = { checked: 0, failed: 0, deferred: ids.length };
  const deadline = now() + Math.min(Math.max(budgetMs, 1), 30000);
  let boundary;
  for (const userId of ids) {
    if (signal.aborted || now() >= deadline) break;
    const record = (event, roleId = null, retrySeconds = 300) => callRpc("service_record_discord_role_sync", { p_run_id: config.runId, p_discord_user_id: userId, p_event: event, p_role_id: roleId, p_retry_seconds: retrySeconds }, undefined, { useSecret: true, signal: AbortSignal.timeout(4000) });
    try {
      boundary ||= await validateDiscordRoleBoundary(client, config);
      await reconcileDiscordMember({ client, config, boundary, discordUserId: userId,
        snapshot: () => invoke("service_read_discord_role_sync", { p_run_id: config.runId, p_discord_user_id: userId }), record });
      summary.checked++;
    } catch (error) {
      summary.failed++;
      const code = ["retry", "rate_limited", "forbidden", "configuration_error"].includes(error.code) ? error.code : "retry";
      await record(code, null, error.retrySeconds || 300).catch(() => {});
      if (["rate_limited", "forbidden", "configuration_error"].includes(code)) break;
    } finally { summary.deferred--; }
  }
  return { accepted: true, summary };
}
