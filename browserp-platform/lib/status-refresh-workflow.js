import { rpc } from "./supabase.js";
import { readBody } from "./http.js";
import { refreshCfxCode } from "./fivem-workflow.js";
import { refreshMinecraftCode } from "./minecraft-workflow.js";
import { cleanupAdvertMedia } from "./staff-advert-media.js";

// Only the database scheduler holds this opaque credential. Source addresses
// and codes always come from reviewed, published database records.
export async function scheduledStatusRefresh(req, {
  callRpc = rpc, refreshCfx = refreshCfxCode, refreshMinecraft = refreshMinecraftCode,
  now = Date.now, budgetMs = 40_000, signal = AbortSignal.timeout(45_000), cleanupMedia = cleanupAdvertMedia
} = {}) {
  const start = now();
  const authorization = req.headers?.authorization;
  const token = typeof authorization === "string" && /^Bearer [a-f0-9]{64}$/.test(authorization)
    ? authorization.slice(7) : null;
  if (!token) throw Object.assign(new Error("Scheduler authorization required."), { status: 401 });
  const body = await readBody(req, 128);
  if (Object.keys(body).length) throw Object.assign(new Error("This endpoint does not accept source inputs."), { status: 400 });
  const runId = await callRpc("service_claim_status_refresh", { p_token: token }, undefined, { useSecret: true, signal });
  if (!runId) return { accepted: false, reason: "already_running_or_recent" };
  const summary = { requested: 0, checked: 0, unchanged: 0, unavailable: 0, skipped: 0, failed: 0, deferred: 0, durationMs: 0 };
  let sourceReadFailed = false;
  try {
    const [cfx, minecraft] = await Promise.all([
      callRpc("service_cfx_sources", { p_platform: null, p_server_id: null, p_due_only: true, p_limit: 100 }, undefined, { useSecret: true, signal }),
      callRpc("service_minecraft_sources", { p_server_id: null, p_due_only: true, p_limit: 100 }, undefined, { useSecret: true, signal })
    ]);
    if (!Array.isArray(cfx) || !Array.isArray(minecraft)) throw new Error("Invalid registered-source response.");
    const sources = [...minecraft.slice(0, 100).map(source => ({ ...source, platform: "minecraft" })), ...cfx.slice(0, 100)];
    summary.requested = sources.length;
    let cursor = 0;
    const deadline = start + Math.min(Math.max(budgetMs, 0), 40_000);
    async function worker() {
      while (cursor < sources.length && now() < deadline && !signal.aborted) {
        const source = sources[cursor++];
        try {
          if (!/^[a-f0-9-]{36}$/i.test(String(source.serverId || ""))) throw new Error("Invalid registered server.");
          let result;
          if (source.platform === "minecraft") result = await refreshMinecraft(source.joinCode, { serverId: source.serverId, signal });
          else if (["fivem", "redm"].includes(source.platform)) result = await refreshCfx(source.joinCode, { platform: source.platform, signal });
          else throw new Error("Unsupported registered platform.");
          if (!result || result.skipped) summary.skipped++;
          else if (result.unavailable) summary.unavailable++;
          else if (result.unchanged) summary.unchanged++;
          else summary.checked++;
        } catch { summary.failed++; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, sources.length) }, worker));
    summary.deferred = sources.length - cursor;
  } catch {
    sourceReadFailed = true;
    summary.failed++;
  }
  summary.durationMs = Math.max(0, Math.round(now() - start));
  // Source I/O is aborted at 45 seconds. Leave a separate bounded window to
  // record the run before the hosted route's 60-second limit.
  await callRpc("service_finish_status_refresh", { p_run_id: runId, p_summary: summary }, undefined, { useSecret: true, signal: AbortSignal.timeout(8_000) });
  if (sourceReadFailed) throw Object.assign(new Error("The scheduled source list could not be read."), { status: 503 });
  // Reuse the authenticated, leased scheduler. Source checks and their recorded
  // outcome take priority; abandoned artwork gets a separate four-second budget.
  // The cleanup RPC only claims aged, unreferenced assets and retries safely.
  if (now() - start < 54_000) {
    try { await cleanupMedia({ signal: AbortSignal.timeout(4_000) }); }
    catch { console.warn(JSON.stringify({ event: "advert_media_cleanup_deferred", runId })); }
  }
  return { accepted: true, summary };
}
