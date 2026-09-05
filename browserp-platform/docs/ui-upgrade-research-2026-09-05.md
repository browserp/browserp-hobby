# BrowseRP: three useful product improvements

**Update, 5 September:** The owner correction loop identified below is now implemented locally, including staff submission/queue version checks. See [SUBMISSION_CORRECTIONS.md](SUBMISSION_CORRECTIONS.md) for behavior, verification and deployment order. The original findings below describe the pre-fix state.

Read-only review and primary-source research, 5 September 2026. This reflects the current local release candidate, including the owner-feedback and Roblox-status wording changes. No production interaction, application, enquiry, message, purchase or repository code change was made for this research pass. Existing release work takes priority over these implementations.

## Purpose and design test

BrowseRP should help roleplayers find a community they will enjoy returning to, and help good communities explain what makes them worth joining. At launch, this means English-speaking communities across the four chosen games, with reliable descriptions, clear joining requirements and honest activity information. It does not mean squeezing every community into the same population leaderboard.

A worthwhile improvement should remove a specific obstacle for a player, owner or staff member. Keep the distinctive pink/violet brand, game accents, useful imagery, lively desktop buttons and grouped staff control panel. Sharing high-quality components does not require identical information density on every screen. No new decorative badge, oversized onboarding wizard or generic dashboard redesign is proposed here.

## 1. Owners need to be able to act on requested changes

**Priority:** first. **Classification:** an incomplete existing owner workflow, not a new product idea.

**Current journey:** submit a listing → staff request changes → My account shows the decision and now its review note → the only contextual action is reading the standards. There is no way to correct that same submission. The owner either stops or starts a duplicate listing from scratch.

**Exact current evidence:**

- `public/browserp-portal-v2.js:336`, `dashboardSubmissions()`, renders feedback; at lines 352–359, `changes_requested` explains the need for changes and only offers `/legal#standards`.
- `api/submissions.js:160` exposes GET and POST. GET at 168–174 reads submissions for the current owner. POST at 177–208 creates a new submission via `create_server_submission_server_v2`; it does not accept an existing submission for correction.
- `public/browserp-directory.js:370` posts a new form to that endpoint; it sends no submission identity or revision. Its failure handler already preserves entered form values, a useful behavior to retain.
- `supabase/migrations/20260819214000_profile_retention_security.sql`, `private.flag_duplicate_submission()`, records a duplicate signal for matching recent names or community URLs. “Create another listing” is therefore a poor substitute for correction.

**Small complete improvement:** put **Make requested changes** beside the feedback when that owner is allowed to revise the record. Open the existing listing form with its values filled in, show the review note alongside the relevant fields, and use **Send changes for review**. Preserve the submission's identity and its history; return it to the staff review queue only after a successful save. Keep the current listing visible while work is pending. A rejected decision should have its own explanation and allowed next steps rather than silently behaving like an editable request for changes.

**Why this pattern is useful:** Modrinth keeps review communication on the project and distinguishes a project waiting for its first review from one returned after requested changes. That supports keeping a single understandable owner/staff conversation around the same item. BrowseRP should borrow that continuity, without inventing a queue position or a promised review time. [Modrinth: Project Review Times](https://support.modrinth.com/en/articles/8793355-project-review-times), checked 5 September 2026.

**Finished means:** an owner can open the correct record, make a correction, recover after a network failure and see it awaiting review; staff see the changed record with its earlier feedback. A different account, an expired session, a decision that changed mid-edit and repeated clicks must not overwrite or duplicate it. On mobile, returning from a field error must not lose the draft or jump past the feedback. This is a complete loop, not just a new button.

## 2. Roblox applications need to identify the actual community

**Priority:** after the correction loop, reusing it. **Classification:** already accepted scope with a generic intake available; the dedicated workflow is incomplete.

**Current journey:** Roblox is one of the active launch games and can be selected in **List a server**. The form collects the same general listing data used by other games. Staff's Roblox section describes an application-led approach and is correctly marked in development, but does not provide an application workspace. Calling Roblox wholly unsupported would be inaccurate; calling its intended application workflow complete would also be inaccurate.

**Exact current evidence:**

- `public/browserp-games.js:19` includes Roblox in active games; lines 96–100 mount the regular listing search for it.
- `public/list-server.html:11` includes Roblox in the game selector. `public/browserp-directory.js:292` now has a proper Roblox experience label/example, but lines 370–385 still send only generic listing fields.
- `api/submissions.js:142–152` captures a free-text setup and one community URL. It has no separate official Roblox experience link, community-control evidence, rules link or session schedule.
- `public/staff-scrapers.js:25–28` records the intended application approach and the distinction between experience-wide and community counts. At 127–137, only FiveM, RedM and Minecraft mount import tools; Roblox mounts the planning panel.
- `docs/LAUNCH_CONTINUITY.md:66` explicitly records the generic submission/dedicated application distinction.

**Small complete improvement:** adapt the existing owner form after choosing Roblox. Ask what they are listing: their own experience, or an independent RP community within an existing experience. Then ask for the official experience link, the community's own joining route, their role and evidence of control, concise RP style/rules, language/region and when sessions normally happen. Give the applicant a public-listing preview, a saved application with a status, and the same correction loop as other submissions. Staff should review these in a dedicated Roblox queue with the evidence and public preview together.

The public listing should make three things obvious: **which game this uses**, **what this community is like**, and **how to join this community**. A link to the whole experience should not masquerade as entry to a particular private RP group. Count unavailable is an acceptable truthful state; an unrelated experience-wide total is not.

**Why these patterns are useful:** Roblox documents games as potentially containing several places, with their own access and creator/group structure. That is enough to reject the assumption that an experience link uniquely identifies the community BrowseRP is listing. [Roblox: Create and publish games and places](https://create.roblox.com/docs/production/publishing/publish-games-and-places), checked 5 September 2026.

Discord's onboarding examples show how a few relevant choices can guide someone while keeping less important questions for later. Apply that conditional approach to owner intake; do not copy Discord's UI or add a multi-step wizard where one well-grouped form is easier. [Discord: Community Onboarding Examples](https://support.discord.com/hc/en-us/articles/10394859532823-Community-Onboarding-Examples), updated 20 April 2023 and checked 5 September 2026.

For ER:LC specifically, the official private-server API can expose the server's own live data. Current documentation requires the server's API pack and a server key. This is an optional owner-authorized integration to assess separately, not a reason to demand keys in a generic application or assume every Roblox community can provide telemetry. No provider purchase is proposed. [ER:LC Private Server API](https://apidocs.erlc.gg/), checked 5 September 2026.

**Finished means:** a real applicant can submit the right kind of community; staff can verify its identity/control, ask for changes and publish an accurate listing; a player can distinguish the underlying experience from the listed RP group. Test wrong-domain URLs, revoked/invalid evidence, duplicated communities under different names, failed saves, private evidence visibility, misleading count sources and joining on mobile. Do not label Discord guild ownership alone as proof of owning a Roblox experience.

## 3. Advertising needs a clear invitation and next step

**Priority:** after the owner/application gaps, while payments remain independently gated. **Classification:** a current expectation mismatch and public-copy problem; disabled purchasing itself is deliberate, not a bug.

**Current journey:** the public carousel says **Advertise here** → `/advertise` explains placements, says an enquiry route will open later, then prominently offers **Open my account** → the dashboard has no campaign enquiry action. The user can read about a future service, but the invitation looks more actionable than the journey is.

**Exact current evidence:**

- `public/browserp-v3.js:229` supplies the default advertising call to action; the footer also promotes `/advertise` and `/coins` at line 409.
- `public/advertise.html:47` says BrowseRP will publish an enquiry route before campaigns open. Line 49 discusses “live signed-event testing”; line 50 links the main action to `/dashboard`.
- `public/browserp-portal-v2.js:623–629` renders listings, submissions, saved servers, history, notifications and profile, with no advertiser enquiry entry.
- `public/coins.html:7` describes the internal balance ledger, reconciliation and an instruction that pages must never imply a disabled feature is for sale. Those details belong in internal release documentation, not the explanation for a community owner.

**Small complete improvement:** first align the current invitation: explain that advertising enquiries are not yet open and offer **See advertising options** from the carousel. Keep the useful information about placements and review. Replace implementation detail with human copy such as: “Paid campaigns aren't open yet. Before you book, you'll be able to review the placement, price and terms.” Coins can plainly explain their intended use and that buying/spending is unavailable, without promising an opening date.

Then complete a small **Ask about advertising** flow if it is part of this launch: community/listing or service link, intended audience/game, optional dates, and what they want to promote. Use the signed-in account to avoid asking for information already known. Confirm receipt and show the enquiry status in My account; put enquiries alongside the existing staff advert workspace. Ask for artwork only when it is actually needed. This does not need a full sales system, marketing automation or coin checkout to be useful.

**Why this pattern is useful:** EthicalAds connects its advertiser page to an actual enquiry form, explains audience/placements, and states that its team approves and starts campaigns even though advertisers later have their own controls. The relevant lesson is an understandable handoff from public interest to staff review. Its market, pricing and visual style are not a template for BrowseRP. [EthicalAds: Advertise with Us](https://www.ethicalads.io/advertisers/), checked 5 September 2026.

**Finished means:** every advertising invitation lands on the current service state; an open enquiry reaches a monitored staff queue and can receive an answer visible to its owner; a closed enquiry state never suggests a purchase or immediate campaign activation. Test signed-out return paths, duplicate sends, account separation, unavailable services, staff permissions and mobile form errors. Keep existing financial release tests as the boundary for enabling payments.

## Cross-product polish: keep the strengths and fix one confirmed touch issue

The current code already preserves visible content while shortening desktop reveals: `public/browserp-v3.css:51–63` uses a small 120 ms transform with opacity 1. On touch devices it removes scroll transforms at 420–422. `public/browserp-v3.js:86–111` also bypasses reveal waits for touch and live result sections. These are useful safeguards; do not replace them with a new smooth-scroll engine or delayed entrance effect.

**Confirmed small bug for the final motion pass:** `public/browserp-v3.js:663–675`, `touchPolish()`, starts a sweep after two animation frames on touch `pointerdown`, and removes it only on `animationend`. It does not cancel pending frames or the sweep when the browser cancels the pointer to begin scrolling. The effect lasts 460 ms (`public/browserp-v3.css:111–112`).

An isolated DOM check using that exact function ran: touch pointerdown → pointercancel → drain its queued animation frames. The button still received `touch-sweep-v3`. This confirms an event-handling gap; it is not physical-device frame-rate evidence. Preserve the immediate colour response, but cancel queued/current press feedback on pointer cancellation and a dragged-away press. This should not cancel native scrolling or turn decorative feedback into an extra click. MDN confirms that a browser can dispatch pointercancel when a touch becomes a pan/zoom/scroll gesture. [MDN: pointercancel](https://developer.mozilla.org/en-US/docs/Web/API/Element/pointercancel_event), checked 5 September 2026.

**Subsequent implementation checkpoint:** the release owner assigned this narrow repair after the research handback. `touchPolish()` now cancels pending frames and clears the sweep for cancellation, a pan/dragged-away press, scrolling, lost window focus and motion-preference changes. Normal taps retain their sweep and native click. The new `test/touch-feedback-ui.test.mjs` plus affected branding, game visibility and public navigation tests passed 64 tests locally. Integrated release/browser verification is still separate; the historical reproduction above describes the pre-fix behavior.

Across all three future flows, reuse the established stationary Menu/Close, button styling, field spacing, feedback and dialog patterns. Keep the staff's grouped controls and public site's character. Validate touch press/cancel, keyboard focus, Escape, failed requests, small screens and reduced motion on the actual integrated build. Honor the user's reduced-motion preference while retaining clear static colour/focus feedback. [MDN: prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion), checked 5 September 2026.

## Verification boundary

This pass checked current local source, the existing UI tests/read-only fixtures, relevant routes and primary product documentation. It did not claim every page, hosted provider login, payment, physical device, GPU or browser engine had passed. The release owner is performing integrated verification separately. The three improvements above should follow the already-authorized launch work; the additional touch fix is a narrow regression repair within the existing motion scope.
