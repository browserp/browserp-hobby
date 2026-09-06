# Page navigation stability — 6 September 2026

## User-visible defect and correction

Clicking listings or moving between pages briefly collapsed content into a narrow column, then expanded it when adverts arrived. Hidden advert elements were removed from grid auto-placement, so the only visible content occupied the first sidebar track. Server pages, Discover and homepage editorial shared this error.

- Explicit desktop columns/rows keep content in its correct track with zero, one or both adverts loaded.
- Tablet/phone server pages reset to one column. Phone directory/editorial sections keep full width and adverts after content, preventing an advert arriving above the reader.
- The initial public header reserves the enhanced header height (88px desktop, 68px phone, excluding border), removing the deferred-script height jump.
- Full-page opacity/translation entrance animation removed. Existing menu, logo, tag, button and advert interaction effects remain.
- Four changed stylesheets are requested with 2.19.3 cache versions. No new JavaScript runtime, functions, database or account/security changes.

## Verification

The user journey is directory link → listing HTML → asynchronous public adverts/session response → stable rendered listing → breadcrumb back to directory. This is a presentation defect, not an API/data contract change.

- Three automated regression tests cover real CSS cascade, hidden/loaded advert track placement, mobile resets and no page-wide animation.
- The optional local `test/navigation-visual.mjs` exercises actual Chrome against `test/visual-fixture.mjs`, never production accounts/data. It holds navigation and session responses until initial geometry is measured, then releases them and compares content width/position and header height. It checks 2503, 1366, 768 and 390px across server, directory and home pages, with ordinary and reduced motion, plus real listing/breadcrumb clicks. Screenshots are local ignored review artifacts.
- Local final gate: 824 application tests plus 35 database tests passed (859 total); 197 JavaScript syntax checks; 11 API functions plus one Node middleware (12 total); clean `git diff --check`.
- All 24 held-response Chrome cases passed, including ordinary and reduced motion. Actual directory → listing → breadcrumb navigation passed, with no uncaught browser errors. Desktop/mobile screenshots were inspected.
- No paid plan or production load test is part of this fix.

## Deploy result

- URL: https://www.browserp.com
- Target: production
- Status: READY, 6 September 2026 at 14:48 UTC
- Commit: `79f13e4253d02b6fdb1240907b38d56cd18bd93d`
- Framework: multipage HTML/CSS/JavaScript with Node functions
- Build duration: 2m40s
- Deployment: `dpl_4Eo234dyNcmRSB9XTfNojJYxw5Hj`, https://browserp-hobby-b2dogturk-browserp.vercel.app
- Functions: 12 (11 API plus one Node middleware)
- Validated preview: `dpl_4AyREGQcFG8e12psLQxnxb9AJGnW`, https://browserp-hobby-nww85y7t4-browserp.vercel.app

### Post-deploy observability

- Live health at 14:49 UTC matched the source; backend, authentication and security ready, payments disabled.
- Live CaliRP opens with content in column 2, main opacity 1, animation none and server-detail.css 2.19.3. At 1280px its document is 1265px wide (no overflow). Clicking its Discover servers breadcrumb reaches `/servers`, also column 2 and no page-wide animation.
- Error scan: no errors returned for this production deployment in the preceding five-minute window.
- Drains: not reviewed or changed. This is a release smoke check, not continuous monitoring, a load test or certification of all device/browser combinations.

Final deployment evidence is a local documentation-only follow-up; do not create another deployment solely to publish it.
