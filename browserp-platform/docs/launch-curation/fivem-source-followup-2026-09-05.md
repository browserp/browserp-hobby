# FiveM source and quality follow-up — 5 September 2026

Research-only assessment of New Day RP, ONX, TRP, Connect RP, 17th Street RP and ECLIPSE Roleplay, checked approximately 20:07–20:24 UTC. No communities were joined or contacted; no account, application, purchase or live listing was created. Parent reports GTA World is now published, making the working baseline **26 FiveM listings**; recheck inventory before importing. This report and its companion JSON are separate from the already reviewed GTA World manifest.

## Decision

**Recommend ECLIPSE Roleplay for staff import review.** Its exact new FiveM identity, fresh activity, current website, Discord and working artwork are established. It adds a long-running, structured voice-roleplay alternative. Mature rules and public criticism are material context, not automatic reasons to exclude an established community. Describe its strengths and limitations honestly; do not call it universally welcoming or flawless.

| Community | Decision | Decisive result |
| --- | --- | --- |
| ECLIPSE Roleplay | **Recommended with caveats** | Correct new FiveM code `qqqbm7v`; fresh 163/2048; established community with public rules, applications and continuing activity. Recent migration and player feedback need truthful presentation. |
| New Day RP | **Quality shortlist; source hold** | Correct main code `ypq96k` is repeatedly marked `fallback: true`. Raw clients change, but BrowseRP correctly does not certify them as live. Application route exists behind normal login. |
| ONX | **Source hold** | Recovered official-domain listing `46pb7q`, but it is a 7-slot fallback entry whose public FiveM page disables Connect with an end-of-life artifact warning. It is not a reliable whole-community population source. |
| TRP | **FiveM source hold** | The often-repeated `wzjb8d` currently identifies **RedM**, not FiveM. Official GTA onboarding gives connection details inside its Discord. |
| Connect RP | **Promising smaller reserve; source hold** | Thoughtful current rules and early positive player reports; public homepage 178/200 is a missing-data fallback, not a verified activity observation. No attributable production code recovered. |
| 17th Street RP | **Active reserve** | Fresh 112/200; two current whitelist invites agree. Public rules/onboarding remain poorly attributable and the official shop sells gameplay advantages. Not rejected simply for having a shop. |

## ECLIPSE Roleplay — recommended import review

The [official website](https://eclipse-rp.net/) now explicitly gives FiveM download steps and `play.eclipse-rp.net:30120`. The [official FiveM listing](https://servers.fivem.net/servers/detail/qqqbm7v) matches that domain and describes the original community founded in 2017. This is **not** the separate FiveM community at `yjbqg5`, the Hungarian `z7qzld`, or the other similarly named UK/Australian listings. The public homepage links [Discord invite y2gxAjg](https://discord.gg/y2gxAjg), which returned the matching ECLIPSE ROLEPLAY guild at 20:19 UTC.

**What it adds:** established English voice roleplay with player businesses, police, medical and other government factions, civilian activities, and custom developed systems. The public [general rules](https://forum.eclipse-rp.net/topic/57059-general-rules/) require English in character and provide reporting, consent withdrawal and restrictions on disruptive conduct. Mature offensive scenes require consent; the rules also allow some IC slurs under that system and infer consent in particular knowingly entered scenes/venues. This merits accurate adult-context positioning, not a blanket “family friendly” or “harassment-free” promise. No private moderation outcomes or in-game experience were tested.

**Joining:** label **Whitelisted**, with a clear explanation that new players complete a roleplay quiz and staff review. The still-published [official setup guide](https://forum.eclipse-rp.net/topic/15577-eclipse-roleplay-new-player-setup-guide/) describes manually reviewed short answers; its old RAGE Multiplayer connection instructions are obsolete. A [5 September player account](https://www.reddit.com/r/GTARP/comments/1w7j8yp/struggling_to_find_a_good_server/) independently says a quiz is still required. The new website's six-step registration form was observed without submitting it. This is strong corroboration, but the actual approval process was not exercised. Do not let the raw Cfx `public` flag overwrite the reviewed access label.

**Balanced quality judgement:** current [migration feedback](https://forum.eclipse-rp.net/topic/182326-suggestions-for-the-future/?comment=616399&do=findComment) values the community's identity and player businesses while asking for better civilian systems, housing affordability and migration fixes. A [September faction-leadership discussion](https://forum.eclipse-rp.net/topic/182511-reasonable-expectations-of-gov-factions/) criticizes rising activity expectations and weak development incentives; the founder says the intent is to replace inactive leaders with active ones. These are direct stakeholder perspectives, not proven misconduct. The [June rules update](https://forum.eclipse-rp.net/topic/31252-eclipse-server-rules-changelog/page/2/) protects ordinary shopping/refuelling from unmotivated robbery, showing a concrete effort to improve everyday play. Taken together, longevity, activity and depth justify inclusion with these caveats. Avoid describing it as the best beginner experience or treating every old complaint as current fact.

| Verification | Evidence |
| --- | --- |
| Canonical feed | `https://frontend.cfx-services.net/api/servers/single/qqqbm7v` |
| Activity | **163/2048**, observed **2026-09-05 20:15:06.279 UTC**, fetched **20:17:36.366 UTC**; official UI also showed 168 peak over 24 hours at that visit |
| Language / audience | English confirmed by rules; International is an editorial audience label, not a hosting-location/latency promise |
| Logo | Cfx icon version `788076764`, HTTP 200 at 20:19:52 UTC; actual decoded **96×96** ECRP artwork visually checked |
| Image safety | Original animated PNG 451,955 bytes; existing `staticServerPng` validation produced 6,550-byte static PNG locally. No upload occurred |
| Banner | None supplied; do not manufacture or guess an external banner |
| Access | Reviewed Whitelisted override; preserve the quiz/approval evidence and legacy-guide caveat |

The JSON contains the exact review payload, restrained feature labels and required post-import checks. Refresh the feed immediately before publication; search results, filters, stored image and detail view must agree afterwards.

## New Day RP — good fit; current feed cannot be certified live

The [official FAQ](https://newdayrp.com/threads/faqs.850/) identifies `connect ndrp.gg`, Discord/Steam linking and built-in voice, including an accommodation for players who cannot speak. The [whitelist route](https://newdayrp.com/whitelist) displayed the ordinary login screen in the browser; a crawler's 403 was **not** evidence that applications are closed. The linked [Discord](https://discord.gg/Mq6BN9Rftr) was valid at 20:12 UTC.

The [July 2026 community newsletter](https://newdayrp.com/threads/community-newsletter-july-2026.75031/) shows continuing staff operations, civilian-system changes and candid discussion of police recruitment/training bottlenecks. [May first-person reporting](https://www.pcgamer.com/games/grand-theft-auto/as-it-celebrates-its-5th-birthday-new-day-rp-might-be-gta-roleplays-most-accessible-server-proving-the-scene-doesnt-need-to-be-intimidating-to-be-rewarding/) supports newcomer accessibility, but predates those later operational issues. These are useful reasons to prioritize it, not evidence every session is excellent.

The exact [main Cfx source](https://frontend.cfx-services.net/api/servers/single/ypq96k) returned `fallback: true` twice: raw clients 108/275 at 20:07:16 UTC and 169/275 at 20:20:54 UTC. The later `lastSeen` was 20:17:53 UTC. Changing fallback data is evidence the listing is changing; it does not justify bypassing BrowseRP's existing freshness/source guard or publishing those numbers as certified live. **Next action:** obtain an attributable non-fallback production source or an explicitly supported aggregate-status source. Do not substitute the Danish NewDay, similarly named new community, or handling/test instance. Do not call New Day dead.

## ONX — canonical public listing found, but not a usable launch feed

The current [ONX homepage](https://onx.gg/) displays patch notes through **3 September 2026**, an allowlist application link and its custom-system/community positioning. [Discord onxgg](https://discord.com/invite/onxgg) is valid. Public [FAQ](https://onx.gg/faq) currently displays a coming-soon placeholder, so older indexed FAQ claims must not be presented as current usable onboarding.

Searching the official FiveM directory revealed [46pb7q](https://servers.fivem.net/servers/detail/46pb7q), which links onx.gg. The browser showed **Connect disabled** and an **outdated server artifact/end-of-life warning**. The [aggregate API](https://frontend.cfx-services.net/api/servers/single/46pb7q) at 20:20:53 UTC was a 7/7 fallback entry, last seen 20:18:13 UTC. This is a concrete source problem, not proof that ONX's actual community is closed or only has seven players. Do not use development, Spanish or asset-showcase instances. **Next action:** find the publicly attributable current production connection and aggregate activity source; if intentionally unlisted, resolve that with the owner during a later authorized claim/onboarding flow rather than inventing public data.

## TRP — do not import RedM as FiveM

[TRP's GTA onboarding](https://wiki.playtrp.com/doku.php?id=gta:getting_started) documents application review, feedback, accessibility controls, jobs and joining instructions supplied in its Discord GTA guide. The [consent and safety page](https://playtrp.com/consent-and-safety/) gives explicit ways to stop uncomfortable scenes and report problems. Those are stronger organizational signals than an SEO ranking.

However, the [widely copied code wzjb8d](https://frontend.cfx-services.net/api/servers/single/wzjb8d) returned `gamename: rdr3`, description identifying **TRP RedM**, and 0/48 at 20:20:55 UTC. The prior FiveM association is stale. This observation says nothing conclusive about TRP's FiveM population. **Next action:** recover an official GTA production source and representative history; do not copy a code from a mixed-game article or expose private Discord connection material.

## Connect RP — promising policies, unverified population

[Current rules](https://connectrp.net/rules), updated 5 August 2026, prohibit hate speech even in character, cover doxxing/harassment, allow safety exits, and describe independent complaint review including staff/owners. [Onboarding](https://connectrp.net/join) requires an application and approval, is 18+, and uses [Discord connectrp](https://discord.gg/connectrp), validated at 20:19 UTC. Early [player discussion](https://www.reddit.com/r/FiveMServers/comments/1v74igx/looking_for_a_new_server_to_call_home/) praises roleplay-led policing; some participants are promoting the server, so this is encouraging limited evidence, not an independent audit. The community appears recently launched; do not borrow the history of an older same-name server.

**Concrete source trap:** the public [homepage](https://connectrp.net/) displays 178/200 in its city feature even when the live status is missing. Its publicly served page script uses default values `onlineCount ?? 178` and `capacity ?? 200`; the uptime figure is also hardcoded. These figures were therefore excluded from activity evidence. Search snippets also splice Connect recommendations together with other commenters' join links: `xlzqy85` in these threads belongs to City of Justice: Reborn, and `e6ekr5m` to NoBull RP. Neither is an attributable Connect code. **Next action:** verify an official production source and representative regional activity around the user's 35-player criterion before adding it. No accusation of deliberate deception is established.

## 17th Street RP — active reserve with clearer tradeoffs

[Cfx code 86amo5](https://frontend.cfx-services.net/api/servers/single/86amo5) was a fresh English listing with **112/200**, observed 20:08:11.985 UTC, and an allowlisted signal. The two Cfx whitelist invites, [17thstreetwl](https://discord.gg/17thstreetwl) and [6Kvuv6HkU3](https://discord.gg/6Kvuv6HkU3), both resolve to **17th Street RP V3**. The shop's old `17thstreet` invite returned invalid. Do not mistake two valid same-guild invites for two communities, or keep the broken shop link.

The [official Elite Ride Pack](https://17th-street-rp-webshop.tebex.io/package/7200104) sells a vehicle, $50,000 in-game money and supplies. That is a real gameplay head start; it must not be described as cosmetic-only. It is a comparative drawback for a quality-led launch, not automatic proof of abusive monetization or poor players. A [recent former-player discussion](https://www.reddit.com/r/FiveMServers/comments/1urfelw/looking_for_a_new_city_former_savrp_17th_street/) supplies limited experience context, while the publicly indexed beginner guide is a third-party Scribd upload rather than an attributable current rulebook. **Reserve:** confirm current governing rules, application process and fair progression/newcomer support before recommending over better-documented alternatives. Do not import competitor names copied into promotional metadata as features or keywords.

## Verification boundaries and next actions

- ECLIPSE can proceed to staff review with the companion payload; retain mature-content and migration caveats, then check logo, exact join link, latest count, search and Whitelisted filters after publication.
- New Day is the highest-priority source repair for quality reasons. ONX and TRP need correct public production feeds; repeated checks of known unsuitable codes will not resolve that.
- Connect and 17th Street are documented reserves, with precise evidence gaps rather than permanent exclusions. No fixed number of negative reviews or universal friendliness certificate is required.
- Public-source research cannot establish actual in-game performance, fairness of every moderation decision or a risk-free community. No private player identities, IPs, account secrets or Discord channel content were retained.

Companion JSON was parsed and checked for a unique canonical code, HTTPS sources, consistent FiveM/English/Whitelisted fields and timestamped activity. Only one reviewed import payload is present. The isolated official FiveM browser searches for the exact phrase `Connect RP` and for `playtrp` returned no matching listing at approximately 20:25–20:26 UTC; the unrelated featured-server section was not mistaken for search results. This is a bounded discovery result, not proof that either community is closed.
