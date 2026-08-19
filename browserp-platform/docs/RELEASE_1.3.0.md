# BrowseRP v1.3.0 release record

Prepared: 19 August 2026

## Scope

v1.3.0 reconstructs the verified v1.2.3 handover state from the available v1.1.0 source and live v1.2.2 behavior, then adds further security and operations hardening.

## Functional changes

- focused, responsive FiveM-first public experience with larger, more readable typography and reduced-motion support;
- intentional public routes at `/`, `/servers`, `/list-server`, `/server/:slug`, `/dashboard` and `/legal`;
- public developer, resource, tool and staff links removed; `/staff` remains a direct permission-gated, `noindex` operations route;
- exact clean community routes, safe not-found rendering and a dedicated reviewed listing flow;
- staff-reviewed HTTPS community links prepared for published server pages;
- essential-only authentication cookies with no analytics, advertising tracker, local storage or session storage;
- live provider discovery with code-ready Google member login;
- Discord-only staff ownership enforcement;
- member dashboard, favourites and notifications;
- evidence-first staff review modal and audited single-item actions;
- release/system snapshot in the staff centre;
- explicit disabled-by-default payment state;
- hosted Checkout with deterministic idempotency-compatible integration labels;
- strict webhook mode, server-signed metadata, catalog, line-item, amount, currency and replay protection;
- modern Supabase publishable/secret key handling;
- production-aligned `create_server_submission_server` listing boundary and server-only telemetry;
- exact CSP hash verification, static page contracts, robots and sitemap.

## Canonical Supabase history

The repository preserves the four migrations already applied to production at
`20260819110256`, `20260819112534`, `20260819113549` and `20260819114235`.
The application calls `create_server_submission_server`, matching that recorded
history. `20260819143942_critical_security_boundaries.sql` is recorded in production
and fixes NULL-secret fulfillment, anonymous execution, linked staff identities
and automatic owner reactivation. `20260819143947_public_server_join_links.sql` is
recorded after it and prepares the public directory to return only the
staff-reviewed HTTPS community link stored on a published, non-adult listing.
`20260819151759_release_hardening.sql` is recorded after the verified v1.3.0
production cutover and removes the legacy privileged RPC grants.

## Handover outcome

v1.3.0 was preview-tested and published to `browserp.com`. The transferred verification record reports Node.js 24, 32 JavaScript syntax checks, exactly 12 Vercel Functions and 26 passing tests. Production health was `ok` with no unexpected runtime errors at the handover snapshot.

The corresponding production snapshot contained two Discord users/profiles, one active owner and no listed servers, pending submissions, staff moderation actions or payment orders. Payments and Google login remained disabled. Northstar and Civic cards on that historical homepage were visual examples, not live listings.

## Outstanding at handover

- complete one real submit → staff review → publish journey;
- replace and fully test the Stripe webhook, refunds, disputes and reconciliation before enabling payments;
- decide whether both Discord owner-allowlist entries are still required;
- review remaining Supabase advisor warnings;
- synchronize the local v1.3 history to GitHub without overwriting it from the older remote `main` branch.

All three final production migrations through `20260819151759_release_hardening.sql` were recorded as applied before this handover record was closed.
