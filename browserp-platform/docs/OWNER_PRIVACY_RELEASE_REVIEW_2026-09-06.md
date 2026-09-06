# Integrated owner/options/privacy release review — 6 September 2026

## Result

One confirmed security gap in an older raw-table permission was found and closed in the handed-back isolated patch. No further concrete release blocker was found within the owner/options/privacy API, function, projection and migration boundaries reviewed. This is a scoped code review plus isolated regression evidence; it does not certify every site feature or replace hosted verification.

Patch: `/tmp/browserp-submission-read-hardening.patch`
Worktree: `/tmp/browserp-submission-read-hardening/browserp-platform`
Readback: `/tmp/browserp-owner-privacy-release-readback.sql`

## Confirmed blocker addressed

The inherited `submissions_owner_read` RLS policy (`202608180001_browserp_core.sql:1099`) checks the token identity, not whether its session still exists. Parent independently confirmed live SELECT grants for anon, authenticated and service_role. Thus a signed-out/revoked but unexpired owner JWT could still read its own raw submission rows directly even though website APIs and guarded functions refused it.

`20260906005841_restrict_raw_submission_reads.sql` revokes raw SELECT from PUBLIC, anon and authenticated only. It leaves service access and guarded member/staff function grants unchanged. No caller in this repository needs an unguarded member table read: `api/submissions.js:187–195` checks current account status before its privileged list read; individual owner/staff reads use guarded functions.

Regression reproduces the original stale-token read, then proves direct anon/member/staff reads fail after the revoke while a valid owner, current staff reviewer and service reader still work. RLS remains enabled. Readback also checks column-level SELECT privileges so an unexpected separate column grant cannot be missed.

## Migration-before-frontend compatibility

- The existing 7778 ordinary creation signature and service-only grant remain intact. Matching old applications and exact already-completed idempotent retries still work. Current atomic creation validates the actual session, expected account, restrictions and immutable request fingerprint.
- Strict game-specific choices can reject previously offered ordinary features (for example FiveM “whitelisted” or Minecraft “serious-roleplay”). This is a deliberate changed validation boundary, not a generic 500. The patch uses this 400 message: “Some feature choices have changed. Keep this page open and copy your draft into the updated listing form in another tab.” Both old and current form behavior retain all values/private Roblox evidence and account binding. A definite rejection unlocks deliberate correction with a new retry key; an ambiguous response still keeps the immutable original retry.
- Do not automatically reload an old form: these private drafts are deliberately not persisted across navigation. The recovery wording preserves the open page and does not falsely promise durable storage.
- New applications are limited to the four launch games. Existing nonlaunch corrections/owned targets remain maintainable. Do not restore old partial service writers.
- Owner migrations introduce new entrypoints without replacing the existing queue. Existing 7778 frontend cannot start owner edits or private completion, so do not exercise new operations until the corresponding API/assets are promoted. Privacy backfill preserves only an honestly labelled current snapshot, not invented historical messages.
- Apply source-ordered owner/options/privacy/feature-alias/raw-read migrations in the release window after the reviewed preview is ready, then promote and perform hosted checks. No source rollback should re-grant the unsafe raw SELECT permission.

## Controls preserved

- Owner read (`20260905233144...:109`) requires a current unrestricted member and actual published ownership. Propose/correct use the actual stored target and current versions, not the client owner flag. Approval (`:238–251`) requires current staff review plus server-management permission and rechecks ownership/live version. Existing `has_staff_permission` requires allowed active Discord staff/current session and, with the enforced setting, AAL2/TOTP. Read back `staff_mfa_required=true`.
- Stable listing ID/slug, source, logo/banner, live polling, claim/ownership and unrelated fields are retained. Database mutation and audit succeed atomically; conflict or audit failure leaves live content untouched.
- Imported keywords (`20260906001040...:54–79`) are checked against the actual locked owned listing. Thirty mixed researched/catalog/freeform keywords survive a name-only update. Hidden non-contextual research cannot be silently dropped; new additions are capped and must be enabled contextual catalog choices. No forged client flag grants the expanded limit.
- Private history/completion (`20260906002145...:15–76,195–282`) has RLS, no raw PUBLIC/anon/member/service access and tightly granted definer functions. Member projection excludes private completion evidence and staff identity. Staff evidence appears only through restricted review history. General audit records do not receive private evidence.
- Completion requires both review and separate fulfillment permission/current TOTP, a locked ready row, matching version, a concrete result/evidence/date, confirmation and an exact replay fingerprint. Modified replay payloads conflict. Append-only records cannot be silently rewritten.

## Remaining boundary — do not call privacy finished

Manual completion records what authorised staff attest they already did. It does not itself deliver an export, remove uploaded files, delete an Auth account, erase records or prove that an external action occurred. Ready is not completion. Restricted request/history foreign keys and append-only evidence deliberately retain records; actual export/erasure/retention/redaction fulfillment still needs its separately tracked design and implementation. This limitation remains visible in the source/runbook.

## Evidence and narrowly targeted hosted checks

The final affected run passed 36/36 in 4.7 seconds: owner database integration, contextual database integration and Roblox form behavior. The direct-role test first reproduces the vulnerability before applying the exact migration. The form 400 regression passed against both the old 7778 source and integrated contextual source. `git diff --check` and application against root passed. No production data or owner account/factors were changed.

Earlier controlled UI coverage already passed 30/30 scenarios with 1,044 assertions across Chromium/Firefox/WebKit, 390 touch and 1280 desktop, isolated HTTPS/CSP and mock APIs. See `/tmp/browserp-owner-options-browser-review.md`; do not repeat that full matrix just to restate it.

For the hosted candidate:

1. Run the metadata-only readback. Every function must exist with expected grants; private raw table/column access false; public submission anon/member table and column reads false, service access true; immutable history triggers enabled; one-open owner index present; fulfillment role initially owner; mandatory staff MFA true. This reads no requests, users, identities or private evidence.
2. Load an actually owned listing as its existing account without submitting. Confirm 30-keyword preservation, stable read-only source identity, descriptive version/current-account binding, and no exposure when signed out/using an unrelated account. A permitted non-destructive mock/isolated write supplies mutation proof already; do not manufacture production proposals solely for a check.
3. Check the promoted ordinary four-game form and Roblox fieldset, correct asset hashes/security headers, and a read-only existing corrections screen. If testing a deliberately invalid old-field request, ensure all other fields are harmless and it is rejected without creating any row; prefer the already-proven isolated scenario over avoidable production test traffic.
4. Read-only staff queue/owner review and privacy history: correct human labels, permission gating, version fields and member/staff evidence separation. Do not mark a real request fulfilled unless its requested work was independently completed.
5. Confirm a normal signed-in submissions list still loads after the revoke, and guests cannot retrieve private APIs. This specifically checks preservation of the service-backed website path.
