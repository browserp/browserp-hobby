# Account erasure: implemented preflight and remaining decisions

This is a locally implemented, read-only account-removal dependency report. It does not delete or anonymise records, revoke a session, operate Storage or Auth, activate Discord role sync, approve a retention policy, or change a privacy request. Router mounting, reviewed migration application, hosted readback and production verification belong to the coordinating release task.

## Integration contract

The two functions are provided by migration `20260908101606_account_erasure_preflight.sql`; the handler is `lib/account-erasure-preflight.js`:

```js
import { staffAccountErasurePreflight } from "../lib/account-erasure-preflight.js";

"admin/account-erasure-preflight": endpoint(["POST"], async (req, res) =>
  ok(res, await staffAccountErasurePreflight(req, res))),
```

Use the existing private `ok` response, including private/no-store handling. Never use the public cacheable JSON helper. This task deliberately does not edit the shared router or staff presentation modules.

`POST /api/admin/account-erasure-preflight`

```json
{"requestId":"UUID of an existing deletion request","version":1}
```

The displayed account must be supplied in `X-BrowseRP-Account`; normal same-origin and CSRF checks also apply. Unknown fields, an arbitrary target account, a policy override, or an execution/fulfilment instruction are rejected. The handler requires the current Discord session and AAL2, forwards its token, and applies the existing request limiter. Both database functions separately require a currently active **owner role**, current privacy review and fulfilment permissions including deny overrides, current unrestricted allowed staff identity/session, and TOTP. A non-owner delegated privacy reviewer cannot use this report. This restriction avoids exposing dependency counts to ordinary members or broad staff permissions.

The subject is read from the existing open `delete` request. Missing/non-delete requests return 404; a changed version or closed request returns 409. The RPCs are:

```text
staff_account_erasure_preflight(p_request_id uuid, p_expected_version bigint) -> report
staff_account_erasure_preflight_access(p_request_id uuid, p_expected_version bigint) -> true or denial
```

The handler calls the access check again after the scan, before returning private counts, so session revocation, permission changes or request withdrawal during a slow scan can deny release. It returns a SHA-256 of the exact `JSON.stringify(report)` bytes as `reportSha256` and a fixed set of `stages`. The digest is a consistency reference, not a signature, execution approval or proof that underlying data stayed unchanged. Reports are fresh snapshots; they are not cached or durably stored by this feature.

```text
{
  contractVersion: 1,
  mode: "read-only", executionEnabled: false,
  asOf, request: {id,version,status}, subjectId,
  coverage: {
    dependencyGraphComplete, boundedCountsComplete, fullErasureInventory: false,
    maxPaths: 250, maxDepth: 6, countLimit: 1000,
    dependencyPathsInspected, foreignKeyEdgesInspected,
    missingRelations: [{relation,optional}]
  },
  dependencies: [{relation,category,via:[{constraint,from,to,deleteAction}],
                 count,countIsLowerBound,triggers:[]}],
  summary: {ownedServers,ownedServersCountIsLowerBound,
            otherOwnersAdvertsUsingUploads,sharedAdvertsCountIsLowerBound,
            activeStaff,storedObjects},
  policyDecisions: [{id,decision}], technicalBlockers: [{id,detail}], warnings: [],
  reportSha256, stages: [{id,state,evidence}]
}
```

Counts refer to paths and overlap; adding them does not give a distinct-record total. A `count` of 1000 with `countIsLowerBound:true` means **at least 1000**, not an exact total. Follow that flag on the underlying storage dependency when interpreting `summary.storedObjects`. Depth, cycles and queue limits explicitly make graph coverage incomplete. Optional tables missing from this particular installed schema are reported as absent; this is not a zero-row result or proof that they are inactive in another environment. A schema/column mismatch fails the scan rather than inventing a count. The graph only traverses Auth, public, private and Storage relations. Triggers are listed because FK actions alone do not prove what a DELETE would do.

The UI must present this as a review report, never a successful deletion or a "ready to erase" button. `fullErasureInventory` and `executionEnabled` are always false. Even exact bounded counts leave unstructured and external review pending.

## Actual boundaries found in the allocated baseline

The inherited continuity and checklist correctly describe the existing request workflow as review/attestation. `staff_fulfill_data_request` records independently completed follow-up; it does not perform it. The current inactivity job flags review after 45/60 days and always returns `deleted:0`; it does not authorise an erasure schedule.

| Data boundary | Current relationship and consequence |
| --- | --- |
| Account/profile and ordinary member rows | `profiles.id` cascades from Auth. Favourites, votes, comments, reviews, submissions, notifications and many owned rows cascade from the profile; this may also reach other members' interactions with owned content. A cascade is not an approved policy. |
| Privacy requests and export evidence | `private.account_data_requests.user_id` references Auth with NO ACTION. History, fulfilments, review keys, export approvals, copies and file manifests refer to that chain. History, fulfilments and export approvals have immutable guards. The deletion request itself prevents a naive Auth DELETE; disabling the guards is not an implementation. |
| Financial and staff-action evidence | Promotion orders, credit ledger, entitlements, payment attempts and some moderation/staff-action actor references use RESTRICT. Disabled payments do not imply empty historical tables. |
| Reports, moderation, appeals and audits | Some subject references are UUIDs stored as text or JSON, not FKs. Reporter cascades can remove records concerning another person. Setting an actor FK to null leaves prose, targets, before/after snapshots and metadata. External/contact-email-only appeals require separate matching and review. |
| Network/account activity | `account_activity.user_id` has no Auth/profile FK. Its network evidence and reveal requests depend on the activity row. Deleting the account alone leaves activity identifiers and protected evidence. Exact user/reference counts cannot prove that shared network/device hashes identify only this user. |
| Ownership and media | Owned servers and published resources may hold shared community content. Advertisement assets may be referenced by another owner. Stored objects can be owned by a UUID, named under the member UUID, named `staff/<UUID>/…`, or associated through `uploaded_assets`. Upload metadata deletion is not byte deletion. URL-based references and aliases need reconciliation. |
| New consent preferences | `private.member_recommendation_preferences.user_id` is an Auth FK with ON DELETE CASCADE. It stores versioned consent choice, not browsing history. The report includes it explicitly when installed and the FK traversal discovers its current action. |
| New staff duty records | `private.staff_duty_state`, `private.staff_work_sessions` and `private.staff_duty_requests` cascade from profiles. Corrected intervals and reasons also appear in retained `staff_audit_events` before/after records. Removing duty rows does not erase the correction evidence. The report recognises installed tables and counts exact account references in audit snapshots. |
| Deferred Discord work | Existing allowlist and any installed inactive sync member/audit records are identity-based, not all Auth FKs. This report only counts them. Activation, revocation and role-sync work remain Dan's scope. |
| Backups, logs and external copies | These are outside this database scan. The scan makes no claim about external encrypted captures, managed backups, restored data, logs, caches, processor copies, or a member's downloaded export. |

The query walks installed FK relationships rather than assuming every migration in the repository is applied. It explicitly seeds known references without FKs and reports only counts, relation names, constraint actions and trigger names. It never returns names, addresses, content, network evidence, provider credentials, object paths or file bytes.

## Minimal policy decisions needed before an executor can be finalised

1. For mixed reports, appeals, security/network evidence, staff duty corrections and general audit snapshots: what minimal fields must remain, for which purpose, accessible to whom, and for how long? Decide how to treat a record about multiple people and an unresolved case.
2. For existing financial/entitlement and privacy-request/completion evidence: which minimal references and fields must remain, with what duration and eventual disposal procedure? This must resolve the current immutable/FK boundary without silently discarding the audit trail.
3. For owned listings, published resources, adverts and shared files: transfer to an approved accepting owner or withdraw/remove the content, and how to handle no available recipient? Active staff/owner accounts also need an approved authority handover.
4. For retained backups and copies: what expiry/access rule applies, and how will a restore reapply previously verified erasures before serving traffic? Include managed provider backups and external encrypted captures.

These are missing product/retention decisions, separate from the technical work below. This document does not choose a legal basis, promise a deadline or invent a retention duration.

## Staged execution design and resumability boundary

Only the **fresh preflight** is implemented. Re-running it is safe because it has no write side effects; compare its request version, time, limits and digest. It does not save a resumable erasure job. `stages` makes each unimplemented stage explicit rather than recording unperformed work as completed.

After decisions are approved, implement a private, auditable run and per-stage/per-object ledger before enabling destructive work. Bind each run to the reviewed request version and subject, approved policy revision and exact inventory revision. Store opaque private evidence references and least-needed metadata, not copied secrets or unrestricted request prose. Use a stable operation ID, expected version, lease and attempt record; identical retries must not repeat an already verified action. Reject altered retry intent and recheck authority before replay. Schema and data may change, so an old report is insufficient authority.

The required order is:

1. Revalidate the open deletion request and approved scope; resolve shared ownership and protected staff authority. Implement a write freeze honoured by all affected writes, then revoke sessions and verify live-session denial. A profile flag or a temporary Auth ban is not proof that existing tokens stopped working.
2. Apply the specifically approved evidence minimisation and retention transition transactionally. Preserve useful case/fulfilment references outside the account FK chain under the approved policy. Do not disable immutable triggers globally. New exports and queued jobs must also honour the freeze.
3. Reconcile a private storage manifest, object ownership, aliases and shared uses before byte deletion. Use the Storage API, not SQL deletion from `storage.objects`. Record each attempt and verify disappearance; treat an uncertain timeout as pending readback. Only a verified missing object can satisfy that manifest item. Keep failures retryable without proceeding to Auth removal.
4. Remove approved application data in the reviewed dependency order. Re-scan both restrictive references and deliberately retained records; distinguish retained-under-policy from failed deletion. Remove Auth last using its supported admin API and verify user/session/identity absence. If Auth deletion fails after media cleanup, keep the job blocked at that stage and resume that stage without replaying completed media removal.
5. Verify residual public/private data and external follow-up, record exactly what remains and why, and use the existing separate staff fulfilment action only after completed work is independently checked. No stage automatically marks a deletion request fulfilled.

Technical work still required includes the durable run ledger and guarded executor; cross-route write freeze; the policy-aware request/evidence FK migration; complete shared-media/free-text/external inventories; Storage/Auth retries and readback; restore-time suppression; and focused executor security/failure tests. None is presented as live or complete by this preflight.

Supabase currently documents that issued JWTs can remain valid until expiry, so sensitive paths need live-session checks, and that Storage ownership can prevent Auth deletion: [User management](https://supabase.com/docs/guides/auth/managing-user-data). File removal must use the Storage API; deleting storage metadata via SQL can orphan bytes: [Delete objects](https://supabase.com/docs/guides/storage/management/delete-objects). These are implementation constraints, not BrowseRP retention-policy decisions.

## Verification and release implications

Dedicated HTTP tests cover same-origin/CSRF, account binding, MFA, request validation, caller-token forwarding, schema-response validation, rate-limited access, changed-request/permission propagation, and revocation while the scan runs. Disposable PostgreSQL tests use the existing account/export fixture and real current authorization functions, then exercise owner exclusion, deny overrides, live-session/allowlist checks, indirect immutable dependencies, orphan media, newly installed duty/FK dependencies, bounded counts, read-only transaction execution, withdrawal and role grants. These fixtures contain no real users or file bytes.

The parent owns final integrated tests, router/staff presentation, production publication, hosted schema verification and current encrypted database/media capture. Apply only the reviewed named migration and consent/duty dependencies deliberately; never apply unrelated inactive migrations as a batch. Recheck grants and security advisors on the deployed database. Existing source/backup archives are not evidence of the new schema or current data. Include this additive migration and its exact release in the next backup/continuation record, while preserving the unresolved backup-erasure policy and recovery limitations.
