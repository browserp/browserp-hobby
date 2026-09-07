# Member uploaded-file delivery — 7 September 2026

## Status and scope

Implemented and checked locally. The new migration is **unapplied**, the extension is **not deployed**, and no real member, file, approval or provider account was changed. This is the uploaded-file part of the continuing privacy work. It does not implement account erasure or individually reviewed supplements, and it does not turn a receipt into automatic request completion.

A member with a current approved copy can open **Your uploaded files** under `/profile#your-data`, download each file, and explicitly confirm they saved and opened it. The current structured JSON download remains available. Staff approval still requires the existing current Discord staff session, MFA and both privacy permissions; the default permission grant remains owner-only. Staff can see file/receipt counts but cannot download a member's private copy through this workflow.

## Delivery and authorization

- The file inventory is bound to the immutable JSON copy's uploaded-asset IDs, sizes and SHA-256 hashes. It also checks the current asset owner, bucket and path and confirms the object exists in Storage. The supported existing buckets are `profile-media`, `server-media`, `uploads-quarantine` and `advertisements`. Imported shared artwork and other people's assets are not treated as the member's uploads.
- Preparation detects identifiable pre-snapshot Storage objects that lack a matching inventory row, including interrupted historical uploads. Missing objects, changed metadata or orphan objects stop file preparation with a specific follow-up message. The failed preparation rolls back; a corrected inventory can be retried. This is not an assertion that unidentified historical objects or external-provider media have been discovered.
- Existing limits apply: at most 2,000 uploaded records in the JSON copy and 10 MiB per registered upload. The UI displays 50 file controls at a time. Downloads are individual files, not a bulk ZIP. Large or exceptional inventories need staff follow-up; nothing is silently truncated.
- The existing authenticated, no-store `/api/me/data-requests` route handles `list_export_files`, `read_export_file`, `check_export_file` and `receive_export_file`. Every call retains same-origin/CSRF protection and the displayed-account header check. No new Vercel function, secret or external service is introduced.
- The database reuses the recent original sign-in requirement (10 minutes), current unrestricted session, own-account approval, exact request version and one-hour copy expiry. It checks before each chunk and again after Storage I/O. Withdrawals, later reviews, session revocation, changed file ownership and expiry deny subsequent reads. Data already received while authorized cannot be recalled.
- The server fetches only a validated configured Storage path with its existing server credential. It rejects redirects, bounds response size and time, and never returns a signed URL, public download URL, credential or provider error body. Each 512 KiB chunk stays below the function response limit. If Storage ignores Range, the server accepts only a bounded full response with the exact whole-file hash, then slices it; this fallback costs extra Storage traffic on large files.
- The browser checks each chunk, assembles at most 10 MiB, verifies the entire file's SHA-256, and performs a final current-permission check before creating a download. It uses a controlled filename and temporary local object URL. Leaving the page or ending the session aborts the remaining fetch chain and clears private controls/URLs. No file is placed in browser storage or analytics.
- Receipt requires an explicit saved/opened confirmation and the exact file hash. Repeated receipt is idempotent. A receipt is the member's assertion; the browser cannot prove their operating system saved the file or that they read it. Staff still verifies the full request and any supplements before recording completion.

The new manifest table has RLS enabled and no raw `PUBLIC`, `anon`, `authenticated` or `service_role` grants. Only the narrowly granted member RPCs expose its own-account projection. Current private manifest metadata remains alongside the existing copy/receipt record after expiry; expiry denies access immediately. This patch does not introduce a new automatic retention or erasure policy for those records.

## Migration and release order

1. Confirm the target has the existing request/history/export schema: `20260905210347_member_data_requests.sql`, `20260906002145_private_request_history_and_completion.sql`, and `20260906004454_structured_member_data_export.sql`. Preserve later structured-export amendments, including advertising enquiries; this migration does not replace the collector.
2. Review and authorize **only** `20260907105813_member_uploaded_file_delivery.sql` for the intended environment. Do not blindly apply all pending migrations: the shared development branch also contains separately controlled Discord role-sync work. There is no privacy dependency on that integration.
3. Before applying, confirm the hosted `storage.objects` metadata contract contains `bucket_id`, `name`, `owner_id`, `metadata` and `created_at`, and that registered objects use `metadata.size`. This was modeled in isolated PostgreSQL tests, not read from the live database in this task. Resolve any actual schema/size discrepancy before activation.
4. Apply the reviewed migration before enabling the updated UI/API. Read back table RLS, denied raw grants and authenticated-only RPC grants. Use an isolated nonproduction account with owned test uploads for a real Storage round trip, then verify expiry/revocation and missing-object failure. Do not create privacy requests in an actual member account for demonstration.
5. Run the normal integrated release gate and exact preview check, preserving the 12-function deployment budget, then release through the existing owner-controlled publication process. This task did not run a broad release gate or publish anything.

The migration is additive. Rolling back the application does not require deleting manifests or receipts. Do not drop the new private data as a casual rollback step.

## Local verification

Node 24, one test worker, isolated PGlite and mocked Storage/Auth responses: **81 focused checks passed** (14 transport/database, 33 API/DOM, and 34 existing database/controller integration checks), with no skips.

```sh
node --test --test-concurrency=1 test/member-file-export.test.mjs test/member-file-export-db.test.mjs
node --test --test-concurrency=1 test/privacy-requests-ui.test.mjs test/privacy-requests.test.mjs
node --test --test-concurrency=1 test/privacy-requests-integration.test.mjs test/member-data-export-db.test.mjs test/privacy-requests-db.test.mjs
```

Coverage includes cross-account export/file IDs, revoked and stale sessions, approval/version withdrawal, expiry, changed ownership/path/hash, malformed or oversized Storage responses, 403/429/network errors, ignored Range, whole-file mismatch, orphan/missing objects, exact receipt confirmation and retry. The actual Profile/Moderation controller integration retains account-change/permission-loss teardown. The DOM regression verifies the receipt checkbox stays enabled after a successful download rather than being disabled again by the shared busy-state restoration.

A bounded native-browser fixture saved the actual two-chunk 524,305-byte file and matched its SHA-256 in Chromium and Firefox at 1440 px and WebKit at 390 px with reduced motion. Receipt worked, session-end cleared the private view, and no page error or horizontal overflow occurred. Screenshots were inspected. All contexts and browsers were closed. This proves the browser download mechanics with an isolated fixture; it is not hosted Storage, real OAuth, production, or physical-device proof. Local evidence: `/tmp/browserp-private-file-browser-check.mjs`, `/tmp/browserp-private-file-browser-check.json`, and `/tmp/browserp-private-file-{chromium-1440,firefox-1440,webkit-390}.png`.

## Actual erasure remains a separate unfinished action

The repository does not have an agreed policy that says which mixed records to delete, redact, detach or retain, for how long, and under whose authority. Calling Auth account deletion now would either fail on explicit foreign keys or require bypassing evidence safeguards. This patch adds no erasure button or pretend deletion action.

Concrete decisions still required:

- Preserve a minimal request/completion audit while defining what happens to the account link and private request prose. `private.account_data_requests.user_id` currently references `auth.users` without a deletion action. History, fulfilments and export approvals reference the request with `NO ACTION`; export copies reference approvals. History, fulfilments and approvals have immutable update/delete triggers. Closing a request does not remove these relationships.
- Specify retention/redaction for immutable staff audit and credit-ledger records, other financial/moderation history, and protected submission snapshots. `private.server_submission_revisions` denies raw access but currently cascades with its parent submission; it has no immutable update/delete trigger. That is a potential historical-evidence loss on parent deletion, a distinct policy choice from the immutable request/audit safeguards. An account can be the subject, the author, a moderator, or a counterparty; removing one account cannot silently discard another person's evidence or a financial record.
- Resolve profile foreign-key restrictions and shared ownership: `promotion_orders`, `promotion_credit_ledger`, `payment_attempts` and `server_entitlements` restrict deletion of their linked profile; `bans.actor_id`, `security_bans.actor_id` and `blog_posts.author_id` also use `ON DELETE RESTRICT`. The staff-audit actor uses `SET NULL`, but that update can encounter the immutable audit trigger. Published listings and shared content need explicit transfer, detachment or removal decisions. Deleting the profile is not equivalent to deleting all personal references or media.
- Define the treatment of Storage originals, public derivatives, quarantined uploads, pending claims/appeals and retained mixed-record supplements. Storage deletion and Auth deletion are separate external operations and need a retryable, auditable procedure with a final identity/session check and explicit staff confirmation.
- Establish the deletion-specific recovery/retention prerequisites before executing irreversible work. No full database-plus-media restore has been demonstrated by this task. The separately excluded broad recovery/provider-login rehearsals were not resumed.

Once those decisions are recorded, the existing versioned staff fulfilment and private audit patterns can support a narrowly scoped erasure procedure. Until then, deletion requests stay reviewable, and staff completion remains an attestation of separately verified work rather than an executable purge.

## Primary references consulted

- [Supabase Storage bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals): private download access and the distinction from public retrieval.
- [Supabase Storage size metadata](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size): `storage.objects` bucket, name and metadata size inventory.
- [Supabase data deletion guidance](https://supabase.com/docs/guides/database/postgres/data-deletion): dependency review and deliberate deletion/recovery planning.
