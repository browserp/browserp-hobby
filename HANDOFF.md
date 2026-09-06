# BrowseRP — PC development handoff, 6 September 2026

## Latest PC release — read before the historical starting point below

**Resume checkpoint, 6 September ~14:22 UTC:** application branch tip `306c07debf904bac1a871c8919d19fd1acd18006` is pushed and its exact preview is READY: `dpl_HsWz92j3gKGcSkeafr9kf5A3P6dZ`, https://browserp-hobby-ldmi60k7d-browserp.vercel.app . Full release gate: 821 application + 35 database tests, 12 functions. Hosted CaliRP page confirmed 2.19.2 styles and working tag links. **This follow-up is NOT YET production.** CUA browser control repeatedly crashed at the promotion-menu step; read-only deployment listing confirmed no new production deployment. Live health remains `69281112a4c369c071541ac796df282a282a57b5`. Resume by inspecting current live SHA/collaborator state, promote the exact validated preview in Vercel when browser control is available, then verify live health, responsive CSS, tag links and anonymous staff denial. Do not rebuild or reimplement completed work. No paid plan was purchased.

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
