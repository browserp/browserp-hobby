# Private record access boundary

Migration: `20260906012500_restrict_private_record_reads.sql`.

Older owner row policies trusted the identity in an unexpired token even after its session had ended. Hosted metadata confirmed raw client SELECT grants on fifteen private-facing tables. Normal BrowseRP account/staff operations already use current-session functions or guarded server reads, so those table grants are unnecessary. This migration also removes the confirmed unused raw submission mutation grants.

The migration removes all PUBLIC/anon/authenticated table and separate column privileges on those sixteen tables. Service privileges, row security, existing function grants and data remain unchanged. This prevents direct column grants from accidentally leaving a smaller read/update bypass after the table grant is removed.

## Preserve public directories

The existing developer/resource API paths and view columns stay unchanged, including order/filter support. Both views become explicit public projections with a security barrier and trusted view-owner access to their underlying tables. This is intentional: the public caller no longer needs raw profile access. These views are read-only to clients.

- Developers: published developer profile and public member profile; only the approved avatar field when its status is approved. No raw biography, pending avatar or review metadata.
- Resources: published resource with public author profile; same public output columns. Disabled platform names remain hidden, matching the old anonymous row-policy behavior.
- Signed-in ownership or staff status does not widen these public views.

The views must retain all explicit predicates when edited. Do not replace them with SELECT * or remove the barrier. PostgreSQL documents this restricted-view pattern and the differing invoker/owner permission semantics in [CREATE VIEW](https://www.postgresql.org/docs/17/sql-createview.html). This is not a blanket replacement for row security on application tables.

## Rollout and verification

The view replacement and private grant revocation occur in one transaction. Existing public API code therefore works both before and after the migration; no frontend timing adapter is needed. Apply through the normal reviewed migration process. Never restore unsafe raw grants as an application rollback.

Focused isolated PostgreSQL tests first reproduce the stale private-profile read and raw public-avatar exposure. They then verify all sixteen table/column boundaries, public/private/pending/suspended content, view columns and API response/cache contracts, caller-predicate isolation, existing member operations and staff AAL2/current-session checks. The real unchanged API handlers read database-backed fixture views through a local mocked PostgREST transport; this is not hosted Auth or production data testing.

After application, inspect metadata for sixteen RLS-enabled tables: all anon/member table and column privilege flags false; service SELECT retained. Both public views must have security_invoker=false and security_barrier=true, their expected trusted owner and SELECT-only client grants. Check their explicit definitions and unchanged authenticated function grants. Then read /api/developers, /api/resources and an existing signed-in account/profile screen without creating production test records.

This batch does not alter Storage policies or other public catalogue tables, and does not implement account erasure/export fulfillment. No user data, identity or session is deleted.
