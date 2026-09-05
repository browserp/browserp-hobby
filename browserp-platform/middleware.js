import { next } from "@vercel/functions";
import { documentSecurityHeaders } from "./lib/document-policy.js";

// Only document requests need the nonce Cloudflare uses for its injected bot
// script. Assets and data endpoints retain their existing caching behavior.
export default function middleware(request) {
  const path = new URL(request.url).pathname;
  if (!["GET", "HEAD"].includes(request.method) || path === "/api" || path.startsWith("/api/")) return next();
  if (request.headers.has("if-none-match") || request.headers.has("if-modified-since")) {
    // Old HTML may have been cached before this policy was deployed. Ask the
    // static origin for its complete document, never a reused transformed body.
    const headers = new Headers(request.headers);
    headers.delete("if-none-match");
    headers.delete("if-modified-since");
    return next({ request: { headers }, headers: documentSecurityHeaders() });
  }
  return next({ headers: documentSecurityHeaders() });
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!api/|assets/|cdn-cgi/|_vercel/|.*\\.(?:js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|map|json|webmanifest|txt|xml)$).*)"]
};
