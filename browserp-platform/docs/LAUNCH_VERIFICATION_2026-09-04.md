# BrowseRP launch verification — 4 September 2026

## Published collection

| Platform | Published communities |
| --- | ---: |
| FiveM | 32 |
| RedM | 20 |
| Minecraft | 3 |
| Total | 55 |

These are English-speaking launch selections. Research considered attributable community websites, rules, onboarding, roleplay focus and source reliability alongside activity. Candidates without sufficient evidence stayed out of the launch collection. Roblox remains for the later applications-led rollout.

Research and supporting links: [FiveM](launch-curation/fivem-research.md), [RedM](launch-curation/redm-research.md), [Minecraft](launch-curation/minecraft-research.md). The staff scraper shortlist also presents the supporting links while each import is reviewed.

## Verified behaviour

Full repository verification passed **277 tests**. The additional claims/moderation PostgreSQL suite passed **26 tests**. No test failed or was skipped.

- All 55 public detail routes returned HTTP 200. All 56 published image assets were available static PNGs. Broken regional image placeholders were removed, animated source logos were stored as validated static artwork, and image-error fallbacks were checked.
- Canonical join links, community Discord links, English metadata and game-specific filters were checked. Metadata order remains platform, region, language, framework, access. Public filter usage counts stay hidden; staff can see them.
- Desktop and mobile checks found no horizontal overflow or browser JavaScript errors on the sampled game/detail pages. The menu button stayed in the same position. Staff access, Overview, Moderation, profile and connection screens were also checked at desktop and mobile widths.
- Automated checks cover importer validation, source freshness, verified zero versus unavailable counts, PostgreSQL permissions, claim/moderation history, account/CSRF/OAuth boundaries, upload ownership and limits, and refresh cancellation/lease behaviour.
- Scheduled refreshes were observed for more than six minutes without opening individual listing pages or manually refreshing sources. All observed dispatches returned HTTP 200, all runs completed, and there were no worker failures or deferred items. Directory requests were limited to the beginning and end of that check. Each source's lease-derived attempt age stayed below 75 seconds at the sampled times.

The sustained check established refresh coverage; it did not establish that every upstream record is always current. Cfx sometimes returned successful responses with source timestamps older than five minutes. Those observations remain unavailable instead of being represented as zero or newly measured counts. Direct upstream samples confirmed that timestamps and counts later advanced together. Minecraft totals describe the advertised network, not a particular roleplay world.

The final recovery migration clears a previous failure after a valid equal-timestamp retry and uses 55-second source cooldowns, giving ordinary short refreshes room before the next one-minute schedule tick. Its regression tests reproduce the previous failure and verify recovery without duplicate snapshots, fabricated timestamps or weaker freshness limits.

## External verification limits

Real Google/Discord consent and member identity-linking were not completed. The production provider endpoint reports both providers enabled, and callback, CSRF, PKCE, state, nonce, same-account and staff restrictions passed regression checks. The hosted manual-linking setting could not be inspected through the authenticated tools; disabled linking produces a recoverable message. An ordinary consenting member still needs to complete the real provider flow. The owner/staff account was not modified to test linking.

Profile upload tests used a real generated PNG through the actual route with an isolated backend; no production profile or account was changed. All three published Minecraft communities passed real Java status checks. Bedrock parsing, UDP behaviour and cancellation were tested locally; no production Bedrock community was added.

See [staff/account evidence](STAFF_ACCOUNT_AUDIT_2026-09-04.md) and [scheduled refresh operations](SERVER_STATUS_REFRESH.md) for the detailed boundaries, including hosted extension permissions and the Data API schema isolation check.
