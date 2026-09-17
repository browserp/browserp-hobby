// Local-only visual review data. Never imported by the application or deployed API.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import "../public/discovery-model.js";
import { createPublicPageHandler } from "../lib/public-pages.js";
const root = resolve(import.meta.dirname, "../public");
const discovery = globalThis.BrowseRPDiscovery;
const fixturePort = Number(process.env.BROWSERP_FIXTURE_PORT || 4189);
if (!Number.isSafeInteger(fixturePort) || fixturePort < 1024 || fixturePort > 65535) throw new Error("Choose a valid local fixture port.");
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
const fixtureStaff = process.env.BROWSERP_FIXTURE_STAFF === "1";
// Opt-in mode represents an already-approved test message; default sends stay private.
const fixtureMessageApproved = process.env.BROWSERP_FIXTURE_MESSAGE_MODE === "approved";
const accountId = "11111111-1111-4111-8111-111111111111";
const csrfToken = "local-fixture";
const favorites = new Set();
const serverId = index => `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`;
const profile = { username: "preview_member", display_name: "Preview Member", avatar_url: "https://www.browserp.com/assets/browserp-icon-192.png", approved_avatar_url: "https://www.browserp.com/assets/browserp-icon-192.png", avatar_review_status: "approved", bio: "A local-only layout preview.", profile_visibility: "public" };
const members = new Map([
  ["public_member", { username: "public_member", displayName: "Public Member", bio: "A synthetic public profile for layout review.", avatarUrl: "/assets/browserp-icon-192.png", joinedAt: "2026-09-01T10:00:00.000Z", bannerStyle: "aurora", visibility: "public", staffRole: "", badges: [], servers: [] }],
  ["basic_member", { username: "basic_member", avatarUrl: "/api/public/basic-profile-avatar?username=basic_member", visibility: "basic" }]
]);
const publicMemberPage = createPublicPageHandler({ data: { member: async username => {
  if (username !== profile.username) return members.get(username) || null;
  if (profile.profile_visibility === "basic") return { username, avatarUrl: `/api/public/basic-profile-avatar?username=${username}`, visibility: "basic" };
  if (profile.profile_visibility !== "public") return null;
  return { ...members.get("public_member"), username, displayName: profile.display_name, bio: profile.bio };
} } });
const conversationId = index => `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`;
const messageId = index => `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`;
let nextConversation = 2, nextMessage = 2, contactPolicy = "members";
const blockedMembers = new Set();
const conversations = new Map([[conversationId(1), { id: conversationId(1), username: "basic_member", messages: [
  { id: messageId(1), body: "Hi! This is a synthetic unread message for local visual review.", fromMe: false, createdAt: new Date(Date.now() - 10 * 60_000).toISOString(), readAt: null }
] }]]);
const notifications = [{ id: "77777777-7777-4777-8777-000000000001", kind: "member_message", title: "New message", body: "From basic_member", action_url: `/dashboard?thread=${conversationId(1)}#inbox`, created_at: new Date(Date.now() - 10 * 60_000).toISOString(), read_at: null }];
const displayName = username => username === "public_member" ? "Public Member" : username === profile.username && profile.profile_visibility === "public" ? profile.display_name : username;
const knownMember = username => username === profile.username && ["public", "basic"].includes(profile.profile_visibility) || members.has(username);
const json = (res, status, data) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
const fail = (res, status, error) => json(res, status, { error });
async function mutation(req, res, url, maximum = 4096) {
  const cookie = String(req.headers.cookie || "").split(";").some(value => value.trim() === `brp_csrf=${csrfToken}`);
  if (req.headers.origin !== url.origin || req.headers["x-browserp-csrf"] !== csrfToken || !cookie) { fail(res, 403, "Local fixture CSRF check failed"); return null; }
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > maximum) { fail(res, 413, "Fixture request too large"); return null; } }
  try { const body = JSON.parse(raw); if (body && typeof body === "object" && !Array.isArray(body)) return body; } catch {}
  fail(res, 400, "Invalid fixture request"); return null;
}
function inboxOverview() {
  const rows = [...conversations.values()].map(row => ({ id: row.id, username: row.username, displayName: displayName(row.username), lastMessageAt: row.messages.at(-1)?.createdAt,
    unread: row.messages.filter(message => !message.fromMe && !message.readAt).length, blockedByMe: blockedMembers.has(row.username) }));
  return { contactPolicy, unread: rows.reduce((sum, row) => sum + row.unread, 0), conversations: rows,
    blockedMembers: [...blockedMembers].map(username => ({ username, displayName: displayName(username) })) };
}
function inboxThread(id) {
  const row = conversations.get(id);
  if (!row) return null;
  return { id, username: row.username, displayName: displayName(row.username), blockedByMe: blockedMembers.has(row.username), canReply: contactPolicy === "members" && !blockedMembers.has(row.username),
    messages: row.messages.map(message => ({ ...message })), nextBeforeId: null };
}
function history(slug, range, server) {
  const hours = { "1h": 1, "8h": 8, "12h": 12, "24h": 24 }[range];
  if (!hours || !server) return null;
  const end = Date.now(), start = end - hours * 3_600_000;
  const supported = server.platform_id !== "roblox";
  const points = supported ? Array.from({ length: 7 }, (_, index) => ({ at: new Date(start + Math.round((end - start) * (index + 1) / 8)).toISOString(), players: 48 + index * 5 + index % 2 * 4, capacity: 128 })) : [];
  return { slug, range, scope: server.platform_id === "minecraft" ? "network" : "server", supported, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(),
    points, observations: points.length, firstAt: points[0]?.at || null, lastAt: points.at(-1)?.at || null, partial: false, truncated: false, sampled: false };
}
const servers = Array.from({ length: 6 }, (_, index) => ({ id: serverId(index), slug: `preview-community-${index}`, name: `Preview Community ${index + 1}`, platform_id: "fivem", platform_name: "FiveM", region: index < 4 ? "United Kingdom" : "United States", language: "English", framework: "vMenu", access_type: index % 2 ? "public" : "whitelisted", description: "Local layout preview only. Build a character, meet your community and explore a shared world of roleplay. This listing is never published.", tags: index % 2 ? ["Economy", "Custom cars"] : ["Economy", "Custom clothing"], online: true, players: 60 + index, capacity: 128, checked_at: new Date(Date.now() - (index === 1 ? 10 * 60_000 : 0)).toISOString(), logo_url: "https://www.browserp.com/assets/browserp-icon-192.png" }));
for (const [platform_id, platform_name, framework, tags] of [["redm", "RedM", "VORP", ["Ranching", "Economy"]], ["roblox", "Roblox", "city rp", ["Vehicles", "Housing"]], ["minecraft", "Minecraft", "SMP", ["Bedrock", "Crossplay"]]]) {
  const index = servers.length;
  servers.push({ ...servers[0], id: serverId(index), slug: `preview-community-${index}`, name: `Preview ${platform_name} Community`, platform_id, platform_name, framework, tags, access_type: "public", applicationOnly: platform_id === "roblox" });
}
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, fixtureOrigin);
    if (req.headers.host !== `127.0.0.1:${fixturePort}` || req.socket.remoteAddress !== "127.0.0.1"
      || req.headers.origin && req.headers.origin !== fixtureOrigin) { fail(res, 403, "Local fixture only"); return; }
    if (url.pathname.startsWith("/user/")) { await publicMemberPage(req, res); return; }
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname.startsWith("/api/admin/")) {
        if (fixtureStaff && url.pathname === "/api/admin/presence" && req.method === "POST") {
          if (!(await mutation(req, res, url))) return;
          json(res, 200, { received: true }); return;
        }
        if (!fixtureStaff || req.method !== "GET") { fail(res, 403, "Synthetic staff access only"); return; }
        const cookie = String(req.headers.cookie || "").split(";").some(value => value.trim() === `brp_csrf=${csrfToken}`);
        if (!cookie) { fail(res, 401, "Synthetic staff session required"); return; }
        const range = url.searchParams.get("range") || "30d";
        const website = { generatedAt: new Date().toISOString(), metrics: { totalUsers: 42, publishedServers: 9, publishedBlogs: 2, activeStaff: 4 },
          permissions: { manageBlogs: true, manageAnnouncements: true, manageAdverts: true }, users: { range, total: 42, newUsers: 2, granularity: "day", bucketDays: 1,
            series: [{ date: "2026-09-15", newUsers: 1, totalUsers: 41 }, { date: "2026-09-16", newUsers: 1, totalUsers: 42 }] } };
        if (url.pathname === "/api/admin/overview") { json(res, 200, { overview: url.searchParams.has("range") ? { website } :
          { pendingSubmissions: 0, openReports: 0, securityAlerts: 0, listingQueue: [], reportQueue: [], recentAudit: [] } }); return; }
        if (url.pathname === "/api/admin/moderation" && url.searchParams.get("view") === "summary") { json(res, 200, { summary: { capabilities: { readListings: true, readReports: true, readSecurity: true, readAudit: true }, permissions: { keys: ["servers.review", "reports.read"] } } }); return; }
        if (url.pathname === "/api/admin/advertising-enquiries") { json(res, 200, url.searchParams.has("access") ? { canReview: true } : { items: [{ id: "99999999-9999-4999-8999-000000000001", subject: "Synthetic community advert enquiry", status: "submitted", placement: "homepage", message: "Local visual fixture only. No real member sent this enquiry.", displayName: "Fixture Member", createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "2026-09-16T10:00:00.000Z", version: 1 }], next: null }); return; }
        if (url.pathname === "/api/admin/adverts") { json(res, 200, { adverts: [] }); return; }
        if (url.pathname === "/api/admin/blogs") { json(res, 200, { posts: [] }); return; }
        if (url.pathname === "/api/admin/announcements") { json(res, 200, { announcements: [] }); return; }
        if (url.pathname === "/api/admin/duty") { json(res, 200, url.searchParams.get("view") === "self" ? { duty: { availability: "available", displayName: "Fixture Staff", userId: accountId } } : { availability: [], nextAfterUserId: null }); return; }
        if (url.pathname === "/api/admin/authenticators") { json(res, 200, { factors: [] }); return; }
        if (url.pathname === "/api/admin/featured-boost") { json(res, 200, { feature: null }); return; }
        if (url.pathname === "/api/admin/refresh-health") { json(res, 200, { sources: [], alerts: [] }); return; }
        fail(res, 404, "No synthetic staff fixture for this API"); return;
      }
      if (url.pathname === "/api/public/basic-profile-avatar") {
        const username = url.searchParams.get("username");
        if (req.method !== "GET" || username !== "basic_member" && !(username === profile.username && profile.profile_visibility === "basic")) { fail(res, 404, "Picture not found"); return; }
        const bytes = await readFile(resolve(root, "assets/browserp-icon-192.png"));
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": bytes.length, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }); res.end(bytes); return;
      }
      if (url.pathname === "/api/me/messages") {
        const cookie = String(req.headers.cookie || "").split(";").some(value => value.trim() === `brp_csrf=${csrfToken}`);
        if (req.headers["x-browserp-account"] !== accountId || !cookie) { fail(res, 401, "Synthetic account required"); return; }
        if (req.method === "GET") {
          const thread = url.searchParams.get("thread");
          if (thread) { const item = inboxThread(thread); if (!item) { fail(res, 404, "Conversation unavailable"); return; } json(res, 200, { thread: item }); return; }
          if (url.searchParams.has("before")) { fail(res, 400, "Choose a conversation first"); return; }
          json(res, 200, { inbox: inboxOverview() }); return;
        }
        if (req.method !== "POST") { fail(res, 405, "Method not allowed"); return; }
        const body = await mutation(req, res, url); if (!body) return;
        if (body.action === "send") {
          const username = String(body.username || "").trim().toLowerCase(), text = String(body.body || "").trim();
          if (!/^[a-z0-9_]{3,30}$/.test(username) || !knownMember(username) || username === profile.username || !text || text.length > 1000 || contactPolicy !== "members" || blockedMembers.has(username)) { fail(res, 400, "Member unavailable for messages"); return; }
          let row = [...conversations.values()].find(item => item.username === username);
          if (!row) { row = { id: conversationId(nextConversation++), username, messages: [] }; conversations.set(row.id, row); }
          const createdAt = new Date().toISOString(), id = messageId(nextMessage++);
          const status = fixtureMessageApproved ? "delivered" : "pending_review";
          row.messages.push({ id, body: text, fromMe: true, createdAt, readAt: null, status });
          json(res, fixtureMessageApproved ? 201 : 202, { result: { conversationId: row.id, messageId: id, createdAt, status } }); return;
        }
        if (body.action === "read") {
          const row = conversations.get(body.conversationId);
          if (!row) { fail(res, 404, "Conversation unavailable"); return; }
          let count = 0; for (const message of row.messages) if (!message.fromMe && !message.readAt) { message.readAt = new Date().toISOString(); count++; }
          for (const item of notifications) if (item.action_url.includes(row.id)) item.read_at = new Date().toISOString();
          json(res, 200, { markedRead: count }); return;
        }
        if (body.action === "policy") {
          if (!["members", "nobody"].includes(body.policy)) { fail(res, 400, "Choose who can message you"); return; }
          contactPolicy = body.policy; json(res, 200, { result: { contactPolicy } }); return;
        }
        if (body.action === "block") {
          if (typeof body.blocked !== "boolean" || !/^[a-z0-9_]{3,30}$/.test(body.username || "") || !knownMember(body.username)) { fail(res, 400, "Choose a member and action"); return; }
          if (body.blocked) blockedMembers.add(body.username); else blockedMembers.delete(body.username);
          json(res, 200, { result: { username: body.username, blocked: body.blocked } }); return;
        }
        if (body.action === "report") {
          const found = [...conversations.values()].some(row => row.messages.some(item => item.id === body.messageId && !item.fromMe));
          if (!found || !["harassment", "spam", "unsafe-content", "threat"].includes(body.category) || typeof body.details !== "string" || body.details.trim().length < 20 || body.details.length > 800) { fail(res, 400, "Check the report"); return; }
          json(res, 201, { result: { id: "88888888-8888-4888-8888-000000000001", status: "open" } }); return;
        }
        fail(res, 400, "Choose a message action"); return;
      }
      if (url.pathname === "/api/me/notifications/read") {
        if (req.method !== "POST" || !(await mutation(req, res, url))) return;
        const count = notifications.filter(item => !item.read_at).length;
        for (const item of notifications) item.read_at = new Date().toISOString();
        json(res, 200, { markedRead: count }); return;
      }
      let data = {};
      res.setHeader("Cache-Control", "no-store");
      if (url.pathname === "/api/auth/session") {
        res.setHeader("Set-Cookie", `brp_csrf=${csrfToken}; Path=/; SameSite=Strict`);
        data = { authenticated: true, staff: fixtureStaff, staffAccess: fixtureStaff, provider: fixtureStaff ? "discord" : "google", mfa: { required: false }, csrfToken, user: { id: accountId, profile } };
      }
      if (url.pathname === "/api/me/profile") {
        if (req.method === "POST") {
          const body = await mutation(req, res, url); if (!body) return;
          if (!["public", "basic", "members", "private"].includes(body.visibility) || typeof body.bio !== "string" || body.bio.length > 500) { fail(res, 400, "Check profile details"); return; }
          profile.profile_visibility = body.visibility; profile.bio = body.bio;
        } else if (req.method !== "GET") { fail(res, 405, "Method not allowed"); return; }
        data = { profile };
      }
      if (url.pathname === "/api/me/overview") data = { overview: { profile, servers: [], submissions: [], favoriteServers: servers.filter(server => favorites.has(server.id)), notifications,
        unreadNotifications: notifications.filter(item => !item.read_at).length } };
      if (url.pathname === "/api/me/content-moderation") data = { items: [], nextBefore: null };
      if (url.pathname === "/api/me/banner") {
        if (req.method === "POST") { const body = await mutation(req, res, url); if (!body) return; data = { bannerStyle: body.style }; }
        else data = { username: profile.username, bannerStyle: "aurora", visibility: profile.profile_visibility };
      }
      if (url.pathname === "/api/me/connections") data = { connections: { accountId, canManage: true, reauthenticationRequired: true, message: "Sign in again before changing connected accounts.", providers: [{ provider: "discord", connected: false, enabled: true, canConnect: false }, { provider: "google", connected: true, enabled: true, canConnect: false }] } };
      if (url.pathname === "/api/auth/providers") data = { providers: { discord: true, google: true } };
      if (url.pathname === "/api/public/adverts") data = { adverts: [] };
      if (url.pathname === "/api/public/content") data = { content: {} };
      if (url.pathname === "/api/public/announcements") data = { announcements: [] };
      if (url.pathname === "/api/servers") {
        const range = url.searchParams.get("history");
        if (range) {
          const slug = url.searchParams.get("slug"), result = history(slug, range, servers.find(server => server.slug === slug));
          if (!result) { fail(res, 400, "Choose a recorded player history range"); return; }
          json(res, 200, result); return;
        }
        const filters = discovery.normalize(Object.fromEntries(url.searchParams));
        const slug = url.searchParams.get("slug");
        const items = servers.filter(server => (!slug || server.slug === slug) && discovery.matches(server, filters));
        const end = filters.offset + filters.limit;
        data = { servers: items.slice(filters.offset, end), total: items.length, nextOffset: end < items.length ? end : null, engagement: { voteCount: 12, comments: slug ? [
          { id: "33333333-3333-4333-8333-333333333333", author: "Morgan Reed", avatarUrl: "https://www.browserp.com/assets/browserp-icon-192.png", createdAt: "2026-09-08T09:30:00.000Z", editedAt: null, badges: [{ kind: "verified_owner", label: "Verified Server Owner", description: "BrowseRP confirmed control of a published server listing. This is not a safety or quality guarantee.", iconKey: "shield-check" }, { kind: "first_100", label: "First 100", description: "One of the first 100 BrowseRP members.", iconKey: "milestone-100" }], staffRole: null, parent: null, body: "Clear joining information and a helpful community welcome made this easy to understand." },
          { id: "44444444-4444-4444-8444-444444444444", author: "Alex Rivers", avatarUrl: null, createdAt: "2026-09-08T10:45:00.000Z", editedAt: "2026-09-08T11:05:00.000Z", badges: [{ kind: "browserp_staff", label: "BrowseRP Staff", description: "An active member of the BrowseRP staff team.", iconKey: "browserp-rp-mark" }, { kind: "discord_verified_email", label: "Verified Member", description: "Discord confirmed the connected account email is verified.", iconKey: "discord-check" }, { kind: "first_100", label: "First 100", description: "One of the first 100 BrowseRP members.", iconKey: "milestone-100" }, { kind: "community_helper", label: "Community Helper", description: "Recognises constructive community participation.", iconKey: "heart" }, { kind: "new_joiner", label: "New Joiner", description: "Joined BrowseRP within the last five days.", iconKey: "spark" }], staffRole: "Moderator", parent: { id: "33333333-3333-4333-8333-333333333333", author: "Morgan Reed", body: "Clear joining information and a helpful community welcome made this easy to understand.", createdAt: "2026-09-08T09:30:00.000Z", unavailable: false }, body: "The listing now also explains its access requirements before you leave BrowseRP." }
        ] : [] }, facets: discovery.facets(servers, filters) };
      }
      if (url.pathname === "/api/me/favorites") {
        if (req.method === "GET") data = { serverIds: [...favorites] };
        else if (req.method === "POST") {
          const fail = (status, error) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error })); };
          const csrfCookie = String(req.headers.cookie || "").split(";").some(cookie => cookie.trim() === `brp_csrf=${csrfToken}`);
          if (req.headers["x-browserp-csrf"] !== csrfToken || !csrfCookie || (req.headers.origin && req.headers.origin !== url.origin)) { fail(403, "Local fixture CSRF check failed"); return; }
          let raw = "";
          for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 8192) { fail(413, "Fixture request too large"); return; } }
          let body;
          try { body = JSON.parse(raw); } catch { fail(400, "Choose a valid fixture server"); return; }
          if (!body || typeof body !== "object") { fail(400, "Choose a valid fixture server"); return; }
          if (Object.hasOwn(body, "accountId") && body.accountId !== accountId) { fail(409, "The fixture account changed"); return; }
          if (!servers.some(server => server.id === body.serverId)) { fail(400, "Choose a valid fixture server"); return; }
          if (favorites.has(body.serverId)) favorites.delete(body.serverId); else favorites.add(body.serverId);
          data = { result: { favorited: favorites.has(body.serverId), serverId: body.serverId } };
        } else { res.writeHead(405, { Allow: "GET, POST" }); res.end(); return; }
      }
      if (!["/api/auth/session", "/api/auth/providers", "/api/me/profile", "/api/me/overview", "/api/me/content-moderation", "/api/me/banner", "/api/me/connections", "/api/me/favorites", "/api/public/adverts", "/api/public/content", "/api/public/announcements", "/api/servers"].includes(url.pathname)) { fail(res, 404, "No synthetic fixture for this API"); return; }
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); return;
    }
    const route = url.pathname.startsWith("/server/") ? "/server.html" : url.pathname.startsWith("/games/") || url.pathname === "/games" ? "/game.html" : url.pathname.startsWith("/staffpanel/") ? `/staffpanel-${url.pathname.slice("/staffpanel/".length)}.html` : url.pathname === "/" ? "/index.html" : extname(url.pathname) ? url.pathname : `${url.pathname}.html`;
    const file = resolve(root, `.${route}`); if (!file.startsWith(root + sep)) throw Error("Invalid path");
    const body = await readFile(file); res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream"); res.end(body);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(fixturePort, "127.0.0.1", () => console.log(`Local visual fixture: ${fixtureOrigin} (synthetic accounts/listings only)`));
