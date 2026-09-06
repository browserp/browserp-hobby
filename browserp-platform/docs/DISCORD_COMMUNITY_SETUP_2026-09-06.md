# BrowseRP community setup checkpoint

## Current checkpoint after the template import — 6 September 2026

The user confirmed the full import of the selected [GTA RP Xenon template](https://xenon.bot/templates/eQDWs3Nx3XXe) into server `1545981135409123409`. The root task restored the server name to **BrowseRP**. This supersedes the pre-import assumption that the template was only a design reference. The template began with **51 channels and 56 roles**; these are initial template counts, not a current tally during cleanup. Import success is not completion of the community or proof of its permissions.

The retained Xenon backup reference is `FN56MIOZIYZK`. Keep this recovery reference in internal project notes, not public welcome posts. The free backup covers roles, channels and settings; it is not a message backup. No full restoration rehearsal is recorded here. Xenon was removed after the import. The installed bots are now **Security and ServerStats**; the earlier Security-only readback is superseded.

| Area | Verified state | Still required |
| --- | --- | --- |
| Security bot | Installed by the owner; presence verified | Review its granted permissions, configure protection and owner-controlled command access, then prove the intended limits. Installation alone establishes no anti-raid or anti-nuke protection. |
| Staff text channels | All four verified private: `joins-left-kicks-bans`, `logs`, `staff-chat`, `reports`. The former `moderators-only` (`1546229400016527370`) was renamed `staff-chat`, synced to Staff and its View Channels/Connect denies confirmed | Staff role access and assignments are not enabled yet; recheck effective member/app access when granting them. |
| Staff voice rooms | Former Staff meeting is **Staff voice**, synced private. Former Staff on duty is **Owner office**, synced first and then given an explicit Speak deny | Owner office is intentionally unsynced after that deny; `@everyone` View Channels, Connect and Speak are denied, with no staff exceptions. Preserve its separate policy. |
| Staff roles | Six existing template roles renamed and coloured; public role mentions off; dangerous native permissions verified off for all six | Roles remain unassigned. Hierarchy, appropriate channel access and allowed bot commands still need work. |
| Emoji | **40 static emoji** complete: the original RP mark and 39 Twemoji; the root task read **10 of 50 static slots remaining** | Publish the emoji credit in member-facing help/FAQ; check use in finished posts and workflows. |
| Member counters | Owner installed official ServerStats `458276816071950337`; root completed `/setup` → voice → Default at **8:26 PM**. Initial automatic counters read **All Members 3 / Members 1 / Bots 2** | The bot's actual message states **15-minute updates**, superseding older 10-minute research. This snapshot is not proof of a later join/leave refresh; do not present the template's 30 as real members. |
| Booster counter | Not configured | Add the intended distinct-booster or boost-unit counter and verify its meaning/update. Any leftover template zero is not a live statistic. |
| Template role cleanup | **Complete:** all 45 unused roles plus Special Forces (**46 unassigned template roles**) removed; final role list read back as **18 roles**, including managed Security and ServerStats roles. Human role names are emoji-free | Role cleanup does not finish hierarchy, assignments, staff access or bot commands. Channel/content adaptation is still open. |

Emoji attribution, the upstream graphics license and the exact 40-entry source/hash manifest are retained under [discord-assets](discord-assets/CREDITS.md). The manifest records uploaded assets, not a proof that suggestion voting, moderation or other bot actions work. Images themselves are not duplicated into the repository.

### Saved staff role names and colours

| Role | Saved colour |
| --- | --- |
| Ownership | `#ec4fa6` |
| Management | `#dc65b0` |
| Admin | `#c065d0` |
| Junior Admin | `#9568d5` |
| Moderator | `#a98ae4` |
| Trial Moderator | `#bfa9ef` |

For each role, the root task verified public role mentions off and dangerous native permissions off: Administrator; managing the server, roles, channels, webhooks or expressions; ban/kick/timeout; nickname management; mass mentions; message/thread deletion and management; TTS; and voice moderation. Only **Ownership** retains View Audit Log and Server Insights; these are off for the other five. The actual Discord server owner's intrinsic rights are unchanged; naming a role Ownership does not transfer server ownership.

All six roles are **unassigned** and have not been allowed access to the Staff category. The verified staff areas currently admit the actual owner and Security, not the future staff team. Hierarchy and staff access are the root task's next work; bot-mediated punishments/command limits remain unconfigured and unproven. The role checks do not establish effective permissions for a future member holding multiple roles.

Five retained roles were renamed **Support Team, Announcements, Creator, Server Owner and Member**. Public role mentions are off, and all checked extra native permissions were disabled and saved (16, 16, 15, 16 and 0 toggles respectively); they inherit public `@everyone` access only. These names confer no staff or ownership authority by themselves. The four game roles and First 100 remain unchanged with their previously restricted settings. Together with the six staff roles and two managed bot roles, the retained list totals 18; no operational staff assignment is implied.

## Work still required before opening the community

1. **Make the imported server fit BrowseRP.** Finish welcome, rules, FAQ, updates, game discussion, help and voice areas; remove irrelevant in-game jobs, donation offers and unused template material. Preserve the user-selected design while checking each change.
2. **Finish staff authority without reopening private rooms.** The `moderators-only` exception is resolved, the four Staff text channels and two private voice rooms have been checked, and unused-role deletion is complete. Finish hierarchy, appropriate Staff access and assignments, preserving Owner office's separate denies. Configure explicitly allowed bot commands and test effective access, target restrictions and revocation; no general staff or bot whitelist. Private ticket/requester isolation remains untested.
3. **Configure and test security.** Security is installed but unconfigured and unproven. Review its permissions, logging destinations, command access, action limits and recovery behaviour. Re-enter native AutoMod, profanity/spam/mention filters, raid controls, verification and moderator 2FA after the import; prior settings do not establish their current state. Use bounded checks, never attack traffic or destructive tests on members.
4. **Finish member entry and community decisions.** Configure rules acceptance, game-role self-selection and ordinary-member access. Website suggestions must reach a private review queue before public voting, with clear decisions/statuses. Existing-bot selection is researched; the workflow has not been installed or tested. Native staff-created polls can support approved questions once channel permissions are checked.
5. **Finish private help, official posts and music.** Configure the chosen ticket workflow and trusted support access, then test requester isolation. Prepare BrowseRP-branded welcome/rules/FAQ/updates without claiming a running custom bot. Install and test any chosen free music integration in its designated channels only. These functions are pending.
6. **Finish counter setup.** ServerStats member/human/bot counters are configured, with a stated 15-minute interval. Review channel and command permissions, confirm an actual change refreshes, and add the still-missing booster counter. Distinguish people boosting from boost units; use the managed Server Booster role for a people count. Do not promise instant updates.
7. **Complete ordinary-member checks and the final readback.** Check rules/onboarding, public and private visibility, support, suggestions/voting, voice, role changes and app permissions from an ordinary member's access. No public invitation has been published by this work. Do not claim the server is finished or globally private before these checks.

The owner deferred Discord recovery-code replacement; do not inspect codes, copy credentials into these notes or repeat the request tonight. Preserve **at least 50% of the weekly allowance remaining**; the latest root-reported snapshot was 31% used/69% remaining. Finish agreed work within that budget without expanded research or new tasks. The owner now requests **one coordinated website release**, superseding periodic publication for this batch; see the latest repository-root handoff for pending staff work and committed Discover controls.

## Historical checkpoint before the template import

The observations below were verified before the full import. Channel IDs, role permissions and safety routing may have changed during replacement. They are retained as history and must be revalidated before use; they are not current permission guarantees.

Server1545981135409123409 belongs to the master account. RP emblem, pink Soul banner, description and FiveM/RedM/Minecraft/Roblox/Roleplay traits saved. Private profile remains enabled and no public invitation is published.

Community mode enabled with posted rules in channel1545983932338667561 and private staff-updates1545985778947981452. Rules are readable but member sending, thread creation/sending, reactions, invites and external/app commands are denied there. Staff updates are owner-only at this checkpoint. Medium account verification, filtering media from all members, mentions-only notifications, restricted member pruning and activity alerts enabled. Community safety updates go to the private channel. Risky default everyone event/emoji creation and mass mentions removed by Community setup.

AutoMod's existing mention-spam rule is on. Suspected-spam rule was saved with blocking and alert delivery to private staff-updates; final collapsed rule showed enabled and the destination. No real-member spam or raid attack was performed. Discord's built-in raid/DM safety options were read as enabled; this is a settings observation, not an attack-resilience guarantee.

Remaining before public invite: least-privilege roles and assignments; game, announcements, support and showcase structure; voice/music; onboarding/rules acceptance; ordinary-member permission preview; final spam-rule readback. Mandatory moderator2FA needs fresh owner authentication, remains OFF and no moderator has been assigned. User deferred recovery-code replacement until tomorrow. Never inspect codes or ask for another backup passphrase tonight. Community setup is independent of website research and improvement work.

### Further saved channel setup before import

Four text chats: FiveM1545989887797502056, RedM1545990035743182948, Minecraft1545990040738332682, Roblox1545990045582762135. Voice rooms General, Group room and Music lounge exist. Music playback/bot integration is not yet configured. Announcements1545990757377249362 was duplicated from the protected rules channel; all eight inherited member-deny permissions were individually read back as selected. A truthful setup/welcome message and descriptive topic are saved. It is a read-only text channel; Discord cross-server announcement publishing is not configured. No public invite or outside member has been added.

### Music integration research (not installed)

The official Discord app directory lists Jockie Music411916947773587456 as a free music bot: https://discord.com/discovery/applications/411916947773587456 . Its own FAQ https://www.jockiemusic.com/faq?selected=setup-bots+permissions+everyone lists sending messages, embedded links, voice Connect and Speak as required; broad Administrator is described only as convenient, not technically required. Evaluate one free instance confined to a music-command channel and Music lounge, without Administrator, Manage Server, Manage Roles, moderation privileges or access to private staff channels. Test command restrictions, queue controls, voice quality and failure messages before considering it complete. Its current track-source support is not proof of playback quality or licensing coverage. No app has been authorised and no subscription purchased. Rythm has a subscription/trial model (https://rythm.fm/terms-of-service); do not start a payment-backed trial as an implicit free launch choice.

### Saved game interest roles before import

FiveM#ffa15f, RedM#ff627d, Roblox#dadce5 and Minecraft#84d989 exist with zero assigned members. Saved names were reloaded and final colour markers read from the real role-list DOM. Initial rapid edits left two colours on the wrong rows; corrected against the named role form, saved and read back all four. Each of the four roles was independently opened in Permissions: all51 additional role permissions were OFF. They add no staff privileges or private-channel access. Onboarding/self-selection remains unfinished, so these are prepared interest roles rather than an advertised working signup flow. No staff role or bot was assigned.
