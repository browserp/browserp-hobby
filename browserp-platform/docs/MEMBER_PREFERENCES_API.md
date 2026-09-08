# Account recommendation preference contract

This implementation stores a member's optional recommendation choice across devices. It does not upload browsing history, change theme settings, or replace the required session/security boundary. It is prepared code until Main integrates the route, applies the migration and verifies the deployed behavior.

## HTTP integration owned by Main

Import `memberPreferences` from `../lib/member-preferences.js` into `api/router.js` and add the existing endpoint wrapper:

```js
"me/preferences": endpoint(["GET", "POST"], async (req, res) =>
  ok(res, await memberPreferences(req, res))),
```

Route: `/api/me/preferences`. Both methods require a current signed-in member and `X-BrowseRP-Account` equal to that member's authenticated ID. POST also requires the existing same-origin and CSRF checks, `Content-Type: application/json`, and a body of at most 1,024 bytes. Responses use `Cache-Control: no-store`.

GET has no body. POST accepts exactly:

```json
{"schemaVersion":1,"choice":"rejected","expectedVersion":4}
```

`choice` is `accepted` or `rejected`; `expectedVersion` must be a nonnegative JavaScript-safe integer. Unknown fields, including `history`, `accountId`, `userId`, `theme` and timestamps, are rejected. The account header binds the rendered view; the database independently derives the actor from verified `auth.uid()`.

Success returns the unwrapped record below through the repository's normal `ok` helper:

```json
{
  "accountId":"00000000-0000-4000-8000-000000000001",
  "schemaVersion":1,
  "choice":"rejected",
  "version":5,
  "updatedAt":"2026-09-08T10:20:30.123456+00:00"
}
```

Before any saved choice, GET returns `choice: null`, `version: 0`, `updatedAt: null` and does not create a preference row. Timestamps are database-generated ISO timestamps; use **version**, never time, for conflicts. Responses with a different account, unsupported schema, malformed fields or a write result contradicting the requested choice are refused by the HTTP module.

## Rejection-safe conflict rule

- Acceptance requires `expectedVersion` to exactly equal the currently stored version, including version zero when no row exists. Successful acceptance increments version by one.
- Rejection ignores an obsolete `expectedVersion`, saves `rejected` and increments the current version. A delayed acceptance using an older version then receives **409**. If acceptance commits first, the subsequent rejection replaces it. Repeated rejection remains safe.
- Opt-in is limited to **30 successful writes per account per 600 seconds** using the existing database rate limiter. This acceptance quota never blocks rejection. GET creates no rate-limit or preference record.
- Versions are monotonic JavaScript-safe integers. At the theoretical maximum safe integer, rejection remains possible at that terminal version and all future acceptance returns **409**, avoiding overflow or reuse of a version for opt-in.

Example: both devices read accepted/version 7. Device A rejects and gets version 8. Device B's delayed acceptance with expectedVersion 7 receives 409; it cannot restore consent. A later deliberate acceptance after reading version 8 may succeed as version 9. The backend cannot identify a local rejection that has not reached it; frontend rules below remain necessary.

Frontend integration must remain off while loading, on errors, during an account switch and after any local rejection. Turn off and clear local optional history immediately when rejecting, before the POST. Keep a pending rejection on sync failure; a stale remote acceptance must never clear that local rejection. Do not automatically retry an acceptance after 409 by fetching a new version. Recheck the account/request generation before applying any response, and validate schema and version. Cross-device synchronization is observed on refresh/sync; it is not an immediate push guarantee for offline devices.

Guests keep the existing device-local choice and footer controls. Stored consent and browser-local history remain separate. Do not merge guest/browser rejection into account acceptance or upload the local history when an account accepts. Required cookies/session/security and theme behavior stay independent of this optional choice.

## Database boundary and release implications

Migration: `supabase/migrations/20260908101556_member_recommendation_preferences.sql`, initially generated with the Supabase CLI. It adds only:

- `private.member_recommendation_preferences`: current `user_id`, `schema_version`, `choice`, `version`, `updated_at`; private schema, RLS enabled, no direct grants for PUBLIC/anon/authenticated/service_role.
- `public.member_recommendation_preferences()` and `public.member_set_recommendation_preferences(integer,text,bigint)`: authenticated-only RPCs, fixed empty search path, current member/session/expiry/ban checks, caller-derived account. The write takes a per-account advisory transaction lock, including the absent-row case, then rechecks access before writing. Because the inherited helper's `now()` is fixed at transaction start, the writer also explicitly checks the current session's `not_after` against `clock_timestamp()` after the lock wait.

The narrowly scoped security-definer functions are needed to expose only the caller's consent record without granting table access. They use `private.require_active_member()` and its existing live-session/security dependencies; they do not grant staff powers or use user-editable metadata. Anonymous and service-role callers have no execution grant. No Auth, ownership, media, policy, router or shared configuration is changed by this migration.

The row references `auth.users` with `ON DELETE CASCADE`, so an approved erasure procedure must include the table in dependency reporting. Include this private schema/table in database backups and restore checks. The existing fixed-list account export does not gain a new collection automatically: Main should include this consent record in that export before claiming the copy includes every held account field. No browsing history should be added to exports from this feature because none is stored here. The current record is not a historical consent audit log.

Deploy the database migration before enabling the endpoint/frontend. A missing migration or unavailable backend must keep optional collection off; preserve guest behavior. Rollback should disable the route/frontend integration without dropping saved rejection records. Backups can restore an older accepted value, so after a database restore keep account-based acceptance disabled until consent state is reconciled; never treat restored historical acceptance as new consent. Hosted migration/deployment, real cross-device behavior and current recoverable backups remain Main's verification responsibility.

## Focused verification

`test/member-preferences.test.mjs` exercises HTTP identity/CSRF/origin/body/response boundaries and error propagation. `test/member-preferences-db.test.mjs` executes the real migration and current access/session/rate-limit function dependencies in isolated PostgreSQL via PGlite, covering conflict order, first-write races, direct RPC permissions, disabled sessions, terminal version safety, separate-account quotas and Auth fixture cascade. A long-transaction fixture proves the additional real-clock expiry check denies the write even when the inherited helper still sees transaction-start `now()`. PGlite serializes its single connection; these cases verify both possible write orders, not independent hosted connections under load.
