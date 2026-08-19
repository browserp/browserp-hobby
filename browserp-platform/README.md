# BrowseRP

BrowseRP is a focused FiveM roleplay server directory. The public product is a small multipage site: home, server directory, reviewed listing form, individual server pages, member dashboard and plain-language legal information. The staff centre is a direct, unlinked route protected by Discord identity, application permissions and database policies.

## Release state

- **Production at the transferred baseline:** v1.3.0 at `https://www.browserp.com/`
- **Prepared candidate:** v2.0.0; do not describe it as live until the exact verified preview is promoted
- **Application root:** `browserp-platform`
- **Vercel output:** `public`
- **Runtime:** Node.js 24.x in Vercel region `dub1`
- **Vercel Functions:** exactly 12, within the Hobby limit
- **Package manager:** npm with the committed `package-lock.json`

The transfer record says v1.3.0 was healthy in production, while GitHub `main` still pointed to the old v1.1.0 source. Preserve that warning until the release branch has passed CI and `main` is updated without a force-push.

The transferred production-data snapshot contained two Discord users and profiles, one active owner, and no listings, submissions, staff actions or payment orders. Payments and Google login were disabled. Those counts are a snapshot, not fixtures to display on the public site.

## v2 product boundary

- Public routes are `/`, `/servers`, `/list-server`, `/server/:slug`, `/dashboard` and `/legal`.
- The directory renders only published database records. v2 does not present Northstar, Civic or any other fictional card as a real listing.
- Listing submission requires a signed-in member, explicit acceptance of the current terms and listing standards, bounded plain-text fields, a canonical public HTTPS community link and server-side review.
- The member dashboard shows published listings, recent submission status, saved servers and notifications.
- `/staff` is absent from public navigation and the sitemap, sends `noindex`, and still requires an authorised Discord staff session. Obscurity is never treated as access control.
- Staff actions are permission-scoped and single-item. Review decisions require a reason and create an audit record.
- Approved website copy can be managed in the staff centre through schema-defined plain-text/boolean keys with draft, publish, rollback, version checks and revision history. Staff cannot inject raw HTML.
- The browser uses only essential authentication and short-lived OAuth cookies. No analytics, advertising pixels, local storage or session storage are used.
- Payments have no public launch path in v2. Keep them disabled until checkout, webhook, refund, dispute and reconciliation flows have all passed live end-to-end review.

## Local verification

Run from this directory with Node.js 24.x:

```bash
npm ci
npm run verify
npm run dev
```

`npm run verify` checks JavaScript syntax, the Vercel function limit, static contracts, migrations and the Node test suite. Vercel runs the same command as its build command; a failed verifier must fail the deployment.

The local site is served at `http://127.0.0.1:8080`. Synthetic development data is allowed only on loopback, only with its explicit development flag, and never in Vercel or production.

## Release rules

1. Never deploy the historical GitHub `main` branch over v1.3.0.
2. Apply the reviewed additive v2 migration exactly once; do not rename, edit or replay production-recorded migrations.
3. Deploy a preview from the exact candidate source, verify the full browser-to-database story, then promote that same artifact.
4. Keep `PAYMENTS_ENABLED=false` and Google disabled unless their separate launch checklists are completed.
5. Keep provider secrets in their dashboards. Never commit or paste passwords, OAuth secrets, privileged Supabase keys, Stripe secrets, recovery codes or raw network addresses.
6. After production verification, create a recovery reference for the historical remote state and update GitHub through a reviewed, non-force release flow.

See [Deployment](docs/DEPLOYMENT.md), [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md), the [v1.3.0 handover record](docs/RELEASE_1.3.0.md) and the [v2.0.0 candidate record](docs/RELEASE_2.0.0.md).
