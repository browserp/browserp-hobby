# BrowseRP

BrowseRP is a dependency-light FiveM roleplay server directory. Its public surface is intentionally small: a focused home page, the server directory, individual server pages, a reviewed listing form, the signed-in member dashboard and plain-language legal information. The staff centre remains a direct, unlinked operations route protected by application and database permissions. Promotion checkout remains launch-gated and is not part of the current public navigation.

## Current release line

- **Production:** v1.2.2 at `https://www.browserp.com/`
- **Prepared candidate:** v1.3.0
- **Application root:** `browserp-platform`
- **Vercel output:** `public`
- **Vercel Functions:** exactly 12, within the Hobby limit

v1.3.0 reconstructs and extends the missing v1.2.3 work while preserving the clean production database. Payments remain disabled unless every checkout, webhook and server-only fulfillment safeguard is present and `PAYMENTS_ENABLED=true` is set intentionally.

## Product and safety model

- The public routes are `/`, `/servers`, `/list-server`, `/server/:slug`, `/dashboard` and `/legal`.
- Public developer, resource, tool and staff links have been removed. `/staff` remains available only as a direct, `noindex` operations route and still requires an authorised Discord staff identity.
- Search, filtering, ranking and first-pass moderation rules are deterministic.
- Public production requests do not silently fall back to demo records when the database is unavailable.
- Published listings may expose only a staff-reviewed HTTPS community link; unreviewed submission links remain private to the owner and authorised staff.
- Promotion contributes no more than 6% of the discovery score; organic quality remains dominant.
- Staff review is permission-scoped, evidence-first and single-item. Consequential decisions require a reason and create an audit record.
- Discord is the staff-owner identity path. Linked non-Discord identities are denied at both the application and database boundaries, and auth triggers cannot reactivate suspended owners.
- The site uses only essential Secure, HTTP-only authentication cookies. It includes no analytics or advertising trackers and writes no public data to local or session storage.
- Checkout uses Stripe-hosted Checkout Sessions. A success redirect never grants credits; only a verified, server-signed, idempotent webhook can do that.
- Server-only Supabase functions protect privacy rate limiting, trusted moderation output and payment fulfillment.

## Local verification

Use Node.js 24.x:

```bash
npm ci
npm run verify
npm run dev
```

`npm run verify` checks JavaScript syntax, the Vercel function limit, release-versioned assets, ordered migrations, static HTML/accessibility contracts, CSP consistency and the Node test suite.

The local server runs on `http://127.0.0.1:8080`. Development-only catalog records are available only when no production backend is configured and the runtime is not Vercel/production.

## Production rules

1. Never deploy the old `main` branch over the newer production release.
2. Validate v1.3.0 on a preview deployment before promoting it.
3. Production records `20260819143942_critical_security_boundaries.sql` and `20260819143947_public_server_join_links.sql` as applied. They close the anonymous fulfillment bypass, make staff suspension durable and expose only staff-reviewed HTTPS community links. Do not reapply them.
4. Verify the public server journey against those recorded database boundaries before promotion.
5. Keep `PAYMENTS_ENABLED=false` until the Vercel webhook, live Stripe mode, signing secret, server-only Supabase key, fulfillment secret and replay/idempotency tests are complete.
6. Keep the release-hardening SQL under `supabase/planned-migrations/` until v1.3.0 is running with `SUPABASE_SECRET_KEY`. Then generate a fresh migration with the Supabase CLI, copy and review the staged SQL, and apply it; earlier v1.2.2 code depends on grants that plan removes.
7. Never put passwords, OAuth secrets, privileged Supabase keys, Stripe secrets, recovery codes or raw network addresses in source, screenshots or chat.

See [Deployment](docs/DEPLOYMENT.md), [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md) and the [v1.3.0 release record](docs/RELEASE_1.3.0.md).
