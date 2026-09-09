# MAIN-BADGE-01 receipt

## Scope

- Base: `2bc48b21125cdbf927a1dc5964160aae65273928`
- Branch: `feature/owner-badge-visible-label-20260909`
- Owned source: `browserp-platform/public/owner-badge.js`
- Owned test: `browserp-platform/test/owner-badge-ui.test.mjs`
- No Main-checkout edit, image generation, app CSS, SQL, browser batch, deployment or hosted mutation.

## Result

The unchanged approved BrowseRP logo now sits inside a small portable linked HTML badge with a fixed, visibly rendered `Listed on BrowseRP` caption beneath it. The badge uses a white surface, dark text, restrained border, compact spacing, system font and `max-width:100%` image/link styling so copied markup remains legible and fits narrow outside-site containers without relying on BrowseRP CSS.

The link retains the canonical published-listing URL and an escaped server-specific accessible label. The decorative logo is hidden from assistive technology because the link already has that complete label and the visible fixed caption. No verified, endorsed, safe, recommended or quality claim is made.

Markdown remains portable and now contains two links to the same canonical listing: the linked unchanged logo and a separate visibly rendered linked caption. Published-only action eligibility, safe slug/name handling, clipboard success/fallback, dialog behaviour and session cleanup are unchanged.

## Example snippets

HTML:

```html
<a href="https://www.browserp.com/server/county-rp" aria-label="County RP is listed on BrowseRP" style="display:inline-flex;max-width:100%;box-sizing:border-box;flex-direction:column;align-items:flex-start;gap:6px;padding:9px 11px;border:1px solid #c9b8c9;border-radius:10px;background:#fff;color:#211922;text-decoration:none;vertical-align:middle"><img src="https://www.browserp.com/assets/browserp-logo-v5.png?v=20260908" width="180" alt="" aria-hidden="true" style="display:block;max-width:100%;height:auto"><span style="display:block;color:#211922;font:600 13px/1.3 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;letter-spacing:.01em">Listed on BrowseRP</span></a>
```

Markdown:

```markdown
[![County RP is listed on BrowseRP](https://www.browserp.com/assets/browserp-logo-v5.png?v=20260908)](https://www.browserp.com/server/county-rp)

[**Listed on BrowseRP**](https://www.browserp.com/server/county-rp)
```

## Verification

- Bundled runtime: Node `v24.19.0`.
- `test/owner-badge-ui.test.mjs`: **4/4 passed**.
- `test/dashboard-listings-ui.test.mjs`: **3/3 passed**.
- Node 24 syntax check: passed.
- Diff whitespace check: passed.
- Browser/visual review intentionally left to Main and worker 5 as assigned.
