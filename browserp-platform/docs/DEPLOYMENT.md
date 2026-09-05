# BrowseRP v2 deployment runbook

## Known starting point

The transfer record says production is a healthy v1.3.0 deployment and GitHub `main` is still the older v1.1.0 source. The v2.0.0 working tree is a candidate, not production, until a verified preview is promoted. Do not let an automatic Git deployment build from the historical branch during this release.

Payments and Google login are disabled. Keep them disabled. The production-data snapshot at transfer contained two Discord users/profiles, one active owner and zero listings, submissions, staff actions or payment orders.

## Vercel contract

- Root directory: `browserp-platform`
- Framework preset: Other / no framework
- Install command: the npm lockfile is authoritative (`npm ci`)
- Build command: `npm run verify`
- Output directory: `public`
- Node.js: 24.x
- Function region: `dub1`, close to Supabase `eu-west-1`
- Function count: exactly 12, never more than the Hobby limit
- Canonical origin: `https://www.browserp.com`
- Production branch after the safe GitHub sync: `main`

`vercel.json` owns these settings so a dashboard default cannot silently skip verification or move database-bound functions back to `iad1`. `/server/:slug` rewrites explicitly to `/server.html?slug=:slug`. Public and staff CMS endpoints are routed through the consolidated router.

## Required environment

### Core

- `APP_URL` — `https://www.browserp.com`, without a trailing slash
- `SUPABASE_URL` — the clean BrowseRP project, never the legacy BrowseRP_Global project
- `SUPABASE_PUBLISHABLE_KEY` — browser-safe project key used at the server boundary
- `SUPABASE_SECRET_KEY` — server-only key
- `PRIVACY_HASH_SECRET` — unique random server-only value of at least 64 characters

Discord remains the staff-owner identity provider; Google is available for ordinary member sign-in and must never grant staff-owner access. Supabase Auth's site URL and callback allow-list must include `https://www.browserp.com/api/auth/callback`. Google and Discord must use their production BrowseRP applications, the square RP mark, and the public `https://www.browserp.com/privacy` and `https://www.browserp.com/terms` policy pages.

The current Free Supabase project advertises its project hostname as the provider callback. Google brand verification can still identify the application as BrowseRP. A future switch to `auth.browserp.com` requires a paid Supabase plan and custom-domain add-on, both old and new provider callbacks registered before activation, dual storage-host allow-lists during cutover, and a complete login/linking smoke test before the old callback is removed.

All secret values are entered in provider dashboards by the account owner. They are never committed, copied into documentation or pasted into chat.

## Database change

Production already records the v1.3 migration line through:

- `20260819143942_critical_security_boundaries.sql`
- `20260819143947_public_server_join_links.sql`
- `20260819151759_release_hardening.sql`

Do not edit, rename or replay any recorded migration. Production records both reviewed additive v2 migrations:

- `20260819164347_v2_application_boundaries.sql` tightens direct-write/RLS boundaries, adds replay-safe submission provenance, and adds the versioned website-content RPCs.
- `20260819174759_discord_staff_role_allowlist.sql` binds every staff rank to an enabled Discord-only mapping and adds protected-owner rank management with optimistic locking and immutable audit entries.

The sole enabled owner mapping is operational provider data and must never be hardcoded in source. All other staff access is assigned manually by that owner from the private staff centre.

## Cloudflare cutover

Cloudflare is the public security and caching layer; Vercel remains the application origin.

1. Mirror all current DNS before changing nameservers. Proxy only the apex and `www` web records. Keep MX, SPF, DKIM and DMARC records DNS-only so mail is not interrupted.
2. Use Full (strict) TLS, Always Use HTTPS, minimum TLS 1.2 and TLS 1.3. Keep 0-RTT disabled for authenticated/write traffic.
3. Enable the managed WAF and basic bot protection. Rate-limit `/api/` without treating the edge limit as the application's only abuse control.
4. Block unused HTTP methods and obvious secret/development paths. Keep retired payment, developer, resource and tool endpoints unavailable while they are outside the v2 product.
5. Change registrar nameservers only after the mirrored zone, Vercel domain attachment and mail records have been checked. Verify both apex and `www`, then verify inbound/outbound mail separately.
6. Confirm Cloudflare reaches Vercel with a valid certificate and that no redirect loop exists. HSTS is also sent by Vercel; do not enable preload submission without a separate owner decision and subdomain audit.

Cloudflare rules do not replace Discord authentication, CSRF checks, server-side authorization, RLS or rate limits. Never create a broad WAF bypass for `/api/admin/*`.

## Preview gate

Deploy a preview from the exact candidate source. Do not rebuild between approval and promotion.

1. `npm ci` and `npm run verify` pass on Node 24.
2. Vercel reports Ready, 12 functions and `dub1` placement.
3. `/api/health` returns v2.0.0, the candidate build SHA and `status: ok`; no secret or detailed provider error is exposed.
4. `/`, `/servers`, `/list-server`, `/dashboard`, `/legal`, `/server/unknown-test` and direct `/staff` render on desktop and mobile without console, CSP or horizontal-overflow errors.
5. Public pages contain no staff link, fake live listing, developer/resource/tool navigation, analytics or marketing tracker.
6. `/staff` and `/dashboard` return `X-Robots-Tag: noindex, nofollow, noarchive` and private/no-store caching. Signed-out staff APIs return 401 and cross-origin writes return 403.
7. Complete the real flow against the intended database: Discord sign-in → submit one server → see it in the owner dashboard → inspect it as authorised staff → approve/publish it → find it in search → open `/server/:slug`. Remove or clearly retain the test record by owner decision.
8. Verify a repeated listing request is idempotent, unsafe URLs are rejected, unreviewed links never become public, and an unknown slug shows the themed not-found state.
9. Verify staff content permissions separately: draft, version-conflict rejection, publish, public read, rollback and immutable audit/revision evidence.
10. Check response headers through the public Cloudflare hostname as well as the Vercel preview/origin. Confirm CSS/JS revalidate instead of serving a mixed release.

## Promotion and rollback

Promote the already-verified preview artifact. Immediately repeat health, public-route, staff-access and real listing smoke tests on `https://www.browserp.com`. Scan runtime logs for errors without logging request bodies or secrets.

Keep the known-good v1.3.0 deployment ID and the v2 candidate deployment ID in the private release log. Code rollback is an alias change to the known-good deployment. The additive v2 database boundary should normally remain in place because v1.3 does not depend on the new RPCs; do not improvise a destructive database rollback during an incident.

After production is healthy, create a recovery branch/tag for the historical remote state, push the reviewed release branch, require the Node 24 workflow to pass, then fast-forward `main`. Never force-push over the only copy of the old remote history.

## Payment quarantine

Keep `PAYMENTS_ENABLED=false`. Do not expose or unblock checkout until all of the following exist and pass together: a BrowseRP Vercel webhook (not the legacy Supabase project), minimal required Stripe event subscriptions, raw-body signature verification, live/test-mode isolation, server-signed metadata, idempotent fulfillment, replay tests, refund reversal, dispute handling, paid-but-rejected reconciliation and owner-approved legal/refund wording. A success URL must never grant credits.

Exact LCAPUK registered-company details are not present in this repository. Do not invent a company number, registered address or legal identity; the owner must provide and verify them before they are published.
