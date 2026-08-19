# BrowseRP v2.2.0 release record

Prepared: 19 August 2026

Status: **candidate pending exact preview and production verification**

## Scope

- Expands BrowseRP from a FiveM-led directory into a cross-game roleplay discovery platform.
- Rebuilds the public experience around fast game browsing, honest empty states, dedicated server URLs and information-rich directory rows.
- Removes the oversized raster hero mark and uses the supplied BrowseRP artwork as a compact lockup with a themed `Browse` wordmark.
- Adds reviewed, picture-led side advert carousels with manual controls, pause behaviour and reduced-motion support.
- Adds a signed-in avatar menu, light/dark preference and reviewed member profile-picture URL.
- Repairs staff authenticator QR rendering and keeps the setup key hidden unless explicitly requested.
- Adds staff-visible duplicate-submission signals and guarded 45/60-day account-retention warnings and cleanup.
- Preserves permission-scoped staff controls, audited IP-evidence reveal, database row security and the 12-function Vercel limit.
- Keeps Stripe checkout and BrowseRP Coin sales disabled.

## Database artifacts

- `20260819212500_multiplatform_advert_carousels.sql`
- `20260819214000_profile_retention_security.sql`

Both migrations are additive and must be applied exactly once. The retention job excludes active staff, financial records and unresolved uploaded media.

## Verification before production

- Node.js 24 verifier passes with exactly 12 Vercel Functions.
- All repository tests pass and `git diff --check` is clean.
- Public desktop/mobile routes render without overflow or console errors.
- The production migration head, platform and advert counts are verified.
- Production health reports the exact Git commit and payments remain disabled.
