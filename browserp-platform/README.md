# BrowseRP

BrowseRP is a cross-game roleplay server directory for FiveM, RedM, Roblox, Minecraft, social worlds, survival games and simulators. The public product is a focused multipage site: home, server directory, reviewed listing form, individual server pages, member dashboard and plain-language legal information. The staff centre is a direct, unlinked route protected by Discord identity, TOTP, application permissions and database policies.

## Release state

- **Current production release:** v2.3.0 at `https://www.browserp.com/`
- **Production source before this candidate:** v2.1.0 on GitHub `main`
- **Application root:** `browserp-platform`
- **Vercel output:** `public`
- **Runtime:** Node.js 24.x in Vercel region `dub1`
- **Vercel Functions:** exactly 12, within the Hobby limit
- **Package manager:** npm with the committed `package-lock.json`

The original transfer recovered v1.3.0 from an old v1.1.0 `main`. GitHub and production were subsequently reconciled through verified v2 releases; keep the historical recovery branch and never force-push `main`.

The transferred production-data snapshot contained two Discord users and profiles, one active owner, and no listings, submissions, staff actions or payment orders. Payments and Google login were disabled. Those counts are a snapshot, not fixtures to display on the public site.

## v2.2 product boundary

- Public routes include `/`, `/servers`, `/list-server`, `/server/:slug`, `/dashboard`, `/about`, `/blog`, `/advertise`, `/appeal`, `/coins` and `/legal`.
- Discovery covers FiveM, RedM, Roblox, Minecraft, Forza, Garry's Mod, ARMA, VRChat, survival, driving and other roleplay games without fictional live listings.
- The directory renders only published database records. v2 does not present Northstar, Civic or any other fictional card as a real listing.
- Listing submission requires a signed-in member, explicit acceptance of the current terms and listing standards, bounded plain-text fields, a canonical public HTTPS community link and server-side review.
- The member dashboard shows published listings, recent submission status, saved servers and notifications.
- `/staffpanel` is absent from public navigation and the sitemap, sends `noindex`, and requires an authorised Discord staff identity plus a verified authenticator factor. Obscurity is never treated as access control.
- Staff actions are permission-scoped and single-item. Review decisions require a reason and create an audit record.
- Staff can review listings, reports, profiles, account/security signals, rank permissions, blog posts and picture adverts through permission-scoped audited workflows. Staff cannot inject raw HTML.
- Account creation and sign-ins use masked network/device evidence. Full IP evidence requires an owner-approved, time-limited reveal and is audited.
- Accounts receive an inactivity warning after 45 days and guarded deletion after 60 days; active staff, financial records and unresolved media are excluded.
- The browser uses only essential authentication and short-lived OAuth cookies. No analytics or advertising pixels are used. An explicit light/dark preference is stored locally in the member's own browser.
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
2. Apply each reviewed additive migration exactly once; do not rename, edit or replay production-recorded migrations.
3. Deploy a preview from the exact candidate source, verify the full browser-to-database story, then promote that same artifact.
4. Keep `PAYMENTS_ENABLED=false`; financial launch still requires the separate Stripe refund, dispute, spend and reconciliation checklist.
5. Keep provider secrets in their dashboards. Never commit or paste passwords, OAuth secrets, privileged Supabase keys, Stripe secrets, recovery codes or raw network addresses.
6. After production verification, create a recovery reference for the historical remote state and update GitHub through a reviewed, non-force release flow.

See [Deployment](docs/DEPLOYMENT.md), [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md), the [v1.3.0 handover record](docs/RELEASE_1.3.0.md), the [v2.0.0 production record](docs/RELEASE_2.0.0.md) and the [v2.2.0 release record](docs/RELEASE_2.2.0.md).
