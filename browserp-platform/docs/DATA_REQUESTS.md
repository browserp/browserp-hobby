# Account data requests

This batch adds a private request inbox. A signed-in member can request a copy of their data, a correction or account deletion; read their most recent 50 requests; update details when asked; and withdraw an open request. They cannot choose another account as the request owner.

Staff can filter and page through the queue, ask for more information, record a review, decline a request or mark it **Ready for follow-up**. That final label means a separate verified action is still needed. There is deliberately no Completed, Exported or Deleted action. This module does not produce data exports, modify profile data, purge an account, remove server ownership, delete media, or dispose of moderation/security evidence.

## Integrated surfaces and release gate

`20260905210347_member_data_requests.sql` was applied on 5 September 2026 at 21:03 UTC after review and the complete 579-test repository verification. Readback confirmed private tables have RLS and no direct anonymous/member access. The matching interfaces still require preview verification before production release. It adds private request and retry-key tables and narrowly granted RPCs. RLS is enabled, with no direct client or service-role table access. The functions check live, unexpired, unrestricted sessions themselves. Staff access additionally requires active allowed Discord staff, AAL2/TOTP and `privacy.requests.manage`; only the owner role receives the default grant. Existing custom-role controls can delegate that permission.

The main router, development server and Vercel rewrites mount GET/POST `/api/me/data-requests` and `/api/admin/data-requests` through the existing router, with private no-store responses. No standalone function was added. All calls use the member's authenticated token. Every request carries the account shown by the page in `X-BrowseRP-Account`; a changed sign-in is rejected before request data is read or written. This catches another tab switching accounts on the next request; it does not claim instant cross-tab identity detection.

Profile contains a collapsed **Your data** section at `/profile#your-data`. Links from Privacy and Legal open it directly. It loads on opening and uses the shared site controls. An authenticated **Data requests** section in Moderation appears only after `/api/admin/data-requests?access=1` confirms access without returning private rows. Permission is still checked for every list and decision.

Both pages keep and destroy their request controllers on account/session change or teardown. Moderation clears the queue when leaving its section, refreshing permission or losing access. A late response cannot restore private text. Page-cache restoration reloads the account check. Request text is not put in browser storage, analytics or console logs.

## Decisions and safeguards

- Details and member-visible staff replies are limited to 1,000 characters. No attachments or identity documents are accepted. The forms warn against passwords, codes and other people's personal information.
- Requests use stable submission keys and one open request per type per account. Retry reuses the same request; changing the form creates a new key. Database quotas apply even to direct RPC callers. Immutable create/review fingerprints stay in the private tables; reusing a key with changed details, a changed reply or a changed version returns a conflict, including after a later review. No request prose or fingerprint enters the general staff audit.
- Staff decisions have stable keys and expected versions. A late or competing review cannot silently overwrite a member withdrawal or another staff decision. The general staff audit stores the actor, request reference, kind and state/version transition, without copying private request prose or replies.
- The queue defaults to open requests and uses 25-record pages with a stable timestamp/ID cursor. Member history shows up to 50 recent requests and says so plainly.
- Submitting or approving an account-deletion request does not invalidate ownership, close appeals or discard retained evidence. The request's foreign key also prevents incidental deletion of the account while a request remains; a future reviewed fulfilment procedure must explicitly handle that relationship.

## Still to finish

This is the ordinary signed-in request route. Lost-access or restricted members still need a separately verified operator contact route. Do not direct them to misuse a ban appeal for unrelated privacy requests, and do not invent a support email that nobody monitors.

Full data export, correction and deletion fulfilment remain unfinished scope. A separate staff fulfilment path needs a clear ownership/media/retention decision, identity verification, a secure delivery path for data copies and a tested backup/recovery process. The current project has no demonstrated full database-plus-media backup or isolated restore. A saved schema snapshot or successful application rollback is not a substitute. Do not add an automatic purge to make the queue look complete.

The module contains no outbound email or third-party notifications. Staff must check the queue and members must return to their request status; any future notification should reveal only that a request has an update.

## Verification

Run `node --test test/privacy-requests*.test.mjs`, then the repository checks. The focused checks cover own-account isolation, revoked/expired/banned sessions, direct-RPC quotas, private table permissions, staff MFA and custom permission, idempotent creation/review, stale decisions, absence of destructive outcomes, literal text rendering, duplicate-submit protection, retry input preservation and paging.

Before promotion, verify on the exact preview with isolated fixtures: keyboard and mobile layout, member follow-up/withdrawal, staff permission loss, account switch, browser back/forward restoration and form error recovery. Do not create synthetic privacy requests in real member accounts for demonstration.

### Local integration evidence — 5 September 2026

- Node 24.19.0: 43 checks passed across the privacy database, API, DOM and real-page integration suites, the existing account-session and moderation UI suites, and the listing-review version API regression. The privacy-only group contains 27 passing checks.
- Syntax/deployment checks passed: 156 JavaScript files and the existing 12-function Vercel limit. Shared parallel work may increase the file count before the final release verifier.
- The actual Profile and Moderation HTML, scripts, styles and current strict CSP were served by an isolated local HTTPS fixture. Chromium, Firefox and WebKit passed member request creation, staff review, private section teardown and no horizontal overflow at 390px and 1365px widths. Phone-width contexts also used reduced motion. No real provider, production member or live database was contacted by these browser fixtures.
- WebKit's automated screenshot preparation inserts an inline stylesheet that the policy correctly blocks. Its functional pass ran without that screenshot helper; no site CSP directive was weakened. Chromium/Firefox screenshots were inspected for layout. These are browser-engine and viewport checks, not physical-device or hosted OAuth proof.
- Still required after independent migration/code review: full repository verification, an exact preview check and migration readback before promotion. This agent did not apply the migration; the root release step applied it after independent review at 21:03 UTC.
