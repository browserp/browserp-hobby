# Discovery review — phased implementation

The owner approved a phased build of the 26-point product review on 6 September 2026, keeping the existing service free and within 12 functions. This release is phase 1, not completion of the entire review.

## Phase 1: discovery and shortlisting

- `/find-server`: four focused choices (game, region, joining option, one feature) map to existing public directory filters. Regions and features come from actual listing facets. No fabricated compatibility percentage, unsupported multi-feature filter, or personal-history collection.
- `/compare`: up to three public communities compared side by side. Public slugs/names persist locally; a public-slug URL is shareable. Missing, stale and future-dated live observations remain unknown. Roblox and network counts retain their distinct meaning. A contained horizontal table handles narrow screens.
- Directory, home, game cards and server details now expose Compare and account-backed Save. Controls are siblings, not buttons inside a card link. Server-rendered cards without public IDs cannot save until hydrated.
- The existing favourites endpoint is reused. Saves have fresh session/CSRF checks and an optional, compatible server-side account binding. Duplicate clicks are blocked. Failed/uncertain toggle results are not retried automatically; account changes and page teardown clear private local state.
- Menu and directory entry points added; existing navigation, ads, provider login, security and design retained. Privacy/cookie descriptions now explain the explicit comparison shortlist.
- No new dependency, service, paid plan, database migration, function, tracking or payment activation.

## Verification

Node 24.19.0: 866 application tests and 35 database tests passed. New coverage: 14 shortlist UI tests, 7 comparison tests, 6 finder tests and 5 account-binding tests. Full syntax/function gate passed, retaining 11 API functions plus one Node middleware.

The browser-verification skill was applied using isolated Chrome/Playwright because agent-browser is unavailable in this installation. `test/manual-discovery-phase.mjs` verifies synthetic save/unsave, three-server limit, comparison removal/clear, the complete finder GET navigation and detail controls at 320, 390, 768, 1440 and 2503 pixels. Touch and reduced-motion contexts included. No horizontal page overflow or page errors. This is local-fixture authentication coverage, not a new live Google/Discord login rehearsal. Existing site theme remains dark-only; no light-mode claim is made.

Live preflight read confirmed the existing directory response has public listing IDs and region/feature facets. Production authentication/data writes are not used as test fixtures.

## Next phases (not shipped by phase 1)

2. Better listing decisions: explicit joining steps, verified owner-controlled content, gallery/media, related communities and clear freshness. Preserve authentic assets and avoid inventing joining requirements.
3. Return visits and owner tools: structured moderated reviews, genuine owner updates and notifications, meaningful analytics. Account permissions and abuse controls must be tested with the existing endpoints.
4. Evidence-backed discovery: measured activity history, trending/rising, explainable recommendations and editorial featured servers. Audit data availability first; current default engagement values are not proof of rising popularity. Do not generate synthetic ratings, activity graphs or match percentages.
5. Consider monetisation only after payment/fulfilment safety is verified and the owner separately approves any paid service. Payments remain disabled for this release.

All later phases must keep the 12-function boundary, use existing grouped routes where appropriate, remain within the free-service constraint and verify actual data before making product claims.

## Deployment

Pending verified preview and production publication. Record exact source SHA and deployment IDs below after release; do not deploy just documentation updates.
