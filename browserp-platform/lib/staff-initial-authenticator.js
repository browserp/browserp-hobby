import { randomUUID } from "node:crypto";
import { assertCsrf, assertSameOrigin, readBody } from "./http.js";
import { currentIdentityProvider, getSession, rpc, setSession, supabaseRequest } from "./supabase.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

async function initialOperation(req, res, requestId, action, preloadedSession) {
  assertSameOrigin(req);
  assertCsrf(req);
  // Only the router may pass a session it has already authenticated. Reusing
  // that result avoids refreshing the same original cookie twice in one request.
  const session = preloadedSession || await getSession(req, res, { required: true, provider: "discord" });
  if (!session?.accessToken || !session?.user?.id || currentIdentityProvider(session.user) !== "discord") throw fail("An active Discord staff sign-in is required.", 403);
  const context = { token: session.accessToken };
  const operationId = randomUUID(), signal = AbortSignal.timeout(45000);
  const operation = name => rpc("staff_initial_authenticator_operation", { p_action: name, p_operation_id: operationId }, context.token, { signal });
  if (!await operation("acquire")) throw fail("Another setup change is finishing. Wait two minutes, then refresh.", 409);
  let uncertain = false;
  context.readFactors = async () => {
    const { data } = await supabaseRequest("auth/v1/user", { accessToken: context.token, signal });
    if (data?.id !== session.user.id || currentIdentityProvider(data) !== "discord") throw fail("Your staff sign-in changed. Sign in again.", 403);
    const factors = Array.isArray(data.factors) ? data.factors : [];
    if (factors.some(factor => factor.status === "verified")) throw fail("An authenticator is already verified. Sign in with it to manage your security.", 409);
    return factors.filter(factor => factor.factor_type === "totp" && UUID.test(factor.id));
  };
  context.check = async () => { if (!await operation("check")) throw fail("This setup changed. Refresh before trying again.", 409); };
  context.write = async (path, method, body) => {
    try { return (await supabaseRequest(path, { method, body, accessToken: context.token, signal })).data; }
    catch (error) { if (!error.status || error.status === 408 || error.status >= 500) uncertain = true; throw error; }
  };
  context.acceptSession = data => {
    if (data?.user?.id !== session.user.id || currentIdentityProvider(data.user) !== "discord" || !data.access_token || !data.refresh_token) {
      uncertain = true; throw fail("Your staff sign-in could not be verified. Sign in again.", 403);
    }
    context.token = data.access_token; setSession(res, data, { csrfToken: session.csrfToken });
  };
  try { return await action(context); }
  finally {
    if (!uncertain) {
      try { await rpc("staff_initial_authenticator_operation", { p_action: "release", p_operation_id: operationId }, context.token); }
      catch { console.error(JSON.stringify({ event: "staff_initial_authenticator_unlock_failed", requestId })); }
    }
  }
}

// Router applies the enrolment rate limit and records auth.mfa_enrolled.
// Return the provider factor to its existing safe QR/secret response mapper.
export async function prepareInitialStaffAuthenticator(req, res, requestId, preloadedSession) {
  const body = await readBody(req, 4096);
  const action = body.action || "enroll";
  if (!["enroll", "restart"].includes(action)) throw fail("Choose a valid setup action.");
  if (action === "restart" && !UUID.test(String(body.factorId || ""))) throw fail("Choose your unfinished authenticator setup.");
  return initialOperation(req, res, requestId, async context => {
    const factors = await context.readFactors();
    let name = "BrowseRP staff";
    if (action === "restart") {
      const factor = factors.find(item => item.id === body.factorId && item.status === "unverified");
      if (!factor) throw fail("This unfinished setup is no longer on your account. Refresh and try again.", 409);
      // Retain the selected setup's name so another pending factor is not
      // accidentally chosen or deleted merely because it has a similar label.
      name = typeof factor.friendly_name === "string" && factor.friendly_name.length <= 50 ? factor.friendly_name : name;
      await context.check();
      await context.write(`auth/v1/factors/${factor.id}`, "DELETE");
    } else if (factors.length) {
      throw fail("You already have an unfinished setup. Enter its code or choose Start again.", 409);
    }
    await context.check();
    const created = await context.write("auth/v1/factors", "POST", { factor_type: "totp", friendly_name: name, issuer: "BrowseRP" });
    if (!UUID.test(created?.id || "") || !created?.totp?.secret) throw fail("Setup could not be confirmed. Refresh to check your unfinished setup.", 502);
    return created;
  }, preloadedSession);
}

// The return value is a provider session for server-side MFA policy/audit work.
// Never serialize it into the public response. Session cookies are set here.
export async function verifyInitialStaffAuthenticator(req, res, requestId, preloadedSession) {
  const body = await readBody(req, 4096);
  const factorId = String(body.factorId || ""), code = String(body.code || "").replace(/\s+/g, "");
  if (!UUID.test(factorId) || !/^\d{6}$/.test(code)) throw fail("Enter the current six-digit code from your unfinished setup.");
  return initialOperation(req, res, requestId, async context => {
    const factors = await context.readFactors();
    if (!factors.some(factor => factor.id === factorId && factor.status === "unverified")) throw fail("Choose an unfinished setup attached to your account.", 409);
    await context.check();
    const challenge = await context.write(`auth/v1/factors/${factorId}/challenge`, "POST", {});
    if (!UUID.test(challenge?.id || "")) throw fail("The verification service could not start. Try again.", 502);
    const verified = await context.write(`auth/v1/factors/${factorId}/verify`, "POST", { challenge_id: challenge.id, code });
    context.acceptSession(verified); return verified;
  }, preloadedSession);
}
