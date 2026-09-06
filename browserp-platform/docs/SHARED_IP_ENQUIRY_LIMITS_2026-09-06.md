# Shared-IP enquiry limits — bounded development slice

## Scope and collaboration

Base: `launch/complete-inherited-work` at `98d7de9c3ba4ed3c5ca535f795e6c8592beff450`.
Root `HANDOFF.md` dated 6 September 2026 remains authoritative. This note does not
restart provider/account-flow rehearsals, disaster-recovery rehearsal or optional
research/upgrades. No main merge or live configuration change is part of this slice.

Only `lib/rate-limit.js`, the two limiter calls in `lib/advertising-enquiries.js`,
and a focused test file change. Public/staff design, stationary menu targets,
existing authentication, MFA, CSRF/origin checks, current-account checks, private
RPC permissions, content validation and database migrations remain untouched.
Other contributors can continue separate website, Discord, SEO and catalogue work.
Re-check the launch branch before integrating; do not overwrite or force-push it.

## Concrete problem

The existing limiter uses the network-address HMAC as its sole key. Member enquiry
writes therefore share 12 requests/hour across every member on that connection;
staff enquiry decisions similarly share 40 requests/10 minutes. Authentication
does not distinguish users inside that limiter. This was established by source
inspection, not by load-testing production or using real accounts.

## Proposed behaviour (not a global quota increase)

- Member enquiry writes: retain 12/hour per verified account; network guard 120/hour.
- Staff enquiry writes: retain 40/10 minutes per verified account; network guard 400/10 minutes.
- All other callers of `rateLimit()` retain their original IP-only behaviour.

The shared guards allow up to ten full personal allowances at each of these two
endpoints, with explicit server-owned caps rather than a client-controlled factor.
They are proposed operating values, not values established by production load
measurement. Review real legitimate-use feedback before extending the policy.

The account key uses the existing server privacy secret, an explicit account
namespace and the verified `getSession()` user ID. It does not depend on an IP,
a fresh cookie or a request-supplied identity. Neither raw account IDs nor network
addresses are stored in the rate-limit bucket keys. Existing trusted-proxy address
handling and missing-production-secret denial remain in force.

Check the personal allowance first: retries from an already-throttled account do
not spend another member's network allowance. Then check the original network
key/action using the wider guard, retaining that bucket's existing count. Both
checks must succeed before the existing enquiry RPC is called. A shared-network
rejection may consume a personal attempt; there is deliberately no non-atomic
counter refund. The existing fixed-window database algorithm is preserved.

## Verification ledger

- Syntax checks: new limiter, updated enquiry module and new test file passed in
  the available Node 22 isolated workspace.
- Eleven isolated algorithm tests passed with explicit dependency adapters. This
  is not a Node 24 full-checkout or real-provider test result.
- The committed test file contains thirteen tests, including two real-module
  enquiry-handler regressions with entirely mocked provider fetches. The normal
  hosted Node 24 `npm run verify` gate must run against the full branch. Record its
  actual result in the pull request, rather than treating the historic 813 as new
  evidence or claiming unavailable PC/browser tests were run.
- No production requests, account logins, live database writes, migrations,
  settings changes, paid operations or releases are required to run these tests.

## Still unfinished / intentionally excluded

The broader shared-IP review of other endpoints remains open; this slice resolves
only advertising-enquiry writes and staff decisions. Do not silently change
anonymous, authentication, authenticator, upload or other quotas through the new
helper. Supabase SSL enforcement needs a separate dependency/restart review.
Discord community completion, the agreed concrete SEO tasks and catalogue health
remain in the root handoff's active ledger. Payments/coins and unfinished
resource/developer products remain disabled.

The available chat workspace is Linux with Node 22, not the owner's PC. Direct
Git cloning from it failed at DNS resolution. Source was read through the GitHub
connection and changes are prepared on an isolated child branch with hosted CI;
no claim is made that the PC or old Mac has been accessed or configured.
