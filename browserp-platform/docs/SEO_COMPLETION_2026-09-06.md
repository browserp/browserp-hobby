# Launch SEO completion — 6 September 2026

## Brand-discovery follow-up — 7 September 2026

A read-only production audit identified live source `dcc800d6be1c3b137d56ec816c2a4dc62fe2cdee` through `/api/health`. The canonical homepage and Games page returned 200 with consistent BrowseRP identity. Apex and `/index.html` returned 308 to the canonical homepage. The favicon and original organization mark returned public PNG responses at 192×192 and 1254×1254. Robots permits the homepage; the sitemap returned 77 canonical URLs including home, with no private routes in the checked inventory. Raw HTML contains the game links. This supersedes older production handles in historical records; it does not establish Google's selected canonical or current ranking.

The small source patch adds **`alternateName: ["Browse RP", "browserp.com"]`** to the existing homepage WebSite and Organization nodes and the matching shared identities in generated directory, game, community and article HTML. **BrowseRP remains the primary name.** Titles, descriptions, content, layout, image URLs, canonical URLs, crawl policy and navigation remain unchanged. RPBrowse is not declared a brand, and no keyword-variant pages or repeated title phrases are introduced. No unverified external profile is added as `sameAs`.

Google permits genuine alternative site names and a lowercase domain fallback. These properties express naming preferences, not a promise of first place for any query. Google also recommends using the same name/alternate names for the Organization identity. References: [site-name guidance](https://developers.google.com/search/docs/appearance/site-names), [Organization identity](https://developers.google.com/search/docs/appearance/structured-data/organization), [title guidance](https://developers.google.com/search/docs/appearance/title-link).

The root task's current Search Console Overview showed **2 indexed / 3 not indexed / 0 clicks**. Its reporting dates and homepage URL Inspection are still being investigated; these overview counts are not treated as a current complete sitemap inventory or a diagnosis of a code failure. The already accepted sitemap should not be repeatedly resubmitted.

Validation for this patch parses the single homepage identity and compares it with generated Games, directory, game, community, blog index and article identities. All **25 focused metadata/public-page tests passed** with one Node 24 worker, covering the existing canonical, preview, content and privacy boundaries. The homepage was also verified byte-identical outside its JSON-LD block; the diff check passed. After publication, inspect the exact homepage HTML and use Search Console URL Inspection for Google's access and canonical evidence. **Rich Results Test does not support site-name markup**; use a schema parser/validator for that markup. Allow recrawl and processing time. This paragraph records local source work; publication of the alternate names still needs the exact release readback.

## Live Google markup checks — 6 September, 21:46–21:49 BST

Google's public Rich Results Test fetched the real production pages successfully using its smartphone inspection agent:

- `/blog/how-to-choose-a-fivem-roleplay-server`: **2 valid items**, comprising one Article and one Breadcrumb list. The Article has two **optional**, non-critical omissions: `image` and `author`. No author or article image was invented to silence these warnings. Result: `https://search.google.com/test/rich-results/result?id=MPIErfvaSmNsgqKX8fboQA`.
- `/games/fivem`: **1 valid Breadcrumb item**, with no warning shown in the summary. Result: `https://search.google.com/test/rich-results/result?id=0JuUYN0y6u7pesx1_sFIaw`.

These checks complete the planned live game/article rich-result validation. They establish successful crawl and valid supported markup, not indexing or ranking guarantees. Search Console's selected-canonical/indexing observations remain separate. No repeated sitemap submission or DNS change was made.

## Current production checkpoint

The accepted visual/SEO release is `9c1826e1e3f9fa7c58296e5c672ca421fa1db27b`, tree `14f3095f34d943f8530dcc3bd1ba8c75cf1dbe9f`, READY at https://www.browserp.com through `dpl_9SVwhj1szJRAkvTmJ41W8W3a8m7d`. Its isolated Node 24 gate passed **938 tests**, 217 JavaScript checks and the 12-function deployment limit. All **18 bounded production checks** passed after promotion, including the exact release SHA, changed asset bytes, canonical redirect, real directory/article content and anonymous staff non-disclosure. Historical source and preview records below describe earlier checkpoints; they do not mean this accepted release is still awaiting publication. The disabled Discord role-sync foundation is separate development work and is not included in this production SHA.

This reconciles the earlier [SEO launch plan](SEO_LAUNCH_PLAN.md) against base commit `dfbb66e`, the final SEO changes integrated as `13ff5ce`, and the homepage changes integrated as `d4c4f5a` in `release/seo-community-home-20260906`. The integrated source passed full verification at `5465e3f868fc5007035f9f867d6b4ae2da4fb023`. This document records source and provider verification separately from deployment evidence. The follow-up used the existing Bing DNS verification record without changing DNS, and no search submission was repeated.

## Completed foundation and final corrections

| Plan item | Reconciled status |
| --- | --- |
| Initial HTML for directory, game, community and published article pages | Already implemented. Actual headings, descriptions, public content and crawlable community links arrive before JavaScript. Existing public-data projections, nonce/no-store policy, interactions and exact listing descriptions are preserved. |
| Dynamic sitemap from eligible published records | Already implemented, including listing pagination and failure/duplicate guards. An unauthenticated production GET on 6 September returned 63 individual community URLs. Private forms, future categories and arbitrary filters are excluded. No fabricated last-modified dates were added: existing published data does not provide a reliable content-modification timestamp. |
| Correct 404 and 503 responses | Unknown/unpublished items and unknown games already return 404; unavailable data returns 503 with Retry-After. This final change also returns 404 for directory continuation offsets beyond the result set. Before this fix, the live `/servers?offset=999999` returned indexable HTTP 200 with a page-41667 title. |
| Canonical and filter policy | Valid continuation pages retain individual canonical URLs and real previous/next links. Tracking parameters are removed. Distinct search/filter/sort results now have their normalized own canonical and noindex instead of claiming equivalence with an unfiltered page. Arbitrary offsets between standard pages are noindex. Game-page continuation links no longer repeat their platform query. Legacy game links retain useful filters and offsets. |
| Form/preview exclusion | Compare was already noindex. The finder form now has noindex,follow and remains outside the sitemap. Preview-rendered public documents and the sitemap explicitly send noindex headers; preview HTML also has matching noindex metadata. The exact deployed preview still needs its release check, including static pages under the platform's preview headers. |
| Page-specific social identity | Live game pages now use the existing game artwork with checked local dimensions: FiveM/RedM 460×215, Minecraft 1170×500, Roblox 1200×675. Community pages prefer their existing approved public banner, then logo, then RP mark. Open Graph and Twitter metadata agree and have descriptive image alternatives. Private storage objects and crawl-blocked API image paths cannot become share-image URLs. Unknown community-image dimensions are omitted. The current public article model has no editorial-image field; articles keep the RP fallback and their specific title/excerpt. |
| Structured data | Public collection and community pages now describe their real navigation through BreadcrumbList, share the existing BrowseRP WebSite/Organization identity and identify community artwork. Genuine posts use BlogPosting and their published date. No private author ID, invented byline, invented update date, review, rating or count is introduced. The homepage publisher identity is integrated and checked against its canonical URL and declared social image. |
| Safe editorial links | Already implemented by the shared publishing renderer. No new editor or generic launch articles were introduced. |
| Paid-placement links | Reviewed advertisement links now carry sponsored, including internal listing campaigns; external links retain noopener and noreferrer. Built-in BrowseRP house links remain ordinary links. |
| Search account setup and sitemap submission | Verified complete on 6 September: Google Search Console reports Success, 77 pages and 0 videos; Bing reports Success, 77 pages, 0 errors and 0 warnings. Bing's existing sitemap row reappeared after verifying the canonical property with the existing CNAME. No DNS changes or sitemap resubmissions. See [the updated provider record](SEARCH_AND_BRANDING_SUBMISSIONS_2026-09-06.md). |
| Google branding approval | Verified complete: Google Auth Platform explicitly states that BrowseRP branding has been verified and is being shown to users. The correct app name and canonical homepage/privacy/terms remain saved. This is branding evidence, not login-flow testing. |

## Evidence and release handoff

The bundled Node **24.19.0** completed the full integrated `npm run verify` at commit `5465e3f868fc5007035f9f867d6b4ae2da4fb023`: **886 main tests + 35 database tests = 921 passed, 0 failed, 0 skipped**. Static/deployment checks also passed with **11 API functions + 1 middleware = 12 total**. Log: `/tmp/browserp-integrated-verify-final-20260906.log`.

The integrated gate includes the earlier 36 focused SEO/advert/branding/document-policy checks and the final finder/compare exclusion assertion. It covers public/private field boundaries, injection escaping, 404/503, canonical/filter/continuation behavior, legacy redirects, image metadata and fallback, structured data, preview exclusion, advert qualification, retained article/server content during API failures, brand identity and document security. The only assertion repaired during integration was an old homepage identity equality check; its replacement verifies canonical website/publisher IDs and URLs and consistency with the declared logo. No new serverless entrypoint or dependency was introduced.

Read-only unauthenticated production checks confirmed the canonical homepage, FiveM hub and dynamic sitemap return 200. The Rift Trails and We The People RP listing HTML contains public stored community logos but still had the old generic share image before this branch is released. That supports using existing approved media without adding image fetches to page rendering.

The required full integrated gate is complete. Release checks must verify the exact preview and publication through the existing release path. Check the released raw HTML for `/games/fivem`, `/server/the-rift-trails-d9eyr3`, `/servers?offset=24`, a filtered URL, the invalid offset above, `/find-server` and `/sitemap.xml`. Confirm page-specific share images return successful public image responses. Existing Chromium/Firefox/WebKit and mobile/reduced-motion release checks should cover the final integrated build; this metadata work does not establish physical-device performance evidence.

## Verified provider outcomes and remaining search evidence

The **browserp.com Google Search Console domain property** shows the canonical sitemap as **Success** dated **6 September**, with **77 pages and 0 videos**. Its performance and indexing reports are still processing; these have not been represented as complete or as proof that every discovered page is indexed.

In **Bing Webmaster Tools**, the current account initially showed no sites. Added the canonical property and verified the existing CNAME `e579f893ef6a575b709265b665688016.browserp.com` → `verify.bing.com` without DNS changes. The **existing** sitemap row then reappeared with **Success, 77 pages, 0 errors, 0 warnings**, last crawled **6 September**. The sitemap was **not resubmitted**.

**Google Auth Platform → Verification Center**, project `project-1e3b451d-6f1c-4d0f-83e`, explicitly states **“Your branding has been verified and is being shown to users.”** The app name is BrowseRP and the homepage/privacy/terms addresses are correct. Branding approval is complete. Real-account consent/linking tests and recovery rehearsal were explicitly removed from this launch scope and were not performed by this verification.

Remaining search evidence after publication:

1. Use Google URL Inspection / Test live URL for the canonical homepage, the FiveM game page, a real community listing and `/servers?offset=24`; record access, indexing permission and the selected canonical when available. Request homepage indexing only if still needed, without repeatedly submitting every URL. Allow the existing performance and indexing reports to finish processing.
2. The planned game/article Rich Results Test is complete; the real results and optional omissions are recorded above. Additional community-page inspection can accompany the remaining Search Console work when useful, without inventing content or promising special results.

Search rankings, crawl timing and sufficient field-performance data remain external outcomes. Successful sitemap processing and branding approval do not guarantee ranking. The old plan's ongoing analytics, editorial programme and future landing-page ideas are post-launch options driven by real evidence; they are not a new open-ended launch implementation requirement.

## Preview build correction and exact release evidence

The first release preview at GitHub commit `04f635a01cad1007096b8b628b47b19358a82798` exposed a test-environment leak: production metadata assertions inherited `VERCEL_ENV=preview`. Local commit `f32cbf15df1ed11d7920b13c8fdbb0259d4cfbac` isolates the production test baseline, restores the inherited environment after each test and expands the explicit preview case. Product indexing rules were not weakened.

Both full Node 24 verification runs passed: **888 main tests + 35 database tests = 923 passed, 0 failed, 0 skipped**, once with `VERCEL_ENV=preview` and once with `VERCEL_ENV=production`. Both deployment gates retained **12 functions**. Logs: `/tmp/browserp-verify-preview-isolation-20260906.log` and `/tmp/browserp-verify-production-isolation-20260906.log`.

The release branch was updated without force to GitHub commit `543b04ddbeb006d5f9ec3d6a771e0daeb44ae040`. A fresh fetch confirmed its tree exactly matched the committed local tree `9a5277a6bda118cb4747262a7b3756214b5a045c`. Vercel deployment `dpl_FnaT3tSSDuytTrrhVFaK6rrorVub` reached **READY** for that exact SHA at [the preview URL](https://browserp-hobby-pbcsskoy0-browserp.vercel.app). No production promotion was performed by this verification.

Read-only requests for the exact preview homepage, FiveM hub, filtered directory, sitemap and invalid continuation were intercepted by Vercel Authentication. The connected Vercel fetch also returned an SSO redirect with the platform's noindex header. These responses establish access protection, not the application's rendered metadata or status. The root task's existing authenticated preview browser remains the route for that smoke check; no provider login rehearsal was performed.

## Google search-logo transparency investigation

The reported nontransparent Google Search logo was checked against the actual local pixels and current public files on 6 September. The following live responses returned **200**, their correct image content types, no `X-Robots-Tag` restriction, and bytes identical to the repository assets. The live `robots.txt` also matches the repository and does not block these image paths.

| Current public asset | Verified image evidence |
| --- | --- |
| `/favicon.png` | 192×192 RGBA; all four corner pixels have alpha 0; 68.19% of pixels fully transparent. Identical to the existing `assets/browserp-icon-192.png`. SHA-256 `66008d3afd686d9b2d46f94f5a6f3e7c130878a2e0faf92b748db497470d67f9`. |
| `/favicon.ico?v=2.12.1` | Both 32×32 and 48×48 frames have real alpha transparency and four fully transparent corners. |
| `/browserp-mark-v3.png` | 1254×1254 RGBA RP mark; all four corners have alpha 0; 67.49% of pixels fully transparent. This is the declared Organization logo in the release and the existing social image. |
| `/apple-touch-icon.png?v=2.12.1` | 180×180 opaque RGB home-screen icon with background `#06070b`, as deliberately required by the existing branding tests. It is a separate asset from the transparent favicon. |

The live homepage declares both favicon alternatives and the Apple icon. At this check, its WebSite structured data still lacked the new publisher identity; that identity is present in the READY release. No defect was found in the transparency of the favicon or RP mark, so no branding asset was replaced, generated or edited.

[Google's favicon guidance](https://developers.google.com/search/docs/appearance/favicon-in-search) identifies the small organic-result icon separately from an Organization logo, supports `icon` and `apple-touch-icon` declarations, recommends a stable crawlable square asset, and says processing can take days to weeks.

The user's subsequent screenshot shows BrowseRP's favicon beside its site name on a white circular badge with a grey edge. The BritishRP result immediately below has the same badge treatment. Together with the verified transparent favicon files, this strongly indicates Google's presentation rather than an opaque source-image defect. The screenshot does not expose the exact cached image or page DOM, so that attribution remains an evidence-based inference. The separate Apple icon is dark and does not contain this white disk. [Google's visual-elements guide](https://developers.google.com/search/docs/appearance/visual-elements-gallery) confirms that this is the favicon attribution element and that result presentation can vary.

Google's documented favicon controls do not offer a setting for removing that surrounding badge. A dark-filled replacement might change the image interior but would lose the requested transparency elsewhere and could retain Google's outer rim or padding. Retain the original transparent RP artwork; no asset change was justified or made after reviewing the screenshot.

[Google's Organization guidance](https://developers.google.com/search/docs/appearance/structured-data/organization) describes a separate logo signal and requires a crawlable image at least 112×112 that looks appropriate on white. The existing transparent RP mark satisfies those image-size and access checks. Keep the verified assets and stable favicon URL. After release, the already-planned canonical-homepage URL Inspection can request a recrawl if needed; neither a code change nor a recrawl guarantees Google's chosen display or its timing.

## Current primary guidance consulted

- [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap): canonical public URLs and reliable modification dates.
- [Google pagination guidance](https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading): real continuation links, distinct page canonicals and filtered/sorted result exclusion.
- [Google breadcrumb guidance](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb) and [article guidance](https://developers.google.com/search/docs/appearance/structured-data/article): accurate page identity and relevant validation.
- [Google structured-data rules](https://developers.google.com/search/docs/appearance/structured-data/sd-policies): markup must reflect actual public content.
- [Google outbound-link guidance](https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links): sponsored qualification for advertisement links.
- [Bing robots metadata documentation](https://www.bing.com/webmasters/help/robots-meta-tags-and-attributes-that-bing-supports-5198d240): indexing directives; actual sitemap processing is checked in the existing account.
