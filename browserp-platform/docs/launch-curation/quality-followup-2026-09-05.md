# Existing-community quality follow-up — 5 September 2026

Research window: approximately **19:12–19:18 UTC**. This follows [the current roster audit](current-roster-audit-2026-09-05.md). Scope is eight already-listed communities, with no new candidates, production changes, messages, purchases, applications, or Discord joins.

## Decisions

These are editorial recommendations for the owner/staff workflow, not changes already applied.

| Community | Recommendation | What changed or remains uncertain |
| --- | --- | --- |
| Vital RP | **Retain**; source recovered | The same canonical source recovered after the earlier 404, and the scheduled worker accepted fresh observations without manual intervention. Official site and Discord still identify the same whitelisted community. |
| Ebonridge | **Retain with source unavailable**; do not publish the fallback count | Official source continues to set fallback=true. Current invite and public community profile support ongoing identity, but no cause or recovery date is confirmed. |
| Everglade County RP | **Retain provisionally as a smaller, structured option** | A fresh external week still falls below approximately 35 regular players. Readable current rules/onboarding offer concrete strengths. It is not a large or independently proven welcoming-community pick. |
| Sanctuary & Sin | **Recommend reversible hold from the curated launch selection pending stronger evidence** | A fresh week has only one 35-player reading. Public rulebook, accountable moderation/escalation, and independent newcomer experience remain unverified; recent launch limits track record. This is a fit/evidence decision, not a claim that it is badly run. |
| Bright Falls RP | **Recommend reversible hold from the curated launch selection pending policy review** | Current official store sells paid unban and punishment-removal products. Its new Documents page presently contains only a Test entry. Recurring attributed newcomer concerns remain unadjudicated. The strongest-launch/fair-moderation bar is not met by evidence available here. |
| HighLife Roleplay | **Retain ordinary directory presence; withhold special friendliness/governance endorsement** | Current written support and report rules are readable. They establish process, not how the disputed incidents were handled. Recent detailed allegations come from one account and its cross-posts, not several independent cases. |
| CaliRP | **Retain; access stays Not confirmed** | Current official-page application wording still conflicts with the exact Cfx record's public flag. Do not convert a department application into whole-server whitelisting or ignore explicit whole-server approval wording. |
| MassiveCraft | **Retain provisionally; access stays Not confirmed** | Live network and canonical Discord identity are established; current public joining/rules remain behind human verification. A generic welcoming description is not evidence of access requirements or actual newcomer care. |

A hold recommendation means reversible removal from BrowseRP's deliberately curated launch recommendation set until specific evidence clears it. It must not be presented publicly as a misconduct verdict, permanent ban, or server closure. The owner may prefer a smaller launch roster over a quota filled with unresolved choices.

## Vital RP: transient source failure resolved

The [official website](https://vitalrp.net/) explicitly identifies `ogpvmv`, requires adult applicants, describes an application/approval process, and tells approved users to connect through that same code. Its statements about welcoming culture and performance remain operator claims.

At 19:13:54 UTC, the [official Cfx record](https://frontend.cfx-services.net/api/servers/single/ogpvmv) returned HTTP 200, `gta5`, fallback=false, and 1/175 with a 19:12:01 heartbeat. Read-only production SQL at **19:18:27 UTC** then found a later accepted **15/175** observation from 19:14:06, with its source error cleared. This confirms normal scheduled recovery, not just a successful isolated request. The earlier 24-hour accepted peak was 80.

The [canonical Discord invite](https://discord.gg/vitalRP) returned a current VITAL RP community and no expiry at 19:15:41 UTC. Public guild description and membership support identity and ongoing community presence; they do not measure in-game population or staff quality.

**Next condition for a stronger recommendation:** readable current reporting/appeal instructions and recent independent newcomer experience. Keep the existing Whitelisted label. No code change or removal is warranted by the transient 404.

## Ebonridge: active community identity, unresolved usable live source

At 19:13:55 UTC, the [official Cfx record](https://frontend.cfx-services.net/api/servers/single/jdvk44) returned HTTP 200 and the correct RedM identity but **fallback=true**. Its included 69-player number is unusable as a live observation. Read-only production SQL at 19:18:27 correctly returned null players/capacity, with last accepted observation still 15:43:01 and a recent source error.

The [canonical public invite](https://discord.gg/ebonridge) resolved at 19:15:42 to Ebonridge, with an operator description of an early-access supernatural RedM community. This does not establish a restart, maintenance window, or reason for the fallback. No replacement code was guessed.

The [public community profile](https://top.gg/discord/servers/722899179269881856) corroborates English supernatural storytelling and custom systems. It showed **zero community reviews** in the fetched page. The adjacent 4.6 rating belongs to a music bot, not Ebonridge; never reuse it as a server-review score. The earlier [Cfx spotlight](https://forum.cfx.re/t/community-spotlight-july-2026/5417027/1) remains dated creative evidence, not a moderation certification.

**Decision:** retain its distinct community offering with an honest unavailable player state. Obtain an official status explanation or a valid subsequent heartbeat; keep current identity. Confirm current consent/reporting rules before assigning a stronger newcomer endorsement.

## Everglade and Sanctuary: refreshed representative activity

One ordinary public HTTP fetch per community retrieved the public chart data at [Everglade history](https://redmmetrics.com/server/boya5d?hours=168) and [Sanctuary history](https://redmmetrics.com/server/e66azka?hours=168). The range runs from **29 August 19:32 UTC to 5 September 19:15 UTC**. Six complete UTC days, 30 August–4 September, were used for daily comparisons.

| Metric | Everglade | Sanctuary & Sin |
| --- | ---: | ---: |
| Samples | 2,136 | 2,315 |
| Week maximum | 32 | 35 |
| Arithmetic sample mean | 9.9 | 15.4 |
| Median complete-day maximum | 29.5 | 31.5 |
| Samples at/above 35 | 0 | 1 |
| Complete days with at least three 35+ samples | 0/6 | 0/6 |

These are source observations with unequal sampling intervals, not unique people, time-weighted means, independently verified play sessions, or a staff-quality score. They cover repeated daily cycles, so the difference is not explained merely by one off-peak check. BrowseRP's own shorter window recorded Everglade peak 33; a one-player difference between sources does not change the conclusion.

### Everglade: useful structure, modest activity

The [current rules](https://evergladecountyrp.com/rules.php) loaded successfully in isolated Chromium. They publish English as primary language; prohibit harassment and doxxing; define consent for permanent injury; describe Discord ticket categories/evidence; and explicitly permit interrupting RP for serious safety issues. They also prohibit player unions and unapproved faction Discords. Those restrictions should be understood before calling the community unusually open or flexible. Published rules do not prove enforcement.

The [joining guide](https://evergladecountyrp.com/getting-started.php) gives Discord setup, RedM installation, connection, character creation, and department-entry steps. The [home page](https://evergladecountyrp.com/) still leaves the named staff roster empty. The canonical invite resolved on this pass. The current availability of rules and a detailed start guide is a real strength; verified staff response quality is still missing.

Targeted player-source searches mostly found a separate FiveM Everglade community, including a closure comment. That evidence is **excluded** because it concerns the wrong game/community; it must not be used to declare this RedM community closed or inherited its track record.

**Decision:** retain provisionally for structured civilian/frontier play and describe its modest population honestly. It is a near-threshold exception to consider on quality grounds, not a server demonstrated to meet regular 35+. Before prominent inclusion, obtain accountable staff/support evidence and current newcomer feedback. No immediate automatic removal is justified solely by 32/33 versus an approximate 35-player floor.

### Sanctuary & Sin: limited case for this particular launch

The [current canonical invite](https://discord.gg/tVUdnQYCRJ) resolves to Sanctuary and Sin: 1899 and describes serious frontier storytelling. This supports current identity; it does not show rules, staffing, response quality, or access requirements.

The [identity-matched source listing](https://fivemonitor.com/en/servers/e66azka) and retained source evidence carry an 8 August 2026 opening claim. Treat the opening date as an operator claim, not proof of a full continuity audit. Search did not locate identity-matched public conduct rules, a named escalation/appeal process, or substantial independent first-session accounts within this bounded pass.

**Decision:** recommend a reversible curated-launch hold because two requested selection criteria remain weak together: sustained activity around 35 and established, demonstrably competent newcomer care. This is not evidence of bad behavior. Conditions to reconsider: readable current rules/reporting/appeals, a credible onboarding/accountability route, several representative active sessions, and meaningful player experience. A larger candidate alone is not a sufficient replacement.

## Bright Falls: current paid sanction relief is now verified

The previously stored [dawmecorp.com address](https://www.dawmecorp.com/) now redirects in the rendered browser to **brightfallsrp.com**. The new site gives the same Discord invite and exact Cfx code `lyy7rv`, supporting continuity of identity. Cached extracts of the old site do not reliably describe the new page.

On the current [official store](https://brightfallsrp.com/store), selecting the **Appeals** category showed:

- **Unban — displayed $119.99.** Prior staff eligibility confirmation is required; the text says severe hate speech, doxxing, threats, or extreme toxicity may not qualify. It does not promise future immunity.
- **Coms Removal — displayed $35.99.** The text explicitly offers payment to clear the associated punishment.

This proves paid sanction-relief products exist. It does **not** prove every appeal requires payment, nor corroborate the older alleged $80 price. No purchase, cart addition, authentication, or request was made.

The current [Documents page](https://brightfallsrp.com/documents) says it contains rules and guides but exposes only **Test**. The [FAQ](https://brightfallsrp.com/faq) gives purchase support, subscription cancellation, in-game tax and property-inactivity information; it does not establish an independent or free misconduct-review route.

Two previously identified player threads were re-read: a [February account](https://www.reddit.com/r/RedDeadOnline/comments/1rbgxfw/if_youre_contemplating_about_joining_redm_bright/) and a [later newcomer account](https://www.reddit.com/r/RedDeadOnline/comments/1v6hbhl/dont_play_in_bright_falls_server/). They describe moderation/onboarding dissatisfaction. The first discussion also contains some positive player experiences. Neither anonymous accusations nor selected screenshots establish independently adjudicated misconduct; personal accusations are deliberately not reproduced here.

**Decision:** recommend a reversible curated-launch hold. The verified commercial sanction relief, missing readable current rules, and unresolved player concerns do not support BrowseRP prominently recommending it as one of the fairest or friendliest choices merely because it is active.

**Evidence needed to clear:** current conduct/reporting/appeal terms, whether a free independent appeal route exists, how paid relief affects ordinary penalties, treatment of severe safety violations, and credible balanced recent player experience. This is a product-fit decision; no illegality, corruption, or universal paid-appeal claim is made.

## HighLife: process evidence improved, behavior remains unproven

The rendered [current rules](https://highliferoleplay.net/rules) are substantial. They distinguish routine website reports after a scene, urgent F1 reports, support tickets, and staff-contact behavior. The [published roles](https://highliferoleplay.net/roles) assign impartial teaching/enforcement responsibilities. The [joining/support guide](https://highliferoleplay.net/guide) identifies Discord ban appeals and technical-help paths, but some guide content is older than the current rules. For ordinary report instructions, use the current rulebook rather than the older guide's broader F1 wording.

The [recent detailed player account](https://www.reddit.com/r/FiveMServers/comments/1uxcrz5/dont_play_on_highlife_roleplay/) alleges unfair enforcement and inadequate response to repeated harassment; it also praises anti-cheat work and some roleplayers. Cross-posts are the same account, not independent corroboration. The underlying private tickets and complete context were not available, and no external adjudication was found. Official policy cannot by itself rebut an allegation about actual enforcement.

**Decision:** retain the established, active directory option but withhold a special friendliness/fair-governance endorsement. Conditions for that endorsement are meaningful recent independent player evidence and clarity about escalation when senior staff or repeated harassment are involved. Do not announce misconduct as fact or remove solely on one disputed account.

## Access decisions

### CaliRP: keep Not confirmed

The [official homepage as indexed today](https://calirp.gg/) explicitly describes a general application gate and connection after clearance. The direct rendered page currently stops at Cloudflare human verification, which was not bypassed.

At 19:17:20 UTC, the [exact live Cfx identity](https://frontend.cfx-services.net/api/servers/single/ajv9r5) still declared `sv_appearAllowlisted=false`. The canonical Discord invite resolved to California Roleplay but offered no public explanatory description. Current public and approval claims therefore remain in conflict.

**Do not change the label.** Resolve whether every newcomer must apply or only particular departments/roles do, using a readable current operator guide or authorised owner clarification. Join-button availability does not prove admission. An application phrase alone does not prove the exact vMenu server is gated.

### MassiveCraft: keep Not confirmed

The [official website](https://www.massivecraft.com/) still presents human verification to the isolated browser. The [canonical Discord](https://discord.gg/massivecraft) resolves to MassiveCraft Community; its generic welcome message provides no joining/approval rule. No challenge was solved, and no membership was created.

**Do not infer Public from a reachable Minecraft address or Whitelisted from nearby tags on a search-results page.** Current admission instructions remain unverified. Retain the established fantasy/factions option with the honest access label and explicit network-count scope. Obtain current joining and reporting instructions before a stronger launch endorsement.

## Limits and next staff actions

No production mutation was performed. The proposed holds and website correction need the ordinary staff review workflow and a clear audit reason if applied. No new candidate was researched or imported.

No actual newcomer session, staff ticket, appeal, or application was submitted. Public rules establish the stated process; they do not establish how staff behave in every case. Discord online/member totals were used only as public identity/context, never substituted for in-game players or community quality.

The next useful actions are narrow:

1. Keep Vital's recovered canonical identity.
2. Continue showing Ebonridge's source unavailable until the fallback flag clears; obtain an official explanation without guessing.
3. Review the two proposed curated-launch holds: Bright Falls and Sanctuary & Sin.
4. Preserve Everglade as a documented near-threshold exception only if the owner accepts a smaller structured option.
5. Keep HighLife's directory presence distinct from an endorsement of its disputed governance.
6. Resolve CaliRP/MassiveCraft access through explicit current admission evidence.
7. When using Bright Falls links, review the newly discovered canonical website and current policy routes through staff tools; the old appeal-category URL no longer provides useful current policy.
