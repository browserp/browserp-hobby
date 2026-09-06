// Local-only visual review data. Never imported by the application or deployed API.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import "../public/discovery-model.js";
const root = resolve(import.meta.dirname, "../public");
const discovery = globalThis.BrowseRPDiscovery;
const accountId = "11111111-1111-4111-8111-111111111111";
const csrfToken = "local-fixture";
const favorites = new Set();
const serverId = index => `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`;
const profile = { display_name: "Preview Member", avatar_url: "https://www.browserp.com/assets/browserp-icon-192.png", avatar_review_status: "pending", bio: "A local-only layout preview.", profile_visibility: "public" };
const servers = Array.from({ length: 6 }, (_, index) => ({ id: serverId(index), slug: `preview-community-${index}`, name: `Preview Community ${index + 1}`, platform_id: "fivem", platform_name: "FiveM", region: index < 4 ? "United Kingdom" : "United States", language: "English", framework: "vMenu", access_type: index % 2 ? "public" : "whitelisted", description: "Local layout preview only. Build a character, meet your community and explore a shared world of roleplay. This listing is never published.", tags: index % 2 ? ["Economy", "Custom cars"] : ["Economy", "Custom clothing"], online: true, players: 60 + index, capacity: 128, checked_at: new Date(Date.now() - (index === 1 ? 10 * 60_000 : 0)).toISOString(), logo_url: "https://www.browserp.com/assets/browserp-icon-192.png" }));
for (const [platform_id, platform_name, framework, tags] of [["redm", "RedM", "VORP", ["Ranching", "Economy"]], ["roblox", "Roblox", "city rp", ["Vehicles", "Housing"]], ["minecraft", "Minecraft", "SMP", ["Bedrock", "Crossplay"]]]) {
  const index = servers.length;
  servers.push({ ...servers[0], id: serverId(index), slug: `preview-community-${index}`, name: `Preview ${platform_name} Community`, platform_id, platform_name, framework, tags, access_type: "public", applicationOnly: platform_id === "roblox" });
}
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:4189");
    if (url.pathname.startsWith("/api/")) {
      let data = {};
      res.setHeader("Cache-Control", "no-store");
      if (url.pathname === "/api/auth/session") {
        res.setHeader("Set-Cookie", `brp_csrf=${csrfToken}; Path=/; SameSite=Strict`);
        data = { authenticated: true, staff: false, staffAccess: false, provider: "google", csrfToken, user: { id: accountId, profile } };
      }
      if (url.pathname === "/api/me/profile") data = { profile };
      if (url.pathname === "/api/me/overview") data = { overview: { profile, favoriteServers: servers.filter(server => favorites.has(server.id)) } };
      if (url.pathname === "/api/me/connections") data = { connections: { accountId, canManage: true, reauthenticationRequired: true, message: "Sign in again before changing connected accounts.", providers: [{ provider: "discord", connected: false, enabled: true, canConnect: false }, { provider: "google", connected: true, enabled: true, canConnect: false }] } };
      if (url.pathname === "/api/auth/providers") data = { providers: { discord: true, google: true } };
      if (url.pathname === "/api/public/adverts") data = { adverts: [] };
      if (url.pathname === "/api/public/content") data = { content: {} };
      if (url.pathname === "/api/public/announcements") data = { announcements: [] };
      if (url.pathname === "/api/servers") {
        const filters = discovery.normalize(Object.fromEntries(url.searchParams));
        const slug = url.searchParams.get("slug");
        const items = servers.filter(server => (!slug || server.slug === slug) && discovery.matches(server, filters));
        const end = filters.offset + filters.limit;
        data = { servers: items.slice(filters.offset, end), total: items.length, nextOffset: end < items.length ? end : null, engagement: { voteCount: 0, comments: [] }, facets: discovery.facets(servers, filters) };
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
      if (url.pathname.startsWith("/api/admin/")) { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Staff access denied" })); return; }
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); return;
    }
    const route = url.pathname.startsWith("/server/") ? "/server.html" : url.pathname.startsWith("/games/") || url.pathname === "/games" ? "/game.html" : url.pathname === "/" ? "/index.html" : extname(url.pathname) ? url.pathname : `${url.pathname}.html`;
    const file = resolve(root, `.${route}`); if (!file.startsWith(root + sep)) throw Error("Invalid path");
    const body = await readFile(file); res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream"); res.end(body);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(4189, "127.0.0.1", () => console.log("Local visual fixture: http://127.0.0.1:4189 (synthetic accounts/listings only)"));
