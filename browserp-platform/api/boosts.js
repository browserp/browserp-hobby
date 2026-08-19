import { endpoint, ok } from "../lib/api.js";
import { assertSameOrigin, readBody } from "../lib/http.js";
import { rateLimit } from "../lib/rate-limit.js";
import { getSession, rpc } from "../lib/supabase.js";

export default endpoint("POST", async (req, res) => {
  assertSameOrigin(req);
  const session = await getSession(req, res, { required: true });
  await rateLimit(req, "daily-boost", 6, 60);
  const body = await readBody(req, 8_192);
  const serverId = String(body.serverId || "");
  if (!/^[0-9a-f-]{36}$/i.test(serverId)) throw Object.assign(new Error("Choose a valid server."), { status: 400 });
  const result = await rpc("grant_daily_boost", { p_server_id: serverId }, session.accessToken);
  return ok(res, result, 201);
});
