# Published launch roster — final additions, artwork and refresh review

Read-only checks on **6 September 2026, 00:51–01:03 UTC**, with any later SAVRP repair proof recorded separately below. No community memberships, messages, imports, production edits or browser sessions were used by this reviewer. Root handled publication through the normal staff panel. All timestamps and player values below are observations, not permanent claims.

**The public catalogue independently returned 63 English listings: 40 FiveM, 20 RedM and 3 Minecraft. All 64 unique existing managed artwork assets returned HTTP 200, fully decoded as images, contained visible pixels and matched their content-addressed filename hashes.** One listing, San Andreas Valley Roleplay, had no logo field; exact current Cfx artwork was recovered for the root's normal staff repair. The four final additions passed public detail/search/filter checks with numeric counts and correct reviewed links/access.

This verifies publication data and HTTP image delivery. It does not certify every community as universally friendly, repeat the prior qualitative research, or replace rendered browser, accessibility, authentication or physical-device checks.

## Exact catalogue snapshot

[Public catalogue](https://www.browserp.com/api/servers?discover=true&limit=100), HTTP 200 at **00:51:38.976 UTC**: total 63, returned 63, nextOffset null. Full evidence: `final-roster-public-snapshot-2026-09-06.json`; aggregate: `final-roster-snapshot-summary-2026-09-06.json`.

| Platform | Published | Numeric counts | Unavailable counts | Actual numeric zero | Observations older than 5 minutes |
|---|---:|---:|---:|---:|---:|
| FiveM | 40 | 33 | 7 | 0 | 7 |
| RedM | 20 | 18 | 2 | 0 | 2 |
| Minecraft | 3 | 3 | 0 | 0 | 0 |

All 63 language fields were English. The nine unavailable records returned players and capacity as null, with online false; they were not numeric zero. Every unavailable record in this snapshot also had an observation older than five minutes. This is source freshness evidence, not evidence that the communities closed.

Minecraft was fresh: Stoneworks 131/550, MassiveCraft 76/500 and Lord of the Craft 144/1000, checked roughly 38 seconds before the snapshot.

## Four final additions

Details were checked through `/api/servers?slug=...` at **00:54:23.507–00:54:27.606 UTC**, following eight sequential guarded Cfx source reads at **00:53:24.651–00:53:24.868 UTC**. The existing `fetchCfxServer` guard was used unchanged: fallback/stale/invalid counts remained rejected. Evidence: `final-four-public-postcheck-2026-09-06.json` and `final-roster-source-sample-2026-09-06.json`.

| Listing and exact code | Public detail count / source observation UTC | Public access | Positive filter check |
|---|---|---|---|
| [FREE2RP 2.0](https://www.browserp.com/server/free2rp-2-0-ak44p9), `ak44p9` | 51/210 at 00:52:54.367 | Whitelisted — application and approval | FiveM + Whitelisted + Serious RP + exact name returned this listing, 51 players |
| [Starlight Community Roleplay](https://www.browserp.com/server/starlight-community-roleplay-ayoz35), `ayoz35` | 37/100 at 00:50:17.912 | Whitelisted — application and approval | FiveM + Whitelisted + Serious RP + exact name returned this listing, 37 players |
| [We The People RP](https://www.browserp.com/server/we-the-people-rp-88q583), `88q583` | 306/320 at 00:50:45.928 | Whitelisted — application and approval | FiveM + Whitelisted + Serious RP + exact name returned this listing, 306 players |
| [The Rift Trails](https://www.browserp.com/server/the-rift-trails-d9eyr3), `d9eyr3` | 47/200 at 00:51:41.278 | Not confirmed | RedM + Not confirmed + Horses + exact name returned this listing, 47 players |

Starlight, WTP and Rift's detail values and observation times matched the preceding guarded source reads exactly. FREE2RP's detail observation was newer than the guarded read (which showed 50/210 at 00:48:26.312); the subsequent source update explains the one-player difference. These checks do not pretend that non-simultaneous requests must show identical changing values.

All four canonical Cfx joins matched their exact production codes. Reviewed destinations were preserved:

| Listing | Community | Website | Public metadata |
|---|---|---|---|
| FREE2RP | [Discord](https://discord.gg/free2rp) | [free2rp.com](https://free2rp.com/) | US, English, Ox Core |
| Starlight | [Discord](https://discord.gg/starlightcommunity) | [starlightcommunityrp.com](https://www.starlightcommunityrp.com/) | US, English, Qbox |
| WTP | [Discord](https://discord.gg/wethepeoplerp) | [wtprp.com](https://wtprp.com/) | US, English, QBCore |
| Rift | [Discord](https://discord.gg/rifttrails) | [rifttrails.com](https://www.rifttrails.com/) | International, English, VORP |

Rift's description explicitly presents an equestrian sandbox with optional roleplay, organised events and trail rides. Discord verification alone did not establish either public joining or application-and-approval admission, so Not confirmed remains intentional. The first three retain the reviewed 18+ and application guidance; FREE2RP's copy also explains paid faster application review/queue priority without claiming guaranteed admission. Those caveats are useful expectations, not hidden endorsements.

The guarded feed contained some malformed or conflicting unrelated fields; invalid links/images were excluded. Existing reviewed website/community fields remained intact. In particular, no tag was used as a Discord link and no Discord invitation became a game join link.

## Artwork proof

The complete snapshot contained **64 unique managed logo/banner URLs**. Each was read once with at most two concurrent HTTP requests; download and decoded-image size limits were applied, only the expected managed storage path was accepted, and images were decoded in memory. There were **64/64 passes**, finished **00:56:32.725 UTC**. Evidence: `full-roster-artwork-check-2026-09-06.json`. These checks establish usable image bytes, not a screenshot of every possible layout or third-party content-blocker behaviour.

All four newly published logos were visible 96×96 PNGs and their managed image pixels matched the corresponding current Cfx icon:

| Logo | Managed bytes | Managed SHA-256 |
|---|---:|---|
| FREE2RP | 20,889 | `9e2591222c019732aced372958d6a4ccca6b7707a60e8f6b0b71699848509573` |
| Starlight | 7,788 | `10e2a0b2eb0d6db5bb7ce962c4f51d43a9703fca5f63542a5464a2e0771f822a` |
| WTP | 5,606 | `8538ac22760cd9e4059e4004da5380bdce03879bcb7d59c3e71ad4c3e5067620` |
| Rift | 17,819 | `3591247ab1dafe83da8a4fdec984998c1fd3d5e0364f09fa1346626149c2d103` |

WTP's upstream PNG was 413,676 bytes while its managed PNG was 5,606 bytes; the full decoded pixels were identical. This was effective removal of extraneous PNG data, not a missing or different logo. Banner fields remained null as reviewed, including Starlight's unsuitable thin source banner.

### San Andreas Valley logo repair

The public snapshot and a second detail read at **00:59:59.415 UTC** both showed `logo_url: null`. The second read showed 112/184 players at 00:55:53.078, illustrating count recovery independently of the art defect.

The guarded production source `5xdqg7` identified **SAVRP: A Strength Online World**, linked the same [official site](https://fivem.strengthonlinellc.com/) and [SAVRP Discord](https://discord.gg/SAVRP), and supplied [this canonical Cfx icon](https://frontend.cfx-services.net/api/servers/icon/5xdqg7/-416334642.png). At 00:54:27.659 UTC it returned HTTP 200 and decoded fully as a visible 96×96 PNG, 17,189 bytes, SHA-256 `018801f13d35fd36fbb85e1ef043ea5abef696dc978e4ff1613a803f5bbd89a4`.

Before the root's logo-only staff update, the saved import was compared to the fresh public detail: description matched verbatim; US/English/Qbox/Not confirmed access, name, seven tags, keywords, website and Discord all matched. Canonical join remained `https://cfx.re/join/5xdqg7`; banner remained null. Evidence: `savrp-pre-logo-metadata-2026-09-06.json`. Root reported staff save at approximately 01:00 UTC. Public post-save verification is recorded in the addendum below rather than assumed from the staff success message.

## Refresh-health findings and limits

The snapshot's nine unavailable records were SADRP, Legit RP, San Andreas Valley, The Academy Ambassador, Everyday, Westhaven: The Hush, The Frontier, Circuit Public and SACRP. Their previous observations were all over five minutes old. Four were selected for one bounded guarded source check, rather than polling the entire catalogue repeatedly:

| Snapshot unavailable listing | Guarded source roughly 106 seconds later | Source observation UTC |
|---|---|---|
| Legit RP `ex853d` | 131/150, online | 00:50:16.953 |
| SADRP `o6oodx` | 36/64, online | 00:49:31.076 |
| Westhaven `bpjzpp` | 60/128, online | 00:51:09.848 |
| San Andreas Valley `5xdqg7` | 114/184, online | 00:50:57.862 |

All eight guarded reads, including the four additions, produced accepted current non-fallback observations. The other five unavailable records were not re-polled in this bounded pass, so their subsequent recovery is unknown. The readings support temporary freshness gaps in at least the sampled cases; they do not establish the complete cause of every unavailable result.

The code explains why an otherwise successful refresh run can still have unavailable sources:

- `lib/status-refresh-workflow.js` tracks `unavailable` separately from thrown worker `failed`. Zero failed workers therefore does not mean every source supplied a usable current observation.
- `lib/fivem-workflow.js` treats both guarded fetch/normalisation failures and snapshot-write exceptions through its unavailable path. The aggregate result alone cannot distinguish an upstream problem from a failed snapshot write.
- `20260904112122_staff_refresh_health.sql` considers freshness and source error state separately; stale and unavailable can overlap. Its last-successful-run condition allows unavailable results when there are no worker failures or deferrals.
- The current equal-observation recovery migration, `20260904024313_recover_equal_source_observations.sql`, already clears a transient error when an equally timed still-current Cfx observation is received. It uses 55-second source leases. Do not diagnose against the superseded older version or reintroduce that fixed bug.
- FREE2RP's guarded observation was approximately **298 seconds old**, just inside the five-minute limit, before a later update appeared. Some source observations arrive close to the public freshness boundary. This can contribute to gaps between updates, but it does not prove scheduling is the only cause.

**Concrete next action:** keep current stale/fallback safeguards. If the fluctuating unavailable total remains operationally confusing, record safe per-attempt categories for provider HTTP/fallback/stale/invalid data versus snapshot-write failure, alongside attempt time and upstream observation time. Compare those with run deferred/lease results before changing scheduling. Display successful refresh execution separately from current usable source coverage. Do not widen the freshness window merely to hide a gap or turn unknown counts into zero.

## Activity and quality are separate questions

The catalogue snapshot included positive counts below 35: Popcorn 34 (US), Resilient 21 and Wild Haven 21 (UK), BlueBird 5 and Hydrate 13 (Australia); RedM Medieval 33, Highwater 31, Onyx 27, Everglade 19, Fremont 24 and Souvenir Trails 16. The six RedM regions are currently Not confirmed, so this review does not invent regional peak-hour explanations for them.

These are not automatic removals. Selection evidence is representative activity over the appropriate regional sessions plus governance, onboarding, roleplay experience and track record. The specific prior research remains the basis for those judgments; one snapshot cannot establish either sustained decline or friendliness. Region and representative-session evidence remain the appropriate follow-up where they are weak.

## Related release follow-ups, kept separate

1. The concrete FiveM `police` → `police rp` feature alias gap is covered by the separate three-file patch and focused tests in `police-feature-alias-handoff-2026-09-06.md`. Root reported the patch integrated locally; public membership/count proof must follow the actual migration and deployment, not be inferred here. This also affects police-tagged new additions.
2. A scraper import record's historical Published state is not the same as an actively public server. Root observed 23 RedM import histories versus 20 public listings because held/archived server records remain in history. That is not evidence of three leaked public listings. A later staff-label clarification may help, but is unrelated to the alias patch.
3. All public snapshot assets delivered correctly before the SAVRP repair; complete render, motion, device and login tests remain under the root release checks. No new browser sessions were started for this task.

## Full roster at the stated snapshot

Counts below remain tied to **00:51:38.976 UTC**, not the later detail checks. Access labels come from the public API: Public, Whitelisted (application and approval), or Not confirmed.

| Platform | Listing | Players / capacity | Access | Source observation UTC | Logo |
|---|---|---:|---|---|---|
| FiveM | BadlandsRP | 296/300 | Public | 00:49:14.038 | Managed |
| FiveM | BlueBirdRP | 5/300 | Public | 00:48:16.751 | Managed |
| FiveM | Brighter Times RP 3.0 | 153/220 | Whitelisted | 00:47:24.293 | Managed |
| FiveM | BritishRP | 56/180 | Whitelisted | 00:48:23.103 | Managed |
| FiveM | California Roleplay (CaliRP) | 334/350 | Not confirmed | 00:48:11.35 | Managed |
| FiveM | Circuit RP Public | Unavailable | Public | 00:45:49.883 | Managed |
| FiveM | CityLife Roleplay | 224/275 | Public | 00:48:13.627 | Managed |
| FiveM | CMG Roleplay | 142/1000 | Public | 00:46:46.668 | Managed |
| FiveM | Concrete RP | 334/400 | Public | 00:46:49.742 | Managed |
| FiveM | District 10 | 174/235 | Whitelisted | 00:48:07.304 | Managed |
| FiveM | EchoRP | 169/300 | Whitelisted | 00:48:56.711 | Managed |
| FiveM | ECLIPSE Roleplay | 107/2048 | Whitelisted | 00:47:34.379 | Managed |
| FiveM | Everfall | 155/315 | Public | 00:48:10.238 | Managed |
| FiveM | Everyday Roleplay | Unavailable | Not confirmed | 00:44:53.828 | Managed |
| FiveM | Fat Duck Gaming | 72/1000 | Public | 00:48:56.665 | Managed |
| FiveM | FREE2RP 2.0 | 50/210 | Whitelisted | 00:48:26.312 | Managed |
| FiveM | GTA World English | 688/2000 | Whitelisted | 00:47:26.21 | Managed |
| FiveM | Headliner RP | 296/300 | Not confirmed | 00:49:14.76 | Managed |
| FiveM | HighLife Roleplay | 244/400 | Not confirmed | 00:48:36.921 | Managed |
| FiveM | Hydrate | 13/1000 | Public | 00:47:16.495 | Managed |
| FiveM | Isles RP | 87/200 | Whitelisted | 00:48:05.149 | Managed |
| FiveM | Legit RP | Unavailable | Whitelisted | 00:46:24.163 | Managed |
| FiveM | LiquidRP | 72/150 | Whitelisted | 00:48:10.177 | Managed |
| FiveM | Lucid City Roleplay | 163/350 | Public | 00:47:05.253 | Managed |
| FiveM | Odyssey RP | 314/325 | Public | 00:49:47.423 | Managed |
| FiveM | Popcorn Roleplay | 34/128 | Public | 00:47:35.612 | Managed |
| FiveM | ProdigyRP Allowlist 4.0 | 230/250 | Whitelisted | 00:50:06.029 | Managed |
| FiveM | Resilient Roleplay | 21/120 | Whitelisted | 00:48:15.001 | Managed |
| FiveM | Roleplay UK | 67/361 | Public | 00:47:56.585 | Managed |
| FiveM | Royalty Roleplay | 296/300 | Whitelisted | 00:47:04.153 | Managed |
| FiveM | San Andreas County Roleplay | Unavailable | Public | 00:45:33.332 | Managed |
| FiveM | San Andreas Department of Roleplay (SADRP) | Unavailable | Not confirmed | 00:45:18.533 | Managed |
| FiveM | San Andreas Valley Roleplay | Unavailable | Not confirmed | 00:45:54.824 | Missing |
| FiveM | Space Turtles Roleplay Europe | 279/750 | Public | 00:47:42.877 | Managed |
| FiveM | Starlight Community Roleplay | 35/100 | Whitelisted | 00:47:32.883 | Managed |
| FiveM | Summit RP | 180/200 | Public | 00:49:19.481 | Managed |
| FiveM | The Academy Roleplay — Ambassador | Unavailable | Not confirmed | 00:46:12.934 | Managed |
| FiveM | Vital RP | 95/175 | Whitelisted | 00:47:49.551 | Managed |
| FiveM | We The People RP | 306/320 | Whitelisted | 00:47:34.603 | Managed |
| FiveM | Wild Haven Roleplay | 21/128 | Whitelisted | 00:49:59.234 | Managed |
| Minecraft | Lord of the Craft | 144/1000 | application | 00:51:00.676 | Managed |
| Minecraft | MassiveCraft | 76/500 | Not confirmed | 00:51:00.589 | Managed |
| Minecraft | Stoneworks | 131/550 | Public | 00:51:00.801 | Managed |
| RedM | Dust to Dreams RP | 65/128 | Whitelisted | 00:46:53.546 | Managed |
| RedM | Ebonridge | 99/155 | Not confirmed | 00:46:59.722 | Managed |
| RedM | Everglade County RP | 19/100 | Whitelisted | 00:48:04.348 | Managed |
| RedM | Gilded Roleplay | 57/128 | Whitelisted | 00:48:20.554 | Managed |
| RedM | Highwater Roleplay 2.0 | 31/128 | Not confirmed | 00:48:10.529 | Managed |
| RedM | Medieval RP | 33/64 | Not confirmed | 00:46:58.627 | Managed |
| RedM | Onyx County | 27/128 | Public | 00:48:58.292 | Managed |
| RedM | Ranch Roleplay | 238/240 | Whitelisted | 00:49:12.663 | Managed |
| RedM | RosalitaRP | 75/128 | Whitelisted | 00:46:50.429 | Managed |
| RedM | Souvenir Trails RP | 16/128 | Whitelisted | 00:48:37.651 | Managed |
| RedM | State of Deliverance | 219/250 | Not confirmed | 00:48:41.763 | Managed |
| RedM | State of Fremont 1902 | 24/128 | Not confirmed | 00:48:46.983 | Managed |
| RedM | Still Water RP | 82/100 | Not confirmed | 00:48:10.471 | Managed |
| RedM | Syn County | 380/510 | Public | 00:48:47.412 | Managed |
| RedM | The Frontier Roleplay | Unavailable | Whitelisted | 00:46:19.511 | Managed |
| RedM | The Rift Trails | 47/200 | Not confirmed | 00:48:40.883 | Managed |
| RedM | The Tackroom | 95/200 | Whitelisted | 00:48:28.538 | Managed |
| RedM | True Grit RP | 106/120 | Public | 00:47:32.6 | Managed |
| RedM | Western Skies Roleplay | 56/148 | Whitelisted | 00:47:13.01 | Managed |
| RedM | Westhaven: The Hush RP | Unavailable | Whitelisted | 00:46:25.184 | Managed |

## Post-save addendum

**SAVRP repair passed at 01:03:39.312 UTC.** The ordinary public detail endpoint now returns the managed logo `server-media/5xdqg7/018801f13d35fd36fbb85e1ef043ea5abef696dc978e4ff1613a803f5bbd89a4.png`. It returned HTTP 200, fully decoded as a visible 96×96 PNG, 17,189 bytes, with the same SHA-256 as the previously reviewed Cfx image and the managed filename. Comparison against the pre-save detail found **zero editorial-field changes excluding the logo**; access and join URL were unchanged. Evidence: `savrp-logo-postcheck-2026-09-06.json`.

This yields **64/64 previous unique managed assets plus the repaired SAVRP asset passed**, and all 63 listings now have a delivered logo based on the original full snapshot plus this targeted update. A first immediate post-save request still showed null before the later ordinary read reflected the change; no forced-cache bypass or production mutation was used by this reviewer. No further roster refresh was performed, so the full player-count table remains the explicitly timed earlier snapshot.

Root owns the remaining one bounded public Police RP membership/count check after live SQL and the deployment. No additional research or browser sessions are required from this review.
