# Owner submission corrections

Implemented and verified on 5 September 2026. The additive migration was applied at 21:03 UTC after the complete 579-test repository run; hosted permission readback passed. No member submission was changed for testing. Matching API/UI preview verification remains the next release gate.

Owners can open **Correct submission** in My account when staff request changes. The original data is prefilled on the existing listing form, with the current review feedback and earlier feedback. Resubmission updates that same submission and reopens its existing moderation queue item. It never creates another submission or publishes directly.

The form keeps language and setup separate, preserves earlier selected features, requires agreement again, and keeps a pending or closed review read-only. If staff change the review or queue while the form is open, the owner must load the latest review. Their unsent edits stay in place for comparison; consent is cleared again. Unsent edits are not stored on the device, and navigation warns while edits remain unsent.

A failed network response keeps the exact attempted body and idempotency key. Retrying cannot create another row or overwrite a later decision. The owner can instead check the latest review before editing further. Ended sessions and navigation away clear the personal form and feedback; late responses cannot restore them. A Back/Forward cache restoration reloads and rechecks the session before revealing correction details. Ordinary tab switching keeps unsent edits. The account originally displayed in the form is checked on both read and correction requests.

## Boundaries

- GET `/api/submissions?id=…&account=…` calls the authenticated, owner-scoped `member_server_submission` RPC. All-submission reads also check the current session before returning owned rows.
- PATCH `/api/submissions` checks same origin, session, CSRF, displayed account, agreement, bounded validated fields, rate limit, URL rules and existing moderation assessment. Server-owned actor/session values and moderation results go to `resubmit_server_submission_server`.
- The correction transaction rechecks a real unexpired matching session and account restrictions, ownership, submission revision and queue revision. It locks the submission and queue, preserves the old data/feedback/queue snapshot, updates content, reopens one queue row and records the retry key atomically.
- Private revision and correction-key tables have RLS enabled and no direct member, anonymous or service-role table privileges. Entries cascade with the underlying submission/user. They contain historical owner content and require the same retention/export consideration as the original submission; no additional public exposure is introduced.
- Versions also protect staff review. `staff_server_submission_review` returns current submission and queue revisions with current and previous evidence. `staff_review_server_submission` checks both before invoking the existing audited decision behavior. The old generic listing action is closed to direct calls; its former implementation is private. Reports, comment moderation and other existing actions retain their existing handlers.
- No earlier review snapshots are invented. Existing staff audit events stay intact; the new private snapshot history begins when this migration is installed.

## Release order and verification

Apply `20260905210355_owner_submission_corrections.sql` before deploying the matching API and UI. The migration moves the old generic decision function into `private` and replaces the public entry with a compatibility wrapper that rejects unversioned listing decisions. An older client therefore fails safely with a refresh message. Reverting only the JavaScript will not restore legacy listing writes; use a reviewed forward fix or a separately reviewed database rollback.

Focused verification includes real isolated PostgreSQL (PGlite) permissions/transactions, owner/API/UI tests, the actual old staff decision implementation behind the new wrapper, and staff version API/dialog regression tests. Coverage includes cross-account and revoked/expired/banned sessions, malformed links, missing agreement, stale record and queue versions, replay conflicts, preservation of successive feedback, closed decisions, complete rollback after a forced queue failure, and denial of the old direct listing mutation path.

Controlled Chromium, Firefox and WebKit checks use real current HTML/CSS/JavaScript and native forms under the unchanged production CSP, with API fixtures only. They cover 1280px, 390px and 320px widths, prefill, conflict recovery without losing edits, renewed consent and successful same-record submission. This is browser-engine/emulated-width coverage, not a claim about physical phones or hosted account/data mutations.
