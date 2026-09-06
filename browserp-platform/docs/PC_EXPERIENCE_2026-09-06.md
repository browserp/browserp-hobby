# PC experience and staff access release

Based on `98d7de9` (latest launch handoff), preserving deployed application `445a852` and the existing four launch games. Asset release: 2.19.0. Main is intentionally unchanged.

## Changes

- Staff HTML is hidden and inert from first paint. The server's strict `staff` flag checks the live account session, active Discord membership/allowlist, current MFA policy and verified TOTP when required. Membership-only `staffAccess` still supports enrollment but no longer exposes the public menu link.
- Denied staff requests clear private UI, ignore late responses and invalidate the workspace. History restoration reloads; returning to a hidden tab requires a fresh current-account check. Existing permission-gated database operations remain authoritative. No IP allowlist is added: the requested server-side role validation avoids locking mobile/dynamic-IP staff out.
- Actual profile avatars and custom uploads replace hardcoded initials; broken images retain a safe initials fallback. Provider reauthentication is in a separate section below connection cards. Responsive crop sizing is corrected.
- Public desktop select menus use a keyboard-accessible top-layer picker. Mobile and unsupported browsers keep the native control. Staff controls retain their existing controller with refreshed styling. Search suggestions are scrollable and no longer clipped behind other sections.
- Server details use an up-to-1760px desktop frame, two artwork rails on wide screens and one compact banner on mobile. House promotions stay explicitly labelled; arrow/dot/pause controls are retained. Additional horizontal placements appear on home, game and journal pages using the existing advert endpoint.
- Real publisher artwork replaces generated game images (see `game-artwork-attribution.md`). GTA VI roleplay and 6M have dedicated Coming Soon information; they do not enable submissions, claim an official release date or advertise playable servers.
- Stable `/favicon.png` is a transparent 192px icon. Search engines control when they recrawl and display it.
- Optional recommendations are off until enabled. The browser keeps at most 80 BrowseRP server-view records for 30 days, deduplicates quick reloads and favours frequently viewed regions. No operating-system browser history, cross-site activity or account-linked browsing log is collected. Explicit search/region/sort controls take precedence. Profile and discovery controls can disable and erase this history; notices are reflected in privacy/cookie policies.

## Verification

- Node 24 application suite: 815 passing tests at integration gate; subsequent focused game/recommendation/advertising tests passed.
- Real local PostgreSQL tests: 35 passed. Live read-only probes denied an ordinary account and an owner token with an invalid session; existing MFA requirement retained. No production migrations required.
- Syntax/function check: 11 API functions plus one Node middleware, 12 total. Dependency install audit reported zero vulnerabilities.
- Browser review used a local-only synthetic fixture, never published listings/accounts. Desktop 1600px: no horizontal overflow, server frame 1521px with 1078px content and two rails. Mobile 390px: no overflow, stacked profile, one server rail. Connected-account sign-in group sits below cards; search choices update the region picker; three distinct UK views yield UK recommendations.
- The typing caret reported across unrelated websites is consistent with browser caret browsing (F7), not editable BrowseRP content. No blanket suppression of selection or accessibility features was added.

## Production release evidence

- URL: https://www.browserp.com
- Target/status: production, READY at 14:02 UTC on 6 September 2026.
- Application commit: `69281112a4c369c071541ac796df282a282a57b5`.
- Deployment: `dpl_31AFT7Y2H8n8QZFKpHAYk1hn8Q8X`; https://browserp-hobby-2jl036v1c-browserp.vercel.app.
- Framework: multipage HTML/CSS/JavaScript with Node functions. Build duration: 2m42s. Exactly 12 Node functions.
- Live health matched the SHA; backend/authentication/security ready, payments disabled. Apex redirects to www. GTA VI and 6M pages return 200 with Coming Soon text; published artwork, recommendation script and CSS return 200. Live favicon SHA-256 matches the tested transparent source.
- Anonymous session reports staff=false/staffAccess=false. Six staff endpoints (overview, staff, security, profiles, roles, permissions) return 401 with error/requestId only, no-store and cache MISS.
- Observability: no errors returned in the deployment-scoped production error scan since five minutes. Drains were not reviewed or changed; this is a smoke check, not continuous monitoring or a penetration test.
- Final live visual review caught narrow advert arrows over text. A CSS-only follow-up moves those controls into clear artwork space, retains 44px targets and bumps only the relevant stylesheet cache to 2.19.1. Five carousel regression tests passed; local browser geometry verified both control bottoms above both advert titles. No API or database changes in that follow-up. Confirm its final deployment SHA before declaring the follow-up live.

Do not publish the local visual fixture as a live listing. Provider login rehearsals and physical-device tests were not performed in this pass. Google controls favicon recrawling; cross-site typing carets may need the user to disable browser caret browsing.
