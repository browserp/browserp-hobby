# Structured account export — three-engine browser check

Completed **2026-09-06T01:26:37.314Z** against the current root Profile page and its **2.16.0** privacy assets, served from the working tree through a local HTTPS fixture with the current document nonce CSP and private no-store headers.

**Result: 24/24 scenarios passed, with 678 assertions. No functional blocker was reproduced.**

| Engine | 390 px with touch | 1280 px desktop | Actual downloads |
|---|---:|---:|---:|
| Chromium | 4/4 passed | 4/4 passed | 2 exact files |
| Firefox | 4/4 passed | 4/4 passed | 2 exact files |
| WebKit | 4/4 passed | 4/4 passed | 2 exact files |

At each engine and size the test:

1. Opened the actual Profile page's Your data section and approved request, then used a real touch tap at 390 px or click at 1280 px to prepare the copy.
2. Captured the browser's actual download, checked successful completion and the suggested name `BrowseRP-account-data.json`, saved the bytes and verified the exact UTF-8 contents, SHA-256 and parsed Unicode text. The fixture deliberately includes an accented name and emoji.
3. Verified preparation → read → final authorisation check occurs before download. Every private request carried the account bound to the displayed screen; POSTs also carried its CSRF token.
4. Verified that downloading alone sent **no receipt**. The confirmation button was disabled until the separate saved-and-opened checkbox was selected. Explicit confirmation sent exactly one receipt, while the request remained Ready for follow-up and retained the incomplete uploaded-file notice.
5. Corrupted the returned content: integrity verification rejected it and no download or receipt occurred.
6. Returned an account-change denial during the final authorisation check: no download or receipt occurred, private request text was removed and the sign-in screen appeared.
7. Ended the session while the file response was pending, then released that delayed response: no download or receipt occurred and private request content remained cleared.
8. Checked each case for horizontal page overflow, uncaught JavaScript errors, CSP violations and unexpected external/API requests: all zero.

The batch used **one engine at a time**, one context/page per scenario, and closed every context and engine in `finally`. The HTTPS server closed when the batch ended. The successful process log explicitly records Chromium, Firefox and WebKit closed. No IAB/shared tabs were used, and no root files or production accounts/data were changed.

## Evidence

- Machine-readable cases: `results.json`.
- Reusable script: `/tmp/browserp-structured-export-browser.mjs`.
- Process log: `/tmp/browserp-structured-export-browser.log`.
- Two Chromium screenshots: `chromium-390-copy.png` and `chromium-1280-copy.png`.
- Six actual saved fixture downloads alongside the results; all are fictional and contain no user data.
- Tested privacy JS SHA-256: `8d82e99030d82644210fae4aebb894f0cd3cb92accfd9ab94143e6c91b7e9106`.
- Tested privacy CSS SHA-256: `876a373b8602009b472550c2e7610cc8eb44da2a26ae9c0c0e4e0f6c6eb9319c`.

## Validation boundary

This is real browser-engine rendering, pointer/touch emulation, WebCrypto and native file-download behaviour using the actual application UI under its local HTTPS/CSP headers. All API responses are controlled fixtures and all external hosts are blocked. It does **not** establish real provider sign-in/MFA, hosted database approval/session revocation, production retention cleanup, a physical handset, or the user's operating-system save location. Those remain separate from the passing browser behaviours. Screenshots show the functioning controls, not a new design proposal.
