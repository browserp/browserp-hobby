# MAIN-BADGE-PRIVACY-01 — standalone raw award privacy proposal

Status: **compatible with the reviewed production source and ready for Main's review/application**. The scoped local fixture passes 6 checks. No hosted SQL, app deployment, production record query, identity change or badge activation was performed.

The proposal removes direct browser access to `public.user_badges.reason` and `awarded_by` without waiting for the larger moderation/session/badge release. It changes only SELECT privileges on this existing table, retaining its current row policy and four explicit public columns. It adds no application source, functions, tables, ranks, chronology or provider configuration.

## Exact inputs

- Reviewed production-source commit: `88730c4433cd66c3df1b74be4a55c9609e81506d`; tree `143584bb35db7e5c7442b9d890dca790318ec749`.
- Worker2's metadata receipt: `/Users/georgemacdonald/.codex/.chatgpt-projects/g-p-6a84fe2ac40c81919083d96dbb368185/browserp-hosted-inventory/deliverables/MAIN-INVENTORY-01.md`, captured 9 September 2026, 14:45–14:55 UTC; its accompanying JSON was read for the exact table ACL, columns and policy.
- Main subsequently reported applying additive v2 at hosted ledger `20260909150609`, retaining legacy execution. That update was acknowledged as coordinator-reported state, not independently queried here. This proposal does not touch or reapply either session function.
- The receipt records a postgres-owned, RLS-enabled `public.user_badges` table with broad table privileges for `anon`, `authenticated` and `service_role`. Its SELECT policy is `user_badges_public_read`, fingerprint `e9d25b24b15e31e6855ed7a73dab69eb`. The policy permits unexpired awards when the recipient is the caller or an eligible public profile. This metadata establishes potential field access; no real award rows or disclosure history were inspected.
- Proposed SQL: `supabase/rollout/raw-badge-award-privacy.sql`, SHA-256 `5f589a79495581e075920bfa8b93d9eb8c88cdeaea655144103f57945c8a2b98`.
- Isolated branch: `fix/chat6-raw-badge-privacy-20260909`; worktree `/Users/georgemacdonald/Documents/Codex/2026-09-08/browserp-security-audit/work/raw-badge-privacy`.

## Retained public columns

| Column | Purpose |
| --- | --- |
| `user_id` | Award recipient, still subject to the existing row policy |
| `badge_id` | Link to the public badge catalogue |
| `awarded_at` | Existing award timestamp |
| `expires_at` | Existing expiry timestamp |

`reason` and `awarded_by` remain available to their existing trusted service/postgres consumers but are not selectable by `anon` or `authenticated`. An explicit safe-column query remains permitted subject to RLS. Wildcard/whole-row reads and attempts to filter or sort using either hidden field fail; this is intentional. No claim is made that an unknown external wildcard client can continue reading the old broad projection.

The transaction first removes table-level SELECT from `PUBLIC`, `anon` and `authenticated`, then clears existing column SELECT grants on the six current columns and grants only the four above to the two API roles. Revoking a column alone would not override a surviving table-level grant. Non-SELECT privileges, the existing row policy, rows and service-role grants are untouched. Postconditions abort the transaction if another inherited privilege still exposes either protected field or the retained columns are unavailable.

## Current callers and compatibility

Searching `api/`, `lib/` and `public/` at the exact production commit found no direct `user_badges` or `member_badges` caller.

- `api/servers.js:83` gets display data from `public_server_engagement`; `lib/public-pages.js:144` calls the same RPC for the rendered server page.
- `public/public-comments.js:50-60` renders the current `staff` and `server_owner` kind/label pairs.
- That RPC's actual source is `supabase/migrations/20260908100413_comment_identity_and_replies.sql:59-94`. It derives staff labels from active memberships/roles and server-owner labels from the listing owner; it never reads `user_badges`. The scoped fixture executes this real function before and after the proposal and gets identical public JSON.
- The actual `private.member_export_records` collector, defined in `20260906004454_structured_member_data_export.sql:220-224`, reads stored awards from a postgres-owned guarded path. It already projects badge identity/timestamps/catalogue information and omits award reason/actor. A real request, staff review/approval, generation and member read of an account copy still succeed after the proposal.
- Existing system award inserts and trusted service reads/writes keep their original privileges. No browser write authority is added or removed.

This establishes compatibility with the inspected first-party production callers. Hosted PostgREST behavior and any separately operated client remain Main's acceptance responsibility.

## Ordering and readback for Main

This SQL is deliberately outside the automatic migrations folder. Main may review and apply it as a separate privacy step while the current source is live; it requires neither the additive v2 session function nor old-upload containment because it does not alter session or upload behavior. Do not replay any historical migration to obtain the fix.

Before application, confirm the table is still postgres-owned with RLS enabled, the relevant policy remains reviewed, and the later canonical badge migration has not already been installed. The proposal checks RLS/ownership and rejects the presence of `public.member_badges(uuid)` or `private.member_signup_order` before granting transitional reads. If current source or metadata has changed, review that difference first. Main retains all apply authority.

After application, a metadata-only check can confirm the effective columns without selecting award rows:

```sql
select client_role,
  has_table_privilege(client_role,'public.user_badges','select') as table_select,
  array(select a.attname from pg_attribute a
    where a.attrelid='public.user_badges'::regclass and a.attnum>0 and not a.attisdropped
      and has_column_privilege(client_role,'public.user_badges',a.attname,'select')
    order by a.attnum) as selectable_columns
from unnest(array['anon','authenticated','service_role']) as roles(client_role);
```

Expected: `anon`/`authenticated` have no table-level SELECT and exactly `user_id`, `badge_id`, `awarded_at`, `expires_at`; service privileges remain as recorded before application. Reconfirm RLS and the unchanged policy metadata. The proposal requests a PostgREST schema-cache reload. Main can use controlled synthetic API acceptance to confirm explicit safe projections and permission denial for the protected fields, without inspecting real awards.

Later, apply the accepted `20260909163000_member_badges.sql` in the established moderation/export/hierarchy/badge order. Its table **and column** revokes remove these four transitional grants before public display moves to canonical RPCs. The fixture verifies the exact two revocation statements from the accepted migration with SHA-256 `6e753cc0803bf95235916700bfeb74b8b72a8fc7f3fc2cd0375cf19e30e847c0`. Their text was independently compared with the accepted source. After canonical installation, this proposal refuses to run so it cannot reopen direct reads. Do not restore the broad table grant as an application rollback.

## Focused evidence and limits

Node 24.19.0:

```text
node --test --test-concurrency=1 test/raw-badge-award-privacy-db.test.mjs
6 passed, 0 failed, 0 skipped; exit 0; approximately 2.2 seconds.
```

The local PGlite fixture uses the real six-column table, real badge policy, actual production engagement function and existing privacy-file/export fixture. It starts with broad role grants, a PUBLIC grant and explicit sensitive-column grants, reproduces disclosure using synthetic awards, applies the actual proposed SQL, and proves:

- Identical eligible rows for the retained columns, including expiry and private-profile boundaries.
- Denial of reason/actor projections, wildcard/whole-row reads and sensitive filters/sorts.
- Identical actual public engagement JSON and successful guarded account-copy delivery.
- Preserved policy/function bodies, service access and non-SELECT privileges.
- No new session, hierarchy, badge RPC or chronology objects introduced by the proposal.
- Compatible removal of transitional privileges by the accepted later revokes, and rejection of out-of-order reapplication.

The future-order test simulates only the canonical function's presence to exercise the safety guard; it does not claim to apply the full later feature migration. This is scoped local PostgreSQL evidence, not a hosted PostgREST/RLS-advisor receipt, whole-history replay or broad security audit. No private production rows were read.
