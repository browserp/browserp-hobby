// The static policy remains the default for APIs/assets and a safe fallback.
// Keep this baseline identical to vercel.json; the policy test enforces it.
export const BASE_DOCUMENT_POLICY = "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; frame-src 'none'; img-src 'self' data: https://cdn.discordapp.com https://lh3.googleusercontent.com https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/advertisements/ https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/profile-media/ https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/server-media/; manifest-src 'self'; media-src 'none'; object-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; worker-src 'none'; upgrade-insecure-requests";

export function documentSecurityHeaders(randomBytes = crypto.getRandomValues(new Uint8Array(32))) {
  if (!(randomBytes instanceof Uint8Array) || randomBytes.length !== 32) throw new TypeError("A fresh 256-bit nonce is required.");
  const nonce = btoa(String.fromCharCode(...randomBytes));
  return {
    "Content-Security-Policy": BASE_DOCUMENT_POLICY.replace("script-src 'self';", `script-src 'self' 'nonce-${nonce}';`),
    // Cloudflare may add scripts carrying this response nonce. Keep the
    // transformed document out of browser and shared caches.
    "Cache-Control": "private, no-store, max-age=0",
    "CDN-Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "no-store"
  };
}
