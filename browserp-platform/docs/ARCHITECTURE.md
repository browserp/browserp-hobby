# BrowseRP architecture

## Request boundaries

### Browser

Static HTML, CSS and JavaScript provide the FiveM-first public experience and authenticated portal rendering. The public routes are `/`, `/servers`, `/list-server`, `/server/:slug`, `/dashboard` and `/legal`. Public developer, resource and tool pages are not part of the current surface. The browser receives only published directory fields, a staff-reviewed HTTPS community link, or data authorised for the signed-in member. It never receives Supabase server keys, Stripe secrets, OAuth client secrets, fulfillment secrets, private owner identifiers, unreviewed submission links or raw network addresses.

### Vercel Functions

Twelve functions provide validation, provider discovery, PKCE OAuth cookies, member/staff routing, privacy-preserving rate limiting, hosted Checkout creation and signed webhook verification. Production data failures are surfaced rather than replaced with sample records.

### Supabase

Postgres stores profiles, platforms, listings, submissions, favorites, moderation queues, staff permissions/audits, promotion orders/ledger, developer profiles and resources. RLS is enabled throughout exposed schemas. Trusted operations use narrowly granted RPC functions.

### Stripe

BrowseRP uses one-time, Stripe-hosted Checkout Sessions. The webhook re-fetches line items and verifies live/test mode, payment status, a server-only metadata signature, user identity, product metadata, price, quantity, amount, currency and catalog version before calling the service-role-only idempotent database ledger.

## Authentication

Supabase Auth performs OAuth with PKCE. Discord and Google share the verified callback implementation, but staff access requires a Discord-only account. Both the application and `has_staff_permission` reject linked non-Discord identities; owner access also requires a currently enabled private allowlist entry. Provider buttons are derived from live Supabase provider settings, so Google remains hidden until configured.

Session and PKCE values are stored in Secure, HTTP-only, SameSite=Lax cookies in production. Redirect paths are restricted to local relative paths. Canonical BrowseRP and Vercel preview hosts take precedence over stale `APP_URL` values.

These essential authentication and short-lived OAuth cookies are the site's only browser storage. Public code does not use local storage or session storage, and no analytics, advertising pixel or marketing tracker is loaded. Optional tracking must not be introduced without a separate privacy and consent review.

## Discovery score

Organic signals total 94%:

- quality: 28%
- engagement: 22%
- uptime: 18%
- player activity: 18%
- owner verification: 8%

Seven-day boost activity is capped at 6%. Paid visibility cannot replace community quality.

## Staff operations

The staff centre is not linked from the public site or sitemap. `/staff` remains a direct operations route with HTML and response-level `noindex` controls, but obscurity is not an authorization boundary. It requires an authorised Discord staff identity, and its API and database calls remain permission-scoped.

After authorization, the staff centre loads a permission-scoped queue snapshot. Before a decision button becomes actionable, `/api/admin/item` retrieves a safe evidence view under the caller's RLS permissions. The mutation then calls the audited single-item resolver with an explicit reason and request ID. There are no bulk enforcement controls.

## Published community links

Listing owners can submit an HTTPS community link, but submissions and their links remain private during review. The recorded `20260819143947_public_server_join_links.sql` migration adds the reviewed link to the published directory projection after `20260819143942_critical_security_boundaries.sql`. The server page accepts only an HTTPS value and opens it with `nofollow`, `noopener` and `noreferrer`. The migration does not replace staff review or URL moderation.

## Privacy and abuse controls

The application HMAC-hashes the trusted Vercel client-address signal before database use. In production, write paths fail closed when `PRIVACY_HASH_SECRET` is absent. The server-only Supabase boundary is required before privileged rate-limit, trusted moderation and fulfillment grants are hardened.

## Release strategy

The v1.3 migrations are staged:

1. additive slug lookup, staff evidence and server-only submission functions coexist with v1.2.2;
2. confirm the recorded critical security-boundaries migration before enabling account sign-in;
3. confirm the recorded public-server-join-links migration after it and verify that only published, staff-reviewed HTTPS links become public;
4. deploy and verify v1.3 with the server-only Supabase key;
5. generate the final release-hardening migration from the reviewed `supabase/planned-migrations/` artifact and apply it to revoke legacy public/authenticated privileged RPC access;
6. leave payments off until Stripe end-to-end, retry, refund and dispute procedures pass.

Production records the active v1.3 migrations as `20260819143942` and `20260819143947`. Application deployment and the final release-hardening migration remain separate cutover steps.
