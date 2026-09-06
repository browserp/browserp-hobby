import { createHash, randomUUID } from "node:crypto";
import { ok } from "./api.js";
import { supabaseConfig } from "./config.js";
import { assertCsrf, assertSameOrigin, readBody } from "./http.js";
import { rateLimit } from "./rate-limit.js";
import { preparedPngRaster } from "./prepared-png.js";
import { getSession, rest, rpc, uploadStorageObject } from "./supabase.js";

const MAX_BYTES = 1_048_576;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH = /^staff\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/;
const invalid = (message = "Choose a valid static advert image, at least 320 × 180 pixels.") => Object.assign(new Error(message), { status: 422 });

// Decode and inspect the actual raster, not the file extension or client dimensions.
// The editor converts supported source files to a small static PNG before upload.
export function advertImage(value) {
  if (typeof value !== "string" || value.length > 1_400_000) throw invalid("The prepared image must be under 1 MB.");
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw invalid("Choose a PNG, JPG or WebP image in the advert editor.");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length < 70 || bytes.length > MAX_BYTES || bytes.toString("base64") !== match[1]) throw invalid();
  return preparedPngRaster(bytes, { minWidth: 320, minHeight: 180, maxWidth: 1600, maxHeight: 1600 });
}

async function removeObject(objectPath, { signal } = {}) {
  signal?.throwIfAborted();
  if (!PATH.test(objectPath)) throw invalid("Invalid advert artwork.");
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) throw Object.assign(new Error("Artwork storage is not configured."), { status: 503 });
  const headers = { apikey: config.secretKey, "Content-Type": "application/json" };
  if (config.secretKey.split(".").length === 3) headers.Authorization = `Bearer ${config.secretKey}`;
  const response = await fetch(`${config.url}/storage/v1/object/advertisements`, {
    method: "DELETE", headers, body: JSON.stringify({ prefixes: [objectPath] }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw Object.assign(new Error("Unused artwork could not be removed yet."), { status: 503 });
}

// A row lock marks an unused asset rejected before deleting its Storage object.
// The advert reference trigger takes the same lock, preventing a save/delete race.
export async function cleanupAdvertMedia({ assetId = null, ownerId = null, signal, rpcImpl = rpc, removeImpl = removeObject } = {}) {
  signal?.throwIfAborted();
  const assets = await rpcImpl("claim_advert_media_cleanup", { p_asset_id: assetId, p_owner_id: ownerId }, undefined, { useSecret: true, signal });
  let removed = 0;
  for (const asset of Array.isArray(assets) ? assets : []) {
    signal?.throwIfAborted();
    await removeImpl(asset.objectPath, { signal });
    signal?.throwIfAborted();
    await rpcImpl("complete_advert_media_cleanup", { p_asset_id: asset.id }, undefined, { useSecret: true, signal });
    removed++;
  }
  return removed;
}

export async function staffAdvertMedia(req, res, requestId, deps = {}) {
  const sessionImpl = deps.getSession || getSession, rpcImpl = deps.rpc || rpc, restImpl = deps.rest || rest;
  const upload = deps.upload || uploadStorageObject, cleanup = deps.cleanup || cleanupAdvertMedia;
  assertSameOrigin(req); assertCsrf(req);
  const session = await sessionImpl(req, res, { required: true, provider: "discord" });
  if (session.aal !== "aal2" || await rpcImpl("has_staff_permission", { p_permission: "adverts.manage" }, session.accessToken) !== true) {
    throw Object.assign(new Error("Advert-management permission and an authenticator check are required."), { status: 403 });
  }
  await (deps.rateLimit || rateLimit)(req, "staff-advert-artwork", 20, 3600);
  const body = await readBody(req, 1_450_000);
  if (body.action === "remove") {
    if (!UUID.test(String(body.assetId || ""))) throw invalid("Choose valid advert artwork.");
    const removed = await cleanup({ assetId: body.assetId, ownerId: session.user.id });
    return ok(res, { removed: Boolean(removed) });
  }
  if (body.action !== "upload") throw invalid("Choose an artwork action.");
  const image = advertImage(body.imageData), id = randomUUID();
  const objectPath = `staff/${session.user.id}/${id}.png`;
  const sha256 = createHash("sha256").update(image.bytes).digest("hex");
  // Register first so an interrupted upload remains discoverable for cleanup.
  await restImpl("uploaded_assets", { method: "POST", useSecret: true, body: {
    id, owner_id: session.user.id, bucket: "advertisements", object_path: objectPath,
    media_type: "advertisement", mime_type: "image/png", byte_size: image.bytes.length, sha256,
    moderation_status: "scanning", moderation_result: { source: "staff-advert-editor", width: image.width, height: image.height, requestId }
  } });
  let uploadConfirmed = false;
  try {
    await upload("advertisements", objectPath, image.bytes, "image/png");
    uploadConfirmed = true;
    // Recheck permission after the network upload, before approving its use.
    if (await rpcImpl("has_staff_permission", { p_permission: "adverts.manage" }, session.accessToken) !== true) throw Object.assign(new Error("Your staff access changed. Sign in again before saving."), { status: 403 });
    await restImpl(`uploaded_assets?id=eq.${id}`, { method: "PATCH", useSecret: true, body: {
      moderation_status: "approved", reviewed_by: session.user.id, reviewed_at: new Date().toISOString()
    } });
  } catch (error) {
    // A lost/late Storage response does not prove that the upload failed. Keep
    // its registration until the aged cleanup pass can remove any late object.
    // Immediate deletion could otherwise finish before Storage writes the file.
    const status = Number(error?.status);
    const uploadRejected = status >= 400 && status < 500 && status !== 408;
    if (uploadConfirmed || uploadRejected) {
      try { await cleanup({ assetId: id, ownerId: session.user.id }); } catch { /* Registered for the next cleanup pass. */ }
    }
    throw error;
  }
  return ok(res, { asset: { id, imageUrl: `${supabaseConfig().url}/storage/v1/object/public/advertisements/${objectPath}`, width: image.width, height: image.height, byteSize: image.bytes.length } }, 201);
}
