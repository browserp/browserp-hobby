# BrowseRP redesign — integration checkpoint

## Current authority and scope

14 September 2026: user explicitly permits reorganising, redesigning and finalising the website while preserving every existing capability, particularly staff access. The latest clarification requires a complete design plan and implementation for ONE staff area as well as the website. Overview, Moderation and Scrapers are sections of that area, not separate products.

The operative internal brief is [DESIGN_AND_PRESERVATION_PLAN_20260914.md](DESIGN_AND_PRESERVATION_PLAN_20260914.md). It supersedes the earlier prohibition on reordering sections and the narrower staff-colour-parity interpretation. No further plan approval is pending. Public communities and staff work must lead the interface. Dark/light surfaces are neutral; magenta, cyan and purple support BrowseRP's own identity.

## Source and recovery baseline

- Working repository: browserp-visual-refresh-20260914; branch design/complete-ui-20260914.
- Original local source 6552414074a3d0b7d90518772e183b52a9658f77 and remote release/website-ready-20260909 at6448b2b414ca4580e5c5c0d339baefecf6025de1 share tree6c612768eaa42f9d5ab92b4c998e039c6b38626f.
- Last verified canonical production deployment before redesign: dpl_7hiQu8TQw7Dydq6XJx2CF2Mm2fFz, browserp-hobby-el7pjndwy-browserp.vercel.app. Revalidate before making a current live claim.
- gm9926 source archive remains /Users/georgemacdonald/BrowseRP Backups/gm9926.zip, SHA256 3eb74551140b24eaaea6723d2b8e9387b53d52cb4487fd78e26de6bf511cdcda. This is the historical source master, not a fresh database/media recovery proof.
- Synced sources/ and other checkouts remain untouched. AI moderation, Gemini, bot hosting and billing remain deferred.

## Current implementation

The rejected blue visual checkpoint was3e329470a554910e54ce10d7ac89a273b9d5b116. It must not be promoted. Its source-identical GitHub checkpoint df325587ebf58763a31f82cbd0ccfe5ddcfcc8d3 on design/complete-ui-20260914 is historical, not this final design.

Reorganisation starts from4793c8c8c781c7bcaaac679c6365b44a72ccd14b. Main has integrated:

- 3dc943b (Task4 b4f8632): compact directory, search/game/filter/result toolbar, visible sort, authentic logo-led rows, same advertisement after six organic results with preserved lifecycle, quiet controls and recommendations below the directory.
- 5b05740 (Task3 f8f6e3b): purpose-specific home/games/detail/editorial/member composition, real banner above detail identity, open sections, account summary strip and connections as rows.
- 6c19518 (Task2 c473025): review-first staff Overview, duty then website tools/reporting, quieter queues/records/dialogs, responsive actions and grouped staff navigation. JS changes are restricted to navigation constants and a display label.
- 11c41c8 (Task2 receipt25583d8): source-grounded staff architecture and preservation evidence in CHAT2_STATUS.md.
- Main is synchronising changed asset versions, the shared component reference and the full design/preservation brief before the combined freeze.

No current production promotion has occurred. Main's visible local preview is http://127.0.0.1:4172/servers. Its anonymous public data passthrough does not provide private account/staff authentication; use controlled local fixtures for private testing. HTML templates are cached by the preview process, so restart after HTML integration.

## Ownership and next gate

Tasks2/3/4 completed and stopped their bounded slices. Main owns combined visual acceptance, stable source freeze, release and verified delivery. Task5 resumes the final browser/device/lag/changed-journey matrix only on that stable source. Task6 receives a bounded preservation review of the changed staff presentation/navigation and retained capability fixes. Reuse existing task IDs; no duplicate workers or idle test loops.

Current visual checks must include directory with actual results and inline advert, detail with/without artwork, home/games/blog, account/profile forms, staff Overview/Moderation/Scrapers, dark/light, narrow/short/wide windows and keyboard operation. Graphs must use real source semantics; no invented activity/backlog metrics.

## Evidence already available — scope matters

- Rejected3e32947 passed1455 application tests and57 database checks; this is historical evidence, not a current combined pass. /Users/georgemacdonald/Documents/Codex/2026-09-14/ui-refresh-final-verify.log.
- Retained optional Overview capability helper:50 focused helper/auth checks,15 Overview checks and9 actual-controller scenarios passed. Optional moderation-summary403 only preserves fresh same-account authorised Overview; normal denial/revocation/session clearing remain. Receipts: Documents/Codex/2026-09-08/browserp-security-audit/outputs/CHAT6-OVERVIEW-*20260914*.
- New Task4 slice reports78 focused passes including real-carousel redraw, zero/short/full results, pause/focus and sort/filter state. Task3 reports19 existing profile/history/compare passes. Task2 reports38 existing staff passes and preservation of82 IDs,30 control contracts and existing links across9 private entries. These are slice receipts, not combined browser acceptance.
- Main's achromatic interim check4793c8c had21 focused passes and no overflow at1400/960/390. Final redesigned composition still requires new visual acceptance.
- Task5 stopped old matrix at two passing cells; retained its evidence in Documents/Codex/2026-09-14/ui-refresh-final-3e32947/QA-STOP-HANDOFF.md. Do not claim all engines/performance complete.
- Main's in-app combined directory review now shows compact search, visible sort, neutral background, logo-led rows and original ad placed after sixth result. This one visual observation does not cover all routes or prove continuous live API availability.

## External data and release limitations

Canonical public reads previously returned intermittent401/500/502/504 errors. Replayed successful anonymous data is labelled as replay, not live proof. Recent in-app directory reload returned content; final release still needs bounded current health verification. Do not change credentials or claim the entire service fixed from one response.

An earlier preview upload omitted tracked .gitignore required by repository checks. The corrected export transport includes !browserp-platform/.gitignore while preserving default secret ignores. Old previews are obsolete and must not be promoted. The accidental empty temporary Vercel project ui-refresh-release-3e32947 was deleted and confirmed; the production project was unchanged.

## Completion rule

Finish with one stable combined source, relevant functional/preservation checks, personally reviewed visual evidence and honest browser/performance coverage. Distinguish source built, preview available, verified and live. Existing API/DB/permissions, legal content, drafts and legitimate staff controls must survive the redesign. Keep owner input only for actual authentication/approval boundaries, not routine reversible implementation.

## Final verification continuation

The combined aa1c9f83f20580ad41f1587c52ac93ab8756a9ef app passed 12 browser journey cells across Chromium, Firefox and WebKit. Task6 completed its bounded preservation review with no new finding: 82 private IDs, 15 capability-gated destinations, existing links and controls retained; 19 supporting scripts unchanged. The review is source/local-DOM evidence, not live production proof.

The first aa1c9f8 Vercel build failed two stale exact-palette assertions (1455 other application tests passed). fe4c38a updates only those assertions and includes violet in the actual contrast matrix; the focused dark/light tests pass. It does not alter application behaviour.

Final visual review found two missing full-width pattern selectors on article and Advertise; 21d3021 adds only the matching main/header selectors. Main also found shared advert unboxing lost to higher-specificity theme/homepage rules; 550165b strengthens seven existing selectors without changing declarations, placement or carousel logic. Only affected visual checks are repeated. The stylesheet URLs are advanced to layout2 for these two CSS files; all other cache identities remain.

## Resumed completion, 14 September 2026

The user paused work and then explicitly asked Main to finish. Main retains release ownership. The complete public/member/staff redesign is integrated; AI moderation, Gemini, bot hosting and billing remain deferred. The historical gm9926 source master remains untouched.

### Completed verification

- aa1c9f8: 12 combined journey cells across Chromium, Firefox and WebKit passed. Supplementary checks covered dark/light, 320–2560px widths, short windows, text zoom, keyboard interaction and reduced motion. These are browser-engine and viewport checks, not a physical-device lab or a field performance guarantee.
- 5ba616c: the two corrected full-width patterns and shared advertisement styling passed 8 affected groups / 20 checks. Main reviewed the resulting screenshots. Advertising disclosure, 44px interaction targets, pause/focus and creative/link behaviour were preserved.
- Task6 preservation review passed: 82 private IDs, 15 capability-gated destinations and existing controls/links retained; 19 supporting scripts unchanged. This is source and controlled local-DOM evidence, not a claim that a live owner performed every staff action.
- 518c829 fixed concrete first-load layout jumps. Discover counted layout shift fell to 0 in the paired normal/4x runs; staff Overview fell from .175739 to .005727. A smaller queue shift was attributed to below-view navigation. The large content movement was removed.
- dc9dcdb staged production build is READY at dpl_CJVjAwXAyfw3VY24f6EiPP2QGE6v. It passed 1,458 application tests and 57 database checks, with no failures. Bounded authenticated staging reads returned health 200 and server-rendered directory 200 with 63 total communities. This does not establish continuous API availability.
- Source dc9dcdb (tree 1d1c589cd14eb2a57b340e5cccaa03293913cb74) is preserved on GitHub as 4f22ac5b3660f7eb14eb2f14744d03f67d1a4632 on design/complete-ui-20260914. It is a candidate checkpoint, not a live-release claim.

### Final affected correction

The optional offscreen directory rendering optimisation improved the paired normal Menu measurement (native showModal 311.5 to 181.4ms; event to two animation frames 586.5 to 419.1ms). This is one local pair, not field INP. Chromium deep scrolling, text search, link/focus, Save/Compare and print-content checks passed. Firefox and WebKit affected checks determine whether the optimisation can ship; a possible Firefox blank row is explicitly unresolved at this checkpoint.

baa0008 integrates Task3's narrow focus correction from 5a0897f: the directory listing link draws its existing 2px keyboard outline inward, avoiding the parent's clipping boundary. It changes no dimensions, colours, data or actions. Task5 owns only the remaining affected browser checks; no full matrix restart is required.

Main will record the final source, affected result, source archive and exact deployment in a release receipt. Production promotion and canonical readback follow the final gate. Staging uses --prod --skip-domain to retain production environment semantics while leaving the canonical domain unchanged until promotion. No production promotion has yet occurred as of this checkpoint.


## Post-release advert and accent refinement

The core redesign ac3bf0e is live as dpl_2Jgvj15oCjnG1gX6ygpgCgo74fEs, verified by canonical deployment and stylesheet readback. Its release receipt is Documents/Codex/2026-09-14/BrowseRP-Redesign-Release.md.

User feedback then authorised improving every advert placement using the praised Games banner as a quality benchmark, while preserving different creatives and suitable compositions. The integrated refinement removes legacy home split and clipping rules, uses stable slot-based wide/phone/portrait geometry, preserves the three current creatives and all existing carousel behaviour, and frames the low car subjects individually. Main personally reviewed home wide/phone, Games and true narrow detail rails. This changes presentation only, including the previously preserved obsolete home-split source assertion.

The shared button gradient now originates at the border box, removing coloured repeat seams. Existing decorative headline accents use restrained 12-second brand-colour movement with static reduced-motion and solid forced-colour/print fallbacks. No ordinary status colours, wordmark behaviour, access control, data or navigation behaviour changed.

Changed asset identities are advanced together. The combined source is awaiting bounded affected browser checks and the required staged build before publication. Do not claim these refinements live from the core release receipt. The prior core deployment is the immediate rollback target; gm9926 remains the historical source master.


## Final advert, hover and history refinement

The follow-up source now combines the refined advert layouts and accent motion with enabled primary-button gradient hover (1.6 seconds, scale 1.018, brightness 1.05, no generated sweep); protected touch/reduced-motion/forced-colour states remain static. Light artwork-unavailable links inherit the readable light-theme cyan. Firefox's transient image decode rejection no longer creates a permanent failure entry, and stale load/error callbacks cannot change a newer creative's state. Genuine blocked images retain the no-retry fallback.

Player history supports mouse and horizontal finger/pointer inspection of actual recorded samples with a vertical guide, count and local timestamp; keyboard arrows/Home/End remain available. Missing displayed samples show a plain no-reading message, and sampling/truncation context remains honest. The lengthy observations paragraph moved to the existing expandable data section. Uncaptured abandoned gestures release cleanly; horizontal pointer capture, normal vertical scrolling, rerender cleanup and cancelled/out-of-order requests are preserved. No API, database, moderation, staff access or permission semantics changed.

Task5 owns the final emulated-touch chart checks and remaining Firefox/WebKit advert, motion and control checks. The existing passing Chromium layouts and b27 light fallback/button evidence remain valid. A combined required build, final exact-tree publication, promotion and canonical readback remain Main's release gate. Previous core production is the rollback target. See the external release receipt for the final identities and outcome.


## Button hover correction — 14 September 2026

User correction supersedes prior 1.8% hover scale: primary buttons must stay fixed in size and position. Retain one continuous brand-gradient animation, gradually increase its speed on hover/focus, add a gentle brightness pulse, and ease back without restarting its colour phase. New shared primary-motion helper loads alongside design-system.css on all 29 existing templates, including staff pages. It changes only animation playback speed; no navigation, form, staff access, backend or data behavior changes. Motion preferences, offscreen/background pause, disabled/pressed/busy states and existing touch semantics remain. Candidate requires targeted phase-continuity browser verification, the existing required build, and exact canonical publication readback.
