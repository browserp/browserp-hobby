import { endpoint, ok } from "../../lib/api.js";
import { getSession, rpc } from "../../lib/supabase.js";

export default endpoint("GET", async (req, res) => {
  const session = await getSession(req, res);
  if (!session) return ok(res, { dailyAllowance: 3, used: 0, remaining: 3, authenticated: false });
  const balance = await rpc("daily_boost_balance", {}, session.accessToken);
  return ok(res, { ...balance, authenticated: true });
});
