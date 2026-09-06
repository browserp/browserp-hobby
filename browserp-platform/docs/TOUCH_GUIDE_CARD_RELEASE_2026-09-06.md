# BrowseRP 2.18 — consistent cards, touch feedback and useful guide links

Source base e4e923987266c5ffd44c0cb4de77cfc611936d8e; branch launch/complete-inherited-work. No migration or provider configuration change.

Shared cancellable touch colour feedback now loads independently on public and staff pages. Existing desktop effects and Menu/Close positions remain intact. Directory/game cards show the published logo, then banner fallback, then initials; retain the first three existing features; and use Community listing for application-only Roblox entries. Metadata stays platform, region, language, framework, access. Initial HTML reflects the same card cues without pretending to have measured live status.

Labelled HTTPS and same-site article links render consistently in staff preview, initial HTML and public enhancement. HTML, image markup, code and rejected destinations remain readable literal text. No current article has been edited automatically. One homepage WebSite identity declares BrowseRP and its actual canonical URL; no ranking guarantee or invented alternative brand.

Verification: all 813 repository tests passed (778 application plus 35 additional database), no failures/skips; syntax187 files and function-count gate passed. Two initial tests hardcoded the helper's development v=1 URL; after versioning assets to2.18 they correctly failed, and now verify a versioned single include and load order without hardcoding a release number. Full gate rerun passed. Independent link/SSR security review found no blocking/high/medium finding. Focused agent tests:29 touch/card and28 guide/SSR; isolated native Chromium390 public/staff touch fixture2/2 passed. Hosted final preview/production and additional-engine touch checks follow before release. Physical devices, external-link reputation and provider approval are not established by these tests.

## Exact preview verification

Reviewed source445a85218f23b697e12bfaceb5e681f7172e0df9, previewdpl_3VoFXb7cbDvSKKE3aq7JriMbBNAX at https://browserp-hobby-8wnpxtzr4-browserp.vercel.app . All29 checks passed: five exact source-asset hashes plus24 public/staff-gate pages across Chromium, Firefox and WebKit at390/1280. Includes same-point Menu/Close, actual Cali results on Discover and FiveM, logo/three-feature/metadata parity, readable initial/enhanced article, same-site identity, images, no overflow or application errors. Six additional controlled public/staff touch scenarios passed all three engines; real native taps plus controlled cancellation, disabled controls and reduced-motion checks. No live records were submitted.

The first preview attempt reported an unloaded Firefox image. The isolated diagnostic reproduced an immediate decode EncodingError for a newly visible lazy image with no selected currentSrc; the same attached image then loadedHTTP200 and decoded96x96 without request failures. The harness now waits for actual visible-image completion within8s and still rejects missing/broken/undecodable images. Complete corrected preview rerun passed. No application or source change was required. The original observation and diagnostic are retained alongside the passing evidence.

Production promotion requested for this exact source; do not infer success until source/aliases and live browser checks are recorded below.

## Published and checked — 2026-09-06T03:13:37.576932+00:00

Productiondpl_6jemV4Ha1NZeVqXqxhVhEZu54dsu is READY with www.browserp.com and browserp.com aliases, exact source445a85218f23b697e12bfaceb5e681f7172e0df9, URL https://browserp-hobby-ehf3u1zpo-browserp.vercel.app . All29 production checks passed using the same corrected matrix; no application errors, broken visible images or overflow. The actual existing signed-in staff session reloaded Overview and returned its authorised empty enquiry queue, with exactly one2.18 touch module. Initial heading readiness alone was not treated as proof of the asynchronous private queue response.

All813 full repository tests,29 preview checks,29 production checks and6 three-engine touch scenarios passed. These are emulated viewports on native browser engines, not physical-device tests. Main is unchanged. All owned native test contexts and browsers closed. No migration, new paid service, live trial enquiry, claim or avatar submission was needed for2.18.
