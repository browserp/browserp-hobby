# BrowseRP architecture

## Boundaries

- **Browser:** static, accessible HTML/CSS/JavaScript. It receives only public catalog fields or the signed-in member's authorized data.
- **Vercel Functions:** input validation, Discord PKCE cookies, Stripe Checkout creation, signed webhook verification, privacy hashing and low-cost deterministic tools.
- **Supabase:** Postgres, Discord-backed identities, RLS, transactional promotion ledger, moderation queues, permission checks and quarantined uploads.
- **Stripe:** hosted Checkout only. The success redirect never grants credits; only a verified webhook can call the idempotent fulfillment function.

## Discovery score

Organic signals total 94%: quality 28%, engagement 22%, uptime 18%, player activity 18%, owner verification 8%. Seven-day boost activity is capped at the remaining 6%. Paid visibility therefore cannot replace quality.

## Moderation path

Clear rules handle known spam and unsafe-link patterns. Low-confidence submissions enter `moderation_queue`; staff decisions require a scoped permission and consequential actions are appended to `staff_audit_events`. A mass-ban trigger automatically suspends the acting staff membership and alerts owners when the configured threshold is reached.

## Privacy

Raw network addresses are not stored by application functions. Abuse-prevention signals are HMAC-hashed before they reach Supabase. Public views exclude private endpoints, email addresses, tokens, staff notes and adult-rated listings.
