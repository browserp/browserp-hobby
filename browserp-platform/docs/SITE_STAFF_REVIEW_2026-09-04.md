# Public site and staff review — 4 September 2026

Reviewed the production tree `ca959de0f57b5e64528466aed8077082c3eef1da`, then implemented and tested the corrections below. This review combines production reads, authenticated staff navigation, actual browser rendering and isolated database/API mutation tests. Production accounts, published content, claims, bans and staff assignments were not used as test fixtures. During the review, the owner completed authenticator verification; the existing application flow automatically activated mandatory staff MFA, which was then independently confirmed.

## Corrections

- Revoked staff sessions now lose database permissions immediately, even while their old signed token remains within its expiry period. Active Discord staff sessions, custom permissions, overrides and authenticator enrollment remain supported.
- Failed ban lookups deny the request instead of silently allowing it. Temporary lookup failures preserve credentials for recovery; confirmed bans clear the application session.
- All seven directly callable member mutation functions and five private member read functions require an active same-account session and an unrestricted account. Account bans also apply to staff receiving a new OAuth session. Database-level request limits protect comments/reports, profile updates, avatars, favourites and notification updates; existing daily claim and boost limits remain.
- Network evidence and rate limits use the same trusted address resolver. Cloudflare headers require verified Cloudflare ingress, while direct connections cannot select their apparent identity using forged forwarding headers. IPv4, IPv6 and mapped addresses are normalized consistently.
- Switching FiveM, RedM or Minecraft scraper tabs asks before discarding an unfinished review. Cancel preserves edits and focus; Back/direct hash navigation uses the same guard. Active imports finish before switching.
- Dirty blog, announcement and advert editors warn before leaving or refreshing. Successful saves, clean editors and explicit discards do not warn. This protects unsaved work; it is not automatic draft persistence.
- The moderation field and record detail now correctly say **Cfx join link (FiveM / RedM)**.
- The member dashboard counts only published records in its published-listings total and keeps archived records clearly labelled in listing history.
- Mandatory staff MFA is now active. The owner completed authenticator verification, and the existing flow enabled the requirement at 10:00 UTC; the persisted policy, verified factor, audit record and continued staff access were checked.
- The previously separate database suites now run as part of `npm run verify`, including during deployment builds.

## Verification results

The complete release command passed **356 tests: 321 application/security tests plus 35 additional database tests**, with no failures or skipped tests. New PostgreSQL tests demonstrate the old revoked-token/direct-call weaknesses before applying the actual migrations, then check denial and legitimate workflows after applying them. The tests also cover ownership, private reads, MFA enrollment, custom roles, invalid session IDs, future/expired bans, separate-account rate limits and anonymous published reads.

| Area | Current evidence |
| --- | --- |
| Public routes | All 20 sampled public/staff HTML routes returned 200. All eight sampled private staff API reads returned 401 without credentials. The refresh worker rejects unsupported GET requests. |
| Browser rendering | Seven public pages at 390px and 1440px: no horizontal overflow, stuck loading state, broken visible image or JavaScript error. Pages include Home, Discover, FiveM, CaliRP, Blog, Profile and List a server. |
| Discovery interaction | In the live browser, FiveM + ESX returned five FiveM/ESX listings. Switching to RedM cleared incompatible ESX and returned 20 RedM listings. An unmatched query showed an explicit empty state and Clear filters recovered the directory. |
| Staff interface | Live authenticated Overview, Moderation, scraper page, blog editor and announcement scheduling controls loaded. The signed-in member dashboard and staff moderation still loaded after both security migrations. Overview showed four current users, 55 published servers, one published blog and one active staff member. |
| Staff responsive behavior | Isolated current-code browsers checked 19 active staff views at 390px and six representative views at 1440px, all five chart ranges, chart keyboard dates/counts, menu position/focus, empty/error states and recovery. No overflow, hidden content, unlabeled visible control or browser error was found. Fixture writes were zero. |
| Unsaved work | Real-browser reproductions confirmed the original scraper loss. Fixed confirmations fit mobile; Cancel/Escape retains data and returns focus, and explicit discard switches correctly. Automated tests cover all three importers and the publishing editors. |
| Database protections | Every public table has RLS enabled. Anonymous/authenticated roles have no private-schema usage. No inspected definer function lacks a fixed search path. No publicly readable view bypasses RLS through missing security-invoker configuration. |
| Browser/transport policy | Live HTTPS responses retain HSTS, strict CSP, framing denial and nosniff. Staff routes remain private/no-store and noindex. |
| Dependencies | All 39 versioned dependencies in the lockfile returned no matching advisories from the [OSV batch API](https://google.github.io/osv.dev/post-v1-querybatch/). npm's advisory endpoint timed out; it is not reported as a successful npm audit. There are no declared production npm dependencies. |
| Runtime | Vercel reported no runtime-error clusters for the hour inspected. The health route reported backend, authentication and security ready, with payments disabled. |

## Earlier work and data are preserved

- The published directory still contains **32 FiveM, 20 RedM and three Minecraft communities**. All 55 are recorded as English; none was falsely assigned ownership or owner verification.
- All **56 stored image URLs** passed availability, image-type and size checks. SAVRP intentionally uses an initials fallback because its former source image was a generic FiveM icon. This is a data-completeness item, not a broken image request.
- Eight independent live directory queries returned the expected totals without duplicate or wrong-game rows. Source join codes still match their canonical Cfx links.
- The preceding hour contained **60 completed refresh runs**, with no failed or deferred work. Upstream observations can still be stale; these remain unavailable rather than being represented as zero. Minecraft counts are labelled as network totals.
- Staff's 56th server record is archived FloridaDOJRO. It is excluded from the public directory. Old San Andreas demo routes render **This server is not available**, with empty public API results; no demo listing content survives publicly.
- Four-game navigation, the supplied artwork/All games logo, platform accents, animated brand buttons, ordered metadata, responsive information cards, custom staff roles, unified moderation, reports/history, profile screening, bans/appeals, publishing, adverts and claim-review tools remain in the current code and relevant checks.

## Recommendations and remaining work

1. **Keep staff MFA recovery ready.** Mandatory staff MFA is now enabled and verified, with the owner’s confirmed authenticator. Document and test the recovery process safely, and require new staff to complete their own enrollment. The review did not create or handle the owner’s authenticator secret or recovery codes.
2. **Finish a real ordinary-member onboarding exercise.** Automated tests cover OAuth state/nonce/PKCE, identity linking, upload ownership/size/type, CSRF and Discord claim matching. A fresh real Google/Discord consent flow, hosted manual-linking setting and genuine server-owner claim still need a consenting ordinary account. Existing authenticated staff access was checked live; no account connections were changed.
3. **Expose refresh health to staff and test recovery operations.** Show the last successful refresh, checked count and stale sources in Overview/Scrapers. Also verify the hosted backup schedule and perform a documented restore exercise in an isolated environment; a production restore was outside this review.
4. **Complete the recorded launch backlog.** Eight more evidenced FiveM communities are needed to reach approximately 40. Roblox's specialized application/import workflow remains intentionally deferred, with zero Roblox listings. Resolve uncertain region/access/framework/Discord/logo fields through owner evidence rather than guesses.
5. **Clarify two remaining limits.** Device bans identify a browser cookie, not physical hardware. Removed listing pages are currently soft 404s; returning a proper 404/410 or noindex would improve search-engine handling. Selecting an already-active chart range could also close its dropdown.

The Supabase advisor reports expected review items for deliberately callable, permission-checked definer RPCs and tables closed to direct access; those notices do not by themselves establish unauthorized access. Its password-leak warning remains: BrowseRP's UI uses OAuth, and the hosted password-provider setting was not independently verified. Review or disable unused password authentication; enable compromised-password protection if password login is offered. [Supabase password guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

This is a bounded engineering/security review with reproduced fixes, not a guarantee against every vulnerability or an exhaustive destructive penetration test. No business feature, payment flow, external login or recovery operation is described as verified solely because a page rendered.

## References and local evidence

- [Supabase session revocation](https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out)
- [Vercel verified proxies](https://vercel.com/docs/security/reverse-proxy), [request headers](https://vercel.com/docs/headers/request-headers), [Cloudflare edge ranges](https://api.cloudflare.com/client/v4/ips)
- Test log: `/tmp/browserp-security-review-final-verify.log`
- Live HTTP audit: `/tmp/browserp-site-staff-live-audit.json`
- Public browser report: `/tmp/browserp-public-browser-audit.json`
- Staff browser report: `/tmp/audit-staff-ui.md`
- Feature/data inventory: `/tmp/audit-feature-inventory.md`
- Dependency evidence: `/tmp/browserp-osv-audit.json`
