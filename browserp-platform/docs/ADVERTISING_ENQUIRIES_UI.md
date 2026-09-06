# Advertising enquiries: member and staff interface

This closes the advertised enquiry-route gap on `/advertise`. Signed-in members can send an advertising idea, read its status and private BrowseRP reply, and withdraw an open enquiry. Staff review these enquiries inside Overview’s existing Advertisements section. Campaign publishing remains a separate tool in that section.

The page continues to state that bookings are not open. An enquiry does not confirm availability, price, payment or a campaign. Replies appear on BrowseRP; this release does not send email or create an upload/payment flow.

## Account and interaction boundaries

- The public module starts after the existing current-session lookup; signed-out visitors receive actual enabled provider links returning to `/advertise`, without a private enquiry query.
- Staff permission is checked independently before the queue can load, including while the check is pending. This allows the backend's enquiry-specific permission without assuming campaign-management permission.
- Every private request binds `X-BrowseRP-Account` to the account shown at initialization. Existing API wrappers provide CSRF on writes; backend current-session/account/MFA/permission checks remain authoritative.
- A definite rejected save keeps the draft editable. A connection failure or ambiguous response locks editing and offers an exact body/key retry, preventing a second, changed enquiry from replacing an uncertain save.
- Staff decisions carry the displayed version. Conflict feedback asks for refresh and keeps the unsent reply, including if another reviewer has since replied or closed the enquiry.
- Published replies are never edited by this UI. Closing an already-replied enquiry sends an empty reply to preserve the published reply. Withdrawal requires explicit confirmation.
- Untrusted prose is rendered as text. Only public-host HTTPS destinations without credentials or explicit ports become links. Client validation matches the backend public-host rule, including local/IP/reserved-address rejection.
- Session-end and navigation events clear private content, drafts and pending operations; late responses cannot restore them. A browser history cache return reloads to revalidate the session. The server also rejects requests after a separate-tab account switch rather than reusing a different account.
- Native disclosure summaries stay in the same place when opened and closed. Labels remain meaningful when collapsed; keyboard/touch operation and reduced-motion behavior use native controls.

## Integration

The UI uses the agreed `/api/me/advertising-enquiries` and `/api/admin/advertising-enquiries` contracts. GET returns `{items,next}`; POST returns `{enquiry}`. Member actions are create/withdraw; staff review targets are reviewing/replied/closed. This interface must ship with the matching API, permission and database migration.

Narrow existing-file edits are the member initialization after `await session()` in `browserp-v3.js`, the staff controller initialization/cleanup in `staffpanel-v3.js`, the two page assets/mounts, and the campaign inner-root selector in `staff-adverts.js`. The new queue is outside that inner campaign mount, so campaign rendering or an unavailable campaign permission cannot overwrite it.

## Verification

- 14 focused UI regressions pass: real signed-out provider choices, account header, create, URL rejection, draft retention, exact uncertain retry and duplicate-click locking, permission gating (including a delayed probe), review/reply/close, version conflict, closed-item draft preservation, confirmed withdrawal, escaped prose, session/navigation cleanup, pagination and independent mounts.
- All 6 existing staff advertisement UI tests continue to pass: 20 focused tests total.
- Syntax check: 180 JavaScript files; Vercel deployment check remains 11 API functions plus one middleware, 12 total in this UI-only baseline.
- The integrated fixture matrix exercised Chromium, Firefox and WebKit member and staff views at 320, 390 and 1280 CSS pixels: 18/18 passed. Checks include no horizontal overflow, actual repeated mouse/touch taps at the original disclosure coordinates, native form submission, one write, and no application page errors. The 320px cases use reduced motion.
- Visual inspection found an inherited legal-section padding override on the member form. Its narrow CSS override was corrected and both 320/390px member checks passed again with a computed padding assertion.

These fixture checks do not claim live provider sign-in, hosted backend/migration deployment, physical-device coverage or cross-browser release coverage. Parent release verification covers the integrated hosted batch. No real enquiry was sent, no production data was changed, and all isolated browser contexts were closed.
