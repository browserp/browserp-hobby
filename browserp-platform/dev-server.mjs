import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");

const apiRoutes = new Map([
  ["GET /api/health", "api/health.js"],
  ["GET /api/platforms", ["api/router.js", "platforms"]],
  ["GET /api/categories", ["api/router.js", "categories"]],
  ["GET /api/servers", "api/servers.js"],
  ["GET /api/public/overview", ["api/router.js", "public/overview"]],
  ["GET /api/public/content", ["api/router.js", "public/content"]],
  ["GET /api/auth/providers", ["api/router.js", "auth/providers"]],
  ["GET /api/auth/discord", ["api/router.js", "auth/discord"]],
  ["GET /api/auth/google", ["api/router.js", "auth/google"]],
  ["GET /api/auth/callback", ["api/router.js", "auth/callback"]],
  ["GET /api/auth/session", ["api/router.js", "auth/session"]],
  ["POST /api/auth/logout", ["api/router.js", "auth/logout"]],
  ["GET /api/boosts/balance", "api/boosts/balance.js"],
  ["POST /api/boosts", "api/boosts.js"],
  ["GET /api/submissions", "api/submissions.js"],
  ["POST /api/submissions", "api/submissions.js"],
  ["POST /api/tools/joaat", "api/tools/joaat.js"],
  ["POST /api/tools/name-generator", "api/tools/name-generator.js"],
  ["POST /api/checkout", "api/checkout.js"],
  ["POST /api/webhooks/stripe", "api/webhooks/stripe.js"],
  ["GET /api/me/overview", ["api/router.js", "me/overview"]],
  ["GET /api/me/favorites", ["api/router.js", "me/favorites"]],
  ["POST /api/me/favorites", ["api/router.js", "me/favorites"]],
  ["POST /api/me/notifications/read", ["api/router.js", "me/notifications/read"]],
  ["GET /api/admin/overview", ["api/router.js", "admin/overview"]],
  ["GET /api/admin/staff", ["api/router.js", "admin/staff"]],
  ["POST /api/admin/staff", ["api/router.js", "admin/staff"]],
  ["GET /api/admin/item", ["api/router.js", "admin/item"]],
  ["POST /api/admin/action", ["api/router.js", "admin/action"]],
  ["GET /api/admin/content", ["api/router.js", "admin/content"]],
  ["POST /api/admin/content", ["api/router.js", "admin/content"]],
  ["GET /api/resources", "api/resources.js"],
  ["GET /api/developers", "api/developers.js"]
]);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https://cdn.discordapp.com; style-src 'self'; script-src 'self' 'sha256-mjT0FPG3NQWnJyjqoM1ha+xDb2mlOSS3l/dtDWVxA8c='; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

async function serveFile(res, path) {
  const normalized = normalize(path).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, normalized);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }
  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mime[extname(filePath)] || "application/octet-stream",
      "Cache-Control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=60"
    });
    res.end(res.req?.method === "HEAD" ? undefined : file);
  } catch (error) {
    res.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(error.code === "ENOENT" ? "Not found" : "Server error");
  }
}

function staticRoute(pathname) {
  if (pathname === "/") return "index.html";
  if (pathname === "/servers") return "servers.html";
  if (pathname === "/list-server") return "list-server.html";
  if (pathname === "/dashboard") return "dashboard.html";
  if (pathname === "/staff") return "staff.html";
  if (pathname === "/legal") return "legal.html";
  if (/^\/server\/[a-z0-9-]+$/i.test(pathname)) return "server.html";
  return pathname.replace(/^\//, "");
}

const STAFF_DEMO_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const STAFF_DEMO_CLIENTS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function hostnameFromHostHeader(hostHeader) {
  try {
    return new URL(`http://${String(hostHeader || "").trim()}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function staffDemoAllowed({ hostHeader, remoteAddress, environment = process.env } = {}) {
  return environment.BROWSERP_LOCAL_STAFF_DEMO === "1"
    && environment.NODE_ENV !== "production"
    && !environment.VERCEL
    && !environment.VERCEL_ENV
    && STAFF_DEMO_HOSTS.has(hostnameFromHostHeader(hostHeader))
    && STAFF_DEMO_CLIENTS.has(String(remoteAddress || "").toLowerCase());
}

function staffDemoPayload() {
  return {
    mode: "synthetic-read-only",
    sample: true,
    overview: {
      pendingSubmissions: 1,
      openModeration: 1,
      openReports: 1,
      securityAlerts: 1,
      listingQueue: [{
        id: "sample-listing",
        name: "Sample UK Roleplay",
        platform_id: "FiveM",
        region: "United Kingdom",
        moderation_confidence: "manual check",
        moderation_score: 18,
        created_at: "2026-08-19T10:00:00.000Z"
      }],
      reportQueue: [{
        id: "sample-report",
        category: "Listing details may be outdated",
        target_type: "server listing",
        status: "open",
        created_at: "2026-08-19T10:12:00.000Z"
      }],
      moderationQueue: [{
        id: "sample-moderation",
        target_type: "listing description",
        confidence: "manual check",
        score: 31,
        status: "open",
        created_at: "2026-08-19T10:18:00.000Z"
      }],
      securityEvents: [{
        id: "sample-security",
        event_type: "Repeated rejected staff sign-in",
        severity: "medium",
        created_at: "2026-08-19T10:25:00.000Z"
      }],
      recentAudit: [{
        id: "sample-audit",
        action: "Changes requested",
        target_type: "listing",
        reason: "The community link needs to match the submitted server.",
        created_at: "2026-08-19T09:45:00.000Z"
      }]
    },
    health: {
      status: "ok",
      version: "1.3.0 local",
      integrations: {
        database: "sample data",
        serverBoundary: "locked",
        authentication: { discord: false },
        payments: "disabled"
      }
    },
    evidence: {
      "listing:sample-listing": {
        name: "Sample UK Roleplay",
        status: "pending review",
        platform_id: "FiveM",
        region: "United Kingdom",
        language: "English",
        framework: "QBCore",
        description: "A fictional, character-led city roleplay community used only to preview this staff interface.",
        community_url: "https://example.invalid/community",
        confidence: "manual check",
        score: 18,
        reasons: ["New listing", "Community link needs a person to check it"],
        created_at: "2026-08-19T10:00:00.000Z"
      },
      "report:sample-report": {
        category: "Listing details may be outdated",
        status: "open",
        target_type: "server listing",
        target_id: "sample-uk-roleplay",
        details: "A fictional member says the framework shown on the listing may have changed.",
        created_at: "2026-08-19T10:12:00.000Z"
      },
      "moderation:sample-moderation": {
        target_type: "listing description",
        status: "open",
        confidence: "manual check",
        score: 31,
        reasons: ["Repeated promotional wording", "A staff member should read the full submission"],
        created_at: "2026-08-19T10:18:00.000Z"
      },
      "security:sample-security": {
        event_type: "Repeated rejected staff sign-in",
        severity: "medium",
        details: "A privacy-safe fictional summary; no raw network address is displayed.",
        created_at: "2026-08-19T10:25:00.000Z"
      },
      "audit:sample-audit": {
        action: "Changes requested",
        target_type: "listing",
        reason: "The community link needs to match the submitted server.",
        actor: "Sample reviewer",
        created_at: "2026-08-19T09:45:00.000Z"
      }
    }
  };
}

export function createBrowseRPServer({ environment = process.env } = {}) {
  return createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/staff") res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (url.pathname === "/__dev/staff-demo") {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const allowed = url.searchParams.get("staffDemo") === "1" && staffDemoAllowed({
        hostHeader: req.headers.host,
        remoteAddress: req.socket.remoteAddress,
        environment
      });
      if (!allowed) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: "Not found." }));
      }
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        res.writeHead(405);
        return res.end(JSON.stringify({ error: "Method not allowed." }));
      }
      res.writeHead(200);
      return res.end(JSON.stringify(staffDemoPayload()));
    }
    const routeTarget = apiRoutes.get(`${req.method} ${url.pathname}`);
    if (routeTarget) {
      const [modulePath, browserpRoute] = Array.isArray(routeTarget) ? routeTarget : [routeTarget, null];
      if (browserpRoute) req.browserpRoute = browserpRoute;
      const module = await import(pathToFileURL(join(root, modulePath)));
      return module.default(req, res);
    }
    if (url.pathname.startsWith("/api/")) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "API route not found." }));
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Method not allowed");
    }
    return serveFile(res, staticRoute(url.pathname));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || "127.0.0.1";
  createBrowseRPServer().listen(port, host, () => console.log(`BrowseRP ready at http://${host}:${port}`));
}
