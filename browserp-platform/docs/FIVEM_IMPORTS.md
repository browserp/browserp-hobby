# FiveM imports and ownership claims

Staff with `scrapers.manage` can use **Staff panel → Scrapers → FiveM**. Paste up to ten Cfx join codes or `https://cfx.re/join/...` links; requests are fetched sequentially and staged for review. Featured suggestions are discovery aids and are not automatically published.

Review the name, description, community language, region, framework, access, tags, keywords and images. Follow the source evidence when fields are missing or disagree. Locale suggests a community language/region; it does not prove a server's physical location. The join link is fixed to the source code. Discord invites and image URLs are classified by their destinations. Fetching checks Discord invites against Discord’s public service: expired invites are removed, while rate-limited or inconclusive checks remain flagged for review. Reviewed search keywords are included in both public search routes. Unsupported media must be removed or replaced. Publishing copies supported raster images to BrowseRP storage and records the reviewer and reason.

Imports are unclaimed and are not owner-verified. Duplicate source codes cannot create a second listing, and imports cannot overwrite metadata once a member owns the listing. Only FiveM is enabled; the other scraper sections remain placeholders.

## Live information

Counts come from the public Cfx listing service, not individual game-server IP addresses. Public reads refresh up to three due listings, protected by a per-server one-minute refresh lease. The server detail page checks every minute while visible. Observations older than five minutes or failed source checks are shown as unavailable rather than zero or live. Empty servers with a valid observation correctly show zero players. A staff refresh action is available for published imports. Metadata updates require a new fetch and review; they are not silently applied.

## Ownership claims

An unclaimed public listing has a claim form. The claimant signs in with Discord, explains their relationship to the server and can provide an HTTPS evidence link. The optional ownership check asks Discord for the `guilds` scope, then checks the authenticated Discord identity and the guild resolved from the listing's existing Discord invite. Only the guild's `owner` flag counts; administrator permissions do not.

Discord access tokens are kept in an encrypted, account-bound, HttpOnly cookie for ten minutes. They are never returned to browser JavaScript, persisted in the database, or included in audit records. Reconnect Discord to repeat a check after expiry. Verification records only the matching guild evidence. If the listing's Discord invite changes, the old verified result no longer appears as current.

Staff with `servers.claims.review` use **Moderation → Server claims** to search and filter pending/history and verified/unverified requests. A verified Discord owner is still subject to staff review of game-server ownership. Approval assigns one owner atomically and supersedes competing pending claims. Approvals and declines require a reason and record versions to prevent stale decisions.

## Authenticated API and checks

The same browser-session APIs support the staff UI and an assistant operating that UI:

- `GET/POST /api/admin/fivem`: list, fetch, featured suggestions, publish, archive, refresh.
- `GET/POST /api/server-claims`: own requests and trusted Discord verification.
- `GET/POST /api/admin/server-claims`: staff filtering and approval/decline.

Writes retain origin checks, CSRF, account restrictions, staff permissions, MFA policy and rate limits. Service-only database functions are inaccessible to member tokens. There is no unauthenticated import/publish endpoint.

Run `npm run verify` with Node 24, then `node --test test/fivem-claims-db.mjs` for the disposable PostgreSQL workflow and row-access checks. Database tests do not modify production. Apply the additive `fivem_imports_and_server_claims` migration before deploying the application.
