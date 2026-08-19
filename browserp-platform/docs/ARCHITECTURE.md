# BrowseRP v2 architecture

## Product shape

BrowseRP v2 is a dependency-light multipage website, not a single crowded application. Static HTML, CSS and JavaScript provide the public pages and authenticated workspaces:

- `/` — purpose, search entry and listing-owner call to action
- `/servers` — published FiveM directory and filters
- `/server/:slug` — one reviewed public listing
- `/list-server` — authentication-first submission flow
- `/dashboard` — a member's listings, submissions, saved servers and notifications
- `/legal` — privacy, terms and listing standards
- `/staff` — direct, unlinked staff operations route

The browser receives only public directory fields or data authorised for the signed-in user. It never receives Supabase secret keys, OAuth client secrets, Stripe secrets, private allowlists, unreviewed community links or raw network addresses.

## Request path

```text
Browser
  -> Cloudflare DNS/TLS/WAF/rate limit
  -> Vercel static files or Node.js Function in dub1
  -> Supabase Auth/Postgres in eu-west-1
```

Cloudflare is defence in depth. Vercel Functions still validate method, media type, body size, origin/CSRF signal, authentication, permissions and input. Supabase RLS/RPC boundaries remain the final data-authorisation layer.

## Vercel Functions

The repository contains exactly 12 deployable JavaScript functions, within the Vercel Hobby limit. `api/router.js` consolidates provider discovery, OAuth, sessions, member operations, staff review and website-content operations. Dedicated functions serve health, directory search, listing submission and retained compatibility endpoints.

The public v2 navigation does not expose developer, resource, free-tool, boost or payment surfaces. Their retained handlers are not a statement that those products are launched; payments remain disabled and the edge policy keeps retired routes closed.

All functions run on Node.js 24 in `dub1`. The Vercel build runs `npm run verify`, and a failed verifier blocks the deployment.

## Authentication and browser state

Supabase Auth performs OAuth with state, nonce and PKCE. Discord is the staff-owner identity path. A staff session must contain one consistent Discord identity, map to an enabled private owner allowlist entry and pass application plus database permission checks.

Session and short-lived OAuth values use Secure, HTTP-only, SameSite=Lax cookies in production. State-changing requests also require a synchroniser CSRF header derived from the authenticated session and a same-origin request. Redirects are restricted to local paths and trusted canonical hosts.

These essential cookies are the only browser storage. v2 does not use local storage, session storage, analytics, advertising pixels or marketing trackers.

## Listings

Public directory reads use the reviewed `search_server_directory` projection. Only published, non-adult records can appear. A community action is rendered only for a canonical HTTPS value returned by that projection and opens with `nofollow`, `noopener` and `noreferrer`.

Submission writes use a server-only Supabase function. The v2 boundary adds a request UUID, a one-way idempotency key, a request fingerprint, accepted terms/standards versions and a per-owner open-submission cap. Replaying the same request returns the existing submission; replaying a changed payload under the same key fails.

The member dashboard reads only the signed-in owner's records. Staff review is evidence-first and single-item: retrieve the permitted item, choose an allowed action, provide a reason, and write one audited decision using an internal request ID.

## Staff-managed website content

Website copy is not arbitrary HTML and the staff panel is not a general code editor. The v2 database migration defines an allowlist of known keys and value types in a private schema. Public readers receive only published values. Authorised Discord staff can:

- save a bounded plain-text or boolean draft;
- publish against the version they loaded;
- roll back to an earlier published revision;
- review current and published versions.

Optimistic version checks prevent silent overwrites. Publish/rollback requires the stronger permission, every mutation requires a reason, and revisions are retained for audit.

## Caching and security headers

Vercel serves HTML with revalidation defaults. Authenticated shells (`/dashboard` and `/staff`) are explicitly private/no-store. CSS and JavaScript revalidate on every use so an HTML page cannot remain paired with a stale mixed-release bundle; stable images may be cached for one day.

The global response policy includes HSTS, a self-only CSP with no inline script/style allowance, frame/object/media blocking, `nosniff`, strict referrer handling, restrictive permissions, and same-origin opener/resource policy. `/staff` and `/dashboard` also emit `noindex`, but search exclusion is not an access-control mechanism.

## Payments

The historical Stripe implementation remains quarantined. No public v2 navigation launches checkout, and `PAYMENTS_ENABLED` stays false. Payment work is a separate release requiring a replacement Vercel webhook plus tested fulfillment, replay, refund, dispute and reconciliation flows. A browser redirect is never proof of payment.

## Release boundary

The v2 migration is additive to the production v1.3 schema. It must be applied before code that calls its new submission/content RPCs is promoted. Preview validation covers browser, API, authentication and real database state; production promotion reuses that exact deployment artifact. GitHub synchronization happens only after production is healthy and the historical remote state has a recovery reference.
