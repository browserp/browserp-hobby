# Public interaction and refresh checks — 4 September 2026

The joining filters, automatic directory refresh and staff refresh-health controls remained usable in the bounded slow-device checks. The checks also exposed and corrected public-menu placement, repainting and keyboard issues. This report describes local browser evidence, not production traffic measurements or a claim that every physical device is lag-free.

## Conditions

- Actual repository HTML, CSS and JavaScript served at `127.0.0.1:8106`; synthetic public directory rows and staff health responses. No authenticated user cookies, provider consent, account changes, publishing requests or production load testing.
- Headless Chromium 151.0.7922.34 with 4× CPU slowdown, 150 ms network latency, 1.6 Mbps download and 0.75 Mbps upload. Directory/health responses additionally waited 850 ms. Mobile touch emulation used 390×844 and 320×740, device scale factor 3; desktop used 1440×960. Normal and reduced motion were both checked.
- Separate unthrottled functional checks used Chromium 151.0.7922.34, Firefox 153.0 and WebKit 26.5 at 390, 1440 and 2560 pixels wide. These are browser engines on a development machine, not physical Android/iPhone devices or a field Core Web Vitals sample.
- Frame intervals came from requestAnimationFrame. Input timing below measures click dispatch to two animation frames, not standardized INP. Layout shifts used the largest normal CLS session window. Navigation readiness includes deliberately delayed local resources and is not a Vercel response-time benchmark.

## Functional results and repairs

- Joining choices remain selected after refresh. A delayed failure retains existing cards, paging and focused listing link; the next successful update replaces unavailable/old counts without requiring another search. A 48-row fixture filtered to the expected 16 whitelisted rows, with no public rows mixed in. The 60-second scheduler was triggered with a controlled clock for this failure/recovery check.
- Staff health retains its dated figures and open history disclosure during a failed update; a successful retry replaces the warning and retains the open disclosure.
- No horizontal overflow or page JavaScript errors appeared in the successful scenarios. Advert text and its Advertisement label stayed readable. An initial case-sensitive harness assertion did not account for CSS uppercase text; it was corrected and all five home confirmation/control cases passed.
- Public-menu Close now uses the opener's exact viewport position and size, captured before scroll locking. The panel stays around that control even on a wide centred header. The control no longer scales or moves with the panel's entrance effect.
- Only while the menu is open, ambient hero and logo animations pause. They resume when it closes; the backdrop, navigation entrance effects, primary-button hover and reduced-motion preference remain intact.
- Filled search inputs no longer consume Escape merely to clear their text: Escape closes the outer menu and preserves the query. Inner account-menu Escape retains its separate behavior.
- WebKit's default keyboard preference skipped menu buttons/links and allowed focus to leave the modal's controls. Explicit forward/backward modal traversal now reaches visible enabled controls, excludes hidden/inert/negative-tabindex controls and wraps consistently.

## Measurements

| Scenario, 4× CPU | Observation |
| --- | --- |
| Mobile Discover, 390 normal / 320 reduced | Joining filter completed in 987 / 984 ms with the deliberate 850 ms API delay; click-to-two-frame timing 18–24 ms. |
| Mobile staff health, 390 / 320 | Retry completed in 973 / 1481 ms; control input timing 23–29 ms. |
| Mobile page readiness | 2.7–4.0 seconds across home, Discover and health with the described network delay. |
| Mobile initial short scenarios | Frame p95 about 18.3–18.6 ms; largest observed CLS 0.063; isolated startup long task up to 205 ms. |
| Desktop menu open and idle, before / after scoped pause | Frame p95 about 99.9 / 17.6 ms; frames over 50 ms fell from 15 of 37 to 1 of 106 in equal 1.8-second observation windows. |
| Menu geometry after correction | All measured x/y/width/height differences from opener: 0 px at 320, 390 and 1440, including reduced motion. |
| Mobile menu after correction | Open-menu idle p95 about 17.5 ms, no frames above 50 ms in the measured idle windows. |
| Reduced-motion scenarios | Zero running animations in captured final states; controls and dismissal remain functional. |
| Desktop primary Search hover | Pink/violet gradient remains, position animates, brightness becomes 1.06; reduced motion retains brightness without movement. |

The 4× desktop opening transition still had a brief approximately 101 ms maximum frame; open-menu idle no longer sustains the former slow repainting. Outside the modal, the unchanged large desktop hero/hover scenario had approximately 34 ms frame p95 in headless rendering, compared with approximately 17.5 ms under reduced motion. A physical-device/GPU or field performance study would be needed to generalize these figures.

## Regression evidence

- `node --test test/public-navigation.test.mjs test/navigation-game-showcase.test.mjs`: **48 passed**. New cases cover pre-scroll-lock geometry, viewport changes, wide/phone panel anchoring, filled-search Escape, and complete keyboard traversal.
- `test/discovery-refresh.test.mjs`: **6 passed** in the focused refresh run, covering unavailable-count recovery, hidden-page and overlap guards, retained loaded pages/filter/focus, failed refresh preservation, five-minute expiry and a new search superseding an older response.
- **9/9 native configurations passed** across Chromium, Firefox and WebKit at 390/1440/2560. The Chromium 2560 resize initially missed a fixed 100 ms harness deadline by 5 px; waiting for its resize event to settle (bounded 2 seconds) then confirmed 0 px, with no further app change. The final matrix checks control position during entry and at rest, containment in the panel, 24 forward plus 24 backward Tab steps, retained query on resize, Escape focus return, scroll restoration and overflow. Browser results are retained in the artifacts below.

Local evidence artifacts for this run:

- `/tmp/browserp-performance-results/results.json` — original slow-device home/Discover/health scenarios.
- `/tmp/browserp-performance-home-confirmation/results.json` — corrected home assertions plus reduced-motion and unthrottled controls.
- `/tmp/browserp-performance-animation-isolation/results.json` — before-fix idle/transition measurements.
- `/tmp/browserp-performance-navigation-after/results.json` — after-fix measurements and screenshots at 320/390/1440.
- `/tmp/browserp-navigation-engine-check/results-final.json` — latest passing result per native configuration; original matrix and the isolated wide-screen confirmation are retained alongside it and in `/tmp/browserp-navigation-wide-confirmation/results.json`.
- `/tmp/browserp-performance-results/mobile320-reduced-discover.png` and `mobile390-normal-health.png` — narrow-screen recovery evidence.
- `/tmp/browserp-navigation-engine-check/chromium-1440-menu.png` and `webkit-390-menu.png` — final desktop/mobile menu rendering.

The temporary isolated browser contexts were closed after the checks. The shared local fixture belongs to the release audit and was left running for the parent task.
