# Staff and member account verification — 4 September 2026

## Scope and result

The staff shell, access/MFA screens, member profile uploads, and member account connections were reviewed across browser controls, HTTP routes, Auth boundaries, and existing database authorization. The full repository verification completed with **235 passing tests and no failures**. No production accounts, connections, authenticator factors, settings, or uploaded files were changed during verification.

### Concrete corrections

- Staff session lookup outages now show a retry screen instead of a misleading signed-out state. Authenticator enrollment errors remain visible on the active card; enrollment and verification prevent duplicate requests and recover after errors. Staff access cards offer explicit sign-out, preserve safe return destinations, and use the site's existing pink/violet design. Action dialogs expose accessible names. Returning to sign-in closes an open mobile menu and keeps the skip link useful.
- Temporary refresh failures, rate limits, and conflicts preserve existing credentials for a later request. Invalid or revoked refresh credentials still clear the session. There is no automatic retry loop.
- The public image policy now permits the exact `profile-media` storage path. The cropper already uses permitted data URLs; no additional `blob:` policy was needed. Local profile/avatar routes now match production. The explicit avatar JSON budget accommodates a 1 MiB PNG after base64 encoding while normal request defaults remain bounded.
- Members can sign in with a configured provider after normal Auth identity linking. Staff authorization continues to use the original strict single-Discord helper and database constraints.
- The profile and dashboard show authoritative connected providers and explicit connect controls. Connection initiation requires an authenticated member, CSRF, same-origin, a supported provider, and no current or former staff membership. PKCE, state, nonce, and the initiating account bind the callback; the currently authenticated and returned account must both match. Staff membership is checked again. There is no unlink feature.
- A member's verified connected Discord identity can be used for member claims. Staff claim tools still require the strict staff identity boundary. Discord guild-owner verification and staff claim approval remain separate.

## Evidence

Automated regression tests cover production host-only Secure/HttpOnly cookies; Strict CSRF cookies; transient and invalid refresh credentials; OAuth state/nonce rejection before exchange; supported provider URLs; ordinary linked-member login; rejection of current, suspended, and revoked staff membership; initiating/returned account mismatch; disabled manual linking; duplicate submissions; recoverable UI errors; and private routes without sign-in.

A real generated 512×512 PNG whose base64 JSON exceeded the former 1 MiB request ceiling passed through the actual avatar route with an isolated backend. The storage path and registration belonged to the authenticated user, ignored client-supplied owner/path fields, and used non-overwriting uploads. A forged CSRF token was rejected. This was an isolated test, not a production upload.

Existing moderation tests also passed for permission-filtered controls, private filter state, stale request ordering, metadata order, audited report history, and concurrent edit errors.

Isolated browser checks used the repository's real HTML, CSS, and scripts with clearly labeled synthetic API data and the production content-security policy. Overview, Moderation, a RedM filter change, MFA enrollment failure, profile cropping, and the connected-account UI were checked at **1440px and 390px**. There was no horizontal overflow or browser JavaScript error. The mobile staff menu remains at x286/y12.5 with an 88×46 button at 390px width.

Screenshots from this local verification:

- `/tmp/browserp-staff-audit-overview-desktop.png`, `/tmp/browserp-staff-audit-overview-mobile.png`
- `/tmp/browserp-staff-audit-moderation-desktop.png`, `/tmp/browserp-staff-audit-moderation-mobile.png`
- `/tmp/browserp-staff-audit-mfa-desktop.png`, `/tmp/browserp-staff-audit-mfa-mobile.png`
- `/tmp/browserp-profile-crop-audit-mobile.png`
- `/tmp/browserp-member-connections-desktop.png`, `/tmp/browserp-member-connections-mobile.png`

## Live verification limits

The public production provider endpoint reports Discord and Google enabled. An actual provider consent/sign-in flow was **not** completed, and the project's manual-linking setting could not be inspected through the available authenticated connector. When manual linking is disabled, the API and UI show a recoverable unavailable message and keep the existing sign-in usable. Deployment should not describe provider consent as verified until a consenting ordinary member completes that step with the project setting enabled.

All staff identity SQL and its containment trigger are unchanged. Connecting an additional identity to any current or former staff account through these controls is refused. Production staff settings and owner account connections were not used for tests.

Implementation was checked against [Supabase identity-linking documentation](https://supabase.com/docs/guides/auth/auth-identity-linking), the [official Auth client implementation](https://github.com/supabase/auth-js/blob/master/src/GoTrueClient.ts), and [Auth error-code documentation](https://supabase.com/docs/guides/auth/debugging/error-codes). The current changelog was inspected for relevant breaking changes.
