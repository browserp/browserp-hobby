import { createHash, randomBytes } from "node:crypto";
import { appUrl, supabaseConfig } from "./config.js";
import { cookie, parseCookies, safeReturnPath, setCookies } from "./http.js";

const OAUTH_PROVIDERS = new Set(["discord", "google"]);

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
  const response = await fetch(`${config.url}/${String(path).replace(/^\//, "")}`, {
    method,
    headers: { ...apiHeaders({ accessToken, useSecret }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
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

export function setSession(res, session) {
  const expiresIn = Math.max(60, Number(session.expires_in || 3600));
  setCookies(res, [
    cookie("brp_access", session.access_token, { maxAge: expiresIn }),
    cookie("brp_refresh", session.refresh_token, { maxAge: 60 * 60 * 24 * 30 }),
    cookie("brp_pkce", "", { maxAge: 0 }),
    cookie("brp_auth_return", "", { maxAge: 0 }),
    cookie("brp_auth_provider", "", { maxAge: 0 })
  ]);
}

export function clearSession(res) {
  setCookies(res, [
    cookie("brp_access", "", { maxAge: 0 }),
    cookie("brp_refresh", "", { maxAge: 0 }),
    cookie("brp_pkce", "", { maxAge: 0 }),
    cookie("brp_auth_return", "", { maxAge: 0 }),
    cookie("brp_auth_provider", "", { maxAge: 0 })
  ]);
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
  let accessToken = cookies.brp_access || "";
  let user = await userForToken(accessToken);

  if (!user && cookies.brp_refresh) {
    try {
      const { data } = await supabaseRequest("auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: cookies.brp_refresh }
      });
      setSession(res, data);
      accessToken = data.access_token;
      user = data.user;
    } catch {
      clearSession(res);
    }
  }

  if (!user && required) throw Object.assign(new Error("Sign in to continue."), { status: 401 });
  if (!user) return null;
  const identityProvider = currentIdentityProvider(user);
  if (provider && identityProvider !== provider) {
    throw Object.assign(new Error(`${provider === "discord" ? "Discord" : "The required provider"} sign-in is required for this workspace.`), { status: 403 });
  }
  return { user, accessToken, provider: identityProvider };
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
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const requestUrl = new URL(req.url, appUrl(req));
  const returnTo = safeReturnPath(requestUrl.searchParams.get("returnTo"), "/dashboard");
  const callback = `${appUrl(req)}/api/auth/callback`;
  setCookies(res, [
    cookie("brp_pkce", verifier, { maxAge: 600 }),
    cookie("brp_auth_return", returnTo, { maxAge: 600 }),
    cookie("brp_auth_provider", normalizedProvider, { maxAge: 600 })
  ]);
  const authorize = new URL(`${config.url}/auth/v1/authorize`);
  authorize.searchParams.set("provider", normalizedProvider);
  authorize.searchParams.set("redirect_to", callback);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "s256");
  return authorize.toString();
}

export async function finishOAuth(req, res) {
  const url = new URL(req.url, appUrl(req));
  const code = url.searchParams.get("code");
  const cookies = parseCookies(req);
  const provider = String(cookies.brp_auth_provider || "").toLowerCase();
  if (!code || !cookies.brp_pkce || !OAUTH_PROVIDERS.has(provider)) {
    throw Object.assign(new Error("The sign-in request expired. Please try again."), { status: 400 });
  }
  const { data } = await supabaseRequest("auth/v1/token?grant_type=pkce", {
    method: "POST",
    body: { auth_code: code, code_verifier: cookies.brp_pkce }
  });
  setSession(res, data);
  return { returnTo: safeReturnPath(cookies.brp_auth_return, "/dashboard"), provider };
}

export async function signOut(req, res) {
  const cookies = parseCookies(req);
  if (cookies.brp_access) {
    try { await supabaseRequest("auth/v1/logout", { method: "POST", accessToken: cookies.brp_access }); } catch { /* Local session still clears. */ }
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
