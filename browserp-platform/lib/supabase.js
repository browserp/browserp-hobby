import { createHash, randomBytes } from "node:crypto";
import { appUrl, supabaseConfig } from "./config.js";
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
const SESSION_COOKIE_BASES = ["brp_access", "brp_refresh", "brp_csrf"];
const OAUTH_COOKIE_BASES = [
  "brp_pkce",
  "brp_auth_return",
  "brp_auth_provider",
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

export async function supabaseRequest(path, { method = "GET", body, accessToken, useSecret = false, headers = {} } = {}) {
  const config = supabaseConfig();
  if (!config.url || (!useSecret && !config.publishableKey) || (useSecret && !config.secretKey)) {
    throw Object.assign(new Error(useSecret
      ? "The server-only BrowseRP database boundary is not configured."
      : "The BrowseRP backend is not connected yet."), {
      status: 503,
      code: useSecret ? "SERVER_BOUNDARY_NOT_CONFIGURED" : "BACKEND_NOT_CONFIGURED"
    });
  }

  let response;
  try {
    response = await fetch(`${config.url}/${String(path).replace(/^\//, "")}`, {
      method,
      headers: { ...apiHeaders({ accessToken, useSecret }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs())
    });
  } catch (error) {
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

  const text = await response.text();
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
    } catch {
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
  return { user, accessToken, provider: identityProvider, csrfToken };
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
    ...transitionCookies("brp_oauth_state", state, { maxAge: 600 }),
    ...transitionCookies("brp_oauth_nonce", nonce, { maxAge: 600 })
  ]);

  const authorize = new URL(`${config.url}/auth/v1/authorize`);
  authorize.searchParams.set("provider", normalizedProvider);
  authorize.searchParams.set("redirect_to", callback.toString());
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "s256");
  return authorize.toString();
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
  clearOAuthState(res);

  const expectedNonce = TOKEN_PATTERN.test(nonce)
    ? createHash("sha256").update(nonce).digest("base64url")
    : "";
  if (!code || !verifier || !OAUTH_PROVIDERS.has(provider)
      || !TOKEN_PATTERN.test(expectedState) || !TOKEN_PATTERN.test(returnedState)
      || !secureEqual(expectedState, returnedState)
      || !TOKEN_PATTERN.test(expectedNonce) || !TOKEN_PATTERN.test(returnedNonce)
      || !secureEqual(expectedNonce, returnedNonce)) {
    throw Object.assign(new Error("The sign-in request expired. Please try again."), { status: 400 });
  }

  const { data } = await supabaseRequest("auth/v1/token?grant_type=pkce", {
    method: "POST",
    body: { auth_code: code, code_verifier: verifier }
  });
  if (currentIdentityProvider(data?.user) !== provider) {
    throw Object.assign(new Error("The sign-in provider did not match the request."), { status: 403 });
  }
  setSession(res, data);
  return { returnTo, provider };
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
    useSecret: Boolean(options.useSecret)
  })).data;
}

export async function rest(path, options = {}) {
  return (await supabaseRequest(`rest/v1/${path}`, options)).data;
}
