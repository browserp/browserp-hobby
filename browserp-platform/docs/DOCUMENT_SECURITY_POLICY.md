# Document security policy and Cloudflare checks

The proposed middleware adds a fresh 256-bit script nonce to each GET/HEAD document response. It preserves the existing policy in `vercel.json`, including `frame-src 'none'`, and adds no `unsafe-inline`, `unsafe-eval`, wildcard or new external origin. The existing allowance for style attributes is unchanged. API endpoints, methods that change data, public assets and crawler files keep their existing behavior and caching.

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

### Hosted findings and correction

The first preview preserved all directives and produced distinct nonces, but an explicit conditional request still returned 304. The middleware now removes old document validators before forwarding to static hosting. A subsequent Node middleware build hit the actual Hobby limit because middleware counts as a Node function. The unchanged health handler now runs through the existing router at the same /api/health URL, leaving 11 API functions plus one Node middleware. The deployment checker counts both. This retains the supported runtime without buying a plan or dropping a feature. A replacement hosted check is required before promotion.
