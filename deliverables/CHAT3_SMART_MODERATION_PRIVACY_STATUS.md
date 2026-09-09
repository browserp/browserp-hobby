# Chat 3 — smart moderation privacy patch, 9 September 2026

Own worktree: `browserp-smart-moderation-privacy`; branch `work/chat3-smart-moderation-privacy-20260909`; base `075c6fe887f9708e1f7c221ddd4a6539f7bd2ba6`.

Completed:
- Added one `content-review` section and update date to `public/privacy.html`. Describes private pending/blocked submissions, prior approved identity, reason/free review, manual applications, incomplete image coverage, separate optional recommendations, legacy public-image limits and erasure limits.
- Explicitly says external AI classification is not enabled and this feature does not currently send submissions to OpenAI. This copy is for the integrated private-review release with that configuration; it must not be published prematurely or left unchanged after activation.
- Added `docs/SMART_MODERATION_PRIVACY.md`: observed data paths, official endpoint data-handling sources, current inactive adapter versus later activation, operator safeguards and unresolved retention/export/media/backup decisions.
- Added three narrow disclosure assertions. All 3 passed using bundled Node24.19.0. A separate exact baseline comparison confirmed all surrounding privacy markup/scripts/links/prior text are unchanged. Whitespace check passed. No broad suite or browser batch.

Only documentation/public privacy text/assertions changed. `legal.html` remains unchanged; its existing focused-policy link already reaches `/privacy`. No API/library/migration/other UI edit, provider installation/configuration, real-content transmission, hosted-data read, billing change or deployment.

Reported early to Main and Security:
- The initially inspected legacy avatar handler uploaded public `profile-media` before the new draft migration’s private-quarantine contract. Security subsequently reported private registration/new router binding present in its newer snapshot; do not treat the old-handler observation as a current unfixed defect. Final handler/migration/private-preview/current-approved delivery still needs integrated verification. Security also flagged a fresh public-avatar cache window as incompatible with per-request revocation; Main owns resolution. Do not promise existing public URLs/copies became private.
- New private candidates include text, source/asset references, fingerprints, checker results, appeals and reviewer/times. Add export/erasure coverage and byte cleanup; an Auth FK cascade is not complete erasure.
- Operator decisions still needed: candidate/check/appeal/fingerprint purposes, access and durations; superseded/orphan-byte cleanup; evidence/backups; any later provider/project/data-controls/input-scope/disclosure activation. No retention duration is invented.
- Official OpenAI endpoint table and image-category coverage were checked. The selected moderation endpoint's listed handling is not an accountwide zero-retention guarantee or permission to activate it.

Main owns final backend/UI/schema integration, configuration evidence and publication. Chat2 owns UI; Security owns authority/exposure review. Backend drafts were read-only and unfrozen; these assertions are not hosted-flow/security proof. Role sync stays deferred to Dan.
