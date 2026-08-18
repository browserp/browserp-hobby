import { endpoint, ok } from "../../lib/api.js";
import { readBody } from "../../lib/http.js";
import { sanitizePlainText } from "../../lib/moderation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { rpc } from "../../lib/supabase.js";
import { generateNames } from "../../lib/tools.js";

export default endpoint("POST", async (req, res) => {
  await rateLimit(req, "tool-name-generator", 60, 60);
  const body = await readBody(req, 8_192);
  const options = {
    platform: sanitizePlainText(body.platform, 40) || "default",
    theme: sanitizePlainText(body.theme, 40) || "default",
    style: sanitizePlainText(body.style, 40) || "casual"
  };
  rpc("record_tool_run", { p_tool_key: "name-generator" }).catch(() => {});
  return ok(res, { names: generateNames(options), generation: "local-rules" });
});
