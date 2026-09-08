# Account export: duty, comment context and consent — 8 September 2026

Migration `20260908101754_member_export_duty_and_comment_context.sql` extends the current advertising-aware structured account export. It preserves the existing collector as `private.member_export_records_before_duty_comments(uuid)` and leaves the historical collector migrations unchanged. The new wrapper calls that collector first, retaining its account, enquiry, pending-scope and other existing fields.

## Included records

- `collections.staffDutyState`: zero or one row containing the subject's stored `availability` and `updated_at`. An absent state stays an empty array; it does not invent a duty event.
- `collections.staffWorkSessions`: the subject's recorded intervals with `id`, `started_at`, `ended_at`, `status`, `version` and `updated_at`. Open, confirmed and review-needed records are included as stored, without inventing worked-hour totals. Former staff retain access to their own records through the existing approved account-copy workflow.
- `collections.comments`: all previous fields and ordering remain, with the subject's own `parent_comment_id` and `edited_at` appended to each row. The wrapper does not look up a parent's body, author or private moderation information.
- `collections.recommendationPreferences`: exactly one row with `schemaVersion`, `choice`, `version` and `updatedAt`, matching the consent RPC's field names. A saved choice is `accepted` or `rejected`; an unset preference is `{ "schemaVersion": 1, "choice": null, "version": 0, "updatedAt": null }`. Its count is one even when unset, representing the exported preference state. Only the subject's current row is read; no browsing history or previous choices are included.

Each new collection has its corresponding count. An explicit scope note describes the duty projection; earlier scope notes and pending notices remain intact.

The wrapper never includes duty request payloads/results, correction reasons or staff audit prose. A manager's recorded correction request can refer to another person; it is deliberately not treated as that manager's own work interval. Other users' availability and work sessions are excluded. The existing advertising-enquiry projection, including the subject's own private enquiry message and staff reply, is preserved.

## Limits and access

The subject must match `private.require_active_member()` exactly. Approval, recent original sign-in, current request version, expiry, receipt and final download checks continue through the existing public account-copy RPCs. Neither the new wrapper nor its renamed predecessor grants raw execution to `PUBLIC`, `anon`, `authenticated` or `service_role`.

New records are preflighted with a 2,001-row sentinel before aggregation. A collection exceeding 2,000 rows, a combined count above 10,000, collections exceeding 2,000,000 encoded bytes or a final payload exceeding 2,097,152 bytes fails with the existing larger-export follow-up error. New comment fields, collection names and JSON separators count toward the byte budget; records are not silently truncated.

Already generated copies retain their original payload and SHA. The new fields appear when the existing workflow creates a new copy; its reuse of an available, unexpired copy is unchanged.

## Migration and integration order

Apply only after the existing structured export, `20260906020500_private_advertising_enquiries.sql`, `20260908100259_explicit_staff_duty_sessions.sql`, `20260908100413_comment_identity_and_replies.sql` and `20260908101556_member_recommendation_preferences.sql` are present. The preference migration remains owned by Chat 3 and must be integrated unchanged before this wrapper. This migration has not been applied to a hosted database by this task.

Collector chain after this migration:

```text
member_export_records
  -> member_export_records_before_duty_comments
    -> member_export_records_before_advertising
```

This wrapper includes the separately implemented recommendation preference through an explicit own-row projection. It does not change Chat 3's consent table, RPCs or modules. The exact collection shape and migration order were coordinated through the main task. Future collector wrappers must call the then-current collector and include their additions in the combined budgets so advertising, duty, comment and consent fields are retained.

Before publication, reconcile applied migration history, verify the private function grants and run the combined release checks against the final consent/export chain. No hosted account-copy request, approval, receipt, database mutation or deployment was performed by this task.

## Local verification

The dedicated `test/member-export-duty-comments-db.test.mjs` passed 11 checks on bundled Node 24.19.0 with PGlite. It exercised the real historical collector and approval/generation/read RPCs before and after the new wrapper, preserving earlier fields and advertising enquiries. Further checks covered current accepted/rejected/unset consent, own-record isolation, former-staff records, absent duty state, helper/table grants, wrong-account and revoked-session denial, all 2,000 work records, rejection of record 2,001, exactly 10,000 combined records including the consent state, new comment/duty bytes and the exact 2,097,152-byte final payload boundary.

The final consent-inclusive run read the exact consent migration from Chat 3's worktree through a temporary test copy because that migration was not yet present in the integration worktree. Its SHA-256 was `c1c1173649c06e22d61312fbfaebe8921d9375f66062221e127d2cfc9ceca900`. The temporary copy was removed; the permanent test uses the normal local migration path and must be run after the exact dependency is integrated. These are local database checks, not evidence of hosted activation.
