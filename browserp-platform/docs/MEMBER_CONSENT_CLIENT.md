# Recommendation consent integration

`public/recommendations.js` remains the single existing script include. It exposes the existing `BrowseRPRecommendations` model, footer preferences and `mountSettings(root)` API. `getConsentState()` adds `{phase,accountId,choice,version,enabled,localSaveFailed}` for presentation, and changes emit `browserp:recommendations-changed`. The optional recommendation model starts disabled.

The script independently checks `/api/auth/session`, then `/api/me/preferences` for a signed-in account. No shared router, navigation, portal or theme module was edited. Main must mount the documented member preference route and apply the named migration before this frontend and its policy copy are released. The existing `browserp:session-ended` event suspends collection and clears optional history immediately. Account-changing interfaces must continue emitting it. Footer preference buttons and profile controls remain available to guests.

## Conflict and lifecycle rules

- The server stores only choice/version/update time. It never receives view records. Signed-in writes carry the confirmed account header and CSRF token. Unset remote consent does not import a guest's acceptance.
- A local rejection vetoes a saved remote acceptance. The browser sends that rejection to the account; a failed save keeps collection disabled and the local rejection pending for the next check. A remote rejection clears local history and leaves the same local veto. Only a fresh explicit acceptance on this browser can lift it.
- Acceptance uses the last confirmed server version. A conflict fails closed; it never silently retries acceptance over a newer decision. Rejection applies even with a stale version. Delayed callbacks are discarded after a later choice, session pause or account change.
- Local rejection is immediate even if local removal fails. The UI reports the failure and keeps the in-memory collection gate closed. An in-memory rejection veto survives failed local writes and remote retries; tombstone, marker and history removal are attempted independently. The stored choice, account binding and a separate rejection-generation marker prevent an older acceptance response from overwriting a newer rejection from another tab, including before its storage event is delivered.
- The optional history stays at `browserp-recommendations-v1`, at most 80 records for 30 days, and expires on the next successful active use. `browserp-cookie-choice-v1` preserves guest choice. Account binding and rejection-generation keys are consent bookkeeping, containing no browsing history. History is cleared on a verified account/guest change; acceptance is not inherited across that boundary.
- Reads, writes, ranking and recommendation requests remain off during initial load, saves, failed checks, page suspension and unconfirmed account changes. A check lasts at most 10 seconds per HTTP request. Confirmation expires after 30 seconds; visible pages recheck on a 30-second interval and on focus/resume. Hidden pages pause and do not poll. Before a delayed timer runs, the expired confirmation itself denies optional use.
- Other devices learn a change through a successful active check. Offline devices cannot receive immediate changes. A session-cookie change made outside the participating app events is detected by the next verified API check; cookie changes themselves have no browser event. This is a bounded check, not a claim of instantaneous cross-device revocation. Every signed-in preference request independently binds the current server session to the expected account.

Required session/security storage, theme, favourites, Recently viewed and Compare have separate purposes and controls. This change does not upload or alter those stores. Staff workspace paths do not activate recommendation code.

## Presentation

Use the existing recommendation controls, or read `getConsentState()` after `browserp:recommendations-changed`. Never display a completed account save while phase is `loading`, `saving` or `error`; `enabled` is the actual current collection gate. An unset account choice is not a saved rejection. The footer dialog explains delayed/offline device updates and local-rejection precedence.

Cookie policy is `/legal#cookies`; no `cookies.html` exists. Chat 2 granted only the privacy/cookie sections of `legal.html` to this task. `privacy.html` and those two legal sections describe the implemented target release. Main must release them together with the route, migration and frontend, after integrated verification. Other legal sections are unchanged.

## Verification limits

Dedicated model and DOM fixtures exercise opt-in/default-off, stale conflicts and callbacks, account separation, visibility/session suspension, missing/malformed API data, offline retries, local storage failures, footer/profile controls and local-only history. These are synthetic checks with no real user data. Main owns the integrated preview/production and cross-browser/device checks and will identify physical-device evidence separately. No hosted preference row, migration or deployment was created here.

## Required server-detail integration at Chat 2

The existing browserp-v3.js server loader records a view once; that call can precede the independent preference check and is correctly refused. Chat 2 has the exact integration request: after consent becomes ready/enabled, observe only the currently displayed server while visible and in the same confirmed account/route, with teardown on navigation/session change. Do not queue or replay pre-consent views. The existing record method checks consent and de-duplicates a listing for 30 minutes. This is a release integration dependency; it is outside this task’s reserved file ownership.
