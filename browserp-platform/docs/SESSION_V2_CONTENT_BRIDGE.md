# Versioned session bridge for the moderation rollout

This bounded patch starts from Main public commit `9a00307cc9c50eb6b6b1f052d2bcd1d1e60af4e2`. It adds a versioned member-session RPC, moves every current application caller to it and adds an optional content-write pause. It does not deploy, apply hosted SQL, activate a classifier or change public/staff styling.

## Database contracts

The cached Supabase CLI `2.117.0` generated both SQL filenames with `migration new`; no CLI installation was needed.

- `supabase/migrations/20260909125137_member_connection_status_v2.sql` is additive. `member_connection_status_v2()` preserves the original guarded body: member access, caller-owned live session, session expiry, staff membership and original OAuth recency. Only `authenticated` receives direct execution; `PUBLIC`, `anon` and `service_role` do not.
- `supabase/rollout/20260909125139_retire_legacy_member_connection_status.sql` is a separate controlled step, deliberately outside the automatically discovered migrations directory. Its transaction requires the new authenticated, postgres-owned security-definer function and the expected legacy owner before permanently revoking all direct legacy execution from `PUBLIC`, `anon`, `authenticated` and `service_role`. Main must verify the exact v2 body and effective privileges before running it. The script requests a PostgREST schema-cache reload after the grant change.

Inactive reads return `{active:false}`. Active reads retain `{active:true,staff,userId,sessionId,authenticatedAt,recent}` with the original value types. No browser-supplied release identifier, result, role or timestamp gains authority.

The original guarded function body remains intact for its postgres-owned internal consumers: `public.member_connection_operation()`, `private.export_recent_member()` and `public.member_read_data_export_file()`. Do not replace the legacy body with an unconditional inactive response. Main confirmed the hosted legacy owner and body before this implementation; actual hosted internal ownership/effective privileges still belong in the retirement readback.

## Application coverage

All five direct RPC call sites now use v2: the shared `currentAccountSession` in `api/router.js`, `connectionSessionStatus` in `lib/supabase.js`, and the collection-read, create and correction checks in `api/submissions.js`.

This keeps auth/session and profile reads, avatar eligibility, account connections, both unlink checks, OAuth link start/callback and listing applications on the same established authorization contract. OAuth link cookies keep the original session ID and authentication timestamp; the callback comparisons are unchanged. Ordinary OAuth sign-in remains available.

Setting the server-only `CONTENT_WRITES_PAUSED=true` makes the current deployment return HTTP 503, `Cache-Control: no-store`, `Retry-After: 60` and a plain retry message for:

- POST profile changes and prepared avatars, before session refresh, payload processing or Storage work. The check sits inside each router handler, covering both friendly URL rewrites and direct `/api/router?_route=...` calls.
- POST comments and replies through `/api/servers`, after bounded JSON parsing/action normalization and before authentication, quota work or either comment RPC.

The optional setting defaults to false. It is read on each invocation from this deployment's configuration; it is not a global cross-deployment switch. Reads, votes, reports, server applications and account connections remain available. This patch does not globally pause OAuth profile creation, staff actions or direct database RPC callers.

## Controlled order

1. Apply only the additive v2 migration and verify its exact guarded body, owner, authenticated execution, rejected anonymous/service execution, session results and response types. Keep legacy grants unchanged at this step.
2. Deploy this v2-capable public bridge with `CONTENT_WRITES_PAUSED=true`. Verify the exact commit and settings on the canonical host, both raw and friendly write routes, profile/session reads, account connections and server applications. Keep every deployment containing the old public-upload implementation paused permanently once it uses v2.
3. Complete the separate inventory and containment of surviving deployments that lack the mandatory legacy session preflight. Main identified deployed `a538` code without that preflight; this patch cannot retire that upload path. An alias change or an authentication prompt alone does not prove signed-in old-deployment execution is closed.
4. Apply the separately controlled retirement SQL. Read back effective grants, prove a valid authenticated direct legacy call is rejected and v2 remains available, and verify internal connection/export consumers. Exercise a controlled old handler only after its closure is established; do not test unknown old upload paths by submitting public member content.
5. Drain requests that passed the old session preflight before retirement. Source settings permit 60 seconds for the router invocation and up to 15 seconds for a Storage request; verify actual deployed limits. A timeout does not prove the remote write was cancelled. Check requests and reconcile Storage writes accepted around the boundary before proceeding.
6. Apply and verify the reviewed moderation migration; deploy the exact integrated application with these v2 callers and the pause retained. Confirm canonical guarded avatar routes and controlled member/staff fixtures before reopening content writes on the integrated release. Keep the classifier provider unset.

Legacy profile POST and comment/reply POST do not call the retired session RPC, so its revocation alone is not universal maintenance. The canonical bridge pause covers those paths on this deployment; the moderation migration supplies their private-review database boundary. Include older host access in the release plan where complete cross-deployment maintenance is required.

## Rollback and limitations

Before retirement, a v1 application rollback is possible while the additive v2 function remains installed. After retirement, roll back only to a v2-capable release with content writes still paused. After moderation migration, complete the forward application deployment or obtain a separately reviewed compatibility migration. Never restore immediate avatar publication or restore legacy direct RPC execution: either can reopen historical upload paths.

This patch cannot prove that every old immutable deployment has the required preflight, cancel an upload already accepted by Storage, or verify hosted ownership, ACLs, RLS, quarantine storage and release configuration. It does not modify managed Storage metadata, rotate credentials or introduce another service.

## Local validation

Focused HTTP/API tests cover pause-before-upload, actual friendly HTTP routes and configured raw router destinations, comments/replies before auth/quota/RPC, profile reads through v2, continuing votes/reports, and explicit reopening. Existing account/OAuth/upload and listing-application tests exercise v2; valid server applications run with content writes paused. The focused application run passed 84 tests with zero failures.

The expanded disposable PostgreSQL suite passed 22 tests with zero failures. It verifies v1/v2 contract equivalence, active/revoked/foreign/expired/banned/deleted/anonymous access, OAuth recency, staff status, grants before and after retirement, and actual internal connection/export consumers after retirement. In addition to the disposable postgres-owned recent-export adapter, the real privacy-file fixture exercises request, staff review and approval, generation, manifest listing, member file reads and receipts. It checks preserved function bodies, file ownership/digests and denied cross-member, staff, anonymous, service-role, stale-OAuth, revoked-session and withdrawn-request reads. Storage metadata and accounts are synthetic: hosted file delivery, actual MFA and deployment containment are not exercised. This is local database evidence, not a hosted migration or full-chain deployment proof.

The current [Supabase function guidance](https://supabase.com/docs/guides/database/functions) was checked for security-definer search-path and explicit execution-grant behavior; the changelog index was checked for relevant breaking changes. No hosted advisors or live database queries were run in this isolated implementation.
