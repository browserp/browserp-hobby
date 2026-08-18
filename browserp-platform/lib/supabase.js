import { createHash, randomBytes } from "node:crypto";
import { appUrl, supabaseConfig } from "./config.js";
import { cookie, parseCookies, safeReturnPath, setCookies } from "./http.js";

function apiHeaders(accessToken) {
  const { publishableKey } = supabaseConfig();
  return {
    apikey: publishableKey,
    Authorization: `Bearer ${accessToken || publishableKey}`,
    "Content-Type": "application/json"
  };
}

export async function supabaseRequest(path, { method = "GET", body, accessToken, headers = {} } = {}) {
  const config = supabaseConfig();
  if (!config.configured) throw Object.assign(new Error("The new BrowseRP backend is not connected yet."), { status: 503, code: "BACKEND_NOT_CONFIGURED" });
  const response = await fetch(`${config.url}/${String(path).replace(/^\//, "")}`, {
    method,
    headers: { ...apiHeaders(accessToken), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const message = payload?.message || payload?.msg || payload?.error_description || payload?.error || "Backend request failed.";
    throw Object.assign(new Error(message), { status: response.status, payload });
  }
  return { data: payload, response };
}

export function setSession(res, session) {
  const expiresIn = Math.max(60, Number(session.expires_in || 3600));
  setCookies(res, [
    cookie("brp_access", session.access_token, { maxAge: expiresIn }),
    cookie("brp_refresh", session.refresh_token, { maxAge: 60 * 60 * 24 * 30 }),
    cookie("brp_pkce", "", { maxAge: 0 }),
    cookie("brp_auth_return", "", { maxAge: 0 })
  ]);
}

export function clearSession(res) {
  setCookies(res, [
    cookie("brp_access", "", { maxAge: 0 }),
    cookie("brp_refresh", "", { maxAge: 0 }),
    cookie("brp_pkce", "", { maxAge: 0 }),
    cookie("brp_auth_return", "", { maxAge: 0 })
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

export async function getSession(req, res, { required = false } = {}) {
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

  if (!user && required) throw Object.assign(new Error("Sign in with Discord to continue."), { status: 401 });
  return user ? { user, accessToken } : null;
}

export function beginDiscordOAuth(req, res) {
  const config = supabaseConfig();
  if (!config.configured) throw Object.assign(new Error("Discord sign-in will be available after the new backend is connected."), { status: 503 });
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const requestUrl = new URL(req.url, appUrl(req));
  const returnTo = safeReturnPath(requestUrl.searchParams.get("returnTo"), "/dashboard");
  const callback = `${appUrl(req)}/api/auth/callback`;
  setCookies(res, [
    cookie("brp_pkce", verifier, { maxAge: 600 }),
    cookie("brp_auth_return", returnTo, { maxAge: 600 })
  ]);
  const authorize = new URL(`${config.url}/auth/v1/authorize`);
  authorize.searchParams.set("provider", "discord");
  authorize.searchParams.set("redirect_to", callback);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "s256");
  return authorize.toString();
}

export async function finishDiscordOAuth(req, res) {
  const url = new URL(req.url, appUrl(req));
  const code = url.searchParams.get("code");
  const cookies = parseCookies(req);
  if (!code || !cookies.brp_pkce) throw Object.assign(new Error("The sign-in request expired. Please try again."), { status: 400 });
  const { data } = await supabaseRequest("auth/v1/token?grant_type=pkce", {
    method: "POST",
    body: { auth_code: code, code_verifier: cookies.brp_pkce }
  });
  setSession(res, data);
  return safeReturnPath(cookies.brp_auth_return, "/dashboard");
}

export async function signOut(req, res) {
  const cookies = parseCookies(req);
  if (cookies.brp_access) {
    try { await supabaseRequest("auth/v1/logout", { method: "POST", accessToken: cookies.brp_access }); } catch { /* Session still clears locally. */ }
  }
  clearSession(res);
}

export async function rpc(name, body, accessToken) {
  return (await supabaseRequest(`rest/v1/rpc/${name}`, { method: "POST", body, accessToken })).data;
}

export async function rest(path, options = {}) {
  return (await supabaseRequest(`rest/v1/${path}`, options)).data;
}
