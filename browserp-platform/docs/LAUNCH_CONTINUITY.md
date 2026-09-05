# BrowseRP launch continuity

Updated 5 September 2026. This is the working scope and evidence ledger, not a claim that launch work is complete. Later requests add to this scope unless the owner explicitly changes it. Historical verification must be refreshed against the release being published.

## Purpose and design decisions

BrowseRP brings the online roleplay community together globally, starting with English-speaking communities. The owner's ambition is to be the preferred discovery and community platform by GTA 6's release, through trusted information, useful discovery, community relationships and dependable operations. This is a product ambition, not a claim about unannounced GTA 6 roleplay capabilities or release arrangements.

Keep the strong existing public design. Make tangible improvements, preserve useful controls, and finish inherited work before optional additions. Staff want a capable, grouped control panel, with the same quality and menu design as the public site. Less unnecessary decoration does not mean fewer useful features. Keep engineering detail out of member-facing language.

Core brand: BrowseRP pink/violet; square identity is the RP and magnifying-glass part of the wordmark. FiveM orange, RedM red, Roblox white/silver, Minecraft green. These four launch games remain active; other games are collapsed and coming soon. Forza stays out of active Browse by game, with artwork retained in coming soon. Do not restore duplicate symbols over game pictures. Preserve mobile layout, keyboard support, readable contrast, reduced motion, and stationary Menu/Close buttons.

The owner's complete 5 September handoff is preserved in `LAUNCH_BRIEF_2026-09-05.md`. It is scope, not evidence of completion; historical deployment and provider statements inside it require current verification. This ledger tracks the resulting work and newer decisions.

## Required stages that must not disappear into individual fixes

1. **Find and finish inherited gaps.** Compare the conversation, handoff, repository, database, provider settings, public pages and staff workflows. Inventory unfinished controls, placeholders, broken routes and journeys that only look complete. Classify each as completed and proven; implemented but awaiting real proof; broken; incomplete/disconnected; deliberately disabled; or blocked by one named external action. Finish launch features rather than silently hiding their gaps. Explicit launch exclusions, such as paid transactions and unsupported games, remain clearly disabled.
2. **Audit and curate the launch communities.** Review the existing published, pending and held roster before expansion. Research and compare credible alternatives using rules, onboarding, moderation, development, reviews, public forums/community information, representative activity and newcomer experience. Record confidence and dates. Work toward the owner's 40 FiveM / 20 RedM / 3 Minecraft selection, reviewed and live before Discord community setup; never pad the numbers with unqualified communities.
3. **Research inspiration and meaningful upgrades.** After inherited functional gaps are closed, study strong roleplay/community discovery products and excellent mobile experiences. Find actual player, owner and staff frustrations. Record the problem, evidence, relevant inspiration, proposed benefit, simpler alternative, privacy impact, staff workload, maintenance cost and comparison with the existing experience. Adapt ideas to BrowseRP's mission; do not copy a product or automatically build a list of fashionable features.
4. **Refine motion and the mobile experience.** Make mobile feel deliberately designed and impressive: comfortable touch controls, immediate colour/press feedback, readable information and effortless navigation. Preserve desktop colour-shifting buttons. Refine or add animation only where it helps feedback or hierarchy. The reported scroll problem is delayed-feeling animation on ordinary phones; check frame consistency, long frames, image dimensions and interaction delay rather than blaming weak hardware. Respect reduced motion, press cancellation and keyboard use.
5. **Unify the final design.** After integrated changes, compare equivalent components across every public page, account flow and staff section. Share the strongest BrowseRP menu, buttons, typography, spacing, colours, surfaces, cards, icons and loading/error/success patterns wherever they have the same job. The top-right Menu/Close control must stay in exactly the same place and support touch, keyboard, Escape, focus and scroll locking. Keep useful grouped staff controls and purposeful density. Do not flatten the site or trade its identity for a generic dashboard.
6. **Prove safeguards and release quality.** Test abuse boundaries and safe recovery alongside normal journeys: revoked sessions, account linking, staff escalation, access to another owner's data, private/IP exposure, harmful content/uploads, automated voting/report/claim abuse, traffic pressure, backup restoration and rollback. Use isolated or bounded checks, never attack traffic or destructive tests on real members. Recheck known regressions on the actual final deployment. Publish only the verified batch, then recheck production. Optional upgrades follow resolution of inherited launch gaps; Discord follows the qualified live roster and a dependable launch product.

Independent work can continue in parallel without changing these dependencies. A new steering message adds to the scope unless it explicitly replaces something.

**No sidegrades.** Every upgrade needs a tangible improvement in finding a suitable community, representing/managing it accurately, or operating BrowseRP safely and efficiently. Compare before and after; preserve the stronger current experience if the benefit is unclear. Complexity belongs in dependable engineering, not confusing public language or unnecessary controls. Decorations and repeated information must earn their space.

**Human wording and real controls.** The owner explicitly rejected the useless, badly spaced “Dark workspace” pill and asked for this standard site-wide. Remove that label and use the actual View website action in the staff header. Find similarly empty decoration, awkward copy and false affordances, while preserving BrowseRP's personality, meaningful status information and useful control-panel density. Do not reinterpret this as flattening the voice or oversimplifying every screen.

**Staff independence.** Authorised staff must be able to complete routine listing, claim, moderation, role, publishing, advert, health and scraper workflows through the panel without database edits or an engineer. Include corrections, failures, retries and recovery in the completion check.

**Regression safeguards.** Before changing a working shared component, identify its dependent screens and behaviours. Afterwards compare those screens and repeat the affected journeys, especially artwork, homepage game links, search player counts, menu position and scroll feel. Preserve owner data, useful content and permission boundaries. Reconcile stale operational documents so they cannot undo current configuration.

## Release baseline

- Work starts from production commit `a53886d472905370fa0c128f1506af6045326c0f` on `fix/oauth-branding-and-motion`, not stale main.
- Successor working branch: `launch/complete-inherited-work`.
- Prior production deployment: `dpl_Hy49iYKL3AzWPWHdnRQc9tCAadRF`, `https://www.browserp.com`.
- Prior recorded verification: 399 tests (364 application and 35 isolated database), 125 JavaScript syntax checks, 12 Vercel functions. This is baseline evidence, not verification of later changes.
- Owner authorizes publishing verified polished work. Do not merge main. Keep a tested preview and rollback reference, then verify the actual production release.
- Keep versioned favicon/apple-icon URLs; previous CDN negative caching caused missing icons.

## Current execution ledger

| Work | Status at takeover / current evidence | Required next proof |
| --- | --- | --- |
| Public platform redesign, four game navigation, metadata and information cards | Existing implementation; preserve metadata order platform, region, language, framework, access | Regression-check showcase, real details, directory, game pages, filters and suggestions on current release |
| Staff/public menu consistency and expired-session behavior | Local fix: matching Menu/Close icon and label; stale menu hidden at access gates; all queue badges updated. 25 focused tests and six controlled browser configurations pass | Review integrated diff, full suite, hosted preview and production smoke check |
| Mobile feel, scroll and button feedback | Prior motion work exists; owner wants immediate-feeling scroll and tactile colour feedback, not delayed reveals | Check scrolling, touch press/cancel, reduced motion, low bandwidth and CPU, keyboard, no sticky hover, no layout jumps; physical device evidence separate |
| Branding at every member touchpoint | Prior logo/favicon/manifest/policy work exists; external consent remains partly unfinished | Check Google and Discord consent, callback domains, profile linking, emails, errors, tabs, saved-home icons, shared links/previews, uploads and Discord community |
| Discord master-account login application | New master-account app `1545874834708234321` branded with RP icon, BrowseRP name, description, terms/privacy and exact callback. Provider configured, fresh consent with identify/email completed, owner completed MFA and existing staff overview/permissions verified 19:47 UTC | Regression-check ordinary-member consent and distinct claims guild-control flow; name/logo does not remove provider-owned Supabase hostname |
| Google naming and consent | Prior configuration partially completed; consent may still show Supabase hostname | Inspect actual ordinary-member flow and provider branding verification; distinguish name/logo approval from optional paid custom auth domain |
| Member connections | Linking exists; hosted manual linking was OFF; unlink absent; current-session/recent-auth boundary needs strengthening | Implement and test safe linking/unlinking, preserve last usable login, exclude current/former staff, verify real hosted ordinary-member consent with owner participation |
| Unused email login | Completed hosted change: email login disabled and read back; live aggregate showed zero email/password accounts among seven users | Google/Discord remain enabled; verify real consent flows |
| Staff authentication and recovery | Mandatory MFA live; active owner has one verified authenticator. Existing permission/session tests pass | Add backup-factor selection/management, verify replacement before removal, prevent last-factor removal, document and prove safe recovery on an isolated account |
| Inactivity retention and privacy | Completed live safety migration 20260905192015: review-only retention, no automatic account deletion; unused quarantine INSERT removed. Readback confirmed both and active cron. 18 focused regressions pass | Publish corrected privacy wording; provide real member data-request workflow |
| Upload security and independence | Avatar path has tested boundaries; unused direct quarantine upload policy is now closed live. Staff advert upload implementation is under isolated verification | Preserve legitimate uploads, integrate staff artwork upload; exercise real storage and cleanup flows |
| Backups and recovery | Dashboard confirms Free plan has no project backups; no isolated restore proof; database backups do not include Storage bytes | Inspect hosted coverage/last success; prepare database plus media backup and restore into isolation; never restore production as a test |
| Security layers | Existing session/RLS/permission/CSRF/rate-limit guards strong in focused tests. Cloudflare injected script conflicts with strict CSP | Inspect actual bot product and reconcile with supported nonce handling without unsafe-inline or weakening protection; normal-user rate testing, no attack traffic |
| Staff overview | Charts/ranges/publishing/custom roles implemented earlier | Verify real dates/counts for 30/90/180 days/year/max, refresh health, queue counts, errors, role assignment and publishing end to end |
| Moderation and security control panel | Existing members/servers/reports/logs/bans/appeals/permissions modules | Test search/smart filters, owner edit-any, permission-specific denial, active/deleted reports/history, privacy-controlled IP reveal, bans/appeals and audit trails; no unsafe real bans for testing |
| Scrapers and source accuracy | FiveM/RedM/Minecraft implementations and scheduler live; no Roblox import | Validate input classification, source URLs, live freshness, tags/keywords/join links/Discord/images, retries and partial failures; ordinary staff operation must be independent |
| Existing roster | Current audit: 48 published (25 FiveM, 20 RedM, 3 Minecraft), 49/49 stored images reachable; 45/48 fresh at 19:08 UTC. See current roster audit | Audit quality before next imports, resolve source and access uncertainty, distinguish a working link from a good community |
| Server quality and launch selection | Required launch target: 40 FiveM, 20 RedM, 3 Minecraft, reviewed and live BEFORE Discord community setup; meaningful variety and quality over filler | Public official/review/forum evidence for moderation, onboarding, longevity, friendliness and scripts; about 35 players at representative active times, with region/history considered; never remove only for one low/offline sample |
| Named communities and access labels | SACRP/CaliRP requested; Redline deferred by owner. Public means no application; Whitelisted means application and approval | Preserve accurate explicit labels and filters; unknown remains unknown; research existing access gaps and prove search does not erase counts |
| Roblox applications | Generic submission exists, dedicated application-led workflow incomplete | Build an understandable application/review path for suitable experiences and community control; do not treat experience concurrency as one RP server |
| Blog, announcements and adverts | Blog text/Markdown import and publishing exist; announcements scheduled/live; paid adverts disabled | Complete authorized create/edit/schedule/end/review/media flows and public output; no test announcements sent to real users |
| Payments and Coins | Deliberately disabled | Keep disabled until full financial tests and owner decision about services/purchases; this is an explicit launch exclusion unless owner changes it |
| Discord community | AFTER inherited website work and fully reviewed/live 3 Minecraft + 20 RedM + 40 FiveM: branded welcome/rules/help/game discovery, roles, staff moderation, security bots, voice and music | Design useful minimal channels and least privilege, maintained bots, anti-raid/spam and recovery; no purchases or unsolicited invitations/messages |
| Final whole-site verification | Historical passes do not prove new release | Full repository checks; Chromium/Firefox/WebKit desktop/tablet/mobile; 320px narrow layout; reduced motion; slower network/CPU; search/filter/sort/login/link/upload/claims/publishing/moderation/error journeys; inspect actual deployed commit |


## Small details that must survive the final pass

- Homepage game clicks, Games, Discover, navigation search and suggestions must all lead to useful results; no blank FiveM page. Only four launch games appear in active discovery filters.
- Use the supplied game pictures consistently and the supplied All games logo in both its homepage tile and the Games heading. Do not restore overlay symbols that obscure the same picture's purpose.
- Every launch game needs tailored, understandable filters. FiveM includes vMenu/ESX and relevant play styles/features such as serious roleplay and custom cars. Order options by actual usage; usage totals stay invisible publicly and visible to staff. Public and Whitelisted are explicit separate filters.
- Search/filter/sort/page navigation must preserve live-count enrichment and accurate joining requirements. Missing/stale source data is not zero. Framework and language must never swap places in generic metadata.
- Preserve real artwork and useful labelled fallbacks in listings and adverts. A content blocker is not proof that an image was deleted. Remove demo/FloridaDOJRO and genuinely unsuitable launch listings through the appropriate staff workflow; preserve useful audit history.
- Keep gradient buttons colourful on desktop hover and give intentional mobile touch feedback. Avoid grey hover regressions, sticky touch hover, over-sensitive controls, distracting repeated effects, delayed scrolling, accidental typing/carets on information cards and excess empty space.
- Overview includes website totals and exact-date user history with 30/90/180-day, year and maximum ranges. Publishing, blogs, announcements and adverts belong there. Staff can CREATE custom roles and ASSIGN them, with backend enforcement and owner protection.
- Moderation includes members and servers with search/smart filters; overall moderation and reports; active and deleted report history; site-risk security; profile screening, account activity, staff/permissions, bans and appeals. IP/device bans and audited IP access need privacy and abuse safeguards, not just visible buttons.
- Server claims must verify control of the exact community's Discord where evidence permits; Discord login or membership alone is not ownership. Unverified requests still need a clear manual review path.
- Scrapers are accessible under the coloured/pictured FiveM, RedM, Minecraft and Roblox menu groups. Staff need safe independent controls and source links/plans; automation needs the same validation. Roblox uses reviewed applications, not invented server-level counts.
- Test ordinary member as well as owner/staff sign-in, connection and disconnection, MFA, uploads, claims, favourites/votes, comments/reports, moderation, role changes and publishing. Check cancellations, double clicks, session expiry, failures and recovery, not only successful page loads.
- The launch set must offer genuinely different good options: accessible public communities, application-based storytelling, serious and more relaxed RP, useful regional/time coverage and distinct worlds/systems. Research and vet before adding; then check every published listing, artwork, source, link and filter behaviour again.
- Keep the owner's involvement minimal: prepare forms and values, use existing authorised access, ask only for the precise unavoidable owner-only step, and verify the result afterwards. Never ask the owner to perform routine configuration that the agent can complete safely.

## Quality and evidence rules

- Preserve unavailable/stale counts as unavailable, never zero. A scheduler succeeding does not prove every upstream community is online. Label measured freshness honestly.
- Review current communities before adding the next batch. Do not turn promotional claims or allegations into established fact. Use reversible holds when evidence is insufficient. No private Discord scraping or contacting people without authorization.
- Test role boundaries through the application and database. IP/device data is sensitive; minimise exposure, maintain audited reveals and retention. Avoid invasive fingerprinting. No security or community-quality guarantees.
- A mocked session or browser emulator cannot prove real OAuth consent, MFA recovery, email delivery, real payments, or a physical phone. Record the exact boundary of evidence.
- Use a small isolated dataset for destructive/action tests. Do not damage real members, publish fake listings, send real test announcements, or flood production while testing.
- Ask the owner only for concrete account access, credential entry, purchases or other required handoffs. Continue independent authorized work while awaiting answers. Never put credentials or one-time codes into this ledger.
- Optional improvements come only after inherited gaps close and research shows a clear benefit: trusted freshness, reporting outdated listings, useful activity history, shortlisting/comparison, owner-change history or better staff queues. Do not add clutter to appear advanced.

## Completion standard

For each completed item, record the change, meaningful test result, deployment evidence if applicable, and any remaining external dependency. At release provide working branch, exact commit, test results, preview and production URLs, and an honest outstanding list. A saved plan, hidden feature, disabled button, or passing unit test alone is not completion of an end-to-end feature.

## Integrated batch checkpoint, 5 September, 20:15 UTC

- New Discord master-app consent and the existing owner's MFA staff access were verified in the real browser.
- Live migrations now include account connection/current-session checks, reviewed advert artwork storage, shared session expiry, serialised authenticator management and interrupted first-setup recovery. Anonymous execution and member audit-writer access are denied; the owner's one verified factor is unchanged.
- Local changes unify the staff menu, replace the Dark workspace pill with View website, expose real submission review feedback, correct game-specific setup labels, protect account disconnection and private session-ended UI, and provide staff authenticator and advert upload controls. They remain pending release verification/publication.
- The test gate caught a stylesheet-version assertion after cache version updates; the assertion now checks stylesheet identity and ordering independently of its cache version. Security review additionally found and corrected duplicate refresh use and revoked-token privileged profile/upload paths.
- Next-batch work remains separate: safe member data requests, correction/resubmission, Roblox applications and advertising enquiries. Research and curation continue in parallel.

### Frozen release verification

The integrated application passed `npm run verify`: 484 application/security/UI checks and 35 separate database checks, 519 total, with no failures. Syntax and Vercel function-count checks passed. Controlled and hosted browser checks remain separately recorded; these counts do not establish real third-party consent or physical-device coverage.

GTA World English was researched, imported, corrected and published through the real staff panel at 20:14 UTC. Its exact Cfx code is 7b9dbvd; primary onboarding overrides the self-reported Public source flag to Whitelisted. Post-publication discovery returned one searched result with stored PNG artwork and a fresh 795/2000 observation from 20:11:58 UTC. Current launch counts become 26 FiveM, 20 RedM, 3 Minecraft; the 40 FiveM target remains incomplete. Research notes retain source-specific limitations.

## Published release checkpoint, 5 September, 20:30 UTC

Commit `cda768b50ba205190e0c708789cb7e7ec4d92fd6` on `launch/complete-inherited-work` is live at https://www.browserp.com through READY production deployment `dpl_CAEHW5hMUH1eHFQ8DYFaLrddYmfm`. The tested preview is https://browserp-hobby-c01n3472p-browserp.vercel.app/ (`dpl_H6yzKKTHqosFayMVPVeMsvjkfYCv`). Main was not merged or advanced. The previous production reference above remains the rollback target for this batch.

The release includes the matching staff menu, real View website header action, private-session cleanup, safer account disconnection and authenticator controls, interrupted first-setup recovery, managed advert artwork upload and touch-animation cancellation during scrolling. The 519-check full repository gate applies to this commit, not unfinished successor changes.

Additional proof:

- 63 controlled staff browser cases across Chromium, Firefox and WebKit at 1280, 390 and 320px passed. These cover owner overview, access gates, menu position/focus/escape, authenticator UI and real browser image preview operations against controlled APIs. They do not prove hosted account recovery or real storage writes.
- The exact hosted preview passed 54 route checks across the three engines at desktop and mobile widths, with no application page errors, broken visible images or horizontal overflow. Expected protected-preview feedback-script CSP diagnostics were kept separate; no CSP was weakened.
- Post-publication checks in all three engines covered the home page, CaliRP search, GTA World details and signed-out staff access at 390px. All pages loaded correctly, and served script hashes matched the tested commit.
- At 20:36 UTC the real owner's signed-in production overview loaded normally. Your sign-in security showed the existing verified BrowseRP staff factor, protected from removal until a backup is verified. Add/refresh controls rendered. No authenticator was added, removed or exposed during this read-only check.

Onyx County (`lgrex4`) was published through staff review around 20:26 UTC with verified Discord, managed PNG logo and Public access supported by current joining instructions. The initial 7/128 observation is an off-peak reading; six complete days of reviewed history show repeated representative activity over 35. No unsupported banner was kept. Bright Falls RP (`lyy7rv`) was archived through staff moderation around 20:31 UTC as a reversible launch-quality hold, with its policy-evidence reason retained. That decision is not a closure or misconduct allegation. These two actions kept the recorded roster at 26 FiveM / 20 RedM / 3 Minecraft before subsequent imports.

Current successor work remains separate and unproven until its own release gate: private member data requests and staff handling, same-submission owner corrections, and continued community research. Google/ordinary-member linking, full database-and-media backup restoration, Roblox application detail and advertising enquiries remain open. The Discord community and optional upgrades follow the inherited-work and qualified-roster gates.

### Design clarification, 5 September 2026, 21:14 UTC

Public site and staff panel should share visual standards and the same menu-button design, including spacing, typography, colour, focus/touch response and motion. They remain bespoke areas with different navigation and appropriately dense staff controls. Do not force identical layouts or remove useful operational features. Small tangible improvements are welcome; preserve character and verify the result. Keep visible in-app browser work available for the owner to follow.

### 5 September, 21:40 UTC — coherent controls and next release

The user clarified that shared design does not mean identical public and staff products. Public Menu/Close and staff Menu now share 100×46px targets, 22px icons, spacing, colours and mobile press feedback; the public menu and staff navigation remain bespoke. Both remain stationary. Removed an incorrectly positioned hidden search label that painted behind the home logo, retaining correct accessible labels and keyboard skip links. Focused checks: 55 passed; nine browser configurations across Chromium, Firefox and WebKit at desktop/390/320 widths passed against preview with local asset overlays. Final deployed-asset verification remains required.

The roster is now 30 FiveM / 19 RedM / 3 Minecraft (52 total), with the new three communities checked on public search/detail pages in all three engines. The 40/20/3 quality target remains open. Live firewall review now covers strict TLS, proxy records, DDoS configuration, caching and sampled events; shared-IP rate limits and actual injected-script compatibility remain follow-up checks. Full database/media recovery has not been proven: PostgreSQL17 tools are prepared; the session pooler is reachable, but secure database credentials and an encrypted backup/restore exercise are still needed.
