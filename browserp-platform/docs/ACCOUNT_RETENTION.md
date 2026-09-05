# Inactive account review

The daily `browserp-account-retention` job identifies inactive accounts for staff review. It does not delete accounts, end sessions, remove server ownership, or close appeals. No removal action is exposed by this job.

- Under 45 inactive days: no review flag. Returning activity clears an existing review flag.
- From 45 inactive days: one in-app reminder per inactive period. This is not proof of external notice delivery.
- From 60 inactive days: the existing staff account-review list marks the account as due for review. This is not a deletion deadline.
- Active staff are excluded from the inactivity queue.

`private.run_account_retention()` remains private to the scheduled database operation. It returns `mode: review-only`, the number of new reminders and due reviews, and `deleted: 0`. Repeated runs do not duplicate reminders. The existing daily schedule remains in place.

For a review, inspect account activity and relevant ownership, moderation and appeal records. Inactivity alone is not grounds for removing a community or its owner. A future account deletion request needs a real contact/request route, verified identity, an explicit decision about retained records and server ownership, safe media cleanup, and a proven backup/recovery process. The dashboard currently has no dedicated export or deletion request form; do not tell a member that it does.

## Release checks

Apply `20260905192015_review_inactive_accounts_and_close_unused_uploads.sql` through the reviewed migration workflow before publishing its updated privacy wording. Confirm that the installed function performs no deletes against `auth.users`, `auth.sessions`, or community/appeal tables; any DELETE in it is limited to obsolete review flags. Inspect a scheduled result for `mode: review-only` and `deleted: 0` without logging personal records.

The migration also closes the unused browser INSERT policy on `uploads-quarantine`. It keeps existing files, bucket limits, read rules, and server-managed media uploads. Do not restore that direct upload permission unless there is a reviewed workflow with current-session checks, bans, quotas, validation and cleanup.

The isolated PostgreSQL regression in `test/retention-storage-boundaries-db.test.mjs` covers first-observed accounts over 60 days old with server ownership and an open appeal, repeat reminders, returning activity, direct-upload denial, and existing server-managed media access. It never uses hosted user data.

If application code is rolled back, retain this additive safety migration. Do not reinstate automatic deletion or the unused direct upload policy as part of an incident rollback.
