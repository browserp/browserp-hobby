# Game-aware application options

This is an add-on to `20260905233144_reviewed_owner_listing_updates.sql`, prepared on release `7778a56bba4d16561c9669c255261582f9b53827`. It has not been applied live or deployed by this agent.

New applications offer FiveM, RedM, Roblox and Minecraft after the enabled platform list loads. Each game gets relevant features: for example custom vehicles for FiveM, horses and ranching for RedM, editions/crossplay/quests for Minecraft, and organised events or mobile/controller support for Roblox. Joining requirements remain in the dedicated Public/Whitelisted/Not confirmed control. No duplicate access chips are added. The global platform API and staff maintenance choices remain unchanged.

The read-only live catalog check found only the historical 17 seeded entries. Several existing visible choices had no accepted catalog entry. The new additive seed aligns every contextual choice with the database without removing existing entries, relabelling them or overriding disabled choices. Tests apply the real historical seed and new migration, then validate every rendered feature against both catalog and game policy.

Owners can update a claimed imported listing without losing researched keywords. The form preserves exact existing keyword strings (including noncatalog names, spaces, case and more than eight values), displays noneditable research keywords in a small disclosure, and permits deliberate changes to contextual features. Unchanged source/relevance records survive approval. If staff added keywords before a correction is reopened, the refreshed form retains them and asks the owner to compare the current listing.

The database derives preservation rights from the locked, published server and recorded owner. It never trusts a client owner flag. Removing protected research keywords is rejected; staff can review those changes separately. A request can add at most eight enabled contextual features, and the total stays within 30 or the existing larger count. The HTTP boundary accepts at most 128 existing keywords of 2–40 characters each; this is a defensive request limit, not permission to create arbitrary keywords. Ordinary new applications still accept at most eight contextual catalog features.

The atomic creator now delegates to a private shared implementation that selects ordinary validation or the actual owned-target validation. Creation, private Roblox evidence, queue insertion, owner attachment and idempotency receipt remain one transaction. The receipt binds the exact full data and target. Current sessions, expected account, bans, legal acceptance, rate limits and existing open-review limits remain enforced. Corrections derive the owner target from the stored proposal, retain its queue/version guards and use the same authoritative feature validation. Existing nonlaunch owned listings and historical corrections remain maintainable; new nonlaunch applications are rejected. Private helpers are not executable by anonymous users, members or the service role.

## Rollout

1. Integrate the frozen owner-update patch, then this separate follow-up patch.
2. Review/apply the owner migration first, then `20260906001040_contextual_listing_features.sql`. Do not publish the earlier owner form alone: its former eight-tag limit could reject imported listings.
3. Run the full repository gate on the combined release and verify one ordinary game-aware form plus one realistic owned imported-listing form in the coordinated browser batch. The local API/UI fixtures make no live submissions.
4. Verify deployed bytes for the two changed scripts and the API release. Existing JavaScript responses use `max-age=0, must-revalidate`; no broad cache-policy change is needed.

No production listing, tag, staff permission or platform setting was changed during this work. Isolated PostgreSQL and DOM tests establish application behavior; they do not replace hosted-session or physical-device verification.
