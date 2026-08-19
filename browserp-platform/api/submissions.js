import { endpoint, ok } from "../lib/api.js";
import { supabaseConfig } from "../lib/config.js";
import { assertSameOrigin, readBody } from "../lib/http.js";
import { assessContent, sanitizePlainText } from "../lib/moderation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { getSession, rpc } from "../lib/supabase.js";

export const SERVER_SUBMISSION_RPC = "create_server_submission_server";

export function buildServerSubmissionRpcPayload(userId, input, moderation) {
  return {
    p_user_id: userId,
    p_name: input.name,
    p_platform_id: input.platform,
    p_region: input.region,
    p_language: input.language,
    p_framework: input.framework || null,
    p_description: input.description,
    p_community_url: input.communityUrl || null,
    p_moderation_confidence: moderation.confidence,
    p_moderation_score: moderation.score,
    p_moderation_reasons: moderation.reasons
  };
}

export default endpoint("POST", async (req, res) => {
  assertSameOrigin(req);
  const session = await getSession(req, res, { required: true });
  await rateLimit(req, "server-submission", 3, 3600);
  const body = await readBody(req);
  const input = {
    name: sanitizePlainText(body.name, 80),
    platform: sanitizePlainText(body.platform, 40),
    region: sanitizePlainText(body.region, 60),
    language: sanitizePlainText(body.language, 60),
    framework: sanitizePlainText(body.framework, 80),
    description: sanitizePlainText(body.description, 1_500),
    communityUrl: sanitizePlainText(body.communityUrl, 300)
  };
  if (!input.name || !input.platform || !input.region || !input.language || input.description.length < 40) {
    throw Object.assign(new Error("A name, platform, region, language and fuller description are required."), { status: 400 });
  }
  if (input.communityUrl) {
    let parsed;
    try { parsed = new URL(input.communityUrl); }
    catch { throw Object.assign(new Error("Enter a valid HTTPS community URL."), { status: 400 }); }
    if (parsed.protocol !== "https:") throw Object.assign(new Error("Community links must use HTTPS."), { status: 400 });
  }
  const moderation = assessContent(input);
  if (moderation.action === "reject") {
    throw Object.assign(new Error("This submission contains a high-risk link or pattern and cannot be accepted."), { status: 422 });
  }

  const database = supabaseConfig();
  let submission;
  if (database.privileged) {
    submission = await rpc(
      SERVER_SUBMISSION_RPC,
      buildServerSubmissionRpcPayload(session.user.id, input, moderation),
      undefined,
      { useSecret: true }
    );
  } else {
    throw Object.assign(new Error("Listing submission is waiting for the server-only database boundary."), { status: 503 });
  }
  return ok(res, { submission }, 202);
});
