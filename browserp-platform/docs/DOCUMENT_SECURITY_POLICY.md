# Document security policy and Cloudflare checks

The middleware adds a fresh 256-bit script nonce to each GET/HEAD document response. It preserves the existing policy in `vercel.json`, including `frame-src 'none'`, and adds no `unsafe-inline`, `unsafe-eval`, wildcard or new external origin. The existing allowance for style attributes is unchanged. API endpoints, methods that change data, public assets and crawler files keep their existing behavior and caching.

The nonce comes from WebCrypto. No request header, query parameter or cookie supplies it. HTML receives `private, no-store, max-age=0`, with no-store directives for the CDN and Cloudflare. A previously transformed page must not be cached and paired with a new nonce.

Cloudflare documents that JavaScript Detections reads script nonces from the response CSP, adds them to injected scripts, and strips ETags from HTML where injection happens. This relies on the HTTP response header rather than a meta tag. Its script injection must not be combined with a `no-transform` response directive. [Cloudflare JavaScript Detections documentation](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/).

## Local evidence — 5 September 2026

- `test/document-policy.test.mjs`: six passing Node 24 checks. The tests compare the complete baseline policy with `vercel.json`, check 1,000 distinct nonces and their 32-byte length, reject malformed entropy, prove request-supplied nonce values are not forwarded, exercise document/exclusion matching against all real public files, and verify the exact `@vercel/functions` 3.9.5 dependency/lock version.
- An isolated HTTPS browser fixture applied the actual generated CSP in Chromium, Firefox and WebKit. A nonce-authorised inline script and same-origin external script ran. A script with the correct nonce ran inside a newly created empty iframe, while an inline script without that nonce in the same iframe was blocked. Unauthorised parent-page inline code and a wrong nonce were blocked. A frame with a same-origin `src` was blocked by the unchanged `frame-src 'none'` policy without a network request. Reloading produced a different nonce and preserved these results. No unexpected runtime errors occurred.
- These checks prove browser CSP behavior for the tested pattern. They do **not** prove that Cloudflare’s actual injected inner script receives its nonce, that a visitor passes a bot check, or that bot enforcement rules exist.

## Hosted release checks still required

Before promotion, inspect the exact preview’s effective response headers. Ensure Vercel’s static header rule does not create an additional, conflicting CSP policy; keep all existing directives. Verify two separate document responses and a normal browser reload/revalidation have fresh nonces, private/no-store caching, and no cached-body/new-header pairing through a 304 response. Confirm API and static asset response policies are unaffected.

After the reviewed deployment crosses the Cloudflare-proxied hostname, observe the real injected outer and inner script, its requests and any console violations. No amount of local fixture success proves that final provider integration. If the provider fails to propagate the nonce, retain the restrictive policy and investigate the actual script rather than allowing all inline code or loosening iframe access.

## Privacy wording

BrowseRP’s own account device identifier is random. Cloudflare’s separate essential security checks can use browser/request signals and security cookies, so the public Privacy/Legal copy no longer promises that no upstream security provider ever uses browser fingerprinting. It distinguishes those security checks from BrowseRP’s identifier and advertising, and links to Cloudflare’s [privacy policy](https://www.cloudflare.com/policies/privacy/) and [cookie documentation](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/).

### Hosted findings — 5 September 2026

Vercel previews preserve the full baseline policy and return one CSP header with a different nonce on each fresh document response. API policies and static asset bytes/cache behavior remain unchanged. Chromium, Firefox and WebKit each loaded the profile page and reloaded twice: all nine responses were HTTP 200 with private/no-store caching, nine distinct nonces, and no conditional request validators.

An artificially constructed request carrying the static file's ETag can still receive a platform-generated 304, **without a CSP header**. The platform does not run the document middleware for that response; it does not attach a new nonce to the cached body. Request-header stripping and a middleware-generated ETag did not alter that platform behavior and have been removed. Normal browsers respected no-store in all three tested engines. This boundary is recorded rather than presented as a middleware guarantee to disable every possible 304. Cloudflare separately documents stripping ETags when it injects its checks.

The supported Node middleware counts toward the actual Hobby function limit. The unchanged health handler now runs through the existing router at the same `/api/health` URL, leaving 11 API functions plus one Node middleware. The deployment checker counts both. No hosting plan upgrade or feature removal is required.

The final release still requires its full preview checks and observation of the actual Cloudflare-injected scripts on the production hostname. Hosted reload evidence: `/tmp/browserp-normal-reload.json`; synthetic conditional-request evidence: `/tmp/browserp-etag-csp-preview.json` (local audit artifacts, not repository data).

### Actual production integration verified — 5 September, approximately 22:20 UTC

Release 0fe82e5 is live behind Cloudflare. Chromium, Firefox and WebKit each received a document nonce, observed it on the real outer injected script and both scripts in the blank child frame, and completed the provider challenge request with HTTP200. No CSP violation was recorded. The unchanged strict policy is effective; no iframe-origin allowance or inline bypass was added. All 12 checked public/account/signed-out-staff pages loaded with no application errors. This proves the observed provider integration, not universal attack prevention. Evidence: /tmp/browserp-menu-production-check.json.
