# Published roster verification — 4 September 2026

The reviewed roster and candidate manifests agree: **48 published listings — 25 FiveM, 20 RedM and 3 Minecraft**. This was checked against production data at **13:26:03 UTC**, after the two confirmed staff publications. Every published game/code pair has a corresponding published manifest entry, including the two existing FiveM anchors, CaliRP and ProdigyRP. There are no missing entries, unexpected additions or duplicate communities in this comparison.

## Confirmed editorial changes

- Distinct, Ignite, Logic, Moonlit Hills, OzzyGaming DarkSide and San Andreas First Response are archived in staff data and held in the FiveM manifest. The hold notes retain the observed regional evening coverage, one-night limitations and reversible nature of the decision. These are launch-selection decisions, not claims of closure or poor management.
- Lemoyne is archived and held. Its note cites the separate week-long activity review and preserves its text-roleplay identity for reconsideration.
- SACRP and Resilient each appear once in the FiveM shortlist. The Tackroom appears once in RedM. Their reviewed entry requirements and paid-perk disclosures match the published descriptions.
- Gilded is whitelisted and its description now explains the first-login in-game application quiz. Human review is not a prerequisite for the site's application-based classification. CaliRP remains Not confirmed because its operator's current public-access and general-application statements conflict.
- Redline remains deferred. New Eden and Wanted were not published.

FiveM has **57 research candidates, 23 marked publish, plus the two already-live anchors**. RedM has **21 research candidates, 20 marked publish**. Other candidate evidence and reserves were preserved. Existing Everfall and SACRP descriptions were synchronized with the staff-published paid-perk disclosures so future review suggestions retain them.

## Metadata, ownership and artwork

The comparison checked reviewed names, descriptions, region, language, framework, access, community links and website links. Blank research regions are equivalent to the published Not confirmed value; Minecraft platform comes from its manifest context. Language and framework remain correctly mapped. Every published listing has import provenance. None is marked verified or assigned an invented owner.

All **49 stored image URLs** — 47 logos and two banners — returned HTTP 200 with image content during the bounded check. SAVRP intentionally has no logo because its former generic Cfx icon was rejected. Imported artwork is a reviewed stored asset, not a claim that an upstream image is refreshed each minute. The two new logos were decoded in the publishing UI; Resilient's logo was also visually checked during research. No missing banner was replaced with unrelated artwork.

No stored count was negative, above its stored capacity or dated in the future. All three Minecraft entries retain **network-level** count scope, which may include other worlds or lobbies rather than only roleplay scenes.

## Live-status limits and targeted findings

The scheduled refresh job is active every minute. The three completed rounds read at 13:26 finished successfully in roughly two to three seconds, with no worker failures. That does not mean every upstream server had usable current data.

At **13:26:03**, 44 of 48 sources were fresh. Four targeted Cfx checks at **13:27:06** found:

| Community | Result |
| --- | --- |
| Badlands | Newer, fresh 39/300 observation; the earlier unavailable state was transient. |
| Vital | Newer, fresh 8/175 observation; the earlier unavailable state was transient. |
| True Grit | HTTP 200 but the heartbeat was 6 minutes 52 seconds old. Its historical 13/120 count must not be presented as live. |
| Ranch | Official Cfx endpoint returned HTTP 404. Last retained good observation was 12:42:53 UTC. |

A final database check at **13:28:34** found **41 fresh and seven unavailable**: Ranch, District 10, Lucid City, Westhaven, Echo, Vital and State of Deliverance. Both newly published sources were fresh. The completed 13:28 refresh round had reported 45 fresh and three unavailable at 13:28:02; four additional observations crossed the five-minute age limit between the round and the later read. Freshness is time-dependent. The differing totals are not evidence of invented zeros or seven confirmed server outages. True Grit had recovered by that final database check.

Ranch's official website and Discord still respond and identify the same community. No explicit replacement code or current outage explanation was found in the bounded public-source check. Its website embeds the genuine [Ranch Statuspage](https://ranchroleplay.statuspage.io/), but the unresolved game-server incident dates to **24 July 2026**, so it cannot reliably explain today's missing listing. The evidence supports **current source unavailability with an unconfirmed cause**, not closure, permanent delisting or a confirmed temporary outage. Ranch's identity and listing were left unchanged.

## Verification scope

This audit used read-only production SQL, fixed public Cfx requests for the four flagged sources, public website/Discord checks for Ranch, and stored-image HEAD requests. It did not write production data, refresh arbitrary server IPs, send messages, create accounts, or reimport listings. Manifest JSON, field limits, duplicate detection, runtime shortlist membership and metadata comparison passed; whitespace checks passed. Full repository verification is reported separately by the release task.
