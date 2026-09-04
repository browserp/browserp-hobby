# BrowseRP scraper research and phased plan

Researched 4 September 2026. Research only: no new scraper implementation, database changes, deployment, or bulk collection. Recommendations below are design proposals; a reachable endpoint is not a promise of unrestricted third-party use.

## Recommended direction

The site owner's next-phase preference is an applications-led Roblox section, approximately **3 well-known Minecraft RP communities**, **20 RedM communities**, and **40 strong FiveM communities**. These are later rollout targets, not instructions to bulk-import now. Selection should consider sustained activity, clear community identity, working links, RP relevance and accessible joining information. The current delivery adds only CaliRP and fixes existing launch listings. Roblox applications should gather the experience, community identity, owner-control evidence and joining details; optional integrations can then validate the submitted information.

Use one review workflow with a different source adapter for each platform. Keep **community**, **game/experience**, **server endpoint**, and **running instance** distinct. Staff should see evidence and conflicts before publication; owners can subsequently prove control and correct their listing. Store the observation time and source for every count. Display “unavailable” when freshness expires; a successful observation of zero remains zero.

| Platform | Best first discovery sources | Useful live data | Main limitation |
| --- | --- | --- | --- |
| FiveM | Official server list, current community-authored Cfx Bazaar posts, linked community website | Cfx join code, declared metadata, count/capacity, approved images | Cfx frontend endpoints have no established third-party stability guarantee; metadata is operator-supplied |
| RedM | Official RedM list and RedM Bazaar | Similar Cfx metadata and counts after confirming `rdr3` | Separate game and framework mapping required; do not treat every Cfx result as FiveM |
| Minecraft | Official Minecraft Server List, community website, owner submission | Java status or Bedrock advertisement: count/capacity, version, MOTD; Java favicon | No comprehensive official bulk-discovery API established by this research; network vs individual-world counts can differ |
| Roblox | Official experience pages and creator/community pages; owner submission | Experience details and artwork; properly labelled experience-wide count | A Roblox experience is not an independently owned RP community; public instance enumeration is restricted |
| Roblox ER:LC pilot | Official ER:LC community sources plus owner opt-in | Specific private-server name, owner/co-owners, count/capacity and join key | Requires the owner's ER:LC API pack and secret server key; no public discovery feed established |

## FiveM and RedM

Keep staff discovery links to [FiveM's official list](https://servers.fivem.net/), [FiveM Server Bazaar](https://forum.cfx.re/c/server-development/server-bazaar/38), [RedM's official list](https://servers.redm.net/), and [RedM Server Bazaar](https://forum.cfx.re/c/redm-server-development/redm-server-bazaar/69). Bazaar posts are community advertisements, including development services and unreleased projects; staff must select actual operating RP communities.

The official Cfx server configuration documents project names/descriptions, comma-separated tags, BCP 47 locale, banners, icon and capacity. RedM uses `set gamename rdr3`; FiveM uses `gta5`. This supports sharing validation concepts while retaining platform-specific fields. [Cfx server setup](https://docs.fivem.net/docs/server-manual/setting-up-a-server-vanilla/), [server commands](https://docs.fivem.net/docs/server-manual/server-commands/).

Read-only checks of the current official frontend confirmed `https://frontend.cfx-services.net/api/servers/single/{code}` for known join codes, canonical Cfx icon URLs and the current small FiveM featured list. These are observed frontend services, not an established supported public integration contract. Cfx staff explicitly described the previous single-server endpoint as not a public API; plan for denial or changes, stop on blocks, and seek Cfx guidance before scaling. Do not build a bypass or bulk-download the protobuf server stream. [Cfx staff discussion](https://forum.cfx.re/t/what-happened-to-the-fivem-server-single-endpoint/5329241), [official frontend](https://servers.fivem.net/).

Start RedM with manually selected join codes, require `rdr3`, and add a RedM-specific framework dictionary (for example VORP/RSG when independently evidenced). Before implementation, confirm the current RedM frontend contract with a small known-code fixture; no RedM live API probe was made during this research. Tags or a framework name do not establish RP quality, application requirements, community language, ownership or hosting region. Prefer recent rules/how-to-join pages for those. Preserve conflict flags rather than guessing.

Proposed cadence: cache counts briefly and refresh only known listings with bounded concurrency; refresh editorial metadata less often and send material changes back to review. Every count is a source-reported snapshot, not a guarantee of perfectly accurate occupancy. Require owner consent for any installed reporting resource, private dashboard integration or administrative access.

## Minecraft

Minecraft itself directs players to [the Official Minecraft Server List](https://findmcserver.com/), and distinguishes that community catalog from the featured servers in Bedrock. Keep both [Minecraft's server guide](https://www.minecraft.net/en-us/servers.jsp) and the list as staff reference links. A roleplay tag is a discovery lead, not proof that an entire network is a dedicated RP community.

No documented bulk-import API or republication arrangement was established for FindMCServer. Its rules/terms requests returned 403 in this research; the catalog can be a manual source reference, but automated ingestion should wait for the operator's permission or a documented feed. [Contact the list operator](https://findmcserver.com/contact). Never infer permission from search indexing.

For each reviewed, publicly advertised or owner-submitted address, plan a bounded status-only check: Java Server List Ping, or Bedrock's server advertisement. Java can report MOTD, version, count/capacity and favicon; Bedrock has its own advertisement format. Maintainer documentation supports these operations separately from joining as a player: [PrismarineJS Java ping](https://github.com/PrismarineJS/node-minecraft-protocol/blob/master/docs/API.md), [Bedrock ping](https://github.com/PrismarineJS/bedrock-protocol/blob/master/docs/API.md). These are implementation-maintainer sources, not a Mojang API guarantee.

Store Java/Bedrock edition, version, reviewed hostname and port separately. Restrict checks to those approved endpoints; validate DNS/SRV destinations against private/local networks and prohibit scanning. Status silence means unknown, not necessarily offline: Paper's `enable-status=false` can hide status while players can still join. Player samples are unnecessary and should be discarded. [Paper server settings](https://docs.papermc.io/paper/reference/server-properties/).

Verify Discord, screenshots, modpack, rules, language, access and RP style from the community's own sources. A proxy/network total must be labelled as such; it cannot be assigned to a specific RP world. For exact RP-world counts, use an owner-authorized reporting plugin or minimal aggregate feed later. Prove claims with a temporary MOTD/DNS/website challenge or another reviewed control proof. Minecraft account or Discord ownership alone does not establish server control. Realms should stay owner-submitted; do not enumerate private invitations.

## Roblox: use two listing types

**Experience listing:** the game being played. Store its universe ID and root/start place ID, creator user/group ID, canonical Roblox page, name/description and Roblox-provided artwork. Roblox explicitly distinguishes the experience ID, place ID, ephemeral `JobId`, and persistent private-server ID. [Roblox DataModel reference](https://create.roblox.com/docs/reference/engine/classes/DataModel).

**RP community listing:** the independent group organizing roleplay inside an experience. Link it to that experience and store its own rules, permitted community links, join instructions, owner/control proof and optional private-server identifier. Never present the entire experience's player total as that group's player count. Group membership or a high role does not automatically establish game or private-server ownership.

For an initial pilot, staff can select known RP experiences through Roblox's own discovery/details pages, then retrieve documented metadata and artwork for the selected IDs. Current docs list unauthenticated options for `games.roblox.com/v1/games` and `thumbnails.roblox.com/v1/games/icons` / `v1/games/multiget/thumbnails`; group-created experience lookup uses the current `gamesV2` route. [Games API reference](https://create.roblox.com/docs/cloud/reference/domains/games), [thumbnails](https://create.roblox.com/docs/cloud/reference/domains/thumbnails), [discovery guide](https://create.roblox.com/docs/discovery). Verify the exact count field and semantics in a small fixture before implementation. Do not use paginated public instances to calculate an allegedly complete total.

Roblox's official September 2025 announcement restricts how many public servers can be browsed and tests logged-in-only server-list API access. Therefore an exhaustive instance scraper is not a suitable BrowseRP dependency. Private instances/reserved sessions need separate authorized integrations. [Official server-list changes](https://devforum.roblox.com/t/test-updates-to-server-list-page/3966648).

Use Roblox OAuth/OIDC for account identity and the minimum approved resource scopes if a creator later connects their experience. Public creator/group metadata plus an authenticated identity is evidence to review, not blanket authority. Current Open Cloud observability supports authorized server queries per place version; evaluate it only for consenting creators, not arbitrary games. [OAuth overview](https://create.roblox.com/docs/cloud/auth/oauth2-overview), [observability reference](https://create.roblox.com/docs/en-us/cloud/reference/features/observability.md).

Roblox advises API-key/OAuth endpoints for stability and warns that legacy cookie APIs can change. For a third-party app, **do not ask users for their Roblox API keys or session cookies**: use approved OAuth. Do not collect player identities, locations or cross-experience histories for this directory. [Cloud guidance](https://create.roblox.com/docs/cloud), [third-party app policy](https://en.help.roblox.com/hc/en-us/articles/37924211313044-Creator-Third-Party-App-Policy). Follow each endpoint's rate headers/limits and 429 backoff, rather than claiming one global allowance. [Rate limits](https://create.roblox.com/docs/cloud/reference/rate-limits), [API terms](https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use).

### Recommended Roblox community pilot: ER:LC

[Emergency Response: Liberty County's official site](https://erlc.gg/) links its [official private-server API documentation](https://apidocs.erlc.gg/). This is a much closer match to BrowseRP communities than a generic Roblox public-instance list.

`GET https://api.erlc.gg/v2/server` requires the private owner's ER:LC `server-key` and can return name, owner/co-owner IDs, current/max players and join key. Fetch only the base aggregate fields; omit optional player lists, locations, staff lists, logs and moderation data. The owner must have the ER:LC API pack and explicitly authorize display of the selected public fields/join information. No authenticated ER:LC request was made here. [Server information](https://apidocs.erlc.gg/api-reference/fetch-server-information).

A public multi-community app has registration, description, feature-list, privacy-policy and terms requirements. Credentials must be secured, requests must stop when the integration is removed, and rate limits are dynamic. Their current documentation also advises dedicated IP hosting instead of shared-IP services: assess this before choosing the deployment architecture. ER:LC's game-specific server key is a separate integration from Roblox Open Cloud keys. [Public applications](https://apidocs.erlc.gg/creating-public-applications), [usage rules](https://apidocs.erlc.gg/policies/aup), [rate limits](https://apidocs.erlc.gg/rate-limits). Remote command permissions are unnecessary for BrowseRP and should not be requested.

Other Roblox games need their own documented community/private-server integration or manual submissions. There is no evidence here of one universal API that identifies every RP group, its owner, its invite and its exact live population.

## Shared review and rollout

1. **References now:** show the official directories/docs above in each staff scraper section; leave unfinished adapters visibly planned.
2. **Small pilots before expansion:** retain reviewed FiveM import; validate a few RedM join codes and approximately 3 well-known Minecraft communities before scaling to the agreed later targets. Roblox starts with applications from independent RP communities, linking each application to its experience. Experience metadata supports these applications; a separate experience catalog can be considered later. Import candidates, never auto-publish solely because “RP” appears in tags.
3. **Evidence review:** classify each link by destination and platform, separate keywords from URLs, canonicalize IDs, validate approved image delivery, reject unsafe inputs, flag conflicts and duplicate communities. Keep platform, region, language, framework, access in that order. Store source URL, observed time, confidence and manual corrections.
4. **Claims:** distinguish “Discord control confirmed” from “game/server control confirmed.” Verify the correct Roblox user/group or ER:LC private-server owner; use Minecraft endpoint-control proof. Staff approves disputed or ambiguous cases.
5. **Live refresh:** refresh known records with backoff, request coalescing and circuit breakers. Show source, checked time and correct metric scope. Separate metadata edits from automatic count refresh. Missing or stale data remains unknown; no invented counts.
6. **Owner opt-in expansion:** ER:LC aggregate feed first; other Roblox game integrations and Minecraft RP-world feeds only after permission and API feasibility. Review upstream policies and data deletion requirements before scaling.

## CaliRP identification for current review

Recommended main listing: **California Roleplay (CaliRP)**, canonical Cfx code **`ajv9r5`**, website **https://calirp.gg/**, Discord **https://discord.gg/calirp**. `pk39da` is labelled California Roleplay #2 and is not the main code.

Primary corroboration: [Cfx listing](https://cfx.re/join/ajv9r5) and its current single-record response identify California Roleplay/vMenu and the CaliRP Discord; that response links the official `store.calirp.gg`, `devstore.calirp.gg`, `depts.calirp.gg` and banner CDN. [Official store](https://store.calirp.gg/) also identifies vMenu. Browser inspection of [the homepage](https://calirp.gg/) confirmed its Discord links to the same invite, and its Connect links target `fivem.calirp.gg:30120`. The invite lookup returned the California Roleplay guild, ID `799399975124729926`. A small direct Cfx fetch observed 312/350 at research time; that value is a snapshot, not a publication-time count.

**Unresolved access conflict:** homepage says an application gate/approval is needed; Cfx's public title/allowlist flag imply public access. Leave access unresolved or explain the conflict for staff review. The homepage simultaneously rendered inconsistent player widgets, so use Cfx snapshots rather than copying those widgets. No claim of community ownership or moderation-quality verification is made.
