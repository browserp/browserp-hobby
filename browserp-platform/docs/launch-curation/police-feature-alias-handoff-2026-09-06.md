# Police RP alias correction

Isolated worktree: `/tmp/browserp-police-feature-alias` (detached7778a56). Relevant public model and current dirty owner/search files were copied from the integrated root tree for context/testing; root was not edited.

Patch: `/tmp/browserp-police-feature-alias.patch` contains ONLY three files:
- `browserp-platform/public/discovery-model.js`: adds `police` to the existing FiveM Police RP aliases.
- `browserp-platform/supabase/migrations/20260906004649_canonical_police_feature_alias.sql`: Supabase CLI-generated additive migration. Adds only `fivem.feature.police = police rp` to the actual existing taxonomy, guards conflicting meanings, preserves immutable/invoker/parallel-safe behavior and private EXECUTE restrictions. No listing/tag updates; current directory/ranking/freshness functions remain byte-identical.
- `browserp-platform/test/police-feature-alias.test.mjs`: browser-model and PGlite database fixtures.

Verification: the new fixtures reproduced the pre-fix client and SQL failures. After correction,4/4 focused tests passed; combined Police feature + smart discovery + name-search regression passed20/20 (5.1s), JavaScript syntax and scoped diff whitespace checks passed. Tests verify legacy/current filters and query aliases, canonical popularity with no per-listing double count, correct raw metadata, access and count preservation, paging-independent counts, private/adult/disabled exclusion, narrow game scope, idempotent migration, unchanged ranking function, preserved helper privileges and anonymous public RPC behavior.

Related owner-form spellings `serious-roleplay`, `semi-serious`, `custom-cars` and `player-businesses` already match canonical discovery values. No extra aliases were added; generic `businesses` does not itself prove player ownership, and civilian jobs do not prove every civilian-life feature.

Integration: inspect/apply ONLY the patch from the repository root with ordinary `git apply`; do not copy the whole worktree because it includes snapshots of your unrelated integrated files. Run the three focused suites. Apply the named migration through your reviewed normal database migration workflow, then deploy the matching public model. A public readback should show Legit and Summit under `feature=police rp`, a single canonical Police RP facet, and unchanged counts/access. No live migration, deployment or publication was performed here.

Public postcheck report: `legit-summit-public-postcheck-2026-09-06.md`; observations: `legit-summit-postcheck-evidence-2026-09-06.json`.
