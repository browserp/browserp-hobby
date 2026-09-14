# BrowseRP shared design foundations

Open `index.html` locally or serve this directory through a local static server. This developer reference stays outside member navigation. Toggle Dark/Light and compact staff density, then inspect the labelled ordinary, selected, loading, disabled, error, hover and keyboard-focus examples. Tab through controls for real focus; hover/focus previews are explicitly simulated only in `reference.css`. Theme changes affect this document only and preserve entered values.

## Integration contract

Load legacy/component CSS first, then `public/design-system.css`, then page composition CSS. Main owns product HTML wiring. The shared stylesheet defines both palettes without requiring public `theme.css` on staff pages. Root `data-theme="light"` selects light; default remains dark. Existing product theme controllers keep their saved-preference behaviour and state-preservation responsibilities.

Use existing semantic elements, labels and product controllers. This layer does not grant permissions, mount controls, change action targets or replace validation. Hidden/inert state and dialog geometry remain controller-owned. The 1px backing select rule in `modern-select.css` retains its important geometry.

| Recipe | Existing adapters | New-use class |
| --- | --- | --- |
| Action | `.button-v3`, `.button`, `.small-button` | `.ds-button` |
| Primary / quiet / danger | Existing matching variants | `.ds-button-primary`, `.ds-button-quiet`, `.ds-button-danger` |
| Field | `.field-v3`, `.portal-field`, `.control-v3` | `.ds-field` |
| Section frame | `.panel-v3`, `.portal-panel-v2`, `.staff-section-v3` | `.ds-panel` |
| Tabs | `.portal-nav a`, `[role="tab"]` | `.ds-tabs` |
| Status | `.status-chip` | `.ds-status` with `data-tone` |
| Chart frame | Existing chart controllers retain data | `.ds-chart-frame` |
| Menu trigger adapter | Shared staff Menu implementation owned by Task 2 | `.ds-menu-button` |

Both staff panels must use Task 2's same maintained Menu implementation. The CSS adapter and this reference do not themselves prove component reuse. Keep a single controller/source for repeated product components; do not copy example markup to replace working menus or tabs. Real enhanced dropdown behaviour remains in the existing modern-select controller; the reference's select is deliberately native.

## Values and states

Public control height is 48px; staff `.staff-v3`, `[data-staff-page]` or `.ds-density-compact` uses 44px. Control/card/panel radii are 12/16/20px. The body font remains Inter with system fallbacks. Both themes independently define raised/inset surfaces, borders, shadows and readable semantic colours.

Use `--brand-gradient` for accent artwork. Use `--brand-action-gradient` for primary actions with white labels; its deeper stops support readable text. Use `--text`, `--copy`, `--muted` for hierarchy; `--success`, `--warning`, `--danger`, `--info` for semantic feedback, accompanied by words or a state marker. Chart aliases are `--chart-grid`, `--chart-axis`, `--chart-series`.

Native `disabled`, `aria-disabled`, `aria-busy`, `aria-invalid`, `aria-pressed`, `aria-selected` and `aria-current` expose existing state. CSS does not suppress activation of aria-disabled controls: existing controllers remain responsible. Keep labels/widths stable while loading; do not remount unsaved forms for theme changes. Primary action animation is absent in light mode. Light mode also removes repeated-logo surfaces/veil and pauses decorative header branding; product JS handles animation-loop lifecycle.

## Evidence and remaining release gates

The first slice passed 65 focused checks across modern-select semantics, navigation stability/controller behaviour and theme-control contrast. The contrast test now loads this stylesheet, retains instant surface/label switching checks, and tests palette ratios for text and control edges. It caught the proposed light muted colour below 4.5:1 on a tinted panel; the corrected value is `#586a82`.

These checks are not screenshots or full page acceptance. Main owns final integrated before/after visual review and QA5 owns the combined browser, device, lag and no-lost-functionality matrix. Check both real staff panels and public/member routes after final wiring. The empty chart example is not delivered analytics; real measures require authorised source, scope, period and missing/stale states.

A bounded local browser check rendered the reference in both themes, parsed both stylesheets, and found no horizontal overflow at the checked desktop size. Switching themes retained the sample field value. This is reference-only evidence, not the release browser/device matrix. The follow-up contrast check also covers hover/selection surfaces, success/warning text and gradient stops read from the actual CSS token.
