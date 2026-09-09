# Logo palette alignment — 9 September 2026

Prepared in the isolated `browserp-logo-palette` worktree on `work/chat3-logo-palette-20260909`, from Main's public commit `ce9027b6bfd697addfc529ddc3d30f8e3c8889b0`. Main owns integration, the frozen visual-verification candidate and deployment. This patch has not been deployed or verified in a rendered browser.

The existing `public/assets/browserp-logo-v5.png` was visually inspected. Its pink upper faces, blue/cyan lower faces and purple transitions guided this narrow update. The artwork itself is unchanged.

## Result and rationale

- Shared brand text and primary actions move from pink/purple to pink/blue. Purple remains the accent token and in existing secondary treatments; there is no blanket replacement.
- Blue links and focus rings use `#59cde0` on dark surfaces and `#006d94` on light surfaces. Existing theme switching, page/panel backgrounds, text colours and default appearance remain intact. Dashboard account links and input focus, public navigation underlines and staff navigation/focus receive the coordinated palette.
- Primary buttons use deeper `#ad176f` pink and `#00628f` blue with white labels. The existing white sweep colour changes from 34% to 8% opacity so labels stay readable through its brightest state. Its timing, position, geometry and motion rules are unchanged; no glow is added.
- Success, warning, danger and informational status colours are preserved. A separate `--info` token retains the former informational purple when `--cyan` becomes blue; older v2-only consumers retain their cyan fallback.
- Game colours stay unchanged: public FiveM orange, RedM red, Roblox white and Minecraft dark green. Staff game tokens retain their pre-existing values. All logo/pattern assets, selectors, keyframes, timing and density are unchanged. No HTML, JavaScript, content, layout or provider configuration changes are included.

## Files

| File under `browserp-platform/public/` | Change |
| --- | --- |
| `browserp-v3.css` | Dark blue/focus tokens, preserved information token, shared text/action gradients and contrast-safe sweep colour |
| `theme.css` | Deep light-theme blue/focus and preserved information token |
| `product-polish.css` | Pink-to-blue public navigation underline |
| `profile-layout.css` | Solid themed blue input focus, replacing the low-opacity pink ring |
| `staff-layout.css` | Brand selection gradients and blue focus border |
| `browserp-portal-v2.css` | Blue account-help link; information-status fallback preserves prior colour |

Only these six CSS files change product behavior. This receipt and `CHAT3_LOGO_PALETTE_CONTRAST.json` record validation.

## Verification

All 18 existing focused checks passed, zero failed/skipped/cancelled: `theme-control-contrast`, `first-visit-appearance`, `platform-theme`, and `premium-interactions`. They cover both theme transitions, stored appearance and consent independence, game colours, and existing pointer/reduced-motion button safeguards. Dependencies were reused through a temporary local link; no packages were installed and the link was removed before commit.

Calculated minimum contrast ratios:

| Treatment | Minimum ratio |
| --- | ---: |
| Dark blue links/focus on the four shared dark surfaces | 9.36:1 |
| Light blue links/focus on the four shared light surfaces | 4.91:1 |
| Pink-to-blue brand text, dark/light surfaces | 5.16:1 / 4.91:1 |
| White CTA label, default gradient | 6.68:1 |
| White CTA label, focus/hover plus maximum white highlight | 5.12:1 |
| White CTA label, conservative touch brightness/saturation plus highlight | 4.60:1 |
| Selected staff moderation tab label | 10.75:1 |

The calculation sampled 1,001 points per sRGB gradient and conservatively combined the full 8% highlight with the existing touch `brightness(1.12) saturate(1.06)` filter, exceeding the actual sweep's 95% opacity peak. These are source colour calculations, not full-page accessibility certification or rendered browser proof.

Source comparisons confirmed unchanged background/text/status/purple tokens, game and logo rules, all keyframes, and no assets/HTML/JavaScript changes. `git diff --check` passed. A bounded independent read-only review found no actionable cascade or scope regressions.

## Main handoff

Integrate this commit into the chosen final candidate, preserving the separate moderation work. Send the frozen result to Chat 5 for the requested targeted visual pass: public page and navigation in dark/light; dashboard account link, CTA and field focus in dark/light; staff CTA, active navigation/tab and field focus on existing staff surfaces. Check the existing hover/touch sweep and reduced-motion presentation. No broad browser run or deployment was started by this task.

The completed backup packager remains available separately for final sealing after Main supplies final inputs.
