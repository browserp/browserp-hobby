# Staff authenticators

Staff can open **Overview → Your sign-in security** after signing in with their allowed Discord account and verifying their authenticator. They can add and verify a named backup, finish or cancel an unfinished setup, and replace an authenticator. The sign-in screen lets them choose any verified authenticator.

Keep a backup on another device or in a secure password manager. Two entries on the same phone do not protect against losing that phone. BrowseRP does not issue recovery codes or store the setup key for later display. The setup key and QR image appear only during that setup and are cleared when its panel closes or the page is left.

Removing a verified authenticator requires a current code from a different verified authenticator. BrowseRP switches the current session to the authenticator being kept before removing the old one. The last verified authenticator has no removal control, and the server independently refuses that removal. Unfinished setups can be removed without deleting a working factor. The panel supports up to three authenticators, including unfinished setups.

The database independently checks the current, unexpired session, active staff membership, Discord allowlist, single Discord identity, no active account ban, AAL2, and TOTP proof. Writes also require the website's normal origin and CSRF checks. A private two-minute account lease serializes requests across application instances. Provider calls share a 45-second deadline; uncertain writes retain the lease until it expires. After an interrupted request, wait two minutes, refresh the list, and act on its actual state. Never retry removal blindly. Setup, verification and removal use the existing restricted account activity history; codes, setup secrets and tokens must never enter that history.

These safeguards cover the BrowseRP application route. A trusted operator using the provider's administrative controls can still remove factors directly; those emergency controls are deliberately not available in the website. Supabase's own user API requires AAL2 for removing a verified factor but does not promise that it will preserve the last factor. Do not describe our UI protection as a new provider-level restriction.

## If one authenticator is lost

1. Sign in with Discord and select the remaining named authenticator.
2. Open Your sign-in security. Add and verify a replacement on a separate device.
3. Remove the lost authenticator using a code from one being kept.
4. Sign out, then verify that a fresh Discord sign-in works with the replacement. Keep the other backup available while checking.

## If first-time setup was interrupted

The sign-in gate shows **Finish authenticator setup** for an existing unverified factor. Enter its app code to continue. If the QR/setup key was lost, choose **Start again** and confirm replacing that exact unfinished factor. This path checks the active allowed staff session, refuses to run once any factor is verified, and shares the account operation lease with backup management. Both first verification and restart must pass through that lease so they cannot delete and verify the same factor concurrently. It grants no staff access before verification and never removes a verified authenticator.

## If every authenticator is lost

There is no public recovery link, staff-rank override, emailed bypass code or switch that disables MFA for the whole staff team. An existing Discord session alone is not proof sufficient to reset staff MFA.

An authorised infrastructure operator must handle this as an account recovery incident:

1. Identify the exact BrowseRP account and its established Discord identity. Verify the person independently using a previously established trusted channel and the project owner's records. A new DM, display name, screenshot or server ownership claim is insufficient. Where another trusted owner is available, have them independently review the request. If identity cannot be established, stop the recovery.
2. Record the recovery reason, operator and authorisation in restricted operational records. Suspend the affected staff membership/allowlist entry and end its existing sessions while investigating. Preserve its ordinary account, listings, identity and audit history.
3. Using the authenticated Supabase project dashboard or official Auth Admin MFA API, inspect and remove only the affected account's lost factors. This is an administrative security action, not a public API endpoint. Do not edit the Auth schema or set a factor to verified manually. Never expose a privileged key in the browser, a chat or a log.
4. After independent identity verification is complete, restore only the prior membership/allowlist assignment. Keep the site's mandatory MFA policy enabled. A fresh Discord sign-in should reach the normal setup gate; it must still be unable to use staff features until the new authenticator is verified.
5. Have the account holder enrol the new authenticator privately, add a separate verified backup, and test a fresh sign-in. Check both allowed access after AAL2 and denied staff access before AAL2. Record the completion without storing any codes, QR images or setup secrets.

Losing access to the **Supabase organisation account** is a separate problem from losing a BrowseRP staff authenticator. Maintain backup factors for the infrastructure operator's account too; this runbook does not grant access to the provider's dashboard.

## Integration and release checks

The additive migration is `20260905200710_serialize_staff_authenticator_management.sql`. Apply only after review. It adds a private lease table and permission-checked RPCs, plus factor removal and identity link/unlink events in the existing audit writer. It does not change any user's factors.

In `api/router.js`, import `staffAuthenticators` from `../lib/staff-authenticators.js` and register:

```js
"admin/authenticators": endpoint(["GET", "POST"], async (req, res, requestId) =>
  ok(res, await staffAuthenticators(req, res, requestId))),
```

Add the matching `/api/admin/authenticators` rewrite to `vercel.json` and the development route mapping, using the existing router pattern. Keep the first-enrolment `/api/auth/mfa/enroll` gate for staff who have no verified factor. For sessions with a verified factor, direct that legacy endpoint to the new management route so additional enrolments share its cap and account lock; otherwise the legacy endpoint remains a way around the panel's cap. Do not expose backup management at AAL1.

The Overview page loads `staff-authenticators.js` and its stylesheet; `staff-overview.js` initialises and tears it down with the existing authorised staff API client. It makes no request until opened. The main staff script supports selecting a named verified factor and resuming or explicitly restarting an unfinished initial setup at the MFA gate.

Initial-setup recovery additionally needs `20260905200719_recover_initial_staff_authenticator_setup.sql`. Import `prepareInitialStaffAuthenticator` and `verifyInitialStaffAuthenticator` from `lib/staff-initial-authenticator.js` into the router. Keep existing endpoint origin/rate checks and success/audit responses. In the zero-verified-factor enrolment branch, replace the direct `enrollTotp` call with `prepareInitialStaffAuthenticator(req,res,requestId)`. In verification, use `verifyInitialStaffAuthenticator(req,res,requestId)` when the session has zero verified factors; otherwise retain the normal verified-factor challenge. Its returned provider session is for the existing server-side policy/audit code only and must never be serialized into the response. Backup management remains AAL2-only.

If the router has already authenticated the request, pass that trusted session as the fourth argument to any of these three handlers. Never derive it from request data. They retain origin/CSRF checks, fresh database permission checks and fresh provider identity/factor reads. Reusing the authenticated session avoids refreshing an expired cookie twice. Preserve the parsed request body before forwarding it to a helper.

Run the isolated API, PostgreSQL and DOM tests in `test/staff-authenticators*.mjs`, the MFA-gate and Overview regressions, and repository verification. On the exact release preview, verify unauthenticated denial, layout/keyboard use at mobile and desktop sizes, and the final route/CSP. Perform a full provider round trip only with a designated test staff account. Do not add, remove or test factors on the owner's account without the owner actively doing the private code entry. Mocked provider tests do not establish hosted factor behaviour or infrastructure recovery readiness.

Official references checked for this implementation: [Supabase MFA enrolment](https://supabase.com/docs/reference/javascript/auth-mfa-enroll), [MFA unenrolment](https://supabase.com/docs/reference/javascript/auth-mfa-unenroll), [application MFA guide](https://supabase.com/docs/guides/auth/auth-mfa), and [Supabase Auth's factor/session implementation](https://github.com/supabase/auth/blob/master/internal/api/mfa.go). Recheck provider behaviour when changing this flow.
