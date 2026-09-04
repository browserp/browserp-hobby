import { createHash, randomBytes } from "node:crypto";
import { appUrl, supabaseConfig } from "./config.js";
import { setDiscordClaimToken } from "./discord-claims.js";
import {
  assertCsrf,
  cookie,
  cookieName,
  cookieNames,
  cookieValue,
  parseCookies,
  safeReturnPath,
  secureEqual,
  setCookies
} from "./http.js";

const OAUTH_PROVIDERS = new Set(["discord", "google"]);
const CSRF_REQUEST_TOKEN = Symbol("browserpCsrfToken");
const SESSION_COOKIE_BASES = ["brp_access", "brp_refresh", "brp_csrf", "brp_discord_claim"];
const OAUTH_COOKIE_BASES = [
  "brp_pkce",
  "brp_auth_return",
  "brp_auth_provider",
  "brp_auth_claims",
  "brp_link_user",
  "brp_oauth_state",
  "brp_oauth_nonce"
];
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function timeoutMs() {
  return Math.min(Math.max(Number(process.env.SUPABASE_FETCH_TIMEOUT_MS) || 8_000, 1_000), 15_000);
}

function looksLikeJwt(value) {
  return String(value || "").split(".").length === 3;
}

function apiHeaders({ accessToken, useSecret = false } = {}) {
  const config = supabaseConfig();
  const key = useSecret ? config.secretKey : config.publishableKey;
  if (!key) {
    throw Object.assign(new Error(useSecret
      ? "The server-only BrowseRP database boundary is not configured."
      : "The BrowseRP backend is not connected yet."), {
      status: 503,
      code: useSecret ? "SERVER_BOUNDARY_NOT_CONFIGURED" : "BACKEND_NOT_CONFIGURED"
    });
  }
  const headers = {
    apikey: key,
    "Content-Type": "application/json"
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  else if (looksLikeJwt(key)) headers.Authorization = `Bearer ${key}`;
  return headers;
}

export async function supabaseRequest(path, { method = "GET", body, accessToken, useSecret = false, headers = {}, signal } = {}) {
  signal?.throwIfAborted();
  const config = supabaseConfig();
  if (!config.url || (!useSecret && !config.publishableKey) || (useSecret && !config.secretKey)) {
    throw Object.assign(new Error(useSecret
      ? "The server-only BrowseRP database boundary is not configured."
      : "The BrowseRP backend is not connected yet."), {
      status: 503,
      code: useSecret ? "SERVER_BOUNDARY_NOT_CONFIGURED" : "BACKEND_NOT_CONFIGURED"
    });
  }

  const requestTimeout = AbortSignal.timeout(timeoutMs());
  const requestSignal = signal ? AbortSignal.any([signal, requestTimeout]) : requestTimeout;
  let response, text;
  try {
    response = await fetch(`${config.url}/${String(path).replace(/^\//, "")}`, {
      method,
      headers: { ...apiHeaders({ accessToken, useSecret }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: requestSignal
    });
    text = await response.text();
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw Object.assign(new Error("The backend did not respond in time."), {
        status: 504,
        code: "BACKEND_TIMEOUT"
      });
    }
    throw Object.assign(new Error("The backend could not be reached."), {
      status: 503,
      code: "BACKEND_UNREACHABLE",
      cause: error
    });
  }

  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const message = payload?.message || payload?.msg || payload?.error_description || payload?.error || "Backend request failed.";
    throw Object.assign(new Error(message), { status: response.status, payload, code: payload?.code });
  }
  return { data: payload, response };
}

function expiredCookies(baseNames) {
  return baseNames.flatMap((baseName) => cookieNames(baseName).map((name) => cookie(name, "", { maxAge: 0 })));
}

function transitionCookies(baseName, value, options) {
  const primary = cookieName(baseName);
  return [
    cookie(primary, value, options),
    ...cookieNames(baseName)
      .filter((name) => name !== primary)
      .map((name) => cookie(name, "", { maxAge: 0 }))
  ];
}

function ensureCsrfToken(req, res) {
  if (TOKEN_PATTERN.test(String(req?.[CSRF_REQUEST_TOKEN] || ""))) {
    return req[CSRF_REQUEST_TOKEN];
  }
  const cookies = parseCookies(req);
  let token = cookieValue(cookies, "brp_csrf");
  if (!TOKEN_PATTERN.test(token)) token = randomToken();
  req[CSRF_REQUEST_TOKEN] = token;
  if (cookies[cookieName("brp_csrf")] !== token) {
    setCookies(res, transitionCookies("brp_csrf", token, {
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "Strict"
    }));
  }
  return token;
}

export function setSession(res, session, { csrfToken } = {}) {
  const expiresIn = Math.max(60, Number(session.expires_in || 3600));
  const nextCsrfToken = TOKEN_PATTERN.test(String(csrfToken || "")) ? String(csrfToken) : randomToken();
  setCookies(res, [
    ...transitionCookies("brp_access", session.access_token, { maxAge: expiresIn }),
    ...transitionCookies("brp_refresh", session.refresh_token, { maxAge: 60 * 60 * 24 * 30 }),
    ...transitionCookies("brp_csrf", nextCsrfToken, { maxAge: 60 * 60 * 24 * 30, sameSite: "Strict" }),
    ...expiredCookies(OAUTH_COOKIE_BASES)
  ]);
  return nextCsrfToken;
}

export function clearSession(res) {
  setCookies(res, expiredCookies([...SESSION_COOKIE_BASES, ...OAUTH_COOKIE_BASES]));
}

function clearOAuthState(res) {
  setCookies(res, expiredCookies(OAUTH_COOKIE_BASES));
}

async function userForToken(accessToken) {
  if (!accessToken) return null;
  try {
    const { data } = await supabaseRequest("auth/v1/user", { accessToken });
    return data;
  } catch (error) {
    if (error.status === 401 || error.status === 403) return null;
    throw error;
  }
}

export function currentIdentityProvider(user) {
  const providers = new Set();
  const addProvider = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized) providers.add(normalized);
  };

  addProvider(user?.app_metadata?.provider);
  const metadataProviders = user?.app_metadata?.providers;
  if (metadataProviders !== undefined && !Array.isArray(metadataProviders)) return null;
  if (Array.isArray(metadataProviders) && metadataProviders.length !== 1) return null;
  for (const provider of metadataProviders || []) addProvider(provider);

  const identities = user?.identities;
  if (identities !== undefined && !Array.isArray(identities)) return null;
  if (Array.isArray(identities) && identities.length > 1) return null;
  for (const identity of identities || []) addProvider(identity?.provider);

  if (providers.size !== 1) return null;
  const [provider] = providers;
  return OAUTH_PROVIDERS.has(provider) ? provider : null;
}

// Member connections use verified Auth identities. Staff authorization keeps
// currentIdentityProvider's separate, stricter single-Discord requirement.
export function memberIdentityProviders(user) {
  if (!Array.isArray(user?.identities)) return [];
  return [...new Set(user.identities.map(identity => identity?.provider).filter(provider => OAUTH_PROVIDERS.has(provider)))];
}

export async function hasStaffMembership(userId) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(userId || ""))) throw Object.assign(new Error("Sign in to manage account connections."), { status: 401 });
  const memberships = await rest(`staff_memberships?select=user_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`, { useSecret: true });
  if (!Array.isArray(memberships)) throw Object.assign(new Error("Account connection permissions could not be checked."), { status: 503 });
  return memberships.length > 0;
}

export function safeProviderAuthorizationUrl(value, provider) {
  if (typeof value !== "string" || value.length > 12000 || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
    const allowed = provider === "google" ? url.hostname === "accounts.google.com" && ["/o/oauth2/auth", "/o/oauth2/v2/auth"].includes(url.pathname)
      : provider === "discord" && url.hostname === "discord.com" && ["/oauth2/authorize", "/api/oauth2/authorize"].includes(url.pathname);
    return allowed ? url.href : null;
  } catch { return null; }
}

export function accessTokenClaims(accessToken) {
  const part = String(accessToken || "").split(".")[1];
  if (!part) return {};
  try {
    const parsed = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export async function getSession(req, res, { required = false, provider } = {}) {
  const cookies = parseCookies(req);
  let csrfToken = ensureCsrfToken(req, res);
  let accessToken = cookieValue(cookies, "brp_access");
  let user = await userForToken(accessToken);

  const refreshToken = cookieValue(cookies, "brp_refresh");
  if (!user && refreshToken) {
    try {
      const { data } = await supabaseRequest("auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: refreshToken }
      });
      csrfToken = setSession(res, data, { csrfToken });
      accessToken = data.access_token;
      user = data.user;
    } catch (error) {
      const code = error?.code || error?.payload?.error_code || error?.payload?.error;
      const invalidSession = new Set(["refresh_token_not_found", "refresh_token_already_used", "session_not_found", "session_expired", "invalid_grant", "invalid_credentials", "user_not_found", "user_banned"]);
      // An outage or rate limit does not invalidate a session. Preserve the
      // existing cookies so a later request can retry without another sign-in.
      if (!invalidSession.has(code) && ![401, 403].includes(error?.status)) throw error;
      clearSession(res);
    }
  }

  if (!user && required) throw Object.assign(new Error("Sign in to continue."), { status: 401 });
  if (!user) return null;
  assertCsrf(req);
  const identityProvider = currentIdentityProvider(user);
  if (provider && identityProvider !== provider) {
    throw Object.assign(new Error(`${provider === "discord" ? "Discord" : "The required provider"} sign-in is required for this workspace.`), { status: 403 });
  }
  const claims = accessTokenClaims(accessToken);
  const factors = Array.isArray(user.factors) ? user.factors.filter((factor) => factor?.factor_type === "totp") : [];
  if (supabaseConfig().privileged) {
    const { securityFingerprintContext } = await import("./security.js");
    const security = securityFingerprintContext(req, res);
    // No successful lookup means no authorization decision. Schema, permission
    // and transient backend failures must all deny access without erasing tokens.
    const ban = await rpc("check_security_ban_server", {
      p_user_id: user.id,
      p_network_hash: security.networkHash,
      p_device_hash: security.deviceHash
    }, undefined, { useSecret: true });
    if (ban?.reference) {
      clearSession(res);
      throw Object.assign(new Error(`This account is restricted. Appeal reference: ${ban.reference}`), {
        status: 403,
        code: "ACCOUNT_RESTRICTED",
        reference: ban.reference
      });
    }
  }
  return {
    user,
    accessToken,
    provider: identityProvider,
    csrfToken,
    aal: claims.aal || "aal1",
    factors
  };
}

export function csrfTokenForRequest(req, res) {
  return ensureCsrfToken(req, res);
}

export async function authCapabilities() {
  const { data } = await supabaseRequest("auth/v1/settings");
  return {
    discord: Boolean(data?.external?.discord),
    google: Boolean(data?.external?.google)
  };
}

export function beginOAuth(req, res, provider) {
  const normalizedProvider = String(provider || "").toLowerCase();
  if (!OAUTH_PROVIDERS.has(normalizedProvider)) {
    throw Object.assign(new Error("Unsupported sign-in provider."), { status: 400 });
  }
  const config = supabaseConfig();
  if (!config.configured) throw Object.assign(new Error("Sign-in will be available after the backend is connected."), { status: 503 });

  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomToken();
  const nonce = randomToken();
  const requestUrl = new URL(req.url, appUrl(req));
  const returnTo = safeReturnPath(requestUrl.searchParams.get("returnTo"), "/dashboard");
  const callback = new URL("/api/auth/callback", appUrl(req));
  callback.searchParams.set("brp_state", state);
  callback.searchParams.set("brp_nonce", createHash("sha256").update(nonce).digest("base64url"));

  setCookies(res, [
    ...transitionCookies("brp_pkce", verifier, { maxAge: 600 }),
    ...transitionCookies("brp_auth_return", returnTo, { maxAge: 600 }),
    ...transitionCookies("brp_auth_provider", normalizedProvider, { maxAge: 600 }),
    ...transitionCookies("brp_auth_claims", normalizedProvider === "discord" && requestUrl.searchParams.get("claimGuilds") === "1" ? "1" : "0", { maxAge: 600 }),
    ...expiredCookies(["brp_link_user"]),
    ...transitionCookies("brp_oauth_state", state, { maxAge: 600 }),
    ...transitionCookies("brp_oauth_nonce", nonce, { maxAge: 600 })
  ]);

  const authorize = new URL(`${config.url}/auth/v1/authorize`);
  authorize.searchParams.set("provider", normalizedProvider);
  authorize.searchParams.set("redirect_to", callback.toString());
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "s256");
  if (normalizedProvider === "discord" && requestUrl.searchParams.get("claimGuilds") === "1") authorize.searchParams.set("scopes", "identify email guilds");
  return authorize.toString();
}

export async function beginIdentityLink(req, res, provider, returnTo = "/profile") {
  if (!OAUTH_PROVIDERS.has(provider)) throw Object.assign(new Error("Choose Discord or Google."), { status: 400 });
  const session = await getSession(req, res, { required: true });
  if (await hasStaffMembership(session.user.id)) throw Object.assign(new Error("Additional connections are unavailable for staff accounts. Keep using your assigned Discord account."), { status: 403 });
  if (memberIdentityProviders(session.user).includes(provider)) throw Object.assign(new Error("This provider is already connected to your account."), { status: 409 });
  const destination = returnTo === "/dashboard" ? "/dashboard" : "/profile";
  const authorize = new URL(beginOAuth({ ...req, url: `/api/auth/${provider}?returnTo=${encodeURIComponent(destination)}` }, res, provider));
  const callback = new URL(authorize.searchParams.get("redirect_to")); callback.searchParams.set("brp_link", "1");
  authorize.pathname = "/auth/v1/user/identities/authorize";
  authorize.searchParams.set("redirect_to", callback.toString()); authorize.searchParams.set("skip_http_redirect", "true");
  try {
    const { data } = await supabaseRequest(`${authorize.pathname}${authorize.search}`, { accessToken: session.accessToken });
    const url = safeProviderAuthorizationUrl(data?.url, provider);
    if (!url) throw Object.assign(new Error("The provider did not return a valid connection page. Please try again later."), { status: 502 });
    setCookies(res, transitionCookies("brp_link_user", session.user.id, { maxAge: 600 }));
    return url;
  } catch (error) {
    clearOAuthState(res);
    if (error?.code === "manual_linking_disabled" || error?.payload?.error_code === "manual_linking_disabled") throw Object.assign(new Error("Connecting another account is temporarily unavailable. Your current sign-in still works."), { status: 409, code: "MANUAL_LINKING_DISABLED" });
    throw error;
  }
}

export async function finishOAuth(req, res) {
  const url = new URL(req.url, appUrl(req));
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("brp_state") || "";
  const returnedNonce = url.searchParams.get("brp_nonce") || "";
  const cookies = parseCookies(req);
  const provider = cookieValue(cookies, "brp_auth_provider").toLowerCase();
  const verifier = cookieValue(cookies, "brp_pkce");
  const expectedState = cookieValue(cookies, "brp_oauth_state");
  const nonce = cookieValue(cookies, "brp_oauth_nonce");
  const returnTo = safeReturnPath(cookieValue(cookies, "brp_auth_return"), "/dashboard");
  const linking = url.searchParams.get("brp_link") === "1";
  const linkUser = cookieValue(cookies, "brp_link_user");
  clearOAuthState(res);

  const expectedNonce = TOKEN_PATTERN.test(nonce)
    ? createHash("sha256").update(nonce).digest("base64url")
    : "";
  if (!code || !verifier || !OAUTH_PROVIDERS.has(provider) || linking !== Boolean(linkUser)
      || !TOKEN_PATTERN.test(expectedState) || !TOKEN_PATTERN.test(returnedState)
      || !secureEqual(expectedState, returnedState)
      || !TOKEN_PATTERN.test(expectedNonce) || !TOKEN_PATTERN.test(returnedNonce)
      || !secureEqual(expectedNonce, returnedNonce)) {
    throw Object.assign(new Error("The sign-in request expired. Please try again."), { status: 400 });
  }

  if (linking) {
    const current = await getSession(req, res, { required: true });
    if (current.user.id !== linkUser || await hasStaffMembership(linkUser)) throw Object.assign(new Error("Sign in to the original member account before connecting a provider."), { status: 403 });
  }

  const { data } = await supabaseRequest("auth/v1/token?grant_type=pkce", {
    method: "POST",
    body: { auth_code: code, code_verifier: verifier }
  });
  const strictProvider = currentIdentityProvider(data?.user);
  const requestedIdentity = memberIdentityProviders(data?.user).includes(provider);
  if ((linking && data?.user?.id !== linkUser) || (!requestedIdentity && strictProvider !== provider)) {
    throw Object.assign(new Error("The sign-in provider did not match the request."), { status: 403 });
  }
  if ((linking || strictProvider !== provider) && (/^\/staff(?:panel)?(?:\/|\?|$)/.test(returnTo) || await hasStaffMembership(data.user.id))) throw Object.assign(new Error("Staff sign-in requires the original Discord-only account."), { status: 403 });
  setSession(res, data);
  if (provider === "discord" && cookieValue(cookies, "brp_auth_claims") === "1") {
    try { setDiscordClaimToken(res, data); } catch { /* Claims can still be submitted for manual review. */ }
  }
  return { returnTo: linking ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}connections=linked` : returnTo, provider, user: data.user, accessToken: data.access_token, linked: linking };
}

export async function enrollTotp(accessToken, friendlyName = "BrowseRP staff") {
  const { data } = await supabaseRequest("auth/v1/factors", {
    method: "POST",
    accessToken,
    body: { factor_type: "totp", friendly_name: friendlyName }
  });
  return data;
}

export async function verifyTotp(res, accessToken, factorId, code, csrfToken) {
  const challenge = await supabaseRequest(`auth/v1/factors/${encodeURIComponent(factorId)}/challenge`, {
    method: "POST",
    accessToken,
    body: {}
  });
  const challengeId = challenge.data?.id;
  if (!challengeId) throw Object.assign(new Error("Authenticator challenge could not be started."), { status: 502 });
  const verified = await supabaseRequest(`auth/v1/factors/${encodeURIComponent(factorId)}/verify`, {
    method: "POST",
    accessToken,
    body: { challenge_id: challengeId, code }
  });
  if (!verified.data?.access_token || !verified.data?.refresh_token) {
    throw Object.assign(new Error("Authenticator verification did not return a session."), { status: 502 });
  }
  setSession(res, verified.data, { csrfToken });
  return verified.data;
}

export async function signOut(req, res) {
  const cookies = parseCookies(req);
  const accessToken = cookieValue(cookies, "brp_access");
  if (accessToken || cookieValue(cookies, "brp_refresh")) assertCsrf(req);
  if (accessToken) {
    try { await supabaseRequest("auth/v1/logout", { method: "POST", accessToken }); } catch { /* Local session still clears. */ }
  }
  clearSession(res);
}

export async function rpc(name, body, accessToken, options = {}) {
  return (await supabaseRequest(`rest/v1/rpc/${name}`, {
    method: "POST",
    body,
    accessToken,
    useSecret: Boolean(options.useSecret),
    signal: options.signal
  })).data;
}

export async function rest(path, options = {}) {
  return (await supabaseRequest(`rest/v1/${path}`, options)).data;
}

export async function uploadStorageObject(bucket, objectPath, bytes, contentType) {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) {
    throw Object.assign(new Error("The server-only media boundary is not configured."), {
      status: 503,
      code: "SERVER_BOUNDARY_NOT_CONFIGURED"
    });
  }
  const headers = {
    apikey: config.secretKey,
    "Content-Type": contentType,
    "Cache-Control": "3600",
    "x-upsert": "false"
  };
  if (looksLikeJwt(config.secretKey)) headers.Authorization = `Bearer ${config.secretKey}`;
  const response = await fetch(`${config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers,
    body: bytes,
    signal: AbortSignal.timeout(timeoutMs())
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(payload?.message || payload?.error || "The profile picture could not be stored."), {
      status: response.status,
      code: payload?.statusCode || "STORAGE_UPLOAD_FAILED"
    });
  }
  return payload;
}
