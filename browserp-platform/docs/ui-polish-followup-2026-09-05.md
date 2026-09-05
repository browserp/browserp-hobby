# Concrete UI follow-up — 5 September 2026

This is a bounded audit of real friction, not a request to flatten BrowseRP's character or reduce useful staff controls. Keep the established public design, grouped staff controls, clear status badges and meaningful game imagery. Root is integrating the shared header and menu fixes separately.

## Implemented in this batch; awaiting integrated release verification

- **My account → Submission progress:** render the owner's review feedback from the existing authenticated `GET /api/submissions`. Keep the existing listing dashboard and recent submission list visible if that request fails; provide a local retry. Show the latest decision and a status-specific explanation. Render review text as text, and reject late updates or detached retries after the session ends. This is feedback visibility, not a new editing workflow.
- **Staff moderation → Edit server:** label the flag **Owner verified**, with “Confirms ownership of the listing, not server quality.” Keep the existing saved boolean and permissions unchanged.
- **List a server → Setup field:** change examples and suggestion types with FiveM, RedM, Roblox or Minecraft. Preserve the existing form behavior and Cfx-link visibility.
- **Staff scrapers → Roblox:** identify **Roblox applications**, with **Application workflow — in development**. Preserve the useful research sources and plan; application tools are still inactive.

Focused verification passed 29 tests across submission feedback, listing setup, the existing dashboard, staff moderation, scraper navigation and account-session cleanup. Four modified JavaScript files passed syntax checking; `git diff --check` passed. These are local DOM/behavior checks, not live publication or physical-device validation.

## Remaining real workflow gaps

### 1. Replying to a request for listing changes

**Screen and frustration:** My account now shows why staff requested changes, but an owner still cannot edit and return that same submission to review. The current form creates a new submission, so a button labelled “Edit” or “Resubmit” would misrepresent its behavior.

**Evidence:** `public/browserp-portal-v2.js`, `dashboardSubmissions()`; `api/submissions.js` supports owned GET and new-submission POST, not an owner update; `supabase/migrations/20260819214000_profile_retention_security.sql`, `private.flag_duplicate_submission()`, records duplicate-submission signals. Sending owners to create the same listing again is not an equivalent correction flow.

**Small meaningful next implementation:** a permission-checked owner correction action on a `changes_requested` submission, prefilled from that record, with the review note beside it, retained draft after a failed save, conflict detection, and an explicit return to review. Keep original ownership, evidence and review history. Test a different owner, closed decisions, duplicate clicks, stale versions and staff receiving the corrected item. Until then, show the feedback and listing standards without a pretend editing control.

### 2. Advertising enquiries and public launch-state copy

**Screen and frustration:** The site's **Advertise here** link reaches `/advertise`, whose main action is **Open my account**. It does not start an advertising enquiry, and the dashboard does not supply that missing action. The public `/coins` explanation also exposes internal ledger/reconciliation details that do not help a prospective advertiser decide what to do.

**Evidence:** `public/advertise.html:50` links to `/dashboard`; `public/coins.html` describes its balance ledger and financial testing; the current dashboard in `public/browserp-portal-v2.js` has no advertiser enquiry form. Recheck current root changes before implementation.

**Small meaningful next implementation:** connect the advert invitation to a real enquiry/review flow with clear submission expectations, or accurately say enquiries are not open yet until that exists. Keep useful information on placement, moderation, eligibility and refund expectations. Retain staff-side delivery/payment controls and records; do not enable unverified checkout merely to remove a launch-state message. Replace internal implementation detail with a concise account of what customers can use and when.

### 3. Roblox application workflow

The plan is accepted; its current staff panel remains a documented plan, not working applicant intake. Build and test that workflow under the full launch scope when the existing higher-priority work is ready. Changing the planning label does not claim this feature is complete.

## Design boundary

No additional confirmed “Dark workspace”-style fake control was identified in this bounded pass. Keep real controls and status information. Judge future changes by a concrete task that becomes clearer, safer or easier; don't substitute a broad simplification or visual redesign for fixing the specific frustration.
