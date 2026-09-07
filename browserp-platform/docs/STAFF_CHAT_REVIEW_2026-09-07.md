# Staff suggestions reviewed — 7 September 2026

The owner requested a useful, bounded final pass based on staff-chat suggestions. This record distinguishes existing behavior, the final additions, and unimplemented requests. It does not authorize future changes or replace newer owner instructions.

## Selected for the final release

- **Individual permission guidance:** per-person Role default / Allow / Deny controls and permission descriptions already exist and are enforced by the database. The clarification explains inheritance and that staff sign-in and MFA requirements still apply. No staff powers were expanded.
- **Cookie preferences:** a compact first-visit prompt offers clear accept and reject choices, with optional recommendations off until chosen. A footer control opens the full preferences dialog later. An explicit choice is remembered across navigation; rejecting turns recommendations off and clears their history. Essential authentication/security cookies remain unchanged. No analytics or advertising tracking was added. The first-visit prompt follows the owner's latest request for a visible popup.
- **Protected network evidence:** review found that two simultaneous calls could reuse one approved reveal. The additive migration locks the exact request and checks current expiry before consuming it. Only an active owner with approval permission can reveal directly; other staff require their own approved request. Evidence retrieval and its audit entry remain one transaction. Activation and production verification must be recorded in the final release receipt.

## Already present; preserve

- Staff permission descriptions and per-member exceptions, subject to role and owner-only permission restrictions.
- Masked network evidence in staff views, encrypted full evidence, owner approval and expiry for non-owner reveals, and audited viewing.
- Privacy and cookie policies describing the actual service and optional browser-local recommendations.
- The established brand artwork, synchronized moving/pulsing pattern, header glow, game imagery, discovery filters, advert layout and protected staff access.

## Still to build or establish

- Staff clock-on/off, accurate hours reporting, and an explicit availability toggle/team view. Existing security activity timestamps are not timekeeping or proof a moderator is available.
- Website audit summaries in a private Discord channel. Do not forward raw logs, IPs, credentials or private report contents. A reviewed event format, least-privilege integration, delivery/retry handling and destination privacy checks are needed.
- Further staff-navigation improvements beyond the small permission clarification.
- A new Discord promotion advert and footer social link, after the invitation and ordinary-member entry/privacy checks are established.
- Additional profile/banner artwork polish. The BrowseRP profile bio and dark/pink theme were saved; the banner upload was not completed.
- Changing network collection to registration only. Current evidence is also captured for security activity; the existing system was not silently changed and the policy must not claim registration-only collection. Retention and audit-record lifetime need a deliberate policy rather than an unqualified promise of permanent storage.

## Discord essentials still unfinished

Website-to-Discord staff-role synchronization remains disabled and its separate activation migration is unapplied. Ordinary-member verification, private-ticket isolation, staff delegation/protected targets, real music/AFK/counter behavior and a reachable appeal intake for Discord-banned users still need proof. Server moderator 2FA remains off/unconfirmed. Ticket transcripts are manual before confirmed deletion. The seven ticket panels, onboarding, suggestions workflow, selected native safety rules and bot configuration have saved setup evidence; those facts do not establish every member-facing or attack-protection outcome.

The final release/PC backup receipt records exact commits, live deployment and tests. Preserve the PC checkout and its local work; do not replace it with an older deployment or deploy unfinished shared development simply because it is included in the backup.
