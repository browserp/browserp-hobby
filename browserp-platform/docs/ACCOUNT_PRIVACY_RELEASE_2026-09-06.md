# Account privacy release — 6 September 2026

Production commit `406d5688f6eb81d7e43790d5e027e95f07024ec4` is READY at https://www.browserp.com through deployment `dpl_9xfG27uYZVRuYHnfbr6bE7H4D7f7` (https://browserp-hobby-oh8avyyl9-browserp.vercel.app). Reviewed preview: https://browserp-hobby-7l4kslfxg-browserp.vercel.app, `dpl_HaUmSFabsUuoh7hvAPLQwUyC1mTp`. Main remains `7fe1f17c25ce4bad8a44f258442671be159122d6`.

This release delivers staff-approved, account-bound JSON data copies with expiry and explicit receipt, restricts raw client access to sixteen private record tables, and makes a joined RP name such as SummitRP find Summit RP without broad fuzzy matching. The published 40 FiveM /20 RedM /3 Minecraft roster evidence is preserved in the same commit.

- Full local verification:704 application tests plus35 database tests,739 total, no failures or skips. Vercel completed its required build gate on the same source.
- Actual local browser downloads:24 controlled scenarios and678 assertions across Chromium, Firefox and WebKit at390/1280px, including six fictional downloads with exact byte/hash/name checks. This does not constitute real-member OAuth or production-private-data delivery.
- Exact preview and production each passed20 hosted checks: changed asset hashes, private export guest denials, guest private-page rendering, strict CSP/no-store, visible artwork and layout in all three engines/two sizes. Disabled developer/resource products remain edge403 in production; the preview public projections returned200.
- Three reviewed migrations applied successfully in order: `20260906004454_structured_member_data_export`, `20260906012210_joined_rp_name_search`, `20260906012500_restrict_private_record_reads`. Metadata readback confirms the sixteen table/column client boundaries, seven existing guarded member/staff functions, eleven new/updated export-function grants, private export table grants/RLS, immutable approval trigger and expiry index.
- A fresh public SummitRP + FiveM + Police RP query returned exactly Summit RP, deduplicated facets and a then-current156/200 observation. Counts change; this is not a future health guarantee.
- The existing signed-in Profile/Your data screen loaded after publication, with its private empty queue and available request controls. No synthetic live privacy request, download approval, receipt or erasure was created. Full uploaded-file delivery, mixed-record review and actual account erasure remain separate work.

Code rollback does not undo database changes. Do not restore unsafe raw grants; prefer forward fixes. All later code must retain the same-account/session checks and private projection boundaries.

Evidence: `structured-account-export-preview-check-2026-09-06.json`, `structured-account-export-production-check-2026-09-06.json`, `structured-account-export-database-readback-2026-09-06.json`, and `STRUCTURED_ACCOUNT_EXPORT_BROWSER_REVIEW_2026-09-06.md`.
