# Member badge integration receipt — 9 September 2026

Status: integrated and verified locally. No hosted database migration, identity assignment, role change, Discord sync, credential access, repository push or deployment was performed by this badge worker.

## Inputs and changes

Imported the supplied `pending-member-badges/20260909163000_member_badges.sql` and `member-badges-db.test.mjs` into the candidate, preserving the declared migration order after `20260909105431_staff_capability_hierarchy.sql`. The immutable handoff files were not edited.

The supplied migration SHA-256 is `7ed1e9f5497bdc9d2d9418eb1a66ac19aea83dabc3806f1652d21d71cc1a28d7`.
The integrated migration SHA-256 is `6e753cc0803bf95235916700bfeb74b8b72a8fc7f3fc2cd0375cf19e30e847c0`.

Scoped integration hardening:

- Revoke client table and column access to raw `public.user_badges`, which contains award reasons and actor identifiers. This closes a legacy/default-grant surface independently of the profiles policy. Service access and the guarded account-copy function remain available; public display uses `member_badges` and the canonical comment projection.
- Enable RLS on both private signup-ledger tables, in addition to their explicit ACL revokes.
- Remove the supplied test's fallback helper definition. Tests now require the real integrated hierarchy migration and verify its frozen canonical helper hash.
- Keep the original focused badge cases, then add an integration fixture which applies the complete relevant privacy, moderation, export and hierarchy migrations before the badge migration, using their real guarded SQL actions.

The canonical `private.is_active_staff_member(uuid)` source remains unchanged, including its execute revokes. Its source hash is `75cffed8faef83aae82e58805c4768ea0504db58273ebce7ab3980a66708f109`. Executable checks compare the database function definition, all stored role names/ranks, and all role default permission grants before and after the badge migration.

First 100/First 500 activation remains OFF: the migration sets `chronology_confirmed=false`, no confirmation time/evidence, and no historical confirmed cohort rows. Tests temporarily activate an explicitly synthetic chronology only inside isolated fixtures; no eligibility decision is made for a real account.

## Verification

Node 24.20.0:

```text
node --test --test-concurrency=1 test/member-badges-db.test.mjs
18 passed, 0 failed

node --test --test-concurrency=1 test/member-badges-db.test.mjs test/active-staff-membership-db.test.mjs test/staff-hierarchy-db.test.mjs
43 passed, 0 failed
```

The checks cover bounded public fields, provider-evidence revocation, reviewed owner control, staff revocation/expiry, manual spoof resistance, private ACLs including legacy table/column grants, all eight canonical roles, unchanged authority, signup ordering and tie/evidence gates, delayed profile provisioning, idempotent awards, guarded account-copy continuity, and actual comment staging/approval/edit/reapproval with stale review rejection.

## Limits and release requirements

These are isolated PostgreSQL/PGlite checks using the repository fixtures and real relevant migration/function definitions. They are not a full historical migration replay, multi-connection PostgreSQL contention test, Supabase advisor run, hosted PostgREST check, browser verification or production readback. Dan's website-only combined verification receipt accompanies the DAN-WEB-01 delivery; Main owns final integrated verification and the controlled release order. The supplied moderation maintenance requirements still apply. Historical cohort activation requires a later reviewed evidence migration and is not part of this completion.

Security guidance checked against the current [Supabase changelog](https://supabase.com/changelog) and [database/RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security); no relevant platform breaking change affected this local SQL integration.
