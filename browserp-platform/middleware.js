import { next, rewrite } from "@vercel/functions";
import { documentSecurityHeaders } from "./lib/document-policy.js";

// Only document requests need the nonce Cloudflare uses for its injected bot
// script. Assets and data endpoints retain their existing caching behavior.
export default function middleware(request) {
  const url = new URL(request.url), path = url.pathname;
  if (!["GET", "HEAD"].includes(request.method) || path === "/api" || path.startsWith("/api/")) return next();
  // Clean URLs resolve existing HTML files before deployment rewrites. Route
  // these documents explicitly so the source templates cannot shadow live HTML.
  if (["/servers", "/games", "/game", "/server", "/blog", "/blog-post"].includes(path) || /^\/(?:games|server|blog)\/[^/]+$/.test(path)) {
    url.pathname = "/api/router";
    url.searchParams.set("_route", "public/document");
    url.searchParams.set("_path", path);
    return rewrite(url, { headers: documentSecurityHeaders() });
  }
  return next({ headers: documentSecurityHeaders() });
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!api/|assets/|cdn-cgi/|_vercel/|.*\\.(?:js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|map|json|webmanifest|txt|xml)$).*)"]
};
