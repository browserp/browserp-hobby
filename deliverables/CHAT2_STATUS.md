# Chat 2 — one staff area, task-led design, 14 September 2026

## Current handoff

Local implementation is committed and ready for Main's integrated visual acceptance. No authenticated browser inspection, cross-browser acceptance, remote publication or deployment was performed in this slice. Main owns integration and release; Task 5 owns the combined browser and interaction checks.

- Coordinator: `01a0692d-f550-7660-85e8-1bab80c5c774`.
- Worktree: `/Users/georgemacdonald/.codex/.chatgpt-projects/g-p-6a84fe2ac40c81919083d96dbb368185/browserp-refresh-staff-20260914`.
- Fresh branch: `design/staff-quality-parity-20260914`.
- Exact Main base: `4793c8c8c781c7bcaaac679c6365b44a72ccd14b`.
- Implementation head: `c4730256a6c49415f59d97a8833b6e2dc280e661`.
- A following documentation commit contains this receipt only.
- The previous staff branch and newer Main/PC work were preserved. The existing untracked dependency link was reused and not committed.

This receipt supersedes the older design wording and historical baseline. There is ONE staff panel. Overview, Moderation and Scrapers are sections within it. The accepted brief requires the same design quality as the public website or better, with a deliberate information hierarchy and every existing legitimate tool and permission retained.

## Working brief and implemented hierarchy

1. **Review first.** Overview starts with current permission-scoped priorities, recent review work and recent staff audit activity. Recent-record samples remain labelled as recent work; they are not represented as whole queues or oldest-first backlogs. One composed working surface replaces repeated card frames.
2. **Duty before reporting.** Existing clocking, availability, confirmed session records, review warnings, manager corrections and team information appear before registration reporting. Availability and recorded work time retain their separate meanings and controls.
3. **Website management within the same area.** Live listing checks, adverts and enquiries, article publishing and announcements remain available with existing forms and previews. Sidebar groups provide personal work links and website tools, including existing listing checks and registrations. Forms remain in place; nothing was moved into a new modal or hidden behind a new workflow.
4. **Moderation by task.** Existing destinations are grouped into Review work, Community, Team, and Safety & records. The summary label is now Review overview. Queue-wide search and filters stay above the records; each record retains its context, details, actions and audit-related information. Groups with no allowed destinations remain absent through the unchanged permission filter.
5. **Supporting reporting.** The existing current-account signup history, UTC range controls, interactive chart, exact-count table and four website totals follow the operational tools. No new graph, trend, workload calculation, badge or management feature was introduced.
6. **Consistent presentation.** Neutral shared charcoal/white surfaces, readable labels and table cells, controlled spacing, quieter lists, contextual action groups, form surfaces and decision dialogs apply throughout the existing staff area. Mobile rules wrap actions and retain every table column through local scrolling. Shared semantic colours still distinguish real errors, warnings and approved states.

This hierarchy applies the intake-before-decision pattern described in [Linear's Triage documentation](https://linear.app/docs/triage). Search and filtering remain at collection level while decision controls remain with their records, following [Carbon's data-table guidance](https://carbondesignsystem.com/components/data-table/usage/). Stable navigation within a complex work area is consistent with [Atlassian's account of its navigation redesign](https://www.atlassian.com/blog/how-we-build/designing-atlassians-new-navigation). These are design principles applied to existing BrowseRP capabilities, not imported product features or automation.

## Changed files and exact boundaries

- `browserp-platform/public/staff-design.css`: staff-only layout and presentation. Shared `design-system.css`, `theme.css`, the actual Menu component and all public styles remain unchanged.
- `browserp-platform/public/staffpanel-overview.html`: existing section order, introductory labels, a registrations anchor and changed-asset references.
- `browserp-platform/public/staffpanel-moderation.html` and `staffpanel-scrapers.html`: consistent staff-area framing and changed-asset references.
- Other private entry HTML (`staffpanel.html`, `staffpanel-accounts.html`, `staffpanel-content.html`, `staffpanel-profiles.html`, `staffpanel-security.html`, `staffpanel-staff.html`): changed staff asset references only.
- `browserp-platform/public/staff-workspace.js`: ONLY the navigation `groups` constant in `mount()` changes labels/order and adds links to the existing listing-checks and registration sections. Theme read/apply/storage logic, events, authentication and session code are byte-identical to the base.
- `browserp-platform/public/staff-moderation.js`: ONLY `META.summary[0]` and the `renderTabs()` group definition change. All view IDs, hash serialization, allowed-view checks, effective permission logic, filters, requests, lifecycle, drafts, renderers, decision handlers, dialogs and conflict handling are byte-identical to the base.
- `deliverables/CHAT2_STATUS.md`: this current receipt.

## Preserved routes and capabilities

| Existing area | Preserved destinations and operations |
| --- | --- |
| Staff entry | `/staffpanel` retains its sign-in and access gate and authorised redirect to `/staffpanel/overview`. |
| Overview | `/staffpanel/overview`; review queues and activity; `#overview-duty`, `#overview-refresh-health`, `#overview-adverts`, `#overview-publishing`, runtime `#overview-announcements`, `#overview-authenticators`; current registration chart and exact table at the added `#overview-users` anchor. |
| Review work | `/staffpanel/moderation#reports`, `#queue`, `#content`, `#profiles`, `#claims`, `#appeals`. Active/history/deleted reports, audited restore, listing decisions, private content evidence, claims and appeals retain their actual actions and versions. |
| Community | `#members`, `#servers`; existing filters, full record context and authorised editors. |
| Team | `#staff`; role catalogue/responsibilities, requests and escalations; granular staff management and permission overrides when allowed. Reader, manager and owner distinctions remain. |
| Safety & records | `#bans`, `#security`, `#activity`, `#data-requests`, `#logs`; existing restrictions, risks/MFA/evidence controls, private requests and audit operations. Privacy read and erasure authority remain independent. |
| Scrapers | `/staffpanel/scrapers#fivem`, `#redm`, `#minecraft`, `#roblox`; source references, imports, preview/review, pending edits, game switching, confirmations and actual Roblox application routing. |
| Compatibility routes | Existing profiles→moderation#profiles, accounts→moderation#activity, staff→moderation#staff, security→moderation#bans, content→overview#overview-adverts redirects remain; overview#overview-roles→moderation#staff remains. They are compatibility paths within one staff area. |

The current Overview response split is retained: ranged website reporting and the separate dashboard request are independent. Effective review capabilities still come from the moderation summary and the existing narrowly scoped optional-capability helper. Raw role defaults are not substituted for effective permissions. Expiry, revocation, changed identity, stale response guards and denial clearing remain intact. Native hidden/inert controls and access-pending UI remain authoritative.

## Verification

**38 affected existing checks passed, zero failures**, run once with one test process at a time:

- `staff-design-ui.test.mjs`: appearance persistence and form retention, shared Menu/focus containment, CSS selector parsing and native hidden controls.
- `staff-layout-ui.test.mjs`: mobile focus, Escape, resizing, skip navigation and private-only stylesheet loading.
- `staff-overview-dashboard-ui.test.mjs`: real split response shapes, effective overrides, independent freshness/errors, confirmed zero counts, expired/denied access and stale-response protection.
- `staff-moderation-ui.test.mjs`: effective permission distinctions, private content actions, filters, versioned edits, unknown values, deleted-report restore and conflict draft retention.
- `staff-publishing-navigation.test.mjs`: blog, announcement and advert drafts across save failures, success and discard.
- `staff-scraper-navigation.test.mjs`: game paths, Roblox application routing, unsaved drafts, Back/hash navigation and active imports.

A separate source comparison against the exact base passed across all **9 private entry pages**: **82 existing ID contracts**, **30 native/control contracts**, every existing HTML link destination, and stylesheet/script asset paths and order were preserved. New registration and listing-check navigation destinations resolve to existing mounted sections; the existing announcement anchor remains supplied by publishing. **19 referenced supporting scripts are byte-identical**. Reversing only the declared navigation constants and summary label makes both edited scripts exactly match the base.

Both edited scripts pass syntax checking. `git diff --check` passes. No tests, dependencies, API/database code, migrations or permission contracts were changed. The tiny added registration anchor was checked in the final source comparison after the focused suite; no repeat full-suite run was needed.

## Integration dependencies

Main should integrate the implementation commit over the declared base, reconcile changed-asset versions with the combined site, and conduct visual acceptance against the final shared design. Task 5's final combined pass should cover desktop/mobile, light/dark, current navigation, queue context/actions, dialogs, drafts and scoped denial/session paths. This slice claims source and focused-flow verification only; visual quality and live completion remain unverified until those combined checks. No independent merge, deployment, migration or role-sync activation occurred.
