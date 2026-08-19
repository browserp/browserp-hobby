# BrowseRP deployment and takeover runbook

## Non-negotiable state

Production currently runs v1.2.2. The historical GitHub `main` source is older. Do not trigger a production deployment from an unsynchronized branch. Use a preview branch, verify it, then promote the reviewed commit.

The production Supabase project is the clean BrowseRP project documented in the transfer guide. Do not point this application at the legacy BrowseRP_Global project.

The FiveM-first public redesign remains in the release candidate. Production records the reviewed active migrations as `20260819143942_critical_security_boundaries.sql` and `20260819143947_public_server_join_links.sql`; no Stripe configuration was changed.

## Vercel project settings

- Root directory: `browserp-platform`
- Framework preset: Other / no framework
- Output directory: `public`
- Node.js: 24.x
- Production branch: `main`
- Canonical origin: `https://www.browserp.com`
- Apex domain redirects to `www`

## Environment variables

### Core

- `APP_URL` — canonical production origin, no trailing slash
- `SUPABASE_URL` — clean BrowseRP project URL
- `SUPABASE_PUBLISHABLE_KEY` — browser-safe project key used by the server boundary
- `SUPABASE_SECRET_KEY` — server-only key; required before hardening privileged RPC grants
- `PRIVACY_HASH_SECRET` — unique random server-only value, at least 64 characters

### Payments

- `PAYMENTS_ENABLED` — keep `false` or absent until the final payment checklist passes
- `STRIPE_FULFILLMENT_ENABLED` — normally `true` so an already-issued paid session can settle; use `false` only as an emergency stop with manual reconciliation
- `NODEJS_HELPERS` — set to `0` in every Vercel environment so webhook code can stream the untouched request body
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_GROWTH`
- `STRIPE_PRICE_LAUNCH`
- `SUPABASE_FULFILLMENT_SECRET`

All secret values are entered directly in provider dashboards by the account owner. They are never committed or pasted into chat.

## Database migration order

1. Confirm production records `20260819143942_critical_security_boundaries.sql`; it is compatible with the disabled-payment state and must precede account sign-in.
2. Confirm production records `20260819143947_public_server_join_links.sql` immediately afterward; verify that only published directory results expose reviewed HTTPS links.
3. Deploy and verify the v1.3 preview with `SUPABASE_SECRET_KEY` configured.
4. After preview verification, run `supabase migration new release_hardening`, copy the reviewed SQL from `supabase/planned-migrations/20260819130000_release_hardening.sql` into that newly generated file, inspect `supabase db push --dry-run`, and apply it with the v1.3 cutover.

The planned hardening artifact must remain outside `supabase/migrations/` until step 4; otherwise a normal push applies it too early. Do not edit or reapply the production-recorded migrations from `20260819110256` through `20260819143947`.

## OAuth

Discord and Google use the Supabase Auth callback. Supabase Site URL must be `https://www.browserp.com`; the application callback allow-list must include `https://www.browserp.com/api/auth/callback`. Staff ownership remains Discord-only.

The application uses only Secure, HTTP-only, SameSite=Lax session and short-lived PKCE cookies. It must not add analytics, advertising trackers, local storage or session storage during deployment. If that changes later, stop and complete a separate privacy, consent and legal review before enabling it.

## Preview verification

Before promotion:

1. `npm ci && npm run verify` passes.
2. Preview build is Ready and contains no build errors.
3. `/api/health` reports v1.3.0; core status is `ok` only when database, server-only key, privacy hash and Discord are ready.
4. `/`, `/servers`, `/list-server`, `/dashboard`, `/legal` and `/server/test` render without horizontal overflow or console/CSP errors on desktop and mobile.
5. The public header and footer contain no developer, resource, tool or staff link. The direct `/staff` route sends `X-Robots-Tag: noindex, nofollow, noarchive` and exposes no queue data without an authorised Discord staff session.
6. Search, filters, reset and the `/list-server` submission journey work. Published server pages show a `Visit community` action only for a staff-reviewed HTTPS link; missing or unsafe links do not render an action.
7. Public pages create no local-storage or session-storage entries and load no analytics, advertising pixel or marketing tracker. Essential sign-in cookies use the expected Secure, HTTP-only and SameSite attributes in the preview environment.
8. Signed-out member/staff write endpoints return 401; cross-origin writes return 403.
9. An unknown server slug renders the themed not-found state, not a routing error.
10. Reduced-motion and background-tab animation pausing work.

## Payment launch checklist

Payments remain disabled until all items pass:

1. Live Stripe products/prices match the fixed catalog amounts. Every Product has exact `browserp_product_key` and `browserp_credit_amount` metadata; Checkout preflight rejects missing or mismatched values before returning a payment URL.
2. The only active BrowseRP webhook points to `https://www.browserp.com/api/webhooks/stripe`, not a legacy Supabase project.
3. The webhook subscribes only to the required Checkout completion/asynchronous success events.
4. Signing, Stripe server key, fulfillment secret and Supabase server key are configured only in Vercel, with `NODEJS_HELPERS=0` for untouched webhook bytes.
5. Production uses live-mode keys/prices; preview uses test mode, and opposite-mode events are rejected.
6. The fulfillment secret hash in the private database matches the Vercel plaintext value.
7. A test purchase validates the server-signed Checkout metadata, strict product metadata, line items, quantity, amount and currency; one ledger credit is granted.
8. Retrying the same Checkout attempt keeps identical Stripe parameters, and replaying the same event grants no additional credits.
9. Cancellation, unpaid sessions, wrong prices, absent metadata, wrong amounts, wrong currency and invalid signatures grant nothing.
10. Paid-but-rejected events have an owner-visible reconciliation procedure; refund and dispute reversals and legal policy text have been reviewed and tested.
11. Raw-body signature verification has passed on an actual Vercel preview.
12. Only then set `PAYMENTS_ENABLED=true`.

## Rollback

If v1.3 fails before release hardening, point production back to the known v1.2.2 deployment. If release hardening has already been applied, prefer a v1.3 code rollback that retains the server-only boundaries. A forced v1.2.2 rollback also requires temporarily restoring authenticated execution of the exact legacy `create_server_submission(text,text,text,text,text,text,text,text,integer,jsonb)` function and the other legacy RPC grants it uses; remove them again when v1.3 is restored.
