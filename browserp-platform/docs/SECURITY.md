# BrowseRP security model

## Secrets

No secret belongs in the browser bundle or repository. Vercel stores server-only Supabase, privacy-hash, Stripe, webhook and fulfillment values. OAuth provider secrets remain in Supabase/Auth provider dashboards. Recovery codes remain in an owner-controlled password manager or offline vault.

## Authentication and authorization

- OAuth uses Supabase PKCE.
- Production uses only essential Secure, HTTP-only, SameSite=Lax authentication and short-lived OAuth cookies.
- Public pages do not use local storage or session storage and do not load analytics, advertising pixels or marketing trackers. Optional tracking must remain disabled until a separate privacy and consent review is complete.
- Staff ownership is provisioned only for privately allowlisted Discord identities. A staff account with any linked non-Discord identity is denied, and an auth trigger cannot reactivate a suspended or revoked owner.
- Staff actions are checked by permission inside the database; the interface is not an authorization boundary.
- Google is a normal member identity path, not a staff-owner path.
- `/staff` is intentionally absent from public navigation and the sitemap and sends `noindex`, `nofollow` and `noarchive`; these discovery controls do not replace Discord identity, API permission or RLS enforcement.

## Database

RLS protects exposed tables. `staff_review_item` runs as SECURITY INVOKER so evidence reads remain subject to the caller's RLS permissions. SECURITY DEFINER functions that remain are narrowly validated transactional/API boundaries and must have explicit grants.

`20260819143942_critical_security_boundaries.sql` is recorded in production. It removes anonymous Stripe fulfillment, fixes NULL-secret validation and closes staff identity/suspension gaps. The later release-hardening migration removes direct public/member execution from privacy rate-limit mutation, tool telemetry and the legacy submission RPC that accepted caller-supplied moderation output.

`20260819143947_public_server_join_links.sql` is recorded in production after the critical boundary. Its scope is limited to adding a staff-reviewed HTTPS `community_url` to published, non-adult directory results; it does not expose `server_submissions` or any unreviewed owner link.

## Payments

Checkout is disabled by default. The client cannot enable it; `/api/health`, the checkout endpoint and the webhook derive readiness from server configuration. Before issuing a Checkout URL, the server verifies the configured active Price and Product metadata. Fulfillment verifies event and session live mode, a server-only Checkout metadata signature and re-fetched Stripe line items before writing an idempotent order/ledger transaction.

Setting `PAYMENTS_ENABLED=false` stops new Checkout creation but deliberately allows a valid, already-issued session to settle. It cannot invalidate a Checkout URL that Stripe already issued. `STRIPE_FULFILLMENT_ENABLED=false` is the emergency settlement stop; using it requires immediate inspection and manual reconciliation of paid sessions before restoration.

## Content and links

Listing input is length-limited, normalized and deterministically screened for unsafe patterns before entering review. Database constraints re-check trusted submission fields. Staff publication remains the final gate.

Public server pages accept only an HTTPS community link returned by the reviewed directory projection. External community links open with `nofollow`, `noopener` and `noreferrer`. Owner verification confirms control of the listing; it is not represented as a guarantee of server quality or third-party safety.

## CSP and browser policy

The site uses a restrictive CSP with no inline event handlers or style attributes. The exact homepage JSON-LD block is authorized by a SHA-256 hash. The verifier recalculates that hash and fails if markup/CSP drift apart. Frames, objects, camera, microphone, geolocation and browser-interest topics are disabled.

## Incident priorities

1. Revoke exposed provider tokens immediately.
2. Set `PAYMENTS_ENABLED=false`. If settlement itself is unsafe, also set `STRIPE_FULFILLMENT_ENABLED=false`, then inspect Stripe for already-issued or paid sessions and reconcile them before restoration.
3. Suspend compromised staff membership and preserve audit/security events.
4. Rotate affected secrets in provider dashboards, then update Vercel.
5. Review runtime logs using request IDs; never add request bodies or secrets to logs.
