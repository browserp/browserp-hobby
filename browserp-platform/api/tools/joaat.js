import { endpoint, ok } from "../../lib/api.js";
import { readBody } from "../../lib/http.js";
import { sanitizePlainText } from "../../lib/moderation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { rpc } from "../../lib/supabase.js";
import { joaat } from "../../lib/tools.js";

export default endpoint("POST", async (req, res) => {
  await rateLimit(req, "tool-joaat", 60, 60);
  const body = await readBody(req, 8_192);
  const input = sanitizePlainText(body.input, 160);
  if (!input) throw Object.assign(new Error("Enter a value to hash."), { status: 400 });
  const unsigned = joaat(input);
  const signed = unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
  rpc("record_tool_run", { p_tool_key: "joaat" }).catch(() => {});
  return ok(res, { input, unsigned, signed, hexadecimal: `0x${unsigned.toString(16).toUpperCase().padStart(8, "0")}` });
});
