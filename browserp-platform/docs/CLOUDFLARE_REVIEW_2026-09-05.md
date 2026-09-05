# Cloudflare production review — 5 September 2026

Signed-in inspection at approximately 21:00 UTC confirmed browserp.com is proxied through Cloudflare on the Free plan. Bot Fight Mode is on; Under Attack Mode and Development Mode are off. The managed free WAF ruleset is active. The overview reports automatic network and HTTP DDoS protections running; this is configuration evidence, not a capacity or attack simulation.

Three active custom rules block unsupported HTTP methods, repository/environment/development paths, and disabled product APIs. The API rate limit counts uncached /api/ requests by IP at 30 requests per 10 seconds and blocks for 10 seconds. It had recorded 44 events in the displayed 24-hour window. Shared-IP usability and actual event classification remain follow-up checks; the threshold was not changed speculatively.

## Necessary release correction

The existing method rule allowed only GET, HEAD, POST and OPTIONS. The reviewed owner-correction API uses PATCH, so it would have been blocked before reaching its authentication and ownership checks. Updated only that rule to:

```
not http.request.method in {"GET" "HEAD" "POST" "OPTIONS"} and not (http.request.method eq "PATCH" and http.request.uri.path eq "/api/submissions")
```

The rule remains active and first. Read-only/no-account probes confirmed PATCH /api/submissions reaches the old application (JSON 405 before release), while PATCH /api/servers and DELETE /api/submissions remain blocked by Cloudflare (403). No authenticated data mutation or load test was performed. After the new release, confirm the allowed endpoint returns the application's signed-out protection.

Rollback of this firewall change means restoring `not http.request.method in {"GET" "HEAD" "POST" "OPTIONS"}`; doing so disables owner corrections until an alternative compatible API is deployed.

## Still required

Validate the fresh document CSP nonce through the actual Cloudflare-injected browser check after deployment. Inspect SSL/TLS mode, DNS origin exposure, DDoS details, cache rules and security events before claiming the edge audit complete. Do not weaken the content policy or blanket-challenge all visitors. A Cloudflare setting does not replace the website's session, permissions, request validation or database protections, and direct Vercel deployment routes require their own protection.
