# Owner updates and contextual applications: controlled browser verification

30/30 scenarios passed, with 1,044 assertions: Chromium, Firefox and WebKit, each at 390px with touch and 1280px desktop, five scenarios per combination. One browser ran at a time, with each context closed before the next. The agent-browser initial check also confirmed meaningful content, expected form controls, no error overlay, no overflow and no broken visible imagery.

The five scenarios were:

- Imported owned listing with thirty exact mixed keywords: prefill; fixed game/live connection; correct language/setup; ten selected contextual features; readable existing keywords; native name-only submission preserving every exact keyword and the description; account recheck.
- Staff-requested owner correction: conflict denies an old screen, reload preserves the draft and resets consent, current server/submission/queue versions are submitted, a newly researched staff keyword survives, one corrected proposal is sent.
- Ambiguous owner-submit failure: editing is locked and a retry sends the same body and idempotency key, retaining all thirty keywords.
- Session ended: unsent name, form fields and keyword disclosure are cleared; no write occurs; the sign-in gate returns.
- Ordinary applications: only the four launch games survive hydration from a broader enabled catalog; appropriate feature choices, one joining control, Roblox-specific controls and explanations, hidden Cfx fields, native complete Roblox application, private-evidence clearing, reduced-motion layout check.

All six engine/width combinations passed the same-coordinate menu open/close check. No horizontal overflow, broken visible images, page errors, CSP violations, external requests or unexpected API calls occurred in the passing scenarios.

The local fixture serves the isolated worktree's actual HTML, CSS, JavaScript and artwork under HTTPS with current nonce CSP and the existing security directives. Browser CSP was not bypassed. Only the local self-signed certificate was trusted for this test. API/session data and writes are mocked; no live account, listing, database or external site was touched. This is viewport/touch emulation, not physical-device, GPU-performance or hosted authentication/database proof.

Six ordinary/Roblox cases initially stopped because the test's description locator also matched the HTML meta description. The harness was corrected to target the textarea and only those six cases were rerun; all passed. The merged final results exclude the incomplete first attempts and retain the explanation.

One real wording issue was corrected: imported owners can retain more than eight existing features, so their legend no longer says “choose up to 8.” It says “Community features,” with a short explanation that up to eight new features can be added while researched keywords stay attached. Ordinary application limits are unchanged. The additional three-line diff is `/tmp/browserp-owner-feature-wording.patch`, to apply after the earlier options patch.

Evidence:

- `/tmp/browserp-owner-options-browser/final-results.json` — merged 30 passing scenarios and exact assertion counts.
- `/tmp/browserp-owner-options-browser/results.json` and `/tmp/browserp-owner-options-browser-rerun/results.json` — original and affected rerun evidence.
- `/tmp/browserp-owner-options-browser/chromium-390-owner-form-final.png` — mobile form spacing/dropdowns.
- `/tmp/browserp-owner-options-browser/chromium-1280-owner-features-final.png` — desktop read-only connection and preserved-feature controls.
- `/tmp/browserp-owner-options-browser-rerun/chromium-390-roblox.png` — mobile Roblox controls.

Cleanup confirmed: all launched browser instances and contexts closed, the named agent-browser session closed, fixture process exited, port 8188 has no listener, and no owned browser/fixture/capture runner remains. No shared browser was used.
