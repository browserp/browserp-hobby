import { next } from "@vercel/functions";
import { documentSecurityHeaders } from "./lib/document-policy.js";

// Only document requests need the nonce Cloudflare uses for its injected bot
// script. Assets and data endpoints retain their existing caching behavior.
export default function middleware(request) {
  const path = new URL(request.url).pathname;
  if (!["GET", "HEAD"].includes(request.method) || path === "/api" || path.startsWith("/api/")) return next();
  return next({ headers: documentSecurityHeaders() });
}

export const config = {
  matcher: ["/((?!api/|assets/|cdn-cgi/|_vercel/|.*\\.(?:js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|map|json|webmanifest|txt|xml)$).*)"]
};
