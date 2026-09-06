# BrowseRP Discord community and operations plan

**Status: implementation plan, not a completion record.** New channels, staff roles, permissions, bot functions and workflows below are proposed until their saved settings and member-view checks are recorded in [the setup checkpoint](DISCORD_COMMUNITY_SETUP_2026-09-06.md). This document does not claim any bot is installed, command limit enforced, ticket system working or onboarding enabled.

**Primary design reference, selected by the user:** [GTA RP TEMPLATE FOR DISCORD SERVER — Xenon `eQDWs3Nx3XXe`](https://xenon.bot/templates/eQDWs3Nx3XXe). This choice supersedes the earlier support/gaming template recommendations. Use its organised roleplay-community presentation as the starting point for the BrowseRP adaptation below; the user’s exact feature scope and our explicit permissions remain authoritative. This is not a claim that the template has been loaded or its permissions audited.

The community belongs to owner account `masterbrowserp`, server `1545981135409123409`. The existing checkpoint records the RP emblem, pink branding, Community mode, posted rules, protected announcements, private staff-updates, four game chats, three voice rooms, four cosmetic game roles, Medium verification and all-member media filtering. The root agent subsequently reported a saved optional game-interest onboarding draft, the START HERE and ROLEPLAY WORLDS categories, and enabled mention, suspected-spam and welcoming-content AutoMod rules. Those later reports require final UI readback in the setup record. No staff member has been appointed and no public invite has been released.

## What the community should offer

A recognisable BrowseRP home: useful game discussion, introductions in general, community showcases, finding people to play with, music and voice, private help, and staff-reviewed ideas that members can vote on. Staff need practical moderation tools and clear accountability while the owner keeps control of configuration and dangerous permissions. Website research remains a separate activity; a Discord vote informs decisions without replacing product research or listing review.

Use the RP mark for the server and any eventual official BrowseRP posting identity. Keep the existing game colours. One restrained symbol per category is enough; channel names should explain their purpose. No paid boosts, fabricated activity, unsolicited invites or placeholder claims of working automation.

## Channel layout: 22 purposeful channels

This is the BrowseRP adaptation of the chosen Xenon reference, retaining the requested BrowseRP features in 22 purposeful permanent channels. Keep existing channel IDs wherever possible. Move channels without synchronising a public category's permissions onto private or protected channels. The table is the target structure, not proof it exists.

| Category | Channel | Purpose and access | Starting point |
| --- | --- | --- | --- |
| ✦ BROWSERP · START HERE | `welcome` | Read-only orientation, official website link and routes into games/help. Holds the official links; no duplicate links channel. | Proposed |
| | `rules` | Existing posted rules, read-only. Preserve text and protected overrides. | Existing `1545983932338667561` |
| | `announcements` | Staff-approved BrowseRP news and verified service updates. Members read; only owner and authorised official posting identity publish. | Existing `1545990757377249362` |
| | `faq` | Read-only answers about BrowseRP, joining communities, listings, help and suggestions. | Proposed |
| ◇ COMMUNITY | `general` | Conversation and optional introductions. | Existing; move |
| | `showcase` | Relevant community screenshots, clips and introductions under the existing rules; no unsolicited promotion. | Proposed |
| | `looking-for-group` | Find people by game, region/time zone and intended session. | Proposed |
| ◈ ROLEPLAY WORLDS | `fivem` | FiveM discussion; orange cosmetic role. | Existing `1545989887797502056` |
| | `redm` | RedM discussion; red cosmetic role. | Existing `1545990035743182948` |
| | `roblox` | Roblox community discussion; silver cosmetic role. | Existing `1545990045582762135` |
| | `minecraft` | Minecraft discussion; green cosmetic role. | Existing `1545990040738332682` |
| ◇ HELP DESK | `help-desk` | Public help instructions and, once verified, the private ticket entry point. No public collection of case evidence. | Proposed |
| | **Staff waiting room** — voice | Public waiting space. Members can join it without gaining access to any staff room. | Proposed |
| ♫ VOICE LOUNGES | **General** — voice | Casual voice conversation. | Existing; move |
| | **Group room** — voice | A smaller shared session. | Existing; move |
| | **Music lounge** — voice | Dedicated listening space once a tested music integration exists. | Existing; playback pending |
| | `music-commands` | Commands and queue controls for the selected music app only. | Proposed; app pending |
| ◈ SHAPE BROWSERP | `ideas-and-votes` | One staff-published board for reviewed suggestions, discussion, voting and decisions. Forum/status tags if verified; otherwise staff-created posts. | Proposed; intake/approval mechanism pending |
| ◆ STAFF HQ — private | `staff-chat` | Shared operational chat for staff ranks and Support Team. No unnecessary case evidence. | Proposed |
| | `staff-updates` | Restricted community safety notices, AutoMod alerts and attributable moderation/action logs. Owner + trusted moderation ranks from Moderator upward; no Trial Moderator or Support Team. | Existing `1545985778947981452`; preserve privacy |
| | **Staff voice** — voice | Private discussion for staff ranks + Support Team. Never use it to bring in waiting members. | Proposed |
| | **Owner office** — voice | Owner alone. Explicitly remove/deny every staff and community role’s access; do not inherit their STAFF HQ allowance. | Proposed |

Private case channels or threads are temporary working spaces, not permanent public channels. Help-desk entry categories should be **Website or listing help**, **Report a member or safety issue**, and **Appeal a moderation decision**. Support Team handles ordinary help; reports and appeals route to Moderator/owner, with an appeal reviewed by someone other than the original decision-maker where possible. A requester sees only their own case. If the selected tool cannot enforce that separation, keep those routes disabled and show a truthful manual contact route supplied by the owner.

The waiting room does not grant permission to listen to staff voice. Staff can meet someone in the waiting room or open a separately restricted help room for that case. Never move a requester into STAFF HQ or Owner office.

## Roles and control boundaries

Use this exact staff ladder, highest to lowest: **Ownership → Management → Admin → Junior Admin → Moderator → Trial Moderator**. “Trial Moderator” is the intended role name. **Support Team** is a separate help role, not an extra administration tier. Create operational roles unassigned; the owner appoints real people. No friend or visitor is automatically staff. An Admin label never means the Discord Administrator permission.

Add **Member**, **First 100** and **Server Owner** as community roles alongside the four existing game roles. Server Owner identifies an appropriately checked community/listing owner; it confers no BrowseRP staff authority. First 100 recognises the first 100 unique human members by their first valid join, excluding bots and repeat joins. Do not claim automatic awards or backfill eligibility without reliable join evidence and a supported process. Member is neutral identity, not a reason to open private staff channels or bypass acceptance requirements.

| Role, highest first | Proposed colour | Purpose |
| --- | --- | --- |
| Ownership | `#ec4fa6` BrowseRP pink | Owner identity; only the actual server owner has ownership powers. |
| Management | `#dc65b0` rose | Staff coordination and operational decisions. |
| Admin | `#c065d0` orchid | Senior case decisions and escalation. |
| Junior Admin | `#9568d5` violet | Review and supervise routine moderation. |
| Moderator | `#a98ae4` soft violet | Day-to-day public moderation. |
| Trial Moderator | `#bfa9ef` pale violet | Supervised moderation practice. |
| Support Team | `#8ea6db` muted periwinkle | Ordinary help cases. |
| Server Owner | `#b8a8cd` muted lilac | Community/listing-owner identity, no staff powers. |
| First 100 | `#e6bf69` gold | Early human-member recognition. |
| Member | `#a8a8b0` neutral grey | Ordinary community identity. |
| FiveM / RedM / Roblox / Minecraft | Preserve saved colours | Optional cosmetic game interests. |

Role labels, not colour alone, communicate authority. Position staff above cosmetic roles so choosing a game does not override staff identity. Ownership does not grant another person actual ownership or automatic access to the owner-only office.

| Role or identity | Allowed work | Explicit boundaries |
| --- | --- | --- |
| Actual owner / Ownership identity | Server configuration, staff appointments, bot installation/configuration, recovery, native audit review and emergencies. | Actual owner alone controls server ownership and Owner office. Keep recovery codes and credentials out of messages and notes. |
| Management | Staff rota/appointments proposed to owner, incident coordination, reviewed announcements and policy decisions. | No Administrator, Manage Server, Manage Roles, Manage Channels or Manage Webhooks. Owner executes configuration and appointments. |
| Admin | Senior case and appeal decisions; authorise severe action through an owner-configured bounded workflow if supported. | No broad native kick/ban, bulk actions, role/configuration management or owner-office access. |
| Junior Admin | Supervise moderators, review case quality and handle escalations within assigned scope. | No staff appointments, server configuration, unrestricted punishments or owner-office access. |
| Moderator | Public-message moderation; warnings/timeouts through the verified native or restricted-command route; restricted safety/action logs. | No Administrator, Manage Server/Roles/Channels/Webhooks or direct mass-ban power. Direct Kick/Ban OFF when bounded bot commands are used. |
| Trial Moderator | Report/triage incidents, supervised warnings and narrowly limited actions once tested. | No full audit/safety-log access by default, severe punishments or independent case escalation. Give only the case information needed for supervision. |
| Support Team | Shared staff discussion and assigned ordinary help cases. | No native audit log, moderation/safety log, unrelated reports/appeals, punishment commands, role management or owner-office access. |
| Member / First 100 / Server Owner / game interests | Public community participation and the stated cosmetic/recognition purpose. | No staff permissions, configuration, private staff access or privileged role grants. First 100 and Server Owner are not moderation ranks. |
| Official BrowseRP posting identity | Owner-approved announcements, help panels or approved ideas in configured destinations. | RP branding without a fake verification claim. No extra moderation/staff access merely to publish. Installation remains pending. |

**Do not hand moderators unrestricted bot power instead of Discord permissions.** Restrict who can invoke each command, which channels it can run in, which targets it can affect and who can change those restrictions. Support cannot run punishment commands. Ordinary members cannot use staff commands through DMs, alternate command names or buttons. Protect owner/staff/bot identities from lower-privilege actions. Log both successful actions and denied attempts where supported.

### Bot hierarchy and permission architecture — proposed

The research agent is evaluating the actual free capabilities of Wick, Dyno, Carl-bot and the official-posting options. Names here are candidates, not installed products or promised features. Use the smallest combination that covers the verified requirements; do not run overlapping automatic punishments from several bots.

- **Moderation/security app:** give only the permissions needed for enabled actions. A timeout-only app needs no Ban Members permission. If banning is approved, staff commands must have tested target restrictions, escalation rules and action limits before staff use them. Owner alone controls configuration. Do not grant Manage Roles/Channels or Administrator merely for convenience.
- **Cosmetic role assignment:** prefer the already-prepared native onboarding where it meets the need. If a role app is selected, allowlist only the four game roles; any later Member/First 100 assignment needs its own verified policy and explicit allowlist. Its role must be above those assignable cosmetic roles and below every staff rank, Support Team and other privileged bot roles. Never offer a staff or bot role in a public role menu.
- **Security restoration/anti-nuke features:** configuration rollback, role stripping or channel restoration may need substantially broader permissions. Keep those functions off until the selected tool's requirements, free limits and precise authority are reviewed. A bot with broad destructive permissions creates its own risk; do not advertise protection before bounded tests prove what it does.
- **Music app:** limit text access to music commands and voice Connect/Speak to Music lounge. No staff, help-case or moderation-log access and no Administrator, Manage Server or Manage Roles.
- **Tickets/suggestions app:** grant only its intake, case and approved-post destinations. Any ability to create private cases must preserve the Support/report/appeal split above. Disable transcript delivery to unrelated roles and public destinations.
- **Official posts:** a webhook may be sufficient for controlled publishing, while interactive commands require an application. The selection is pending research. A webhook address is a credential: keep it out of messages, documentation, browser URLs shown to members and public configuration. Staff do not receive Manage Webhooks just to suggest an announcement.

## Moderation that staff can use without risking the server

Keep native AutoMod as the first layer for mention spam, suspected spam, targeted abuse and unwanted sexual content. Avoid competing bot rules that punish the same message twice. Review false positives, especially game names, quoted reports and normal roleplay terms. Do not promise an infallible profanity or raid filter.

The proposed normal ladder is: remove/block the offending content and explain the rule; record a warning for a repeated minor breach; use a short timeout for continued disruption; escalate serious or repeated conduct to a longer timeout or owner-reviewed removal. Credible threats, raids or exploitation require immediate containment and owner review rather than mechanically waiting through every tier. Record the rule, reason and relevant evidence; do not publish private evidence in a public punishment notice.

Before enabling staff punishment commands, configure and test whatever the selected free tool actually supports: per-command cooldowns, per-staff/action caps, protected targets, maximum timeout duration, one-target-at-a-time operation, confirmation for severe actions and owner-only bulk actions. **No numeric quota or bot limit is implemented by this plan.** If the chosen tool cannot enforce a required bound, do not expose that command to routine staff; retain the safer native action or owner-only handling.

Set slowmode purposefully after observing the channel: tighter in showcase/LFG/ideas, lighter in ordinary conversation. Test that staff can respond to incidents without opening mass mentions or changing role permissions. Under a raid, the owner should be able to pause invites, raise verification or temporarily restrict affected public channels through supported controls, with the prior settings recorded for restoration. Staff can alert and contain messages; they do not need unrestricted server-wide configuration.

Each action log should identify the actor, target, action, reason/case reference, timestamp and expiry where relevant. Avoid unnecessary copies of deleted-message content or attachments. The owner and trusted moderation ranks from Moderator upward can review the restricted operational log; Trial Moderator receives supervised case context only, and Support sees only the ordinary help-case record needed to do their job. Set retention and transcript handling after the selected app's actual controls are verified; do not invent a retention guarantee.

## Moderated ideas and voting

1. A member submits an idea through the approved private intake route. Ask for the problem, who it affects and a useful example. Keep sensitive account details and accusations out of this route.
2. Moderator/owner checks relevance, duplicates, personal information and the existing rules. Request clarification privately when necessary. Rejected raw submissions never appear on the public board.
3. Staff publishes the approved idea in `ideas-and-votes`, with a clear title and neutral description. Credit the submitter only with their agreement. Member discussion remains moderated.
4. Enable the selected voting mechanism only after testing that ordinary members cannot approve/publish their own submissions or use staff controls. If reactions are the temporary mechanism, describe their counts as informal feedback; do not claim fraud prevention or one-person-one-vote guarantees that have not been tested.
5. Use understandable public statuses: **Open for feedback**, **Under review**, **Planned**, **Completed**, **Declined**. Only staff changes status. Add a short reason, link duplicate ideas and mark Completed only after the relevant change exists. Planned is not a promised delivery date.

An idea's popularity is useful evidence, not permission to bypass safety, listing standards, budget or product judgement. A clear Declined explanation is better than leaving every request looking accepted. The public board is staff-published even if ordinary members may reply to approved items.

## Ready-to-use channel copy

### Welcome

**Welcome to BrowseRP.** Find your next roleplay community, share what you enjoy and meet people across FiveM, RedM, Roblox and Minecraft.

Start with `#rules`, choose your game interests in Channels & Roles, then join `#general` or your game chat. Visit `#showcase` for community moments and `#looking-for-group` to find people to play with. For account, listing or community help, start in `#help-desk`.

Our official website is **https://www.browserp.com/**. Official updates appear in `#announcements`. Joining this Discord does not approve a server listing or verify ownership of a community.

### FAQ

**What is BrowseRP?** A place to discover roleplay communities and compare the details that matter before joining. This Discord is the community around it.

**How do I find or list a community?** Use Discover or List a server on the official BrowseRP website. Each listing explains its own joining requirements. Discord membership is separate from a listing application or ownership check.

**Where can I share my community?** Use `#showcase` within the posted rules. Be clear about your connection to it and avoid repeated adverts or unsolicited direct messages.

**Where do I get help or report a problem?** Start in `#help-desk`. Website/listing help, safety reports and moderation appeals need different routes. Never post passwords, recovery codes, identity documents or private evidence in public chat.

**Can I suggest an improvement?** Yes. Use the suggestion intake described in `#ideas-and-votes`. Staff reviews submissions before publishing them for feedback; the public status explains what happens next.

**Where can I check service problems?** Read verified updates in `#announcements` and any linked official status source. A Discord bot being online does not prove that the website or its providers are healthy.

### Help desk

**Tell us which kind of help you need:** website or listing help, a member/safety report, or a moderation appeal. Keep private details out of this channel. The available private contact or ticket route will be shown here once it is configured and tested. You can also join **Staff waiting room** when a staff member is available; it does not connect you to private staff conversations.

### Ideas and votes

**Help shape BrowseRP.** Explain the problem you want solved and give an example of how it affects you. Staff reviews submissions before they appear here. You can discuss and vote on approved ideas; the status shows whether each one is gathering feedback, under review, planned, completed or declined. Votes inform decisions and do not guarantee a feature or delivery date.

**Implementation note:** add the real, tested intake button/link before advertising submission as available. Until then, keep the board read-only with a brief setup notice. Do not publish the explanatory implementation note itself.

### Rules and official updates

Keep the existing rules post intact and point newcomers to it. Enable acceptance of those same rules through the native screening flow after reviewing the actual settings; do not create a second conflicting rulebook or rewrite legal terms.

Official updates should name the affected service, verified symptom, what members can do and when the information was checked. Attribute external-provider status to its official source. Do not display an invented green “all systems operational” panel or claim automatic monitoring before a real integration is tested. Any eventual BrowseRP bot uses the RP mark and publishes only reviewed, factual posts.

## Onboarding and launch checks

Retain optional multi-select game interests mapped only to the four cosmetic roles. For a useful default view, keep rules, announcements and general; add showcase and looking-for-group alongside the four launch-game chats. That proposed set is nine defaults with seven normal conversation channels; confirm the native wizard's actual requirements instead of assuming its draft is enabled. FAQ, help and voice remain discoverable without forcing everyone into every channel.

The reported draft has two custom tasks plus automatic Read rules. Add **Visit showcase** as the third custom task, using a visit action rather than requiring a low-value post. Keep welcome text short, preserve the existing introduction/news tasks unless their configuration needs correction, and verify completion in the native preview. Do not mistake automatic rules reading for the third custom task.

Before any public invite, review the saved channel overrides and use **View Server As Role** for `@everyone`, Member, First 100, Server Owner, every game role, Support Team and every staff rank. Check combined-role members too: a game interest must not expose staff rooms. Explicitly prove that Support and Trial Moderator cannot see unrestricted staff-updates/reports/appeals, and no staff rank can see Owner office, public waiting-room members cannot hear or join staff voice, and ordinary members cannot post to rules/announcements or approve their own ideas. Recheck after moving or synchronising a channel. Role preview is configuration evidence, not proof of actual microphone/audio behaviour or a real ticket conversation.

Test normal commands, denied commands, bot-role hierarchy, a harmless moderation action on a designated test account, healthy and failed music requests, a complete private help case and one approved/rejected suggestion. Keep all bot tests within this server and avoid real-member punishments. Verify event/action logging and restoration after a bounded restriction change. No bot or staff role should be assigned to a person just to make the checklist appear complete.

Moderator two-factor enforcement remains an exact owner-authentication step if Discord requests it. Pause that step for the owner; do not inspect backup codes, change credentials or claim the requirement is on until its saved state is verified. Existing account recovery-code replacement is separately deferred.

## Permission appendix for implementation

All allowances are proposed and require saved readback. “Trusted moderation” means Moderator, Junior Admin, Admin and Management; role names do not automatically grant additional Discord permissions.

| Destination/action | Members and community roles | Support Team | Trial Moderator | Trusted moderation | Actual owner |
| --- | --- | --- | --- | --- | --- |
| Welcome/rules/FAQ | Read | Read | Read | Read | Publish/configure |
| Announcements | Read | Read | Read | Management may publish reviewed news if channel allowance is deliberately granted; other ranks read | Publish/configure |
| General/showcase/LFG/game chats | Read/send within rules | Read/send | Read/send; supervised action only | Public-message moderation within rank scope | Full control |
| Approved ideas board | Read/vote/reply after configured | Help triage only if assigned | Supervised triage | Assigned reviewers publish/change status | Final decision/configuration |
| Ordinary help cases | Own case | Assigned cases | No general access; designated supervised case only | Escalated cases as needed | Oversight |
| Safety reports and appeals | Own submission | No general access | Supervised case only; no full queue | Assigned review; avoid self-review of own appealed action | Oversight/escalation |
| Public waiting room | View/connect; no staff-room access | View/connect/respond | View/connect/respond | View/connect/respond | Full control |
| Staff-chat and staff voice | Deny View/Connect | Allow | Allow | Allow | Allow |
| Staff-updates / AutoMod / action logs | Deny View | Deny View | Deny general access | Allow read; selected app writes | Allow/configure |
| Owner office | Deny View/Connect | Explicit deny | Explicit deny | Explicit deny, including Management and any non-owner Ownership label | Owner alone |
| Native audit log / bot configuration | Deny | Deny | Deny | No access by default; use restricted operational logs | Allow |
| Staff or bot-role assignment / server, channel or webhook management | Deny | Deny | Deny | Deny | Allow |
| Emoji/sticker management | Existing restricted defaults | Deny management | Deny management | Propose assets; no management | Curate/upload |
| Mass mentions, mass deletion/ban, emergency configuration | Deny | Deny | Deny | No broad direct authority | Owner-controlled, bounded and logged |

For private categories, deny `@everyone` View Channel, then allow only named staff roles. Verify channel exceptions individually. Preserve existing rules/announcements posting denies. Owner office and staff-updates must stay unsynchronised where the parent permits a broader staff audience. No bot inherits staff access merely because it is installed. Before assigning anyone a staff rank, test both their channel visibility and their command permissions; a new role name is not proof its boundaries work.

## Chosen template: verified reference and BrowseRP adaptation

The primary public [Xenon listing](https://xenon.bot/templates/eQDWs3Nx3XXe), read on 6 September 2026, displays **51 channels and 56 roles**. Visible sections cover staff operations, support, social chat, roleplay, reports and voice. Examples include a support waiting area, several support offices, moderation records, voting and ideas, clips and music. It also contains donation offerings and in-game professions associated with running a GTA roleplay server. These are observations of the public listing, not evidence that any bot, permission or automation works.

| Visible reference pattern | BrowseRP adaptation |
| --- | --- |
| Grouped staff operations and records | STAFF HQ, restricted staff-updates/action logs, private staff voice and the owner-only office. |
| Waiting area and support offices | Public Staff waiting room, help-desk routing and private case spaces created only when needed. |
| Separate reports, technical issues and appeals | Website/listing help, safety reports and appeals with distinct case access and review responsibilities. |
| Voting, ideas, clips and social discussion | Staff-reviewed ideas-and-votes, showcase, looking-for-group and general; no unreviewed public suggestion intake. |
| Organised voice and staff hierarchy | Existing voice lounges plus the exact BrowseRP staff ladder and four cosmetic game interests. |

**Presentation is not permission policy.** The public template page does not establish saved channel overrides, command allowlists, role capabilities, trustworthy counts or operational bot safeguards. Build those from the role and permission matrices in this blueprint, then verify them in the actual server. Do not import fixed member/booster figures, donation products, in-game job access or unrelated GTA-specific services as BrowseRP features. Our official status communications must remain based on verified sources.

All requested BrowseRP capabilities remain in scope: branded welcome/rules/FAQ/official links; four game communities; the exact six-rank staff ladder plus Support Team and non-staff Member/First 100/Server Owner identities; private help/report/appeal routing; staff chat/voice, public waiting and owner-only office; moderated ideas, approved voting and decision status; attributable moderation/security logs; bounded staff commands and anti-abuse controls; voice/music; native onboarding/rules acceptance; and an official RP-branded posting identity once its method is configured and tested. The prepared 40-image emoji pack supplies operational, poll and community reactions with source credits; preparation does not establish Discord upload or working bot features.

The earlier [Advanced Support Server](https://discordtemplates.me/templates/755059728878665728) and [Gaming Community Friends](https://discordtemplates.me/templates/734824647434043433) links are historical secondary references only. They no longer define the chosen layout. Do not attribute unseen channels or permissions to the chosen template. BrowseRP-specific additions are our explicit adaptation choices above; do not silently replace the user’s selected reference with another pack.

### Apply the design to the existing server

Preserve the current server, IDs, posted rules, private overrides and saved Community settings. Adapt the chosen structure in place and read back privacy after each category/channel move. The template’s import instructions are separate from the decision to use it as a design reference. A native Discord template creates another server; the [Xenon loader documentation](https://github.com/Xenon-Bot/wiki/blob/master/templates.md) describes replacement of existing channels and roles by default. No wholesale import or destructive replacement has been performed by this documentation update. Do not load the template over the existing community as a substitute for the explicit BrowseRP configuration and permission checks.
