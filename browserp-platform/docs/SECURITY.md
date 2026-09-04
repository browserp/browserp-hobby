# BrowseRP v2 security model

Security is enforced at several independent boundaries. A hidden URL, disabled button or Cloudflare rule is never treated as the sole control for sensitive data or actions.

## Edge and transport

- Cloudflare proxies only the public apex and `www` records; mail records remain DNS-only.
- TLS uses Full (strict), HTTPS redirection, TLS 1.2 minimum and TLS 1.3. Vercel also sends a two-year HSTS policy with subdomains.
- The managed WAF, basic bot protection, method/path blocks and `/api/` rate limit reduce commodity abuse.
- Application rate limits, authentication and RLS still run when traffic reaches the origin. Do not create a broad edge bypass for admin APIs.
- 0-RTT remains disabled because requests include authenticated and state-changing operations.

## Browser policy

The Content Security Policy allows scripts, styles, fonts and connections only from BrowseRP. Images may additionally come from the approved Discord and Google avatar hosts, data URLs used by the image cropper, and the exact public advertisement, profile-media and server-media paths in BrowseRP's Supabase project. Inline script/style execution, frames, objects, media and workers are blocked. The site also sends `nosniff`, `DENY` framing, strict-origin referrers, restrictive browser permissions and same-origin opener/resource policies.

`/staff` and `/dashboard` are private/no-store and `noindex`. CSS and JavaScript use immediate revalidation to avoid mixed-release caching across Vercel and Cloudflare.

## Authentication and CSRF

- OAuth uses state, nonce and PKCE with short-lived cookies.
- Production cookies are Secure, HTTP-only and SameSite=Lax. A host-only `__Host-` cookie is preferred; compatibility cookies must retain the same flags and narrow scope.
- Redirects accept only local paths and trusted BrowseRP/Vercel hosts.
- State-changing JSON requests require a synchroniser CSRF header plus same-origin validation.
- Staff-owner access is Discord-only. Linked, duplicate or inconsistent identities fail closed.
- The private Discord owner allowlist and active membership are checked in addition to permission-specific database functions.
- Google is enabled for members and cannot confer staff ownership.
- Staff permissions and authenticator enrollment require the JWT's session ID to match a current session for the same account. Revoking a session removes access without waiting for its signed token to expire. Identity-trigger staff provisioning remains independent of session creation.
- All seven member mutation RPCs and five private member read RPCs require a current session and a non-deleted, non-anonymous account without an active account ban. Staff authorization also checks account bans, including when a restricted account receives a new OAuth token. Public published-content reads remain anonymous.
- Ban-check failures deny the authenticated request. A transient backend error preserves credentials for a later retry; a confirmed restriction clears the application session.
- Staff MFA is mandatory in the production configuration verified on 4 September 2026. The owner has a verified authenticator; initial owner verification automatically activated enforcement, and authenticated staff access was checked afterwards. Keep recovery access documented and require authenticator verification for future staff sessions.

## HTTP and input handling

Functions reject unsupported methods, non-JSON writes, oversized bodies and malformed JSON. Reads and writes use bounded fields. Listing descriptions are plain text; community links are canonical public HTTPS URLs with credentials, fragments, custom ports, local/reserved hosts and common shorteners rejected.

Rate-limit identifiers use a keyed hash of the trusted client-address signal. Plain network addresses are not written to ordinary application records or logs. Protected network evidence is separately encrypted and access-controlled, with retention and an audited approval process for revealing it. Production fails closed if required privacy or evidence keys are absent.

Network evidence and rate limits share one address resolver. On Vercel it uses the platform's authoritative address; a Cloudflare client-IP override additionally requires an ingress address in the reviewed official Cloudflare edge ranges. Host and Ray headers alone never establish trust. Outside Vercel, forwarded headers cannot replace the socket peer. IPv6 and mapped IPv4 addresses are normalized before hashing. Review the pinned Cloudflare ranges when the provider changes them.

Direct member database calls also have per-account request limits. Existing daily claim and boost allowances remain in place. Device restrictions match an HttpOnly browser identifier; they are not hardware identification and can be evaded by clearing browser data or changing browsers, so they supplement account restrictions rather than replace them.

Internal request IDs are generated server-side. Listing idempotency keys are stored as hashes and bound to a fingerprint of the accepted payload. Staff decisions and content mutations require explicit reasons and version/request identifiers.

## Database boundaries

RLS protects exposed tables. Browser roles do not receive broad direct insert/update/delete grants for profiles, favourites, notifications, reports, appeals, applications or private tables. Narrow RPCs perform member and staff mutations.

`private.secrets`, the owner allowlist and staff-managed content tables remain outside public projections. Public content returns only allowlisted, published values. Staff content values are bounded strings or booleans; raw HTML is rejected. Draft/publish/rollback uses optimistic versions and an immutable revision trail.

SECURITY DEFINER functions are treated as API boundaries: fixed search paths, validated identity/input, explicit grants and minimal return fields. The v2 migration is additive and must be reviewed/applied exactly once; previously recorded production migrations are immutable.

## Secrets and logging

No secret belongs in the browser bundle or repository. Supabase secret keys, privacy hashes, OAuth secrets, Stripe keys and webhook/fulfillment secrets stay in provider-managed environment settings. Recovery codes stay in an owner-controlled password manager or offline vault.

Health responses expose only coarse readiness, release version and build SHA. Runtime errors use request IDs and must not log cookies, authorization headers, request bodies, secrets, raw network addresses or private database records.

## Payments

Payments remain disabled and their public routes remain closed. Before any future launch, BrowseRP needs a Vercel-hosted webhook pointed at the clean project, minimal event subscriptions, untouched raw-body signature verification, live/test isolation, server-signed metadata, provider re-fetching, amount/currency/product checks and idempotent server-only fulfillment.

Refund and dispute reversals, paid-but-rejected reconciliation and replay behavior must be designed and tested before enabling checkout. Setting `PAYMENTS_ENABLED=false` stops new checkout creation but cannot cancel an already-issued Stripe URL; any emergency settlement stop requires immediate manual reconciliation. A success redirect never grants value.

## Privacy and UK legal review

The current technical design uses only essential authentication/OAuth cookies and no analytics or advertising tracking, so it does not add a non-essential-cookie consent flow. If analytics, marketing, embedded third-party media or similar storage is proposed, stop and complete a separate UK privacy/PECR and consent review before release.

This repository does not contain verified LCAPUK registered-company details. Do not invent a company number, registered address or controller identity. The owner must provide exact details and obtain appropriate legal review for published terms, privacy, moderation and future payment/refund wording.

## Incident priorities

1. Use Cloudflare attack controls for an active traffic event without disabling origin authentication.
2. Roll Vercel back to the recorded known-good deployment if the application release is faulty.
3. Disable new payments; if settlement itself is unsafe, stop fulfillment and reconcile every already-issued or paid session.
4. Suspend a compromised staff membership and preserve audit/security evidence.
5. Revoke and rotate affected provider credentials, then update Vercel/Supabase through their dashboards.
6. Review request-ID-correlated logs and database audit events without exporting sensitive payloads.
