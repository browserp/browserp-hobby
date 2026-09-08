# Account connection restriction audit — 8 September 2026

Baseline: `f479a7e130d80974b1d7bdb3166e4fae41fd21d4`. This is a local source/fixture audit, not a hosted-provider rehearsal or release claim. The only application change is the specifically approved failed-callback message in public/member-connections.js; backend behavior is unchanged.

## Result

No demonstrated backend restriction bypass was found in the assigned scope. Preserve the existing implementation in `lib/supabase.js`:

- `connectionSessionStatus` (lines 233–240) requires a matching live account/session. Its database function uses the original OAuth AMR timestamp, with a ten-minute age and thirty-second future tolerance; refreshed JWT issue time and TOTP do not refresh that age.
- `beginIdentityLink` / `finishOAuth` (lines 432–508) check current/former staff membership, authenticate the linking request with PKCE, bind state and nonce, and compare the original account, session ID and authentication time at callback. Staff authorization keeps the separate single-Discord identity boundary.
- `unlinkMemberIdentity` (lines 252–297) takes an account lease, rereads Auth with the validated token, rechecks session eligibility, uses the exact owned Auth identity UUID, preserves another configured login, confirms deletion and remaining providers, attempts global logout and reports failure honestly. Ambiguous deletion keeps the lease and clears this browser's session.
- `20260905195603_member_connection_session_guard.sql` denies current/former staff operations, checks the account's current session, restricts RPC execution and direct table access, and prevents a different member or wrong token from releasing a lease.

## Demonstrated presentation issue for Chat 2 / Main

`public/member-connections.js:41` treats every non-`linked` query flag as proof that linking did not complete. In a JSDOM fixture at `/profile?connections=failed`, a fresh `/api/me/connections` response reporting **both** Discord and Google connected rendered two Connected badges plus:

> The connection was not completed. Your existing sign-in still works; you can try connecting again.

That certainty is unsupported. `api/router.js:249–264` uses `connections=failed` for any callback exception; `lib/supabase.js:487–503` can reject after provider consent or during token exchange/verification. A failed application callback does not establish that provider-side linking was rolled back. Supabase documents linking as part of its OAuth flow: [Identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).

Applied after Main granted this exact line: replaced only the failed-result string with **“We couldn’t confirm the connection attempt. Your current connections are shown below.”** Keep the refreshed provider cards authoritative. Added one UI regression fixture combining `connections=failed` with two verified connected providers. All other presentation and connection behavior remains unchanged.

## Verification

Bundled Node **24.19.0**, original checkout dependencies reused read-only:

- `test/member-connections.test.mjs`: **16 passed**.
- `test/member-connections-db.test.mjs`: **6 passed**, including five PostgreSQL subtests.
- `test/member-connections-ui.test.mjs` plus `test/member-connection-session-ui.test.mjs`: **16 passed**.
- Separate read-only JSDOM reproduction confirmed the failed-callback wording contradiction above.

The first database-suite launch failed solely because the allocated worktree initially lacked dependency resolution; rerunning with the original dependency path passed. No hosted users, identities, sessions, data or settings were changed. Real Google/Discord consent, hosted manual-linking enablement, and production migration/deployment state remain outside this bounded audit. The latest Supabase changelog and identity-linking documentation were read; no relevant breaking change was identified in the current changelog entries examined.
