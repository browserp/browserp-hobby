import { randomUUID } from "node:crypto";
import { assertCsrf, assertSameOrigin, readBody } from "./http.js";
import { rateLimit } from "./rate-limit.js";
import { recordAccountActivity } from "./security.js";
import { currentIdentityProvider, getSession, rpc, setSession, supabaseRequest } from "./supabase.js";

const MAX_FACTORS = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function factorId(value) { if (typeof value !== "string" || !UUID.test(value)) throw fail("Choose an authenticator from your account."); return value; }
function code(value) { if (typeof value !== "string" || !/^\d{6}$/.test(value)) throw fail("Enter the current six-digit authenticator code."); return value; }
function label(value) {
  if (typeof value !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N} ._'()-]{1,39}$/u.test(value.trim())) throw fail("Use a name of 2–40 letters, numbers or simple punctuation.");
  return value.trim();
}
function safeFactors(user) {
  return (Array.isArray(user?.factors) ? user.factors : []).filter(item => item.factor_type === "totp" && UUID.test(item.id)).map(item => ({
    id: item.id, label: String(item.friendly_name || "Authenticator").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80),
    status: item.status === "verified" ? "verified" : "unverified", createdAt: item.created_at || null
  }));
}
function summary(factors) { return { factors, maxFactors: MAX_FACTORS, canAdd: factors.length < MAX_FACTORS }; }
function qrImage(value) {
  const source = String(value || "").trim();
  if (source.length > 200000) return null;
  if (/^<svg[\s>]/i.test(source)) return `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;
  if (/^data:image\/svg\+xml(?:;base64)?,/i.test(source)) return source;
  return null;
}

// Mounted by the API router. Every operation uses the caller's Auth session;
// the service credential is used only for the existing private audit writer.
export async function staffAuthenticators(req, res, requestId, preloadedSession) {
  if (!["GET", "POST"].includes(req.method)) throw fail("Method not allowed.", 405);
  if (req.method === "POST") assertSameOrigin(req);
  assertCsrf(req);
  // A trusted router session may already contain a refreshed token. Never
  // refresh the request's original cookies a second time in that case.
  const session = preloadedSession || await getSession(req, res, { required: true, provider: "discord" });
  if (!session?.accessToken || !session?.user?.id || currentIdentityProvider(session.user) !== "discord") throw fail("An active Discord staff sign-in is required.", 403);
  let token = session.accessToken;
  if (session.aal !== "aal2" || !await rpc("staff_authenticator_access", {}, token)) throw fail("Verify your staff authenticator before changing sign-in security.", 403);
  const signal = AbortSignal.timeout(45000);
  const userForFactors = async () => {
    const { data } = await supabaseRequest("auth/v1/user", { accessToken: token, signal });
    if (data?.id !== session.user.id || currentIdentityProvider(data) !== "discord") throw fail("Your staff session has changed. Sign in again.", 403);
    return safeFactors(data);
  };
  if (req.method === "GET") return { authenticators: summary(await userForFactors()) };
  const body = await readBody(req, 2048);
  if (!["enroll", "verify", "remove"].includes(body.action)) throw fail("Choose a supported authenticator action.");
  const name = body.action === "enroll" ? label(body.label) : null;
  const target = body.action !== "enroll" ? factorId(body.factorId) : null;
  if (body.action === "verify") code(body.code);
  await rateLimit(req, "staff-authenticators", 8, 600);
  const operation = randomUUID();
  const locked = await rpc("staff_authenticator_operation", { p_action: "acquire", p_operation_id: operation }, token, { signal });
  if (!locked) throw fail("An authenticator change is already being checked. Wait two minutes, then refresh.", 409);
  let uncertain = false;
  const providerWrite = async (path, method, data) => {
    try { return (await supabaseRequest(path, { method, body: data, accessToken: token, signal })).data; }
    catch (error) {
      if (!error.status || error.status === 408 || error.status >= 500) uncertain = true;
      if (error.status === 400 || error.status === 422) throw fail("The authenticator could not be verified or changed. Check its name and current code, then try again.");
      throw error;
    }
  };
  const verify = async (id, value) => {
    const challenge = await providerWrite(`auth/v1/factors/${id}/challenge`, "POST", {});
    if (!UUID.test(challenge?.id || "")) throw fail("The verification service returned an incomplete response. Please refresh.", 502);
    const verified = await providerWrite(`auth/v1/factors/${id}/verify`, "POST", { challenge_id: challenge.id, code: code(value) });
    if (verified?.user?.id !== session.user.id || currentIdentityProvider(verified.user) !== "discord" || !verified.access_token || !verified.refresh_token) {
      uncertain = true; throw fail("Your staff session could not be verified. Sign in again.", 403);
    }
    token = verified.access_token;
    setSession(res, verified, { csrfToken: session.csrfToken });
  };
  const audit = async (eventType, factor) => {
    try { await recordAccountActivity(req, res, { userId: session.user.id, provider: "discord", requestId, eventType, metadata: { factorId: factor.id, label: factor.label } }); }
    catch { console.error(JSON.stringify({ event: "staff_authenticator_audit_failed", requestId, action: eventType })); }
  };
  try {
    let factors = await userForFactors();
    if (!factors.some(item => item.status === "verified")) throw fail("Verify your staff authenticator before changing sign-in security.", 403);
    if (body.action === "enroll") {
      if (factors.length >= MAX_FACTORS) throw fail("You can keep up to three authenticators. Remove an unused one before adding another.", 409);
      if (factors.some(item => item.label.toLowerCase() === name.toLowerCase())) throw fail("Choose a different name so you can tell your authenticators apart.", 409);
      const enrolled = await providerWrite("auth/v1/factors", "POST", { factor_type: "totp", friendly_name: name, issuer: "BrowseRP" });
      if (!UUID.test(enrolled?.id || "") || !/^[A-Z2-7]{16,128}$/i.test(enrolled?.totp?.secret || "")) { uncertain = true; throw fail("The setup response was incomplete. Refresh to check for an unfinished authenticator.", 502); }
      await audit("auth.mfa_enrolled", { id: enrolled.id, label: name });
      return { authenticators: summary(await userForFactors()), setup: { id: enrolled.id, label: name, qrCode: qrImage(enrolled.totp.qr_code), secret: enrolled.totp.secret } };
    }
    const chosen = factors.find(item => item.id === target);
    if (!chosen) throw fail("This authenticator is no longer on your account. Refresh and try again.", 404);
    if (body.action === "verify") {
      if (chosen.status !== "unverified") throw fail("This authenticator is already verified.", 409);
      await verify(chosen.id, body.code);
      await audit("auth.mfa_verified", chosen);
    } else {
      if (chosen.status === "verified") {
        const alternate = factorId(body.alternateFactorId);
        if (alternate === chosen.id || !factors.some(item => item.id === alternate && item.status === "verified")) throw fail("Keep another verified authenticator and enter its code before removing this one.", 409);
        await verify(alternate, body.code);
        // Verification rotates the session onto the factor we are KEEPING.
        // Reload while holding the lease, including after external changes.
        factors = await userForFactors();
        if (!factors.some(item => item.id === alternate && item.status === "verified") || factors.filter(item => item.status === "verified").length < 2) throw fail("Your last verified authenticator cannot be removed. Refresh your authenticators.", 409);
      }
      // Recheck the current membership/session immediately before deletion.
      if (!await rpc("staff_authenticator_access", {}, token, { signal })) throw fail("Your staff access has changed. Sign in again.", 403);
      await providerWrite(`auth/v1/factors/${chosen.id}`, "DELETE");
      await audit("auth.mfa_removed", chosen);
    }
    return { authenticators: summary(await userForFactors()) };
  } finally {
    // A timed-out provider write may still be completing. Let the lease expire
    // instead of letting a competing change start immediately with stale data.
    if (!uncertain) {
      try { await rpc("staff_authenticator_operation", { p_action: "release", p_operation_id: operation }, token); }
      catch { console.error(JSON.stringify({ event: "staff_authenticator_unlock_failed", requestId })); }
    }
  }
}
