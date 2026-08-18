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
  ["GET /api/auth/discord", ["api/router.js", "auth/discord"]],
  ["GET /api/auth/callback", ["api/router.js", "auth/callback"]],
  ["GET /api/auth/session", ["api/router.js", "auth/session"]],
  ["POST /api/auth/logout", ["api/router.js", "auth/logout"]],
  ["GET /api/boosts/balance", "api/boosts/balance.js"],
  ["POST /api/boosts", "api/boosts.js"],
  ["POST /api/submissions", "api/submissions.js"],
  ["POST /api/tools/joaat", "api/tools/joaat.js"],
  ["POST /api/tools/name-generator", "api/tools/name-generator.js"],
  ["POST /api/checkout", "api/checkout.js"],
  ["POST /api/webhooks/stripe", "api/webhooks/stripe.js"],
  ["GET /api/me/overview", ["api/router.js", "me/overview"]],
  ["GET /api/admin/overview", ["api/router.js", "admin/overview"]],
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
  ".ico": "image/x-icon"
};

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https://cdn.discordapp.com; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
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
    res.end(file);
  } catch (error) {
    res.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(error.code === "ENOENT" ? "Not found" : "Server error");
  }
}

function staticRoute(pathname) {
  if (pathname === "/") return "index.html";
  if (pathname === "/dashboard") return "dashboard.html";
  if (pathname === "/staff") return "staff.html";
  if (pathname === "/developers") return "developers.html";
  if (pathname === "/resources") return "resources.html";
  if (pathname === "/legal") return "legal.html";
  if (/^\/server\/[a-z0-9-]+$/i.test(pathname)) return "server.html";
  return pathname.replace(/^\//, "");
}

export function createBrowseRPServer() {
  return createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
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
