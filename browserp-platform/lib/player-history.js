import { rest } from "./supabase.js";
import { rateLimit } from "./rate-limit.js";

const HOUR = 3_600_000;
const RANGES = Object.freeze({ "1h": { hours: 1, pages: 1 }, "8h": { hours: 8, pages: 2 }, "12h": { hours: 12, pages: 2 }, "24h": { hours: 24, pages: 3 } });
const PAGE_SIZE = 1000;
const MAX_POINTS = 480;
const GAP_MS = 5 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, status = 502) => { throw Object.assign(new Error(message), { status }); };

export function historySelection(params) {
  if ([...params.keys()].some(key => !["slug", "history"].includes(key)) || params.getAll("slug").length !== 1 || params.getAll("history").length !== 1) fail("Choose one server and history range.", 400);
  const slug = params.get("slug"), range = params.get("history");
  if (slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !Object.hasOwn(RANGES, range)) fail("Choose a valid server and history range.", 400);
  return { slug, range };
}

// Every displayed point is an actual observation. Per-time-bucket extrema keep
// short busy/quiet periods visible without synthesising averages or timestamps.
function sample(points, start, end) {
  if (points.length <= MAX_POINTS) return points;
  const buckets = new Map();
  for (const point of points) {
    const key = Math.min(119, Math.floor((Date.parse(point.at) - start) / (end - start) * 120));
    const bucket = buckets.get(key);
    if (!bucket) buckets.set(key, { first: point, last: point, min: point, max: point });
    else {
      bucket.last = point;
      if (point.players < bucket.min.players) bucket.min = point;
      if (point.players > bucket.max.players) bucket.max = point;
    }
  }
  return [...new Set([...buckets.values()].flatMap(bucket => Object.values(bucket)))].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function mapHistory(rows, { start, end, truncated = false }) {
  const byTime = new Map();
  let invalid = 0;
  for (const row of rows) {
    const time = typeof row?.checked_at === "string" && row.checked_at.length <= 40 ? Date.parse(row.checked_at) : NaN;
    if (!Number.isFinite(time) || time < start || time > end || row.online !== true || !Number.isInteger(row.players) || row.players < 0 || row.players > 100000 || !Number.isInteger(row.capacity) || row.capacity < row.players || row.capacity > 100000) { invalid++; continue; }
    // Rows arrive newest first; retain the highest ID for equal source times.
    if (!byTime.has(time)) byTime.set(time, { at: new Date(time).toISOString(), players: row.players, capacity: row.capacity });
  }
  const all = [...byTime.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let gaps = 0, largestGapMs = 0;
  for (let index = 1; index < all.length; index++) {
    const elapsed = Date.parse(all[index].at) - Date.parse(all[index - 1].at);
    if (elapsed > GAP_MS) gaps++;
    largestGapMs = Math.max(largestGapMs, elapsed);
  }
  const firstAt = all[0]?.at || null, lastAt = all.at(-1)?.at || null;
  const partial = !all.length || truncated || invalid > 0 || gaps > 0 || Date.parse(firstAt) - start > GAP_MS || end - Date.parse(lastAt) > GAP_MS;
  const points = sample(all, start, end);
  return { points, observations: all.length, sampled: points.length < all.length, truncated, partial, firstAt, lastAt, gaps, largestGapSeconds: Math.round(largestGapMs / 1000) };
}

export async function readPlayerHistory(req, params, { read = rest, limit = rateLimit, now = Date.now, signal = AbortSignal.timeout(12_000) } = {}) {
  const { slug, range } = historySelection(params);
  const end = now(), start = end - RANGES[range].hours * HOUR;
  signal.throwIfAborted();
  await limit(req, "player-history", 20, 300);
  signal.throwIfAborted();
  // No member cookie/token is forwarded. Both reads use the publishable key and
  // existing anon RLS, including a second publication check on each snapshot read.
  const lookup = new URLSearchParams({ select: "id,slug,platform_id,status,age_rating,platforms!inner(enabled)", slug: `eq.${slug}`, status: "eq.published", age_rating: "neq.adult", "platforms.enabled": "eq.true", limit: "1" });
  const servers = await read(`servers?${lookup}`, { signal });
  const server = Array.isArray(servers) && servers.length === 1 ? servers[0] : null;
  if (!server || !UUID.test(server.id) || server.slug !== slug || server.status !== "published" || server.age_rating === "adult" || server.platforms?.enabled !== true) fail("This public server listing is unavailable.", 404);
  const supported = ["fivem", "redm", "minecraft"].includes(server.platform_id);
  const base = { slug, range, platform: server.platform_id, scope: server.platform_id === "minecraft" ? "network" : "server", supported, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() };
  if (!supported) return { ...base, ...mapHistory([], { start, end }) };
  const provider = server.platform_id === "minecraft" ? "minecraft" : "cfx";
  const rows = [];
  let truncated = false;
  for (let page = 0; page < RANGES[range].pages; page++) {
    signal.throwIfAborted();
    const query = new URLSearchParams({ select: "checked_at,online,players,capacity", server_id: `eq.${server.id}`, provider_status: `eq.${provider}`, order: "checked_at.desc,id.desc", limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    query.append("checked_at", `gte.${base.startAt}`);
    query.append("checked_at", `lte.${base.endAt}`);
    const batch = await read(`server_status_snapshots?${query}`, { signal });
    if (!Array.isArray(batch) || batch.length > PAGE_SIZE || Buffer.byteLength(JSON.stringify(batch)) > 256_000) fail("Player history could not be verified.");
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    truncated = page === RANGES[range].pages - 1;
  }
  signal.throwIfAborted();
  const payload = { ...base, ...mapHistory(rows, { start, end, truncated }) };
  if (Buffer.byteLength(JSON.stringify(payload)) > 64_000) fail("Player history is too large to display.");
  return payload;
}
