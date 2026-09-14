# BrowseRP complete visual refresh — implementation checkpoint

User GO: 14 September 2026 after final review of BRP-DESIGN-20260914-v1.2.
Specification: /Users/georgemacdonald/Documents/Codex/2026-09-14/BrowseRP-Visual-Design-Specification-v1.txt.

## Baseline verified before editing

- Local source: 6552414074a3d0b7d90518772e183b52a9658f77.
- Remote release/website-ready-20260909: 6448b2b414ca4580e5c5c0d339baefecf6025de1.
- Both trees: 6c612768eaa42f9d5ab92b4c998e039c6b38626f.
- Canonical www.browserp.com deployment lookup: dpl_7hiQu8TQw7Dydq6XJx2CF2Mm2fFz, READY, browserp-hobby-el7pjndwy-browserp.vercel.app.
- New isolated integration branch: design/complete-ui-20260914. Existing checkouts and gm9926 remain untouched.
- Usage observed: 2% consumed, 98% remaining. Avoid filler and repeated broad tests.

## Ownership

- Main / task1: integration copy browserp-visual-refresh-20260914; public HTML and asset wiring; browserp-v3.js, wordmark-canvas.js and wordmark-pattern.css; final visual review and functional/build/release decisions. No database/provider/role changes.
- Task2: browserp-refresh-staff-20260914 / design/staff-20260914. Staff HTML, staffpanel controller and shared staff presentation, overview/moderation/layout CSS/JS, staff-design.css. Both control panels and retained staff entry points, existing capabilities preserved.
- Task3: browserp-refresh-foundations-20260914 / design/foundations-20260914. design-system.css, theme.css, navigation.css, modern-select.css, first-visit-appearance.css and developer component reference. Shared dark/light tokens and component appearances; no public/staff data-controller mixing.
- Task4: browserp-refresh-public-20260914 / design/public-20260914. public-design.css and explicitly assigned public/member presentation CSS; directory/compare markup only if needed. Public section order, all destinations and functions remain.
- Task5: separate QA harness. Baseline capture, final browser/device/lag/functional matrix on stable integrated candidate. One heavy browser batch at a time; synthetic private fixtures, no production member mutations.
- Task6: separate preservation review. Role/capability/action-target/unsaved-work baseline; final security review after frozen candidate.

## Integration contract

Existing CSS variables and aliases remain supported. design-system.css loads after legacy styles. public-design.css follows it on public/member pages; staff-design.css follows it on staff pages. Workers commit only owned files, Main merges in dependency order. Worker claims and early slices are not live completion.

Light mode is a full theme everywhere, with no BrowseRP pattern or veil. Dark pattern travels RIGHT along the established diagonal rows, together with a subtle pulse; test travel separately from pulse and keep full-width edges without horizontal overflow. Main will reproduce the reported regression before claiming a cause.

No API, database, provider, payment, Discord bot or role-policy scope. AI remains deferred. Staff light appearance is deliberately added; old forced-dark assertions must not prevent that accepted change.

## Release gates

Prepare route/capability inventory and paired baseline early. Final tests run from one stable integrated commit, using controlled fixture details and an exact preview. Cover required repository checks, real shared-component reuse, both themes and staff panels, changed journeys, browser engines, representative widths and paired slowdown. Record physical-device and native-browser limitations honestly.

Main personally compares finished screens for substantial visual improvement and usefulness. Preserve all legitimate staff powers, unsaved forms, pending/error states and action targets. Fix observed material regressions. A build or preview alone is not a live-delivery claim.

## Current status

Implementation started. Tasks2/3/4 building independent presentation slices; Task5 preparing/capturing baseline; Task6 reviewing preservation contracts. No redesigned website deployment yet.
