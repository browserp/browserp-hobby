import { readFile } from "node:fs/promises";
import { getSession, rpc } from "./supabase.js";
import { documentSecurityHeaders } from "./document-policy.js";
import { staffDocumentName } from "./staff-document-path.js";

// The public sign-in shell contains no workspace controls or private records.
// Check current server authorization before reading any workspace template.
export default async function staffDocument(req, res) {
  for (const [name, value] of Object.entries(documentSecurityHeaders())) res.setHeader(name, value);
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!["GET", "HEAD"].includes(req.method)) {
    res.setHeader("Allow", "GET, HEAD"); res.statusCode = 405;
    return res.end("Method not allowed");
  }
  const url = new URL(req.url, "http://browserp.local");
  const requested = staffDocumentName(url.searchParams.get("_path") || url.pathname);
  if (!requested) { res.statusCode = 404; return res.end("Page not found"); }
  let template = "staffpanel";
  res.statusCode = 200;
  if (requested !== template) {
    try {
      const session = await getSession(req, res, { required: true, provider: "discord" });
      // This RPC checks live membership, its Discord allowlist assignment and
      // the current auth session, including revocation and account restrictions.
      const policy = await rpc("staff_mfa_policy", {}, session.accessToken);
      if (typeof policy?.staffMfaRequired !== "boolean") throw Object.assign(new Error("Access check unavailable"), { status: 503 });
      if (policy.staffMfaRequired && !(session.aal === "aal2" && session.totpVerified === true && session.factors.some(factor => factor.status === "verified"))) {
        throw Object.assign(new Error("Verification required"), { status: 403 });
      }
      template = requested;
    } catch (error) {
      // Provider details, permission errors and account identifiers never enter
      // the denied HTML. The existing shell handles sign-in and MFA enrollment.
      res.statusCode = [401, 403].includes(error?.status) ? error.status : 503;
    }
  }
  const html = await readFile(new URL(`../public/${template}.html`, import.meta.url), "utf8");
  return res.end(req.method === "HEAD" ? undefined : html);
}
