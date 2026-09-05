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

Validate the fresh document CSP nonce through the actual Cloudflare-injected browser check after deployment. Follow up on shared-IP rate-limit usability before claiming the edge audit complete. Direct hosting routes and origin protection also require separate review. Do not weaken the content policy or blanket-challenge all visitors. A Cloudflare setting does not replace the website's session, permissions, request validation or database protections, and direct Vercel deployment routes require their own protection.

## Additional signed-in checks — approximately 21:30 UTC

- The DDoS detail page confirms active network-layer and SSL/TLS DDoS protection, with HTTP protection always enabled and no custom override. This is configuration evidence, not an attack/load test.
- SSL/TLS mode is **Full (strict)**, with automatic mode enabled. The Universal certificate for browserp.com and its wildcard is active. Always Use HTTPS is on, minimum visitor TLS is 1.2, and TLS 1.3 is on. Automatic HTTPS Rewrites is on. No changes were needed.
- All eight DNS records were inspected. Both website records (apex A and www CNAME) are proxied. The remaining six are IONOS mail authentication/routing records and correctly remain DNS-only. There is no unproxied website or origin hostname among these records. This does not hide or protect publicly reachable Vercel deployment aliases.
- DMARC is currently monitoring-only (`p=none`). Tightening this requires verifying every legitimate sender and actual delivery first; no speculative mail policy change was made. Certificate Transparency Monitoring is off; it remains an optional owner alert improvement.

- Cache Rules and Cache Response Rules both have zero active rules. Default caching is Standard; browser TTL respects existing origin headers. Always Online and Development Mode are off.
- Security Events were inspected, rather than treating all mitigations as attacks. The sampled block at 18:45:01 UTC was a Firefox GET to `/api/public/adverts?placement=side`, matching the shared-IP API rate rule during browser verification. Other nearby rate events clustered in the same verification interval. Recent method-rule blocks matched the deliberate no-account negative probes. Bot Fight Mode also recorded managed challenges. These samples do not establish that all blocks were malicious or that no legitimate visitor was affected. The rate threshold remains unchanged pending a bounded normal-use/shared-IP check. No visitor IP addresses are copied into this report.

## Hosting-side firewall inspection — approximately 21:45 UTC

Vercel reports Cloudflare proxy detected and active system mitigations. No custom rules, bypass rules or manual IP blocks are configured. Vercel Bot Protection and Attack Mode are off; AI bots are allowed. The displayed last-day overview recorded 12.7k allowed requests and four DDoS mitigations, with no active alert. These are dashboard observations, not proof of attack resistance or an unreachable origin. No hosting firewall setting was changed. App authentication, authorisation and request limits continue to apply to direct deployment aliases.

## Database transport follow-up — approximately 22:00 UTC

Supabase incoming database SSL enforcement is off and database network restrictions allow all IP addresses. HTTP API traffic uses HTTPS separately. An aggregate client inspection found the non-SSL connections were local loopback connections; the remote management connection used SSL. No client IP addresses or credentials are recorded here. Enabling incoming SSL enforcement requires a brief managed restart, so it remains a deliberate follow-up after backup/recovery preparation and connection dependency checks. No transport setting was changed in this inspection.

### Post-release application/provider checks — approximately 22:20 UTC

Actual browser challenge integration now passes in Chromium, Firefox and WebKit. Outer and inner scripts receive the document nonce; the provider request returns200 and no CSP violations occur. Signed-out PATCH /api/submissions reaches the application and returns JSON401, as do private data-request endpoints. No firewall protection was weakened. The remaining normal-use shared-IP rate-limit check is separate from this result.
