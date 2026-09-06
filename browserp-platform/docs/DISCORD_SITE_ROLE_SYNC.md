# Website → Discord role synchronization

Implementation status: foundation implemented in code, **disabled and not applied to production**. No guild ID, bot identity, Discord role mapping or credential is preconfigured. Deployment alone performs no synchronization.

The site remains authoritative. The worker only derives a role when an active `staff_memberships` row and an enabled `private.discord_owner_allowlist` row agree on the same role, and that exact Discord provider ID belongs to the same non-deleted, non-anonymous account in `auth.identities`. The account must have exactly one identity, matching the existing Discord-only staff policy. Suspension is therefore a removal even though the existing staff mutation keeps its allowlist entry enabled. An allowlist entry awaiting a linked account grants nothing.

Only these confirmed source ranks may be explicitly mapped:

| Site key | Site name | Discord destination |
| --- | --- | --- |
| `administrator` | Administrator | Unconfigured; owner must approve an exact role ID |
| `senior_moderator` | Senior moderator | Unconfigured; no assumed mapping to Junior Admin |
| `moderator` | Moderator | Unconfigured; owner must approve an exact role ID |
| `support` | Support | Unconfigured; owner must approve an exact role ID |
| `owner` | Owner | Excluded from automatic management |

Discord's Ownership, Management, Admin, Junior Admin, Moderator, Trial Moderator and Support Team labels are not inferred from display names. Community membership, First100, game interests and community Server Owner are not site staff authority and are outside this integration. The worker never joins members to Discord, changes site roles, grants Ownership, or touches unrelated cosmetic roles.

## Configuration and owner controls

`GET /api/admin/discord-role-sync` returns the private configuration, managed role history, due-member count and recent outcomes. `POST` accepts `guildId`, `botUserId`, `protectedRoleIds`, `mappings`, `enabled`, `revokeOnly`, `expectedVersion` and a review `reason`. It uses the existing Discord session, same-origin protection, rate limit and database owner/MFA/current-session permission checks. There is no dedicated settings UI in this foundation; this is the authenticated API configuration surface for the existing staff tooling. Credentials are never accepted or returned through it.

All Discord IDs must be strings, preserving their full precision. `mappings` is an object from one of the four source keys above to the approved Discord role ID. The required `protectedRoleIds` includes the exact Ownership/security roles that must remain above the bot. Optimistic configuration versions reject stale saves. Guild identity is immutable after first configuration; changing guilds requires draining the old guild and a separately reviewed migration. Removing a mapping retires its ID without deleting the cleanup history.

A dedicated application bot needs **Manage Roles**, positioned above every mapped role and below all protected roles. The worker verifies its actual bot identity, roles and hierarchy, and refuses Administrator, moderation powers and unknown permission bits. Ordinary nonmoderation permissions inherited from `@everyone` are tolerated by an explicit allowlist in the worker. Mapped staff labels must have **zero guild permission bits** to be granted; channel access is configured separately and must be reviewed before activation. Staff moderation commands remain controlled by the selected moderation bot. The token is technically able to manage other roles below it, so server hierarchy, a dedicated bot and credential custody remain required controls; a Discord token itself cannot be limited to this application's ID allowlist.

## Activation sequence — not performed

1. Review and separately authorize `20260906203519_discord_site_role_sync.sql`. Apply it through the normal deployment process and run hosted database security advisors. It depends on the already-installed status scheduler's Vault secret, pgcrypto, pg_net and pg_cron. It adds private RLS-protected tables and service-only RPCs, without altering staff assignment/auth triggers. The new cron job is created paused in the same transaction.
2. Deploy the application code and verify the fixed internal and owner routes. The existing router remains the deployed function; this adds no Vercel function or continuously running process.
3. Create/approve the dedicated bot, exact guild ID, bot user ID, protected role IDs and explicit mappings. Review channel overrides and the hierarchy. Store only the bot token as server-side `DISCORD_ROLE_SYNC_BOT_TOKEN`; keep `DISCORD_ROLE_SYNC_ENABLED=false` until the mapping review is complete. Never use a Discord account token or expose the credential in frontend variables, a document or a request body.
4. Save the reviewed owner configuration with `enabled=true`. Set the application switch to `DISCORD_ROLE_SYNC_ENABLED=true` only on the intended production environment. Finally, explicitly activate the paused `browserp-discord-role-sync` database job. Preview environments must keep the switch false.
5. Verify one controlled non-owner account: assignment, repeated no-op run, rank replacement, suspension with enabled allowlist, reactivation, revocation, missing guild membership and provider failure. Verify both actual Discord membership roles and private outcomes. Verify the configured job reaches `/api/internal/discord-role-sync` successfully, credentials remain private, and the bot cannot act above its role. No such live operation or rehearsal has been performed by this implementation task.

The scheduler reuses the existing database-held opaque credential; HTTP bodies must be empty objects and cannot select users, roles, guilds, provider URLs or credentials. The destination is fixed to the BrowseRP production origin. Discord requests use the fixed API v10 origin, reject redirects, omit browser credentials and include a generic audit reason.

## Reconciliation, cleanup and timing

A run obtains an atomic 55-second lease, works sequentially for at most 30 seconds and selects at most 20 due identities. The paused schedule is configured for every five minutes. This is **eventual reconciliation**, not an atomic transaction across PostgreSQL and Discord: backlog, missing membership, rate limits, provider outages or permission mistakes can extend removal time beyond five minutes. Critical removals should also be verified directly in Discord while a provider outage is active.

Before making any Discord change, a durable private ledger contains the Discord identity. It is independent of user/identity foreign keys. Old managed role IDs are retained independently of active mappings. Consequently, unlinking/deleting an account, deleting its allowlist entry, changing mappings or retiring mappings still leaves enough information to remove a previous grant. Known users are checked again after leaving the guild, so a subsequent rejoin is reconciled without a new site login.

The worker reads current authority before every mutation. It removes old managed roles before adding the desired role, refreshes Discord hierarchy/permissions before a grant and rereads site authority immediately before and after it. A concurrent revocation or configuration change triggers compensating removal. An ambiguous network result during a grant also attempts removal; if that fails, the ledger remains for retry. There remains an unavoidable brief in-flight API race, and a process crash or provider outage can delay compensation. The implementation does not claim synchronous revocation.

Configuration versions fence active reads and writes: a stale completion cannot overwrite the urgency of a changed mapping. Exact managed IDs delimit removal; unrelated member roles are never replaced wholesale. Previously safe managed roles that acquire dangerous permissions are still removed on revocation when Discord hierarchy permits, but are never newly granted.

Discord 429 pauses the entire worker and persists `retry_after` (rounded up), including a 429 encountered during compensating cleanup. Forbidden/configuration outcomes stop the batch for operator attention. No provider error body, token or personal data is returned by the internal endpoint. Private audit events record changes/outcome transitions; repeated no-op checks update the ledger without filling the audit table with duplicate events.

For a planned shutdown, keep both switches enabled and set `revokeOnly=true` first. Verify all managed grants are removed before disabling the job and application switch. Simply disabling synchronization stops changes and **does not revoke existing Discord roles**. In an incident, revoke the bot credential and remove inappropriate Discord roles directly as appropriate; retained IDs support later reconciliation.

## Verification scope

Focused tests execute the migration in disposable PGlite PostgreSQL with real permission checks and pgcrypto. Vault transport/cron dispatch are local test doubles. They cover private table/RPC access, owner/MFA gating, paused defaults, token checks, leases, active membership/allowlist/identity agreement, suspension, mapping replacement/deletion, external account deletion, retained cleanup IDs, stale configuration completions and durable backoff. Worker tests cover role ordering, idempotency, unrelated roles, concurrent revocation, ambiguous grants, cleanup 429, dangerous-role grant denial/removal, exact ID boundaries, fixed network origin, disabled zero-I/O behavior and unauthorized routes.

Hosted Vault/pg_net/cron operation, bot credentials, actual provider hierarchy, target channel overrides and real Discord role changes still require the controlled activation checks above. No migration, role assignment or bot activation is part of the completed local tests.

Primary references checked September 6, 2026: [Discord member role endpoints](https://docs.discord.com/developers/resources/guild#add-guild-member-role), [Discord permissions and hierarchy](https://docs.discord.com/developers/topics/permissions), [Discord rate limits](https://docs.discord.com/developers/topics/rate-limits), [Supabase database-function privileges](https://supabase.com/docs/guides/database/functions). The Supabase changelog was checked for relevant database-function changes before implementation.
