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

The staff area uses the same maintained Menu implementation across Overview, Moderation and Scrapers. The CSS adapter and this reference do not themselves prove component reuse. Keep a single controller/source for repeated product components; do not copy example markup to replace working menus or tabs. Real enhanced dropdown behaviour remains in the existing modern-select controller; the reference's select is deliberately native.

## Values and states

Public control height is 48px; staff `.staff-v3`, `[data-staff-page]` or `.ds-density-compact` uses 44px. Control/card/panel radii are 12/16/20px. The body font remains Inter with system fallbacks. Both themes independently define raised/inset surfaces, borders, shadows and readable semantic colours.

Dark uses neutral black/charcoal surfaces; light uses neutral white/grey surfaces. Magenta, cyan and purple are accents, not the base palette. Use `--brand-gradient` for accent artwork and `--brand-action-gradient` for primary actions with white labels. Use `--text`, `--copy`, `--muted` for hierarchy; `--success`, `--warning`, `--danger`, `--info` for semantic feedback, accompanied by words or a state marker. Chart aliases are `--chart-grid`, `--chart-axis`, `--chart-series`. Current values always come from `public/design-system.css`.

Ordinary buttons have a quiet neutral face and no raised shadow. Selected controls use a purple underline and readable selection surface. Field boundaries remain visible. Containers are optional composition tools: use open sections and dividers where the grouping is already clear rather than wrapping every heading or record in a panel.

Native `disabled`, `aria-disabled`, `aria-busy`, `aria-invalid`, `aria-pressed`, `aria-selected` and `aria-current` expose existing state. CSS does not suppress activation of aria-disabled controls: existing controllers remain responsible. Keep labels/widths stable while loading; do not remount unsaved forms for theme changes. Primary action animation is absent in light mode. Light mode also removes repeated-logo surfaces/veil and pauses decorative header branding; product JS handles animation-loop lifecycle.

## Evidence and remaining release gates

The initial foundations slice passed 65 focused checks across modern-select semantics, navigation stability/controller behaviour and theme-control contrast. The palette and composition were subsequently revised after visual feedback; those historical passes do not verify every current value. Final contrast checks must load the current stylesheet and test text, field edges, selection, hover and primary gradient against the actual surfaces.

These checks are not screenshots or full page acceptance. Main owns final integrated before/after visual review and QA5 owns the combined browser, device, lag and no-lost-functionality matrix. Check the staff area's sections and public/member routes after final wiring. The empty chart example is not delivered analytics; real measures require authorised source, scope, period and missing/stale states. The complete working brief is `deliverables/DESIGN_AND_PRESERVATION_PLAN_20260914.md` at the repository root.

A bounded local browser check rendered the reference in both themes, parsed both stylesheets, and found no horizontal overflow at the checked desktop size. Switching themes retained the sample field value. This is reference-only evidence, not the release browser/device matrix. The follow-up contrast check also covers hover/selection surfaces, success/warning text and gradient stops read from the actual CSS token.
