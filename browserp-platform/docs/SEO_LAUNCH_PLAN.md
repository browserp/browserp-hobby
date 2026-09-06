# BrowseRP: free search growth plan for launch

Prepared 6 September 2026. This is a plan for review, not a claim that these changes are already live.

**Implementation reconciliation, later 6 September:** the initial audit below is historical. Server-rendered public pages, the complete published sitemap, real missing-page responses and safe article links are already implemented. Google and Bing sitemap submissions were accepted. The remaining launch metadata, page-address and advert-link fixes are recorded in [SEO completion](SEO_COMPLETION_2026-09-06.md); that record separates source completion, release checks and external search/branding outcomes. Do not reopen the historical gaps without checking current code and production.

BrowseRP should become the place where someone finds a roleplay community that actually suits them, then returns when they want another world. Search should bring in those players and the owners of good communities. The strongest foundation is the research already being done: reliable English-speaking listings, clear joining requirements, useful differences between communities, and a website that feels good to use.

My recommendation is to fix how the existing public pages reach search engines first, then improve the information those pages offer. Preserve BrowseRP’s pink/violet identity, RP logo, game colours, photographs, responsive layouts and distinctive interactions. This work does not call for a visual redesign, keyword-stuffed headings or extra controls in the staff panel.

## What I checked, and what I have not claimed

The code audit used commit `81c3cfd` in a separate worktree, `/tmp/browserp-free-seo`, branch `launch/free-seo-foundation`. No SEO source files have been changed. The concurrent Roblox release and other launch work must be integrated before implementation is finalised.

Light public HTTP checks against `https://www.browserp.com` confirmed the main findings below. These inspected the original HTML response without running JavaScript. They did not access private accounts, mutate the database, simulate Googlebot, or establish what Google has already indexed. No browser, database or full test suite was run for this audit while the Mac was handling the main release tests. Search Console access, actual search volumes, ranking positions, conversion rates and real-user performance remain unverified.

## The real gaps worth fixing

| Priority | Current evidence | Why it matters | Concrete fix |
| --- | --- | --- | --- |
| First | `/games/fivem` returns the generic title “Roleplay games — BrowseRP”, the hub heading, no canonical address and no server links in its first HTML response. `public/game.html:8` and `public/browserp-games.js:79` show that the specific content is filled in later. | A player wants FiveM results; search and link previews first receive a generic games page. | Send the actual game title, introduction and public listing links in the initial page response. Keep the existing interface and enhance it with JavaScript afterwards. |
| First | `/server/prodigyrp-allowlist-4-0-rmablpx` initially returns “Loading server…” and generic metadata with no canonical. `public/server.html:8` and `public/browserp-v3.js:564` show the same pattern. | Individual listings are BrowseRP’s most useful search destinations, but their identity and substance arrive late. | Include each published community’s name, description, game, joining requirements, safe public links and representative image in the first response. |
| First | The public sitemap contains 15 URLs and **zero individual server listings**. It includes `/list-server`, although that page explicitly says `noindex`. See `public/sitemap.xml:3` and `public/list-server.html:5`. | New communities are difficult to discover automatically, and the sitemap contradicts the form’s indexing instruction. | Generate the sitemap from the current published catalogue and published articles; exclude forms, drafts, holds, duplicates and removed items. |
| First | `/server/browserp-seo-not-a-real-listing-20260906` returns HTTP 200 and `index,follow`. An unknown game URL also returns 200. Server failure is currently rendered only after JavaScript, `public/browserp-v3.js:630`. | A missing listing appears to be a successful page to crawlers and sharing services. | Return a real 404 for unknown/unpublished listings and unknown games. Keep a helpful BrowseRP error page; distinguish an outage from a missing item. |
| First | `public/robots.txt:7` blocks all `/api/`, while listing and article content depends on `/api/servers` and `/api/public/blogs`. | A crawler obeying this block cannot fetch those data resources to complete the page. This is a dependency conflict, not proof that every page is absent from Google. | Remove the dependency for essential public content through the initial HTML response. Keep private APIs protected; do not open the whole API to crawlers. |
| Next | Blog articles initially return a generic title and loading text. `public/blog.js:58` updates title/description/canonical later, but leaves generic social metadata. | An original useful guide may be poorly described when shared or crawled. | Render published article content and article-specific metadata on the server, using the existing safe publishing rules. |
| Next | `/servers?q=cali` correctly has the directory canonical, but game pages have no canonical; `/game?game=fivem` is another 200 URL. | The same material is available under several addresses; unlimited filters can create many low-value combinations. | Define one public address per real page and a deliberate policy for filters, search, pagination and old aliases. |
| Next | Search lists default to 24 entries and “Show more servers” is a JavaScript button (`public/discovery-model.js:4`, `public/smart-search.js:119`). | A crawler does not click buttons to uncover the rest of a directory. The 40 FiveM launch target makes this concrete. | Give further result pages real crawlable links while preserving the present load-more interaction for people. Include all approved listings in the sitemap too. |
| Next | The article renderer creates headings, paragraphs and lists but no links (`public/publishing-content.js:12`). | Staff cannot yet create a natural, clickable route from a guide to a relevant listing or an official source. | Support a small, safe link format in the current editor/renderer, with tested URL restrictions. Do not introduce a large editor just for SEO. |
| Before paid campaigns | Advert links currently set only `noopener noreferrer` (`public/browserp-v3.js:349`). | A paid link should be identified as sponsored to search engines as well as visibly labelled to people. | Add `sponsored` to actual paid placement links, retaining the existing security attributes and visible labels. House links do not need to pretend to be paid. |

Several foundations are already good: the brand name and RP icon are consistent in page metadata; the home, directory, blog index and main information pages have canonical addresses; public cards use genuine links once rendered; profile and staff pages have noindex instructions and account protection; the homepage links directly to all four game hubs. Live GET checks also confirmed that the non-www HTTPS homepage redirects to www, and `/servers.html` redirects to `/servers`. Keep these behaviours.

Some generic HEAD requests were rejected with 403 while the corresponding identified read-only GET requests worked. That is a reason to check the real Search Console crawler fetch, not a reason to weaken the firewall or declare Google blocked.

## Which searches should lead where

These are audience-led starting hypotheses, not purchased keyword volumes or claims about current ranking. Validate and refine them with Search Console and Bing data once ownership is connected. One strong page can answer several natural variations of a question.

| Person and intention | Example searches | Best destination and useful answer |
| --- | --- | --- |
| Player choosing a game/community | “roleplay servers”, “RP communities”, “BrowseRP” | Homepage and Games hub: explain the cross-game purpose and take them directly to a suitable game. |
| FiveM player looking for a match | “FiveM roleplay servers”, “public FiveM servers”, “whitelisted FiveM RP”, “vMenu roleplay”, “serious RP with custom cars” | `/games/fivem`: real researched listings, relevant filters and joining requirements. A short explanation should make the differences understandable without replacing the directory with an essay. |
| RedM player seeking a particular style | “RedM roleplay servers”, “western RP”, “RedM ranching roleplay”, “whitelisted RedM” | `/games/redm`: meaningful variety, onboarding, frontier/law/outlaw/ranching themes where verified, and English-speaking regional activity. |
| Minecraft player seeking actual roleplay | “Minecraft roleplay servers”, “Minecraft fantasy roleplay”, “Minecraft Java roleplay application” | `/games/minecraft`: the three strongest suitable communities, edition/version/address and character/application requirements. Do not present an ordinary busy minigame network as a dedicated RP world. |
| Roblox player or organiser | “Roblox roleplay communities”, “Roblox RP community application”, “list Roblox roleplay community” | `/games/roblox`: clearly distinguish an independent community from a creator’s experience. Explain that applying to be listed on BrowseRP is different from a player applying to join a whitelisted community. |
| Player researching a named server | “CaliRP how to join”, “SACRP roleplay”, “[community name] rules/Discord/whitelist” | Its existing `/server/<slug>` page: verified identity, joining route, public links, access rules and useful context. Never imply BrowseRP is the official server operator. |
| First-time roleplayer | “how to join FiveM RP”, “public vs whitelisted roleplay”, “how to start RedM roleplay” | A small number of practical, reviewed guides linked to real examples and official setup instructions. |
| Community owner | “list my FiveM server”, “claim roleplay server listing”, “promote my RP community” | A useful public explanation of listing/claiming, with a clear path into the secure form. The current private/correction form remains out of search. Advertising copy must continue to say bookings are not open until they really are. |

The roster goal remains **40 FiveM, 20 RedM and 3 Minecraft communities**, with Roblox handled through reviewed applications. Those are launch targets, not a claim that they are all currently approved or equally good. Only publish and promote candidates that pass the existing quality audit. Use representative activity around the requested 35-player threshold, allowing documented region/time/history context, alongside rules, moderation, onboarding and credible player evidence. No invented “friendliest”, “best”, rating or growth guarantees.

## Launch work, in the order I recommend

### 1. Give crawlers the same useful public page that players receive

**How:** Add a small public page renderer using the existing approved public data and the current templates. Render game hubs, server detail pages and published articles before sending them to the browser. Include the main directory’s initial results and crawlable continuation links. Keep search, live counts, menus, voting and account functions as their existing interactive layers. A visitor should see content sooner and retain all current controls.

**Why this is first:** This fixes several observed problems together: generic initial titles, missing listing content, fragile discovery and inaccurate missing-page responses. It also helps social services that do not execute the site’s scripts. Google can process JavaScript, but essential content and rendering resources must be available; relying on a crawl-blocked API is avoidable. [Google’s JavaScript guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)

**Keep it safe and fast:** Read only explicitly public, published fields. Do not call a live scraper for every page view or bot visit. Keep current source timestamps and unavailable states truthful; refresh counts separately. Public rendering must never include reviewer notes, applications, owner emails, session details or private Roblox evidence. Preserve the current content-security policy and Cloudflare nonce/no-store design. Cache public data carefully inside that boundary; do not simply turn shared document caching back on. On data failure, return a temporary error rather than a fake empty published page or demo content. On a removed or unknown item, return a helpful 404. If a real slug changes, preserve an explicit redirect to its replacement rather than redirecting every missing page to the homepage.

**Done means:** Raw HTML contains the correct title, description, principal heading and published content; ordinary users and crawlers receive the same substance. Unknown/held/draft fixtures return the right status without leaking data. Browser behaviour, mobile layout and live status still pass their existing checks.

### 2. Keep the public map and page addresses accurate automatically

**How:** Use `https://www.browserp.com` consistently. Generate `/sitemap.xml` from published listing and article records plus deliberate public pages. Include only canonical, indexable, successful destinations. Use genuine content modification dates when available; a player-count refresh must not pretend an article or listing was rewritten. Remove holds/archived pages promptly. Use safe XML escaping, bounded queries and explicit failure handling; never replace a failed inventory with an apparently successful empty map.

**Why:** Google and Bing both use sitemaps as discovery signals. They do not guarantee indexing, but this closes BrowseRP’s current zero-listing sitemap gap. [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [Bing sitemap guidance](https://www2.bing.com/webmasters/help/sitemaps-3b5cf6ed)

**Address policy:**

| Address type | Launch treatment |
| --- | --- |
| Home, Games hub, four substantive game pages, approved listings, published guides, About and appropriate public information pages | Indexable, one self-canonical, included in sitemap where useful. |
| `?utm_...` and pure sorting duplicates | Canonical to the underlying page; do not create extra sitemap entries. |
| An exact old game/detail alias, such as `/game?game=fivem` | Permanent redirect to the real page when semantically equivalent and compatible with existing routing. Preserve intended useful filters; do not throw users into a different result set. |
| Arbitrary searches and combinations of filters | Working shareable URLs for users, excluded from sitemap; deliberate noindex for true internal search/low-value combinations. Use canonical for actual duplicates, not as a claim that different content is identical. Avoid automatically publishing every possible region/style combination as an SEO page. |
| Genuine directory continuation pages | Crawlable links and their own appropriate page identity. Do not canonicalise every result page to page one and lose the remainder. |
| Staff, profile, dashboard, login/callback, appeals, applications and submission corrections | Access-controlled where required, noindex, excluded from sitemap. SEO never substitutes for permission checks. |
| Future games with only “Coming soon”, empty placeholders and draft content | Noindex until they provide a real useful page; keep the existing collapsed coming-soon design. |
| Preview deployments | Noindex and excluded from search submissions; verify this on the exact preview before release. |

Keep the useful public filters and their density. At launch scale, clean routes and index controls are sufficient; if crawl logs later show wasted traffic, add narrow facet crawl limits. A robots block cannot communicate a noindex tag if it prevents the crawler reading that page. Do not blanket-block query strings, public assets or required canonical pages. [Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [Google facet guidance](https://developers.google.com/crawling/docs/faceted-navigation), [Bing noindex guidance](https://www.bing.com/webmasters/help/robots-meta-tags-and-attributes-that-bing-supports-5198d240)

**Done means:** Every sitemap destination is public, intended for indexing and returns 200; all eligible catalogue listings are represented, including those beyond the first 24; drafts and held records are absent. No conflicting canonical/noindex instructions. Unknown games and listings return 404. Public content is reachable with scripts disabled; interactive filtering remains unchanged when enabled.

### 3. Make search results and shared links look like BrowseRP

**How:** Give each game, server and article a specific, honest title and description in its initial HTML. Match the visible subject, without stuffing repeated synonyms. For example, the FiveM page could use “FiveM Roleplay Servers — Public & Whitelisted | BrowseRP”; an actual listing uses its real community name and game, plus joining details in the description where confirmed. A blog uses its real article title and excerpt. These are proposed patterns, not fixed character quotas or promises about what Google will display. [Google title guidance](https://developers.google.com/search/docs/appearance/title-link), [Google description guidance](https://developers.google.com/search/docs/appearance/snippet)

Set matching Open Graph title, description and canonical URL. Retain the **RP mark** as BrowseRP’s identity and fallback. Where an approved game/server/article has suitable public artwork, use a relevant preview image rather than making every shared link the same generic tile. Do not use an untrusted image URL or private storage object. Test image response, crop, dimensions and alt description. The existing brand regression currently hardcodes the same thumbnail on every page (`test/branding-motion.test.mjs:42`); evolve that test to preserve brand identity while permitting correct page-specific images.

Add modest machine-readable descriptions: `WebSite` and `Organization` for BrowseRP, `BreadcrumbList` matching real navigation, and `BlogPosting` for genuine articles with accurate dates and author/publisher information. Server directory data should describe what the page really is; do not force it into a product/review type simply to chase stars. No invented aggregate rating, fake reviews, member counts, prices or ownership affiliation. Structured data may improve understanding and eligibility; a special search display is never guaranteed. [Google site names](https://developers.google.com/search/docs/appearance/site-names), [Organization guidance](https://developers.google.com/search/docs/appearance/structured-data/organization), [Structured data rules](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)

**Done means:** A real server link previews that server, a game link previews that game, and missing pages do not pretend to be active listings. Markup matches the visible page and passes relevant validation. No security policy is loosened and no extra decorative badge obscures existing artwork.

### 4. Turn research into useful information, not content padding

**How:** Finish each launch listing before producing a large blog programme. A good listing answers: what kind of RP is this; who will enjoy it; how serious/structured is it; what must I install or apply for; which edition/version/region/language is relevant; what is confirmed about activity; where are the real rules and joining links? Keep Public and Whitelisted consistent: Whitelisted means application **and approval**. Explain network-wide Minecraft counts where applicable. Separate an owner-verified claim from a judgement that a community is safe or excellent.

Add a concise curation explanation to the existing About/trust material: how communities are selected, what evidence is checked, what “reviewed” means and how corrections are handled. Do not publish private research notes or unsupported allegations. Useful distinctive comparisons can grow from the actual reviewed roster instead of copying other directories’ descriptions.

After the existing pages are reliable, improve the current FiveM guide and select the next small number of guides by actual player friction: joining public versus whitelisted communities, a genuinely useful first RedM session guide, and choosing the right Minecraft RP edition/community. Use specific reviewed examples and official setup sources; credit real authors or the BrowseRP editorial team truthfully. Safe clickable article links are part of this work. No imposed word counts, annual date changes without a real update, or hundreds of thin “best X in Y” pages. [Google’s people-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)

For Roblox, finish and test the accepted application workflow first. Its hub should explain the actual offer, list only approved communities, and make creator experience ownership versus independent community authority clear. Do not label it an established catalogue before it is one. A useful application explanation can be public; private applicant evidence cannot.

For owners, use the existing About/advertising information and listing path first. If search data and the completed workflow justify it, add one clear public “List or claim your community” explanation, linked to the secure existing form. It must answer a real owner need; do not add separate repetitive landing pages for every game.

**Done means:** Every launch listing has accurate useful distinctions and safe joining links; every published guide supplies something a player can act on; relevant links work; claims have evidence. New SEO work must not delay fixing an unfinished submission, moderation or account function.

### 5. Protect the mobile experience and keep discovery quick

**How:** Include search landing pages in the existing desktop/mobile quality checks. Prioritise visible content and its leading image, reserve image/card space, use suitably sized compressed assets, and keep delayed images out of the first-content critical path. Informative images need useful alt text; purely decorative pictures beside a complete label can correctly have empty alt text. Do not add duplicated spoken labels or keyword lists. Keep reduced-motion support and touch feedback; preserve the stationary Menu/Close target. No animation should hide already-loaded text or make scrolling feel as if it is struggling. [Google image guidance](https://developers.google.com/search/docs/appearance/google-images)

Measure mobile and desktop loading, responsiveness and layout stability separately. Aim for the established good Core Web Vitals levels: LCP within 2.5 seconds, INP under 200 milliseconds and CLS below 0.1, evaluated at the 75th percentile when sufficient real-user data exists. A new site may have no field report yet; then record repeatable lab results and the absence of field data honestly. Do not declare “perfect performance” from a single Lighthouse score or change the design to chase a number. [Google Core Web Vitals guidance](https://developers.google.com/search/docs/appearance/core-web-vitals)

**Done means:** No material regression against the current tested baseline; filters, game links, search, scrolling and joining remain responsive on supported browsers. Chromium/Firefox/WebKit emulation complements, but does not replace, an actual phone check. Public page rendering should not add repeated live-source refresh calls or a heavy new frontend dependency.

## Free tools, accounts and money

| Tool or task | Purpose | Cost and owner involvement |
| --- | --- | --- |
| Google Search Console | See which pages Google can read/index, real searches, impressions, clicks, mobile differences and issues. | Free. Use the owner’s existing Google account; Google AI Pro is not needed for this setup. Check for an existing property before creating one. |
| Domain ownership verification | Prove control of `browserp.com` and cover www/non-www/protocol variants. | Use the exact Google-provided DNS record in the actual authoritative DNS service. Preserve other verification records. User sign-in/MFA may be necessary; no new purchase. |
| Bing Webmaster Tools | Another source of discovery, crawl diagnostics and search data. | Free. Use an existing supported account. Verify directly or import the verified Search Console property only after reviewing the actual access request. |
| Rich Results Test and Search Console URL Inspection | Check the real released pages, structured data and what Google receives. | Free. Public validation first; URL Inspection requires access to the property. |
| PageSpeed Insights and existing local browser tools | Baseline performance and find concrete regressions. | No new paid service needed. Do not add tracking scripts merely to run these checks. |
| Content research, page rendering, sitemap and metadata work | Improve the product’s own searchable assets. | No SEO software subscription or ad spend required. Normal hosting/database usage still exists; bound and monitor it. |

[Google describes Search Console as a free service](https://support.google.com/webmasters/answer/9128668). Its domain-property verification requires domain-level proof. [Google ownership verification](https://support.google.com/webmasters/answer/9008080). Bing also offers a free account and can import an existing verified property. [Bing getting started](https://www.bing.com/webmasters/help/getting-started-checklist-66a806de), [Bing verification](https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b)

Do the account ownership step now if access is available, so the baseline starts collecting. Submit the **corrected production sitemap** once the public-page fixes are published and verified. Record the actual property, owner access, submission status and inspection outcomes. Do not submit a Vercel preview or repeatedly request indexing for every minor edit. Do not promise ranking or buy backlinks, automated directory submissions or “guaranteed traffic”.

There is also a current Google Search Console setting for inclusion in Search generative AI features. Check the actual property’s inherited setting; Google documents inclusion as the default. This is separate from AI training preferences. If the impressions report is available and the site has data, include it in measurement. No special `llms.txt` file, keyword rewriting or paid AI-SEO package is required for Google Search. [Current Google AI search guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), [Search inclusion control](https://support.google.com/webmasters/answer/16908024), [Generative AI impressions report](https://support.google.com/webmasters/answer/16984139)

## How we will know it is helping the business

Before changes, save a dated baseline: eligible published URLs, current index coverage when available, impressions/clicks by landing page/game/country/device, and current known performance. Do not invent a traffic target before we have any data.

At release, measure the work we control: 100% of intended public URLs have correct content, status and canonical; 100% of eligible published listings appear in the sitemap; 0 private/draft/held records appear; 0 broken joining/image/internal links in the tested roster; no mobile functional regression. Search engines decide actual indexing and ranking, so “100% indexed immediately” is not an honest release gate.

In the first month, review which queries expose BrowseRP and which pages receive useful clicks. Separate searches for “BrowseRP” from people discovering us by game or community. Check whether new listings are being discovered and whether players leave on broken/empty pages. Compare mobile and desktop. Fix crawl errors and weak landing-page answers before increasing article output. Search Console provides query, page, country and device analysis; small or omitted query totals should not be presented as complete demand. [Search Console performance report](https://support.google.com/webmasters/answer/7576553)

The business measure is not just visits. The useful path is search → relevant listing → legitimate join/application/official-site action; for owners it is search → understand listing/claiming → completed valid submission. Check what trustworthy aggregate events already exist before adding instrumentation. If needed, add a minimal privacy-respecting measurement step that excludes staff activity and never sends account IDs, private application text or arbitrary search terms to a third-party tracker. Report an outbound joining click as a click, not as a confirmed new community member. Report completed valid owner submissions separately from abandoned forms and spam.

After enough data, compare rolling 28-day periods for qualified discovery clicks, useful outbound actions, valid owner applications, returning users where safely measurable, and the proportion of launch pages Google can index. Record meaningful content changes so we can connect results to decisions. Avoid setting revenue or “number one by launch” promises.

## After launch: earn reasons for people to mention BrowseRP

Give approved owners a genuinely useful, stable listing they can share. Where an owner chooses to link it from their public site, that is useful discovery; do not require a backlink for approval or manufacture reviews. Publish researched comparisons only when the underlying evidence and player needs justify them. Use the future BrowseRP Discord to help people find communities and report inaccurate information, not as a replacement for public searchable pages or a link-spam channel. Actual outreach/messages remain a separate authorised action.

Over time, Search Console can justify a small number of genuinely distinctive regional or play-style landing pages. Require enough strong, relevant communities and unique help before adding one. Retain the current flexible filters even if most filtered URLs remain outside search. English is the launch language; do not create automatic translated pages or claim global-language coverage before the communities and support exist.

The long-term GTA VI ambition is best served by building a trusted roleplay brand now. Publish future-game information when it can be supported by reliable official evidence; do not invent server support, launch dates, join routes or a directory that does not exist.

## Delivery sequence and acceptance record

1. **Plan and baseline:** review this plan, preserve active launch work, connect existing free webmaster accounts where available. No source changes yet from this audit.
2. **First implementation batch:** correct initial public HTML, public-only data boundaries, real missing-page responses, game/detail/article canonicals and dynamic sitemap. Add focused tests for published versus private data, injection/escaping, unknown routes, pagination and source outages.
3. **Second batch:** accurate social previews, restrained structured data, safe editorial links and paid-link qualification. Preserve the brand and tested UI rather than restyling it.
4. **Release checks:** the full repository gate once integrated; exact preview and then production HTTP/browser checks; anonymous and signed-in behaviour; cross-browser/mobile/reduced-motion checks targeted to the changed templates. Verify a real public page in Search Console and relevant structured-data tools. Do not load the Mac with several full suites simultaneously.
5. **Submission and learning:** submit the production sitemap, record acceptance and indexability evidence, then improve the highest-value existing pages and original guides using real data. Roster curation, security, recovery and unfinished functions remain in the overall launch scope.

The launch value comes from a strong directory that people can find and trust. The proposed SEO work makes the current product easier to discover, clearer when shared, and more useful to the players and owners it already serves.


## Added priority: people searching for BrowseRP by name

The first branded-search target is the official homepage for **BrowseRP**, **Browse RP** and **browserp.com**. Also monitor **RPBrowse** and likely spelling mistakes as real query variants; keep BrowseRP as the official name. Do not add an invented alternate brand, hidden keyword list or fake social profiles.

A public web search on 6 September 2026 for quoted BrowseRP plus roleplay returned an old third-party domain-information page, while RPBrowse plus roleplay produced unrelated technical results. This is a limited search-provider snapshot, not a Google ranking report or proof that Google has not indexed BrowseRP. It indicates that the official identity needs clearer discoverable evidence. The root task verified the browserp.com domain property in Google Search Console on 6 September 2026; its performance data is still processing. That property will supply the dependable query/impression baseline. The corrected production sitemap must be deployed and checked before submission.

For launch: keep the canonical homepage, visible BrowseRP name, square RP logo, About purpose, real contact routes and actual connected social identities consistent. Add accurate WebSite and Organization information to that public identity, using only facts already visible and supported. Make the main game and community pages link naturally back to BrowseRP. Request indexing of the verified canonical homepage and submit the complete production sitemap through the free webmaster tools. Track branded clicks, impressions, average position, selected canonical and the exact page shown, separately from competitive FiveM/RedM/Minecraft/Roblox discovery searches. No position can be guaranteed, and paid advertising is not required to make this technical foundation sound.

Primary guidance: [Google site names](https://developers.google.com/search/docs/appearance/site-names), [Organization structured data](https://developers.google.com/search/docs/appearance/structured-data/organization), [Search Console performance report](https://support.google.com/webmasters/answer/7576553).
