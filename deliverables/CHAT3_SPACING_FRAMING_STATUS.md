# Section spacing and image framing — 9 September 2026

Prepared as an independent piece in `browserp-spacing-framing`, branch `work/chat3-spacing-framing-20260909`, from Main's public commit `57e9b528d87156b3d4d8bf33b72050c66937eb6a`. This handles the user's selected section-spacing and image-framing work only. Main personally retains the final unified design-language pass, integration and deployment.

## Changes

- Introductions flow into their controls and content with less accumulated padding. Scoped public spacing ranges are 48–72px for leads, 40–64px for standard sections and 24–36px for utility gaps. The homepage game-picker-to-listings padding falls from 136px to 72px at wide desktop and from 96px to 48px on narrow screens. These figures describe the two adjoining paddings, not measured browser bounding boxes.
- Intro headings/copy have 22ch/68ch maximum measures, a 10px eyebrow gap and 14px heading-to-copy gap. Section heading/copy measures are 28ch/65ch, with a responsive 20–28px heading-to-content gap. Font families, sizes, weights, colour and text content are unchanged. Home, directory, games and journal spacing is scoped to existing selectors; no section is moved or added.
- Existing game-card and game-hero landscape frames retain their 460 / 215 ratio. The smaller game-navigation thumbnail now uses that ratio at its existing 46px width instead of cropping into 46×30px. The square All games image uses containment in its unchanged frame. Existing editorial feature crops are retained; there is no blanket image override.
- Server-card images use containment with a 6px inset inside the existing 96px desktop / 64px narrow identity frame. Initials fill and centre in that same frame. Detail-logo images also gain a 6px inset, with rounding retained on the outer frame rather than trimming artwork corners. Existing slight card-image hover scaling is preserved.

## Files and contracts

| Product file under `browserp-platform/public/` | Scope |
| --- | --- |
| `public-layout.css` | Shared spacing values, scoped intro/header measures, card-image containment and initials framing |
| `homepage.css` | Homepage lead/listings spacing and square All games containment |
| `game-artwork.css` | Games lead/standard/utility spacing and navigation thumbnail ratio |
| `server-detail.css` | Detail-logo child inset only |

Chat 5 confirmed that `.server-card-media` / `.server-card-media-image` stay inside `.server-card-top`. This patch changes none of the card grid areas, title/metadata/description/summary rules or JavaScript. Chat 2 confirmed that its separate Similar communities work preserves `.detail-logo-v3 > .server-import-logo-v3` and leaves this stylesheet alone.

No edits were needed to `pages.css`, which is not loaded by current public HTML. The live games template is `game.html`; it and all other HTML remain unchanged. No new stylesheet layer or package is introduced.

## Verification and limits

All 14 existing focused checks passed, zero failed/skipped/cancelled: `server-card-identity-ui`, `games-launch`, and `game-results-visibility`. This includes logo→banner→initials fallback behavior, existing game ordering/request boundaries and asynchronous result visibility. No broad test or browser batch was run.

Source comparisons passed for all advert/rail rules, existing motion and colour declarations, asset URLs, card grid geometry and identity-frame sizes. Asset pixels, theme switching, palette, game/status colours, image/error mechanics, HTML and JavaScript are unchanged. The existing advert-spacing fix and 4:5 advert containment remain intact. `git diff --check` passed.

Responsive intent was calculated at 320, 390, 760, 768, 1024, 1440 and 1920 CSS pixels. Spacing is fluid through the prior breakpoint; server-frame sizes retain their existing 760px change. Values and preservation results are in `CHAT3_SPACING_FRAMING_CHECKS.json`. An independent read-only review checked actual stylesheet order and found no actionable cascade or scope issue.

These checks establish source behavior and intended sizing, not rendered browser quality, physical-device coverage or live completion. Main should include the independently integrated piece in the later affected-surface visual pass after its personal unified design work. No deployment was performed. Final backup sealing still awaits Main's new freeze and packaging inputs.
