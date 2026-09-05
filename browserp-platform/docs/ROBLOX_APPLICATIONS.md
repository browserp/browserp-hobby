# Reviewed Roblox community applications

This feature has passed independent root review and is integrated into the launch branch, awaiting hosted verification and deployment. It does not add a live Roblox listing or verify a community automatically.

Owners apply to list a specific community on BrowseRP. Players follow the approved joining instructions. “Whitelisted” still means players apply and receive approval; a BrowseRP listing application does not make a community whitelisted. Independent communities can use the same Roblox experience without claiming to own it.

The form collects the experience name and public page, community destination, optional Roblox group/community page, joining instructions, applicant role and a private explanation of control. Private server share codes, credentials and account secrets are not accepted as public page links. Staff must check independent evidence of control of the specific community and record a private confirmation note before approval. A Discord invite, Roblox group membership or a profile link alone does not prove control. This is manual community review, not Roblox identity verification or official endorsement.

Creation, metadata, private evidence and the existing moderation queue entry save in one transaction. The database rechecks the bound member/session, current restrictions, complete input, accepted terms, limits and the full retry fingerprint. A changed retry is a conflict. Corrections retain the original record and review history; both submission and queue versions guard staff decisions. Only the applicant and staff with current review permission can read private evidence. General audit snapshots and public listings contain the reviewed public details only.

Application-only Roblox listings deliberately show “Live player count not provided”. They do not use an experience-wide total, fabricate online status or poll a missing scraper. The existing queue, silver game theme and public/staff controls are reused.

## Safe release order

1. Independently review and apply **only** `20260905224408_reviewed_roblox_applications.sql`. It adds the new workflow and preserves the current service-only writers so the existing release continues accepting submissions.
2. Deploy the exact reviewed application code to a preview. Validate the ordinary-member form, requested correction, staff control confirmation and public listing projection in an isolated dataset; do not create synthetic production applications for a check.
3. Promote the verified code through the existing release process. Confirm live code now calls `create_server_application_server` and that active older previews will not be used for submission writes.
4. Only then apply `20260905225514_retire_partial_submission_writers.sql`. This removes execution of the earlier v1/v2 create and metadata attachment RPCs from `service_role`. Do not bulk-apply both migrations before deployment.

Rollback before step 4 can restore the earlier application build; the additive schema is compatible. After step 4, prefer a forward code fix. An intentional rollback to the earlier web writer requires restoring its narrowly scoped service-role grants first; never grant the old writers to public, anon or authenticated.

## Validation boundary and remaining scope

Tests cover atomic rollback, retry conflicts including private evidence changes, ended/foreign sessions and switched accounts, current staff permissions, private evidence reads, stale approval, requested correction and reviewed publication, exact URL types, no false counts, and other games' metadata. Browser tests use isolated fixtures; they are not a claim of real applicant ownership, real-device testing or production Auth/Discord integration.

Staff must still research community quality, English-speaking operation, moderation, rules and credible activity before approving. Full post-publication owner editing remains separately tracked launch work; this feature adds requested corrections, not a new published-owner editor. Staff can maintain the existing listing without silently dropping the reviewed Roblox public fields. Broader Roblox automated activity integrations remain future work requiring an exact community-authorized source.

## Local evidence for review

The integrated successor (including the directory name relevance fix) passed593 application tests and35 database checks,628 total, with no failures or skipped checks. Local test concurrency was bounded to two workers after an overloaded run aged a source observation during database startup. That fixture now receives its observation timestamp after initialization; source freshness limits are unchanged. The repository test commands now use the proven two-worker limit. Syntax/deployment checks passed166 JavaScript files and the existing12-function deployment limit. Hosted verification remains a separate release gate.

- Syntax/deployment configuration gate: 165 JavaScript files checked, 12 function slots total, passed.
- Existing database gates: 35/35 passed. New PostgreSQL application lifecycle and post-promotion retirement: 9/9 passed.
- Final focused API, private staff review, public detail and database suite: 46/46 passed; the offered `unknown` joining option was then added to API/database regressions separately.
- Public/member UI suite: 48/48 passed, including 15 new Roblox cases. Full pre-final unit sweep: 587/589 initially passed; its two old UI expectations were corrected and the affected suites then passed. Do not describe that earlier full sweep as an unchanged clean final-tree run.
- Chromium, Firefox and WebKit each completed a native form submission at 390×844 and 1280×900 with reduced motion enabled: no overflow or page errors, bound member identity, no Cfx metadata, private evidence cleared. These used local routed fixture responses and are not production sign-in or physical-device evidence.
