// Local-only visual review data. Never imported by the application or deployed API.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
const root = resolve(import.meta.dirname, "../public");
const profile = { display_name: "Preview Member", avatar_url: "https://www.browserp.com/assets/browserp-icon-192.png", avatar_review_status: "pending", bio: "A local-only layout preview.", profile_visibility: "public" };
const servers = Array.from({ length: 6 }, (_, index) => ({ slug: `preview-community-${index}`, name: `Preview Community ${index + 1}`, platform_id: "fivem", platform_name: "FiveM", region: index < 4 ? "United Kingdom" : "United States", language: "English", framework: "vMenu", access_type: "whitelisted", description: "Local layout preview only. Build a character, meet your community and explore a shared world of roleplay. This listing is never published.", tags: ["Economy", "Custom clothing"], online: true, players: 60 + index, capacity: 128, logo_url: "https://www.browserp.com/assets/browserp-icon-192.png" }));
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:4189");
    if (url.pathname.startsWith("/api/")) {
      let data = {};
      if (url.pathname === "/api/auth/session") data = { authenticated: true, staff: false, staffAccess: false, provider: "google", csrfToken: "local-fixture", user: { id: "local-fixture", profile } };
      if (url.pathname === "/api/me/profile") data = { profile };
      if (url.pathname === "/api/me/overview") data = { overview: { profile } };
      if (url.pathname === "/api/me/connections") data = { connections: { accountId: "local-fixture", canManage: true, reauthenticationRequired: true, message: "Sign in again before changing connected accounts.", providers: [{ provider: "discord", connected: false, enabled: true, canConnect: false }, { provider: "google", connected: true, enabled: true, canConnect: false }] } };
      if (url.pathname === "/api/auth/providers") data = { providers: { discord: true, google: true } };
      if (url.pathname === "/api/public/adverts") data = { adverts: [] };
      if (url.pathname === "/api/public/content") data = { content: {} };
      if (url.pathname === "/api/public/announcements") data = { announcements: [] };
      if (url.pathname === "/api/servers") {
        const items = servers.filter(server => (!url.searchParams.get("slug") || server.slug === url.searchParams.get("slug")) && (!url.searchParams.get("region") || url.searchParams.get("region") === "all" || server.region === url.searchParams.get("region")));
        data = { servers: items.slice(0, Number(url.searchParams.get("limit")) || 24), total: items.length, nextOffset: null, engagement: { voteCount: 0, comments: [] }, facets: { platform: [{ value: "fivem", count: 6 }], region: [{ value: "United Kingdom", count: 4 }, { value: "United States", count: 2 }], mode: [{ value: "vMenu", count: 6 }] } };
      }
      if (url.pathname.startsWith("/api/admin/")) { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Staff access denied" })); return; }
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); return;
    }
    const route = url.pathname.startsWith("/server/") ? "/server.html" : url.pathname.startsWith("/games/") || url.pathname === "/games" ? "/game.html" : url.pathname === "/" ? "/index.html" : extname(url.pathname) ? url.pathname : `${url.pathname}.html`;
    const file = resolve(root, `.${route}`); if (!file.startsWith(root + sep)) throw Error("Invalid path");
    const body = await readFile(file); res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream"); res.end(body);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(4189, "127.0.0.1", () => console.log("Local visual fixture: http://127.0.0.1:4189 (synthetic accounts/listings only)"));
