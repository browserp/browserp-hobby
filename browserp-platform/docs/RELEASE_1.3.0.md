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

## Deliberately incomplete at packaging

- manual owner Discord login;
- Google Cloud OAuth client creation and manual Google login;
- payment enablement and live webhook replacement;
- final release hardening, which waits for the preview and server-only key.

The two active v1.3 migrations were applied to production during release preflight; application deployment and final release hardening remain separate cutover steps.
