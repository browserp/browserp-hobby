# Existing roster audit — 5 September 2026

Read-only inventory, source health, image availability, metadata, and prior editorial-evidence reconciliation. Main database snapshot: **19:08:15 UTC**. Stored images checked by **19:09:46 UTC**; six official Cfx source checks at **19:09:46–19:09:49 UTC**. Scheduler aggregate checked at **19:10:47 UTC**.

## Current inventory

**48 published communities: 25 FiveM, 20 RedM, 3 Minecraft. No Roblox listing exists yet.** There are also 12 archived records: 10 FiveM, one RedM (Lemoyne), and the old FloridaDOJRO record. These archives are excluded from the live roster. There are no other server-table states at this checkpoint.

The published game/source-code pairs match all 48 expected entries from the current candidate manifests, including CaliRP and Prodigy as the existing FiveM anchors. There are **no missing manifest entries, unexpected additions, or duplicate game/code pairs**.

This audit made no production changes, refresh actions, imports, holds, deletions, or new-candidate research. It intentionally used read-only SQL rather than the public server API, whose GET path can itself refresh due source records.

## What is healthy and what needs attention

At the main snapshot, **45/48 sources were fresh**, applying the site's five-minute age and source-error rules. BlueBirdRP, Vital RP, and Ebonridge were unavailable at that instant.

All **49 stored images (47 logos and two banners)** returned HTTP 200 with image content. This proves stored-asset availability, not visual identity, current upstream artwork, or physical-device rendering. SAVRP has no logo by deliberate earlier review: the generic Cfx artwork was rejected. Do not replace that honest fallback with invented or unrelated artwork.

Every published listing:

- Is stored as English-speaking.
- Has import provenance and a source platform matching its listing platform.
- Has a syntactically correct Discord invite in the community field.
- Has a Cfx join URL matching the exact imported code where applicable.
- Has one or more assigned tags.
- Is unverified and is not flagged beginner-friendly, avoiding unsupported certification.

The 24-hour data-integrity query found **24,092 observations, zero negative or over-capacity counts, and zero future-dated observations**. This validates the stored numbers' shape and time bounds; it does not independently count connected players.

All three Minecraft communities explicitly use **network-level** counts, which may include lobbies and non-RP worlds.

### Targeted official-source follow-up

| Community | Follow-up result | Interpretation |
| --- | --- | --- |
| BlueBirdRP | HTTP 200, `gta5`, no fallback; 6/300, source heartbeat 19:05:39 UTC | Source recovered within the fresh window by the direct check. Australian off-hours and a 24-hour peak of 62 make six players insufficient grounds for removal. |
| Vital RP | Official Cfx endpoint HTTP 404 at 19:09:47 UTC | Current source unavailability. Last stored usable observation was 18:58:30 UTC; 24-hour peak 80. Investigate identity/status through official public channels; do not guess a new code or claim closure. |
| Ebonridge | HTTP 200, `rdr3`, **fallback=true**; response included 70 players | The numeric field must remain unavailable because the source explicitly declares fallback. Last accepted stored observation was 15:43:01 UTC. Correctly withholding that number is the intended behavior. |
| District 10 | HTTP 200, `gta5`, no fallback; genuine source snapshot 0/235 | Zero is supported by this particular source reading; the prior 24-hour peak was 215. Do not interpret one zero as a dead community. |
| Resilient Roleplay | HTTP 200, `gta5`, no fallback; 37/120, source heartbeat 19:06:13 UTC | The main snapshot's genuine zero had already recovered. Peak 88 in 24 hours. |
| Ranch Roleplay | HTTP 200, `rdr3`, no fallback; 161/240 but heartbeat 19:04:24 UTC at a 19:09:49 check | The previous day's Cfx404 had recovered; 24-hour peak 230. This particular direct reading was already 5m25s old and must not be advertised as live at fetch time. The main 19:08 snapshot was fresh. |

Official checks used only the fixed `frontend.cfx-services.net/api/servers/single/{code}` endpoint, sequentially. No raw server-IP queries were made.

The scheduled worker ran **1,440 completed rounds over the prior 24 hours**, with zero unfinished rounds, zero reported worker failures, zero reported deferred work, and a maximum duration of **7.25 seconds**. The final three sampled rounds completed in roughly 2.4–2.6 seconds. Individual-source availability still varied; aggregate fresh-source counts ranged from 30 to 48 over that period. A successful worker is not proof that every upstream record was fresh.

## Published snapshot

Counts in this table are timestamped evidence, not a continuously live report. “Unavailable” means no fresh usable observation at 19:08:15 UTC. The peak column is the maximum accepted stored reading during the prior 24 hours, not unique players, average activity, or an independent player census.

| Community | Game | Fresh snapshot players/capacity | Peak in prior 24h | Entry |
| --- | --- | ---: | ---: | --- |
| BadlandsRP | fivem | 156/300 | 293 | Public |
| BlueBirdRP | fivem | Unavailable | 62 | Public |
| California Roleplay (CaliRP) | fivem | 318/350 | 344 | Not confirmed |
| Circuit RP Public | fivem | 40/110 | 40 | Public |
| CityLife Roleplay | fivem | 111/275 | 205 | Public |
| CMG Roleplay | fivem | 202/1000 | 202 | Public |
| Concrete RP | fivem | 228/400 | 374 | Public |
| District 10 | fivem | 0/235 | 215 | Whitelisted |
| EchoRP | fivem | 116/300 | 199 | Whitelisted |
| Everfall | fivem | 72/315 | 143 | Public |
| Fat Duck Gaming | fivem | 61/1000 | 440 | Public |
| HighLife Roleplay | fivem | 223/400 | 282 | Not confirmed |
| Isles RP | fivem | 2/200 | 122 | Whitelisted |
| LiquidRP | fivem | 53/150 | 106 | Whitelisted |
| Lucid City Roleplay | fivem | 148/350 | 157 | Public |
| Odyssey RP | fivem | 296/325 | 323 | Public |
| Popcorn Roleplay | fivem | 15/128 | 36 | Public |
| ProdigyRP Allowlist 4.0 | fivem | 203/250 | 244 | Whitelisted |
| Resilient Roleplay | fivem | 0/120 | 88 | Whitelisted |
| Royalty Roleplay | fivem | 155/300 | 294 | Whitelisted |
| San Andreas County Roleplay | fivem | 22/250 | 40 | Public |
| San Andreas Valley Roleplay | fivem | 67/184 | 124 | Not confirmed |
| Space Turtles Roleplay Europe | fivem | 467/750 | 506 | Public |
| Vital RP | fivem | Unavailable | 80 | Whitelisted |
| Wild Haven Roleplay | fivem | 50/128 | 56 | Whitelisted |
| Lord of the Craft | minecraft | 216/1000 | 217 | Whitelisted |
| MassiveCraft | minecraft | 32/500 | 87 | Not confirmed |
| Stoneworks | minecraft | 313/550 | 324 | Public |
| Bright Falls RP | redm | 94/200 | 174 | Not confirmed |
| Dust to Dreams RP | redm | 28/128 | 60 | Whitelisted |
| Ebonridge | redm | Unavailable | 121 | Not confirmed |
| Everglade County RP | redm | 10/100 | 25 | Whitelisted |
| Gilded Roleplay | redm | 49/128 | 73 | Whitelisted |
| Highwater Roleplay 2.0 | redm | 23/128 | 33 | Not confirmed |
| Medieval RP | redm | 20/64 | 48 | Not confirmed |
| Ranch Roleplay | redm | 161/240 | 230 | Whitelisted |
| RosalitaRP | redm | 8/128 | 73 | Whitelisted |
| Sanctuary & Sin | redm | 20/64 | 27 | Not confirmed |
| Souvenir Trails RP | redm | 7/128 | 23 | Whitelisted |
| State of Deliverance | redm | 149/250 | 220 | Not confirmed |
| State of Fremont 1902 | redm | 7/128 | 24 | Not confirmed |
| Still Water RP | redm | 47/100 | 70 | Not confirmed |
| Syn County | redm | 408/510 | 436 | Public |
| The Frontier Roleplay | redm | 50/150 | 75 | Whitelisted |
| The Tackroom | redm | 148/200 | 177 | Whitelisted |
| True Grit RP | redm | 83/120 | 103 | Public |
| Western Skies Roleplay | redm | 43/148 | 54 | Whitelisted |
| Westhaven: The Hush RP | redm | 26/128 | 66 | Whitelisted |

## Activity and quality are different tests

The database query allowed seven days of history, but BrowseRP's actual retained observations begin on 4 September. The available window is approximately **30–43 hours**, depending on when a listing was added. The earlier database field name `peak_7d` must not be described as a full weekly study.

Five RedM communities never reached 35 in this short stored window:

| Community | Maximum in available BrowseRP window | Relevant prior evidence |
| --- | ---: | --- |
| Everglade County RP | 33 | The dated 28 August–4 September external-history review had weekly peak 32 and median daily peak 27.5; useful public onboarding but a genuine near-threshold activity watch. |
| Highwater Roleplay 2.0 | 34 | The prior external week had peak 45 and repeated 35+ readings on 3/6 complete days. Do not remove because the shorter current window is lower. |
| Sanctuary & Sin | 30 | The prior week had peak 35 but only one such sample, plus a reported recent launch and thinner independent governance evidence. Higher-priority fit review. |
| Souvenir Trails RP | 23 | Prior external week had peak 48 and repeated 35+ readings on 4/6 complete days. Regional/event coverage remains necessary. |
| State of Fremont 1902 | 26 | Prior external week had peak 52 and repeated 35+ readings on 3/6 complete days. The earlier off-peak concern was already partly resolved. |

Popcorn reached 36, SACRP 40, and Circuit 40 in the last 24 hours. All have documented reasons to consider beyond raw size. SACRP was expressly requested by the owner. Review representative prime-time attendance and qualitative fit, rather than applying an automatic instantaneous threshold.

These longer external-history values are carried forward from the dated, sourced [RedM follow-up](redm-selection-followup-2026-09-04.md); that external week was **not fetched again in this initial audit**. Fresh multi-day observations are still needed before any new launch-selection decision.

## Metadata needing evidence

There are **12 Not confirmed access labels**:

CaliRP, HighLife, SAVRP, MassiveCraft, Bright Falls, Ebonridge, Highwater, Medieval, Sanctuary & Sin, State of Deliverance, State of Fremont, and Still Water.

There are **22 Not confirmed regions**: all 20 RedM communities plus District 10 and Everfall. Locale is not enough to establish actual community or server geography. International is explicitly used for the three Minecraft communities.

Five frameworks are unspecified: CMG, EchoRP, Fat Duck Gaming, HighLife, and Lucid City. The site should continue showing honest unknowns until useful game-mode evidence supports a label.

Twelve listings have no stored official website: CityLife, Dust to Dreams, Ebonridge, Highwater, Sanctuary & Sin, Souvenir Trails, State of Deliverance, State of Fremont, Still Water, Syn County, The Frontier, and True Grit. All retain a correctly shaped Discord community route. A website gap is not necessarily a listing defect, but public rules or support material should be linked where it can be authenticated.

Earlier research identified an official Syn County site and a True Grit operator policy page, which should be reconsidered through the staff review workflow rather than copied into production without a fresh identity check.

The tag inventory is populated: FiveM 152 assignments / 28 distinct values, RedM 122 / 25, and Minecraft 20 / 11. This does not by itself prove every public filter control, count, sort order, or result set; browser interaction verification remains a separate task.

## Quality priorities before new imports

The previous editorial work is substantive, but it does **not** justify presenting all 48 as equally proven “best” or “friendly.”

1. **Resolve live-source uncertainty for Ebonridge and Vital.** Check official public status/invite/identity evidence and obtain a later source observation. Preserve the current listing identity until there is evidence for a change.
2. **Complete governance and newcomer-fit review for Bright Falls and HighLife before prominent recommendations.** The prior reviews recorded attributed negative experiences and incomplete policy verification, not established misconduct. Seek balanced current evidence and readable rules, reporting, and appeals.
3. **Revisit Sanctuary & Sin and Everglade against the owner's activity and established-community expectations.** Compare sustained prime-time history and concrete newcomer support. Any future replacement should be demonstrably stronger, not merely larger.
4. **Keep Souvenir, Highwater, and Fremont contextual.** Their earlier full-week history contradicted conclusions from a quiet snapshot. Refresh regional history before changing their status.
5. **Resolve access evidence for CaliRP and MassiveCraft.** CaliRP's prior public-access/application statements conflicted; MassiveCraft's current rules/onboarding were blocked during earlier reading. Not confirmed remains appropriate until resolved.
6. **Review the Minecraft positioning honestly.** LOTC has the strongest documented dedicated-character-RP case. MassiveCraft includes factions/survival and has current evidence gaps; Stoneworks provides political/worldbuilding RP with mixed newcomer accounts. Do not market either as equivalent to strict character RP or certify friendliness from a network count.
7. **Recheck paid-entry and material paid-perk disclosures.** Existing evidence identifies meaningful differences in EchoRP, Prodigy, STRP, Everfall, SACRP and others. Avoid unqualified “free”, “fair”, or “no advantage” claims without product-specific evidence.
8. **Audit every actual destination and rendered card during the next bounded pass.** This initial audit checked stored image availability and link classification, not all 48 invite destinations, every official website, every full image's identity, or real newcomer sessions.

The detailed prior evidence and limitations are in [FiveM quality review](fivem-quality-review-2026-09-04.md), [RedM/Minecraft review](redm-minecraft-quality-review-2026-09-04.md), [Minecraft selection](minecraft-top-three-selection-2026-09-04.md), and [previous roster verification](roster-verification-2026-09-04.md). These are dated research findings; refresh the specific uncertainties before using them for new positive endorsements or exclusions.

## Scope and limits

No accounts were created, Discord communities joined, staff tickets sent, private community data accessed, or production records altered. No new research batch or import was started. Browser/device behavior, actual provider login, full destination health, moderation practice, and in-game friendliness remain outside this bounded inventory audit.

The audit supports “the existing 48 listings are present, correctly linked at the field level, and all stored artwork is reachable, with named live-source and editorial gaps.” It does not support “every server is proven to be one of the best” or “everything is currently live.”
