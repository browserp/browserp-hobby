# Compact advert controls

The owner's screenshot identifies the outlined circular advert arrows, not all site buttons. This release only changes that control styling and refreshes affected stylesheet cache references (2.19.6).

- Replaced the floating 44px outlined circles with restrained 32px rounded-square faces and consistent CSS-drawn chevrons.
- Preserved a 44px minimum clickable/tappable area, accessible button names and all existing carousel controls and actions.
- Added subtle hover/pressed feedback, explicit keyboard focus, reduced-motion and forced-colour support.
- Removed conflicting old sidebar/detail sizing and circular hover styles instead of adding another high-specificity override.
- Failed-artwork controls remain in normal grid flow, with relative positioning so decorative faces anchor to their buttons. Desktop positioning exceptions exclude this fallback.
- No JavaScript, API, database, authentication, payment or plan changes.

## Verification

Isolated Chrome checked home sidebar and banner, plus server-detail adverts at 1366px, 2503px, touch-enabled 768px and 390px, reduced motion and intentionally blocked advert images. Previous/next clicks, invisible hit-area edges, keyboard Enter, 44px targets, 32px faces, containment, no horizontal overflow and failed-artwork positioning passed. No uncaught page errors. Desktop, phone and fallback screenshots were inspected. This uses local synthetic listings only, never published data; emulation is not a physical-device test.

Node 24 final release gate passed: 202 JavaScript files syntax checked, 12 functions, 834 application tests and 35 database tests. Four new control-cascade tests and the unchanged carousel/premium tests passed separately (14 focused tests). Whitespace validation passed.

## Deploy Result

- URL: https://www.browserp.com
- Target: production
- Status: READY, 6 September 2026 at 16:05:44 UTC
- Commit: `e54b02db36a11f695813560476af26f70d885fab`
- Framework: existing multipage HTML/CSS/JavaScript with Node API functions
- Build duration: 2m44s, 12 functions
- Deployment: `dpl_61X9YCjN74VSceqhDvEkLBgmxzk7`, https://browserp-hobby-gwwke3cvv-browserp.vercel.app
- Verified preview: `dpl_EjSLE2zgVzNuoMnd5Ei3GjCkuA4Y`, https://browserp-hobby-6pc6ky2et-browserp.vercel.app (2m36s)

Live health at 16:06:41 UTC matched the exact SHA and reported backend/authentication/security ready, payments disabled. Hosted preview and live Chrome readbacks confirmed 2.19.6 CSS, transparent 44px hosts, 6px face inset, 7px corner radius and hidden legacy text glyph. Live previous/next actions passed with no uncaught page errors. The live check waits for advert hydration and targets the stable banner, not a first-visible-ad locator whose identity changes while the home page initializes.

### Post-deploy observability

- Deployment-scoped five-minute runtime error scan: no errors returned.
- Monitoring/drains: unchanged; this pass did not configure or audit continuous monitoring.
- Final release notes are documentation only; do not redeploy solely for them.
