# Structured account-data downloads

This completes a useful first account-data download within the existing private request workflow. It does not complete uploaded-file delivery, individual review of mixed records, or account erasure.

A staff member with both data-request review and completion permissions, a current allowed Discord session and verified authenticator can approve a ready copy request. The scope and remaining follow-up are visible to the member and preserved in request history. Approval applies to that exact request version. A later review, withdrawal or completion immediately invalidates its downloads.

The member prepares a private JSON copy and downloads it from their signed-in Profile screen. Preparation, reads and receipt confirmation require a live, unrestricted session and original OAuth authentication within ten minutes; a refreshed token does not reset that clock. Every HTTP action also matches the account that opened the screen. No staff download, public storage bucket, bearer download link, email or external transfer is introduced.

The file is a fixed snapshot, expires after one hour and is checked against its exact SHA-256 and byte length before download. The browser rechecks its account-bound authorization after verifying the bytes. Interrupted preparation retains its retry key; repeated preparation returns the existing valid snapshot. Expired copies need a new preparation. A session-ending event or navigation clears private controls, pending display updates and temporary download URLs. Returning through the browser's page cache reloads and revalidates the private screen.

The download starts a normal browser file save. The interface does not claim it can prove the user saved the file. A separate explicit confirmation records that the member saved and opened it. That receipt remains visible in request history even after approval changes or withdrawal. **Receipt never automatically closes the request.** Staff must verify the whole request using the existing separate completion action.

## Included data

The migration's `private.member_export_records` function is the exact, named-field allowlist. It has no generic row conversion, arbitrary table parameter or raw JSON metadata projection. Ownership derives from the authenticated account; callers cannot select another member.

| Collections | Scope |
| --- | --- |
| Account, connections, profile | Own account identifiers/contact and dates; named provider profile fields; own profile text, visibility and review state. No passwords, tokens, sessions, recovery codes, MFA secrets or unrestricted provider metadata. |
| Favorites, votes, comments, reviews, reactions | Own recorded choices and authored content, status and dates. No other authors' private content. |
| Notifications, activity, resource downloads, tool usage | Own records. Activity includes the existing masked network/browser summary; raw IP/device evidence and free-form security metadata are excluded. |
| Orders, payment attempts, credit entries, boosts, entitlements | Own purchase/credit/benefit amounts, currency, state and dates. No payment credentials, Stripe identifiers/webhooks or staff adjustment notes. Payments remain intentionally disabled elsewhere. |
| Developer profile/services, resources, campaigns | Own authored or owned records, named commercial/creative fields and public destinations. No staff review notes or arbitrary internal metadata. |
| Owned listings, tags/categories, submissions, submission history | Own listing/application data and member-visible decisions, including explicitly projected historical versions. No raw review queue snapshots or staff reasons. |
| Roblox evidence and claims | Own submitted authority explanation/evidence and member-visible claim state/reply. No other claimants, Discord tokens, unrelated guild inventories or staff-only verification evidence. |
| Badges, uploads | Own badge details and uploaded-file identifiers/type/size/hash/review status. No storage object paths, scan evidence or file bytes. |
| Reports sent, applications, appeals | Own submitted report/appeal details and statuses. Application answers and mixed staff decision notes require separate review. No reports filed by others or security investigation evidence. |
| Data requests, request history, completed follow-up | Own request/messages and visible results. No staff-only evidence or actor identity. |

If uploaded assets exist, the file explicitly marks file-byte delivery as pending. Existing application answers, authored blog records, current/former staff records, bans, appeal decision notes or staff credit adjustments trigger a separate reviewed-supplement notice. Staff can also record an additional pending scope note. These notices never become assertions that the withheld information has already been supplied.

## Bounds and retention

Each collection is limited to 2,000 rows, all collections together to 10,000 rows and the final UTF-8 file to 2 MiB. Oversized accounts receive a clear error and retain the open request; rows are not silently truncated. Snapshot generation is limited in the database to two per hour and three per day; direct read RPCs and HTTP actions are also rate limited.

Private snapshot and approval tables have RLS and no raw grants to anonymous, authenticated or service roles. Named security-definer functions use an empty search path. No new hosted API function is added: the existing member/admin data-request paths carry JSON responses and existing no-store/error behavior.

The existing authenticated, leased health scheduler clears up to 100 expired snapshot payloads per run under its own two-second budget. Expiry is enforced on every read even if cleanup is delayed. Cleanup preserves minimal copy metadata, scope and receipt history. This adds retained personal-data records: a verified retention/redaction procedure and actual erasure remain separate work, not a compliance claim.

## Release and verification

Apply `20260906004454_structured_member_data_export.sql` after the integrated private request history/completion migration, then deploy the API, private-request UI and scheduler changes together. Refresh the private UI asset reference in Profile, Dashboard and staff pages using the normal release versioning. The migration requests a PostgREST schema reload. No legacy request is auto-approved or closed.

Focused verification: 65 tests passed across actual isolated PGlite table definitions/collector, two-account scope, revoked/expired/stale-original-auth sessions, version changes, key retries, large accounts, missing file parts, receipt, raw permission denial, API payload verification and browser DOM fixtures. Scheduler tests confirm cleanup follows the authenticated completed run and respects the remaining time budget. Syntax check passed for 177 JavaScript files and 12 hosted functions. No production records, real private downloads, native-browser/physical-device sessions or account erasures were used in this batch.

Operational checks after integration: approve a controlled test request, prepare/download its file, confirm its exact account/content/scope, withdraw/review it and verify the old download is denied, then confirm payload cleanup after expiry. Use test-account data only. These are deployment acceptance steps, not claims already established by local fixtures.

Provider reference boundaries: [Supabase sessions](https://supabase.com/docs/guides/auth/sessions), [private storage downloads](https://supabase.com/docs/guides/storage/serving/downloads#private-buckets), [database function privileges](https://supabase.com/docs/guides/database/functions), [Vercel function limits](https://vercel.com/docs/functions/limitations).
