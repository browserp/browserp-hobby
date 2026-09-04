# BrowseRP cross-engine verification — 4 September 2026

Completed 2026-09-04T11:15:39.785Z. Report generated 2026-09-04T11:19:54.870Z.

## Scope and environment

- Playwright 1.62.1: Chromium 151.0.7922.34, Firefox 153.0, WebKit 26.5; macOS headless browser engines.
- Fresh isolated browser contexts at 390×900 and 1440×900, with reduced-motion enabled. These are browser-engine and viewport checks, not a claim about every physical device or browser version.
- 54 primary route views: 36 public, 18 synthetic staff. Six additional home reloads tested blocked advert artwork; six supplemental **local-only** Scrapers views corrected a fixture assertion.
- Public routes: Home, Discover, FiveM, Cali detail, Blog, List server, using real production HTML/assets/API data except the current local browserp-v3.js and browserp-v3.css were supplied through request interception. This is a predeployment compatibility check, not a wholly unmodified production end-to-end run.
- Staff routes: Overview, Moderation, FiveM Scrapers from http://127.0.0.1:8106. Actual current staff assets; explicitly synthetic API fixtures. Health healthy/degraded/error responses were controlled through a local fixture cookie. No production staff session or current user cookies were used.
- Browser interception aborted all methods other than GET/HEAD/OPTIONS. No publishing, editing, importing, sign-in, or production mutation was performed. Created contexts and browsers were closed.

## Findings

- **54/54 page-shell checks passed**: main document HTTP200, expected heading visible, no uncaught page JavaScript errors, no horizontal page overflow at either width. The raw result field `ok` means these bounded rendering checks only; it must not be read as an end-to-end data pass.
- **30/36 public route views had no captured HTTP errors. Six had HTTP429s** affecting API data. There were 20 captured429 responses in total. Public browsing was not repeated after the completed bounded matrix, and no retry flood was performed. Retry-After headers were not captured in this original runner, so the precise backoff window is unrecorded.
- All six engine/width combinations loaded three distinct advert images (18 healthy artwork checks). All 18 deliberately blocked-image checks retained visible copy, the destination link, and “Artwork unavailable.” The final broken-image entries in home raw snapshots are the intentionally aborted images, not unexpected production failures.
- All six Overview combinations passed healthy status, keyboard-opened native history details, degraded source state, retained dated data following a synthetic503, retry recovery, and preservation of the expanded history section across updates.
- All six Moderation combinations displayed the synthetic server section after navigation.
- Scrapers rendered the synthetic candidate and health panel in every combination. The first runner's false `scraperReady` value came from looking for “Synthetic community” instead of the actual “Synthetic FiveM community”; no product change was needed. A six-view local-only supplement confirmed the exact candidate, healthy panel, keyboard-opened review form, and distinct language=French/framework=QBCore values, with zero JavaScript errors or overflow.
- Representative full-page screenshots were visually inspected for mobile Scrapers, mobile health error, desktop health history, desktop blocked advert, and mobile healthy advert. Text, controls, responsive card layouts and explicit error/fallback states remain readable.

## Public data gaps caused by rate limiting

| Engine | Width | Route | Affected API paths |
|---|---:|---|---|
| webkit | 390 | home | /api/public/adverts, /api/public/announcements |
| firefox | 390 | blog | /api/auth/session, /api/public/blogs, /api/public/announcements |
| webkit | 390 | discover | /api/auth/session, /api/servers, /api/public/adverts, /api/public/announcements |
| firefox | 390 | listserver | /api/auth/session, /api/platforms, /api/auth/providers, /api/public/announcements |
| webkit | 390 | fivem | /api/auth/session, /api/servers, /api/public/announcements |
| chromium | 390 | blog | /api/auth/session, /api/public/blogs, /api/public/announcements |

These six views are **not** claimed as successful end-to-end public data flows. Later desktop visits completed without captured HTTP errors during the same bounded run, but no separate postrelease, unmodified production retry was performed by this agent. Root is handling limited sequential postrelease verification.

## Limits

- Staff fixtures verify rendering, interactions and graceful error states; they do not independently prove live staff authorization, database values, scheduled job execution or writes. Separate database/security tests and root's live authenticated check cover those boundaries.
- Public form submission, OAuth login and staff mutations were intentionally not exercised here. Public directory search/filter behavior was not exhaustively retested in this browser matrix.
- No assertion of all images across all listing pages, all screen-reader combinations, physical touch devices, normal-motion autoplay, or long-duration browser stability is made.
- The6 expected local503 responses test the health error state. They are not production incidents.

## Artifacts

- results.json: original54-view observations, preserved unchanged.
- engines.json: all three engines completed successfully.
- scraper-results.json: corrected local-only6-view supplement.
- summary.json: explicit layout/data distinction and aggregate checks.
- run.mjs and scraper-local-check.mjs: bounded reproduction scripts.
- PNG files: per-route and healthy/blocked/degraded/error screenshots.

No repository files were changed during this browser verification task.
