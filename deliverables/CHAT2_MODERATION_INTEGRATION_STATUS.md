# Chat 2 moderation integration status — 9 September 2026

## Source and ownership

- Task: `01a06929-c16b-7683-981a-27c018589881` (`2 · 5.6 Sol · xhigh · Build & integration`)
- Coordinator: `01a0692d-f550-7660-85e8-1bab80c5c774` (`Redesign BrowseRP platform themes`)
- Security review: `01a08093-4dbf-7fc1-a85e-2ad872895f60` (`Audit and secure BrowseRP access and…`)
- Worktree: `browserp-moderation-integrated`
- Branch: `integration/smart-content-moderation-20260909`
- Frozen Main base: `ce9027b6bfd697addfc529ddc3d30f8e3c8889b0`
- Backend source: `79da40b239df6ac4884b64765933f977d48d88f5`, integrated as `8bc161315c966b5dd7413e4469bbb515e4a6713b`
- UI source: `27d1b45a87821c0598550045de9dfcce52031b29`, integrated as `2fc3a28455956574626e37d72432757a3ca74891`
- Privacy source: `27806581c8b214a7431b30fe81e589c362c4c2d9`, integrated as `7a969556b23c84060463d851a82b1b38bd176fc3`
- Security correction: `60278d19857888663762813e1b4915a2bac63d1e`
- Stale test-fixture correction: `5a302e1ada0a2fe972a6da0f470e688528da9401`
- Frozen combined tree: `59c24380e5555226e28891406a9da47a15fae72d`

All three assigned commits applied sequentially without a manual conflict. The integrated `server.html` retains player history and the moderation UI script, and `api/servers.js` retains both history and content-moderation handling. Main's later public palette and history-session corrections are intentionally outside this candidate for Main to integrate after this handoff.

## Integrated behavior

- Member comments, replies, display-name replacements and prepared profile pictures enter private, versioned moderation.
- Prior approved profile identity remains public while a replacement is pending or blocked.
- Members can view private statuses and submit one free appeal from the account Content status view.
- Staff use one private Content queue with permission-specific, exact-version approve/block decisions.
- The external classifier remains disabled unless the owner later supplies both explicit provider settings. Missing or failed classification keeps content privately pending.
- Public approved pictures are served only through the guarded canonical route with repeated approval checks and no-store responses.

## Security correction

Security review found that the legacy queue-only comment resolver could approve replacement text that staff had not read. The corrective commit now:

- rejects legacy comment decisions at the application boundary;
- sends the old staff Overview comment button to the versioned Content queue;
- locks the legacy queue and comment rows at the database boundary, then rejects queue-only decisions for every comment enrolled in the private flow;
- retains the legacy resolver only for untouched legacy rows with no private submission; and
- proves read-original, edit, replay-old-approval rejection and current-version approval in disposable PostgreSQL.

Security Chat6 received the exact corrective commit and focused proof for its final delta review.

## Verification

- Focused database security and moderation regression: 12 passed, 0 failed.
- Focused legacy-action API regression: 1 passed, 0 failed.
- Focused staff version-routing UI regression: 5 passed, 0 failed.
- Final syntax/deployment-shape check: 275 JavaScript files checked; 11 API functions plus 1 Node middleware valid.
- Final application gate was run once at concurrency 2: 1,267 passed and 2 failed out of 1,269. Both failures were stale `comment-replies-api` fixtures that did not mock the new private moderation read after a successful comment write. No product assertion failed.
- The stale fixture was corrected without changing product behavior; its complete file then passed 4 of 4. The 170-second application gate was not repeated.
- Complete database gate was run once at concurrency 2 after the security correction: 57 passed, 0 failed.
- `git diff --check ce9027b..HEAD` passed.

## Promotion and rollback boundary

There is no safe mixed-version window for profile-picture writes. The migration intentionally revokes the old immediate-publication avatar RPC, while the old application uploads into a public bucket before calling it. A compatibility bridge would weaken the private-review guarantee.

Main should use one controlled maintenance promotion: stop member profile, picture and comment writes; apply and verify the migration; deploy this exact integrated application and canonical avatar routes; verify signed-in member and staff fixtures; then reopen writes. Keep the moderation provider unset throughout this promotion. Old comment code is compatible with the migration and already reports a pending moderation result, but old profile-picture writes must remain closed during the mixed-version interval.

Before migration, the previous application can be restored normally. After migration, do not restore it while member writes are open. If the application promotion fails, keep those writes closed and either finish the forward deployment or use a separately reviewed compatibility migration. Do not restore immediate avatar publication, drop private submissions or replay queue-only approvals.

## Boundaries

- No deployment, push, hosted migration, provider configuration, production database change, storage setting, staff-role change or Discord change was made.
- Main remains the only promotion, migration and release owner.
- Browser batches were not run in this worktree. Main and QA own browser verification on the final immutable release.
- Existing public Chat 2 status was preserved; this receipt is separate integration evidence.
