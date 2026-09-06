# BrowseRP — PC development handoff, 6 September 2026

## Latest active checkpoint — 6 September, evening

This section is the authoritative project checkpoint and supersedes historical branch, pending-work and usage snapshots below. Continue on **`release/seo-community-home-20260906`**. The owner **removed the 50% usage reserve**; do not reapply it from older notes. Continue agreed work efficiently, preserving meaningful checks and the existing BrowseRP identity and mechanics. Corrections add to the active scope; they do not authorise unrelated redesigns or replacements. Keep continuity in the project rather than sending the owner another handoff message. The removed-scope decisions below still apply.

- **Verified live release:** `9c1826e1e3f9fa7c58296e5c672ca421fa1db27b`, tree `14f3095f34d943f8530dcc3bd1ba8c75cf1dbe9f`, is accepted and READY at https://www.browserp.com through `dpl_9SVwhj1szJRAkvTmJ41W8W3a8m7d` (deployment URL `https://browserp-hobby-n4exnp81q-browserp.vercel.app`). The isolated Node 24 preview gate passed **938 tests** (903 application + 35 database), 217 JavaScript checks and the **12-function** limit. After root promoted the reviewed preview, **18 hosted smoke checks** passed, including exact bytes of all five changed CSS/JS files and the canonical health SHA. Local visual commit `dc114bc0e5df712563c71a78bed65f4dd421f0cb` has that same tree. The earlier `553639b` production and other old previews are historical evidence.
- **Live discovery and staff boundaries:** Discover retains **63** published communities, 24 initial cards and the next offset. The staff-profile dropdown uses the protected gradient action. Anonymous account state reports staff=false and staffAccess=false. Staff documents return generic **401** login shells with private/no-store caching and no privileged controls; private APIs return 401 without internal data. Current session, enabled staff policy and verified TOTP remain required, with RPC permissions authoritative. This does not establish Discord-to-website staff synchronisation.
- **Visual defects resolved in the accepted release:** the coloured hero wave preserves original wordmark detail, the header pulse is visible, All games is a compact square, and healthy adverts retain their full 4:5 artwork and stable height through all three slides. Independent actual Chrome, Firefox and WebKit checks at 390px and 1440px covered wave direction, fixed heading/search/Menu geometry, reduced motion, simulated hidden-page handling, offscreen pause/resume, game colours, healthy/blocked adverts and retained discovery mechanics. A bounded 2-second Chrome 4× CPU sample recorded 0 Paint/0 Layout events. This is automated desktop evidence, not physical-device or sustained network/performance proof. One WebKit Back request timed out once and passed on an isolated repeat without code changes.
- **SEO provider evidence:** Google Rich Results Test fetched the genuine published article at 21:46 BST (valid Article + Breadcrumb, optional image/author omissions) and FiveM page at 21:49 (valid Breadcrumb, no summary warning). See `browserp-platform/docs/SEO_COMPLETION_2026-09-06.md`. Google/Bing sitemap processing and Google branding approval are verified; selected-canonical/indexing reports remain separate, with no ranking guarantee.
- **Discord access:** Security's managed role is now at the top, saved. Staff denies `@everyone` View Channels/Connect and allows those two permissions for Ownership, Management, Admin, Junior Admin and Moderator. `staff-chat` (`1546229400016527370`) separately allows Support Team and Trial Moderator and is therefore unsynced. Those two roles still need local access to Staff voice. Owner office stays independently private with View Channels/Connect/Speak denied to `@everyone` and no staff exceptions. Six staff roles retain dangerous native permissions OFF and remain unassigned; effective ordinary-member access is unproven.
- **Discord security and entry:** Security confirmed ten-minute limits Ban **2**, Kick **2**, Delete Role **1**, Create Role **3**, Delete Channel **1**, Create Channel **5**; the next action after a limit triggers punishment. Prune is enabled with Kick, and other observed punishments retain Kick defaults. No attack rehearsal was performed. Verification created Unverified, applied overrides to **34 text channels with zero failures**, created verification channel **`1546251856559345715`** (fresh visible link), set **Member** as the verified role and enabled verification. Member is awarded **after verification**, not immediately on joining. New channels need Unverified overwrites and a real new-member check remains pending.
- **Discord retained work:** 46 unused template roles were removed; 18 retained roles plus new Unverified now total **19**. Security and ServerStats are installed; Xenon is removed. ServerStats created All Members **3**, Members **1**, Bots **2** counters with stated **15-minute** updates; at **21:30 local**, the bot confirmed `/counter create boostingmembers voice` enabled. The booster channel/value readback and an observed count-change refresh remain pending. All **40 emoji** are installed; attribution is under `browserp-platform/docs/discord-assets/`. Channel/template cleanup, bot restrictions, native AutoMod audit, private tickets, music, moderated suggestions, official branded posts and ordinary-member checks remain incomplete. Security Anti Spam/advanced Anti-Raid are paid features; no purchase was made, and native AutoMod is the intended free layer.

**Website → Discord role synchronisation: committed foundation, disabled and unapplied.** Source `95ef1d0` adds the authoritative reconciliation worker, owner-only configuration API, private SQL migration and focused tests. No bot identity/token, guild, destination-role mapping or enabled switch is configured; the migration and paused scheduler have not been applied. Deployment alone does not synchronize roles. The completed review found no blocker for this disabled foundation; it is not approval to activate it or proof of hosted role changes. It has no settings UI yet. Activation requires the separately authorized migration, exact owner-approved role IDs, dedicated bot/hierarchy review and controlled hosted checks described in `browserp-platform/docs/DISCORD_SITE_ROLE_SYNC.md`. Do not promote or enable this development batch without root's separate instruction.

The website remains authoritative: active staff membership **and** enabled allowlist policy must agree with the confirmed Discord identity. Automatic Ownership is excluded; ordinary membership, game interests and display labels grant no site staff authority. Suspension/removal is reconciled using retained cleanup IDs. Revocation is eventual and may be delayed by provider failure; disabling synchronization does not remove existing grants. The previous **938-test** count belongs to the accepted visual production release; the new foundation's integrated gate is recorded separately in its publishing commit/build.

The PC task delivery attempt failed with **“earlier turn submission not yet confirmed”**; do not claim the message was delivered. The shared release branch is available for continuation. Inspect the PC checkout before continuing and preserve its branch and uncommitted work; never reset main or the PC branch to match this note. Root retains Discord UI and publication coordination. No public invite has been published. Keep credentials and recovery codes out of notes; deferred recovery-code replacement remains deferred.

## Historical PC release evidence — superseded by the checkpoint above

**Latest live update, 6 September 16:06 UTC:** advert-arrow refinement source `e54b02db36a11f695813560476af26f70d885fab` is READY at https://www.browserp.com . Production `dpl_61X9YCjN74VSceqhDvEkLBgmxzk7`, https://browserp-hobby-gwwke3cvv-browserp.vercel.app; 2m44s build, 12 functions. Only advert controls were restyled: compact 32px rounded-square faces/CSS chevrons inside preserved 44px tap targets, restrained feedback and safe failed-image layout. Assets 2.19.6. Node 24 gates: 834 application + 35 database tests; desktop, wide, tablet/touch, phone/touch, reduced-motion and blocked-artwork Chrome checks passed. Live health matched the SHA; live controls passed next/previous with no page errors; deployment-scoped five-minute error scan was empty. Payments remain disabled; no new services or paid plan. See `browserp-platform/docs/ADVERT_CONTROLS_2026-09-06.md`. Final notes are documentation only; do not redeploy solely for them.

**Latest live update, 6 September 15:27 UTC:** premium interaction source `ad230305316c983698661aab9a7485113e9eb835` is READY at https://www.browserp.com . Production `dpl_AQCCsb8rxx3s4n8TPDzoK23KFZcR`, https://browserp-hobby-5fy34z255-browserp.vercel.app, build 2m40s, 12 functions. Live health matched the exact SHA with backend/auth/security ready and payments disabled. The scoped CSS adds soft card highlights, single-pass desktop button sweeps and menu/account feedback, preserving settled page layouts, text-only game badges and reduced motion. Local gates: 830 application + 35 database tests; isolated Chrome desktop/touch/reduced-motion passed. Live Chrome confirmed 2.19.5 product polish, hover highlight, no page animation/overflow, clean game badges/search labels and no page errors. Deployment-scoped error scan was empty. See `browserp-platform/docs/PREMIUM_INTERACTIONS_2026-09-06.md`. Final notes are documentation only; do not redeploy solely for them.

**Latest live update, 6 September 15:11 UTC:** game-label cleanup source `3af8c796f008f8f8514920cca88fae58bcc37a4a` is READY at https://www.browserp.com . Production `dpl_CRPgsfEpm4to5j54Bc1Kz8Qq993u`, https://browserp-hobby-a3b62ss1x-browserp.vercel.app, build 2m38s and 12 functions. Live health matched the SHA; assets 2.19.4, no random symbols in game badges or game quicklinks, natural-width transparent search category labels. All 860 application/database tests passed. See `browserp-platform/docs/GAME_LABELS_2026-09-06.md`.

**Latest live update, 6 September 14:48 UTC:** navigation stability source `79f13e4253d02b6fdb1240907b38d56cd18bd93d` is READY at https://www.browserp.com . Production deployment `dpl_4Eo234dyNcmRSB9XTfNojJYxw5Hj`, https://browserp-hobby-b2dogturk-browserp.vercel.app, build 2m40s and 12 functions. Live health matched the exact SHA; real CaliRP → Discover navigation confirmed content stays in column 2, main opacity 1 and no full-page animation. Hosted styles are 2.19.3. All 859 application/database tests and 24 delayed-loading Chrome cases passed. Deployment-scoped five-minute error scan returned no errors. This includes all preceding PC updates below. Final release notes are documentation only; do not redeploy solely for notes.

**Published checkpoint, 6 September 14:30 UTC:** application `306c07debf904bac1a871c8919d19fd1acd18006` is live and READY: `dpl_HgJ1j3o37TG7TafmEnWrMDp3wdbf`, https://browserp-hobby-1jalhvuou-browserp.vercel.app . Production health matched this source with backend/auth/security ready and payments disabled. Build: 2m36s, 12 functions; release gate: 821 application + 35 database tests. Live CaliRP was checked at 2503px and 390px without overflow; clicking california opened the correct one-result filtered directory. Six anonymous staff endpoints returned 401 without private data; the browser displayed the signed-out Continue with Discord gate. This supersedes the earlier browser-crash/promotion-pending checkpoint. No paid plan was purchased.

**Resolved owner defect, 6 September:** page navigation briefly squeezed content into hidden advert tracks and then jumped when adverts loaded; the header also changed height after script startup. The published CSS-only 2.19.3 fix explicitly positions server/directory content, keeps mobile adverts after content, reserves header dimensions and removes full-page fade/slide. See `browserp-platform/docs/NAVIGATION_STABILITY_2026-09-06.md` for verification and deployment evidence. Preserve all existing security, functions and other design work.

The latest owner question is launch capacity (300,000 visitors over two days). Answer: not demonstrated; functional tests are not a load test. Read-only snapshot: 7 accounts, 7 profiles, 63 published servers, about 37 MB database and 3 MB stored objects. Vercel Hobby was verified in the provider UI and is non-commercial-only according to current official policy; a commercial business launch needs an appropriate hosting plan. Supabase project metadata does not expose its subscription, so Free allowances are conditional, not a verified billing fact. No live stress test or capacity configuration changes were authorised/performed. Plan for staging load tests, cache/refresh fan-out review, auth proxy rate limits and budget before a viral campaign. Visitors do not all count as Auth monthly active users. Official pricing references and the distinction were researched for the owner's answer; do not turn this into an automatic paid upgrade or a new open-ended workstream.

The current development branch is `fix/pc-experience-2026-09-06`, descended from launch handoff `98d7de9`. Continue from this branch, not the older application source or main. The revised scope and deliberately disabled features below remain in force.

Application commit `69281112a4c369c071541ac796df282a282a57b5` was published on 6 September at 14:02 UTC: production deployment `dpl_31AFT7Y2H8n8QZFKpHAYk1hn8Q8X`, https://browserp-hobby-2jl036v1c-browserp.vercel.app, with www/apex aliases READY. Live health confirmed the exact SHA, ready backend/auth/security, and disabled payments. All six anonymously probed staff endpoints denied access (401, no private data, no-store); the session response reported staff=false and staffAccess=false.

This release adds fail-closed staff UI/menu visibility, real profile avatars, separated provider reauthentication, modern public pickers and unclipped search, wider server details with two desktop advert rails, authentic publisher game artwork, GTA VI/6M Coming Soon, a transparent favicon and optional browser-only regional recommendations. Verification: 815 application tests plus 35 database tests, Node 24, 12 functions. See `browserp-platform/docs/PC_EXPERIENCE_2026-09-06.md` for evidence and boundaries.

Follow-up work on this same branch (asset cache 2.19.2) responds to the owner's wide-monitor screenshot: viewport-proportional advert rails and server frame up to 2400px, safe short-screen/mobile layout, clickable same-game feature tags with restrained motion, and graceful recovery from explicitly invalid legacy refresh tokens. The preceding 2.19.1 arrow-only preview was superseded, not separately promoted. Check final deployment status against live health; do not assume the historical deployment ID above includes these follow-ups. Main and the shared launch branch were not changed. Another collaborator's `collab/enquiry-shared-ip-20260906` preview was not merged or promoted.

## Read this first: revised scope

The owner is moving from the Mac to a PC, using the same account and working with a friend. Development is resuming; the earlier instruction to pause for a week is superseded. The owner is arranging additional usage. Do not purchase or redeem usage on their behalf from this note.

This handoff supersedes conflicting scope/status in `browserp-platform/docs/RESUME_NEXT_SESSION_2026-09-06.md`, the original launch brief and historical continuity entries. Read historical records for evidence, not as instructions to restore work the owner has now removed.

**Removed from the active scope by the owner:**

1. Dedicated real-account Google/Discord login, consent, linking/unlinking and similar external account-flow testing/rehearsals. Do not spend the next session arranging test accounts or repeat provider authorisations for this programme. Existing account security and ordinary regression tests remain in place; repair a concrete bug if encountered.
2. Full account/website backup-and-recovery rehearsal, including the extended Auth/MFA/Storage/Vault restoration exercise and repeated backup-passphrase sessions. Preserve existing backups and security controls. This work is removed, not claimed complete.
3. The open-ended research, inspiration and optional upgrade stage. Do not start another competitor/inspiration study, speculative redesign or new-feature programme. Finish remaining agreed development and specific defects. Normal research needed to implement an existing task correctly, and maintaining the agreed server catalogue, are still appropriate.

The requested community Discord, existing website/staff features, concrete design fixes, security, branding and free SEO work remain in scope. Google branding-review status is a provider follow-up, not a reinstatement of Google login testing.

## Exact starting point

- Repository: https://github.com/browserp/browserp-hobby
- Working branch: `launch/complete-inherited-work`. Continue from its latest remote tip; create an isolated child working branch when useful for collaboration. **Do not start from main or the old release/browserp-v2 base**, which would omit later work.
- Application directory: `browserp-platform`.
- Production: https://www.browserp.com
- Live application source: `445a85218f23b697e12bfaceb5e681f7172e0df9` (asset release 2.18).
- Production deployment: `dpl_6jemV4Ha1NZeVqXqxhVhEZu54dsu`, https://browserp-hobby-ehf3u1zpo-browserp.vercel.app . READY with www/apex aliases was freshly confirmed on 6 September.
- Reviewed preview: https://browserp-hobby-8wnpxtzr4-browserp.vercel.app (`dpl_3VoFXb7cbDvSKKE3aq7JriMbBNAX`).
- Subsequent commits `9765989`, `90049ac` and this handoff contain documentation only. All completed application code was already published. Do not redeploy solely to publish these notes.
- Main was not merged or advanced. No unfinished application-code diff was left at the pause. Existing feature worktrees on the old Mac are not independent pending release instructions; reconcile their commits before considering any merge.

The earlier roughly 80% completion estimate covered the larger previous scope. It is historical, not a measured percentage for this revised scope. Reconcile remaining deliverables before offering a new estimate.

## Starting on the PC

Clone the repository and check out `launch/complete-inherited-work`. Open the repository as the local project. The handoff and tracked evidence are portable Git files; do not depend on the Mac's absolute paths.

```sh
git clone --branch launch/complete-inherited-work https://github.com/browserp/browserp-hobby.git
cd browserp-hobby/browserp-platform
npm ci
npm run dev
```

Use Node.js 24.x and the committed npm lockfile. The app is a multipage HTML/CSS/JavaScript site with Node API functions; do not replace it with a new framework. Scripts verified from package.json: `npm run check`, `npm test`, `npm run test:db`, and `npm run verify` (all three gates). The package version/old README release paragraph predates the live 2.18 asset release; use this handoff and release evidence for current status.

Read `.env.example` for configuration names, not as proof that credentials exist on the PC. Browser cookies, provider sessions, local environment secrets, test-browser installations, recovery archives and passphrases do not transfer through this Git handoff. Verify the tools actually available on the new machine. Use existing authorised provider access/secure environment mechanisms; ask only for genuinely missing access. Keep secrets out of Git, chat, screenshots and handoff documents. Never copy the Mac's entire home/config folders into the project.

Environment identifiers (not credentials): Supabase project `kywabzfgjoqiznnxygbq`; Vercel project `browserp-hobby` under `browserp`; Cloudflare zone `browserp.com`; master-account Discord application `1545874834708234321`; community Discord server `1545981135409123409`.

The encrypted recovery material remains on the Mac under the owner's BrowseRP Recovery location and was not transferred. No restore/passphrase task should be recreated from this fact. Ordinary development should proceed independently.

## Completed baseline to preserve

### Public website and staff panel

- Shared public/staff Menu and Close appearance, stationary opening/closing pointer and touch targets, improved logo/header/corner spacing, keyboard focus and Escape behaviour. Public navigation and staff navigation remain bespoke.
- Removed the useless Dark workspace pill and supplied a real View website action. Repaired the hidden search label painting behind the home logo without removing accessible labels.
- Improved scroll/touch interaction, shared primary-button colour feedback and cancellation during scroll/pan, disabled actions and reduced motion. Preserve the desktop colour-shifting effects the owner likes.
- Consistent directory/game cards: approved logo, then banner fallback, then initials; three feature labels; correct metadata order: **platform, region, language, framework, access**. Roblox has community-listing wording without fake live counts.
- Four launch games and their artwork: FiveM orange, RedM red, Roblox white/silver, Minecraft green. Pink/violet remains BrowseRP's core identity. Other games stay in the coming-soon boundary; Forza artwork was retained there. The All games artwork is distinct from BrowseRP's RP brand emblem. No duplicate symbols obstruct game pictures.
- Overview, moderation, roles, publishing/blogs/announcements, health controls and scraper areas already exist. Refine specific incomplete behaviour rather than rebuilding them from historical requests. Preserve useful staff control density and the same quality of typography, buttons and spacing as the public site.

### Catalogue, owners and operations

- Recorded launch target reached **40 FiveM / 20 RedM / 3 Minecraft English-speaking communities**. These are dated curation results, not a live guarantee or an objective claim of the world's best servers.
- Selection considered rules, onboarding, moderation, credible community history and representative regional activity, not just concurrent players. Weak-evidence listings were held reversibly. Check existing listings before further expansion.
- Live-source refresh/health behaviour, approved artwork, correct join/Discord link classification, Public/Whitelisted filters, tailored game filters and name-search relevance were improved. Unavailable/stale counts remain unavailable, never invented as zero.
- Claims with Discord ownership evidence and staff review, owner corrections/resubmission and reviewed updates are implemented. Roblox uses reviewed applications with complete atomic submission and safe account-bound retries.
- Advertising enquiries support member submission/withdrawal, staff review/reply/closure and private history/export. Managed advert artwork and avatar validation were strengthened. This is not a live payments system.

### Security, privacy, branding and SEO

- Active-session/current-account, origin/CSRF, permission and private-record access checks; safer account disconnection; staff MFA protections; interrupted authenticator setup recovery; private-session cleanup; guarded owner mutations and retry behaviour.
- Private member data requests/staff handling and structured account JSON downloads. These do not imply that full file delivery, erasure or disaster recovery has been demonstrated.
- Cloudflare account-level review of TLS, proxy records, firewall/DDoS settings, caching and challenge compatibility. Website staff MFA is enforced. No claim of being unhackable or exhaustively penetration-tested.
- Public initial HTML and article content, canonical URLs/identity, published-only sitemap, pagination/link improvements and brand-search foundations. Google Search Console and Bing ownership verified, sitemap submitted. Free SEO plan exists.
- BrowseRP/RP Google OAuth branding submitted; the last provider status was manual review pending. Master-account Discord login app configured in earlier work. Do not claim provider approval from a submitted review.
- Encrypted database/media captures and isolated restoration of six configuration tables completed. The broader recovery exercise was incomplete and is now removed from active scope.

## Remaining active work

### 1. Finish the community Discord

Already created: RP emblem/banner/description, rules, announcements, four game chats, private staff/safety areas, General/Group room/Music lounge voice rooms, four coloured interest roles and initial spam/default-permission protections.

Finish:

- Onboarding, rule acceptance and game-role self-selection.
- Appropriately scoped staff roles/assignments and support/showcase channels without excessive empty channels.
- Ordinary-member Discord channel/role permission checks and final spam-rule readback. These are community safety checks, not the removed website login rehearsal.
- Moderator 2FA, currently OFF at last readback and requiring the owner's fresh authentication.
- Optional maintained music bot, limited to appropriate music channels with only required permissions; no Administrator or private staff access. Jockie was researched, not installed or approved as guaranteed suitable. Verify current capabilities before selecting it; no paid subscription/trial was purchased.
- Test the configured community before publishing its invite. **No public invite has been released; no music bot or staff member has been assigned.**

Owner attention: a previously displayed set of Discord recovery codes was captured during an earlier status check; replacement was deferred after an invalid-key error. Do not expose or use those codes, claim they were rotated or block unrelated development on this. Let the owner resolve replacement privately when available.

### 2. Finish concrete website/staff defects and existing features

Reconcile recorded incomplete items against current code and UI. Prioritise actual broken/disconnected controls, misleading states, missing staff operations and consistency defects. Preserve the current design and functions. Claims, reviewed updates, advertisements, publishing, moderation, health refresh and user-data handling are the existing surfaces to keep coherent and operable. Avoid automatically rebuilding an old task already completed.

Remaining device/usability checks may cover menu positioning, scrolling feel, touch colour feedback, filters, public cards, ordinary upload handling, readable errors, cancellation and return-to-page state. Keep dedicated provider/account-rehearsal tasks out of this pass. The owner and friend can supply real-phone observations; emulated viewports do not count as physical devices.

### 3. Remaining security configuration and safeguards

- Check shared-IP rate-limit usability for multiple legitimate visitors while retaining abuse protection.
- Supabase SSL enforcement was OFF at last readback. Review actual dependencies and managed restart impact before any change; do not blindly toggle it.
- Preserve server-side permission checks, staff MFA, private-data boundaries, safe image handling, origin/CSRF protections and disabled payment boundaries.
- Fix specific security findings and verify those changes. No unsolicited destructive/load testing of production or third-party servers.

### 4. Complete the agreed free SEO and branding follow-through

Use `browserp-platform/docs/SEO_LAUNCH_PLAN.md` and reconcile which items are already shipped. Finish concrete pending metadata/social-image/internal-link/indexing work, useful human content and provider-review follow-ups. Check brand presentation wherever users encounter it, without reopening the removed consent/login testing programme. Keep BrowseRP as the brand and RP as its emblem.

Do not make unsupported ranking promises for BrowseRP/RPBrowse, fabricate reviews, keyword-stuff, generate generic filler or buy SEO services. Google branding approval remains an external dependency; report actual status.

### 5. Maintain catalogue quality and source health

Refresh dated observations before expanding or removing listings. The target is already recorded as reached. Approximately 35 players in representative sessions is a guideline with regional/time-history context; one off-peak reading is not grounds for removal. Preserve source/provenance and qualitative evidence, correct access labels and images. Whitelisted means application plus approval. Do not invent friendliness or access to private Discord discussions.

Keep Roblox application-led. Unsupported/future games remain coming soon. Do not revive demo or held listings simply to increase totals.

Payments/coins and unfinished developer/resource products are deliberately disabled. They are separate product decisions, not permission to enable untested functionality under this handoff.

## Verification and collaboration

Latest published source passed **813 repository tests**: 778 application plus 35 additional database; no failures/skips. Syntax and function-count gates passed. There were **29 exact-preview checks, 29 production checks**, and six additional public/staff touch scenarios across Chromium, Firefox and WebKit. The hosted matrix included 390/1280 widths, source asset hashes, stationary menu targets, Cali search/game parity, guide content, images and access gates. The existing signed-in owner's Overview/enquiry queue responded normally.

This evidence belongs to source445a852. Do not add previous release counts as unique tests or claim physical-device, payment, provider-login or attack-resilience proof. The removed rehearsal work remains unproven; removal does not weaken normal regression tests for code being changed.

On the PC, establish a working environment once, run focused checks during implementation and the repository release gate plus relevant hosted/browser checks before a release. Do not repeatedly rerun broad audits without a concrete reason. Do not conduct expensive research or deployment loops simply to demonstrate activity.

Coordinate with the owner and friend: check for their changes before editing/publishing, isolate overlapping code work, never overwrite their work or force-push shared branches. Independent agents can handle bounded non-overlapping tasks; migrations and releases remain ordered. The owner previously authorised tested production releases, but this handoff itself changes no live configuration and does not authorise merging main or paid purchases.

Keep a concise completed/unfinished/disabled/owner-action ledger. Explain work in normal language. Ask only for specific genuinely missing access; continue other useful work meanwhile. Use available tools efficiently and keep browser sessions tidy. Do not assume the PC has the Mac's tooling, browser sessions or hardware limits.

## Evidence to consult selectively

- `browserp-platform/docs/TOUCH_GUIDE_CARD_RELEASE_2026-09-06.md` — latest code and exact release checks.
- `browserp-platform/docs/ENQUIRY_UPLOAD_CLAIM_RELEASE_2026-09-06.md` — enquiries, uploads and claim fixes.
- `browserp-platform/docs/ACCOUNT_PRIVACY_RELEASE_2026-09-06.md` — data requests/export and private boundaries.
- `browserp-platform/docs/DISCORD_COMMUNITY_SETUP_2026-09-06.md` — actual Discord setup and remaining actions; later entries supersede earlier pending lists.
- `browserp-platform/docs/SEARCH_AND_BRANDING_SUBMISSIONS_2026-09-06.md` — provider submission outcomes.
- `browserp-platform/docs/SEO_LAUNCH_PLAN.md` — free SEO plan; reconcile completed items.
- `browserp-platform/docs/LAUNCH_CONTINUITY.md` and `LAUNCH_BRIEF_2026-09-05.md` — historical intent/evidence, subject to this revised scope. Their older release IDs are not current.

Start with this handoff, current Git state and one short live-state check. Choose the next concrete remaining development task with the owner/friend, then implement it. Do not spend the first session reconstructing the entire conversation or resurrecting the three removed workstreams.
