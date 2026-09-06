# Reviewed updates from listing owners

Prepared as a separate add-on to release `7778a56bba4d16561c9669c255261582f9b53827`, including `20260905224408_reviewed_roblox_applications.sql`. This feature has no live migration or deployment yet.

## What owners and staff can do

My account → Your listings → **Request update** loads the current published listing. Owners may propose a name, description, region, language, setup, community destination, access requirements and features. Reviewed Roblox communities may also improve their public joining instructions. Descriptions already published at up to 3,000 characters remain intact; ordinary new applications retain their existing HTTP limit of 1,500.

The live page stays unchanged until approval. Updates use `server_submissions` and the existing Moderation listing queue. My account shows the same review progress and feedback as new applications. One open update per listing prevents duplicate requests. An existing update links back to its review. Staff see plain before/after descriptions and can request corrections or reject a proposal. Applying changes to a published listing requires both `servers.review` and `servers.manage` through the existing allowed-staff/MFA permission boundary.

A successful decision updates the existing server row. Its address, ID, current owner, original source application, import source and player-count configuration, images, website, staff flags, ranking fields and publication history remain attached. Unchanged features preserve their existing source labels. The contextual-features follow-up is required before rollout: it preserves all existing imported keywords, including more than eight and exact noncatalog values, while allowing only deliberate game-relevant additions/removals. Public game filters read the resulting approved feature records through the existing directory path.

Ownership means the current `servers.owner_id`, set by an approved original listing or the existing reviewed claim process. A linked Discord identity, Discord ownership signal or staff display role alone does not establish it. No team-editor role or new authority is created here.

Game and live connection changes remain staff-controlled. Roblox experience name, exact experience URL, community/group URL and listing type stay tied to their reviewed identity. Updating joining instructions does not assert ownership of the underlying Roblox experience. The form asks for no new private control evidence. Internal provenance is factual, kept in the private evidence table, and stripped from the owner response, public projection and broad approval audit. Older Roblox listings without reviewed experience details display a clear staff-setup message instead of a broken form.

## Conflicts and recovery

- Account-bound reads and writes recheck the current session, account, ownership and publication status. The API retains origin/CSRF checks and rate limits; service-only SQL creation/correction also locks and verifies the live Auth session. Ordinary member RPC calls cannot invoke those writers.
- Proposals bind to the live listing version. A newer staff edit prevents stale approval. Staff request corrections; the owner compares the latest live details with their saved proposal, renews agreement and resubmits through the same queue record. Approval checks that live version again.
- Ownership transfers prevent the former owner from reading/correcting the proposal and block approval. Staff may reject it to let the current owner submit their own request. Suspended/archived listings require a separate staff status decision.
- Submission and queue versions protect review decisions. Creation uses the existing atomic writer and retry receipt; target attachment is in the same transaction. An identical uncertain retry never creates a second listing or queue item. Reusing its key for a different target/version or payload conflicts.
- The form freezes an ambiguous retry body/key, checks the displayed account before each send, preserves unsent edits during a conflict refresh, and clears private page state on session end/navigation. Browser Back loads a fresh session. A correction retried after an intervening live edit returns a conflict and directs the owner to current review progress; it never reapplies stale text.
- Live updates, feature changes, queue state, review history and the audit entry succeed or roll back together. A tag or audit failure leaves the live page and proposal unchanged.
- An approved Roblox joining update survives a later staff edit that writes the same game/source values. The original publication trigger now copies initial Roblox details only when the source or platform actually changes, or on first insert.

## Rollout and rollback

1. Complete the Roblox release first. Its additive migration is the prerequisite; retirement of the old partial writers remains the separate release decision already documented in `ROBLOX_APPLICATIONS.md`.
2. Review and apply `20260905233144_reviewed_owner_listing_updates.sql`. It adds nullable proposal references, a private retry target/version and scoped wrapper functions. Existing ordinary applications and corrections keep their existing routes/signatures. It does not mutate any live listing or grant owner edit access.
3. Deploy the reviewed owner patch to preview. There are no new Vercel function slots, rewrite paths, environment variables, secrets or external services. The existing `/api/submissions` supports `GET ?listing=...`, owner-update POST and owner-correction PATCH. The existing staff action endpoint dispatch is unchanged.
4. Verify preview My account → Request update, regular creation/correction, one changed-listing review and session teardown. Use local or isolated fixture data for mutations. Check responsive/keyboard behavior with the coordinated browser batch before promotion.
5. Promote only the tested build. JavaScript/CSS already use `Cache-Control: public, max-age=0, must-revalidate`; no broad cache change is needed. Verify served hashes for the touched form, directory, portal and staff scripts. Old ordinary forms remain compatible; a stale owner-correction form receives a reload instruction instead of bypassing the new ownership check.

If UI rollback is required, preserve the additive data and reviewed queue history. The new SQL wrapper remains compatible with existing ordinary applications and the staff action path. Do not drop proposal columns/private receipts or restore old listing writers to work around an owner conflict. Owner-update foreign keys intentionally protect their referenced listing from physical deletion; existing archival/status moderation remains available. Any later permanent-purge design must account for this review history.

## Validation and remaining boundaries

The focused local suite covers API origin/CSRF/session/account denial, immutable retries, complete 3,000-character descriptions, one existing queue, private-field handling, ownership transfers, version conflicts and corrections, staff permission loss, transactional rollback, preservation of images/source/slug/flags/tag provenance, Roblox identity and later staff-edit compatibility. PostgreSQL behavior is executed in isolated PGlite with real application migrations/functions; its staff permission fixture represents an AAL2 permitted reviewer and does not replace hosted identity/MFA validation.

The final focused and adjacent regression run passed **100 tests**, including the final setup-availability and later-staff-edit changes. No production submissions, claims, server edits, owner-factor changes or deployments were made. No browser sessions were launched for this batch because the root task is coordinating browser checks and closing excess tabs. JSDOM behavior checks are not a claim of physical-device, layout or three-browser coverage.

This completes a reviewed owner metadata-update path. Uploading replacement server artwork, changing an imported connection/experience identity, granting additional community editors, and permanent account-data deletion are outside this bounded change and must not be marked complete by it.
