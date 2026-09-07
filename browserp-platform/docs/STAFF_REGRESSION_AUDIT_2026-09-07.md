# Staff regression audit — 7 September 2026

Bounded independent audit of shipped website source `a788ca18de0e50bfafb7ba31bcf030fb696c1b84` (tree `251f16a05afa5949c86681149ba48fcd09e02055`) after the owner requested testing of the site and staff features. This is evidence for the covered boundaries, not a claim that all launch or Discord work is complete. No product code, provider configuration or production data was changed.

## Results

- **88 focused tests passed**, no failures/skips. They cover staff document aliases; unauthorized/delayed/revoked session UI; initial and backup MFA behavior; real disposable-PostgreSQL session revocation, member restrictions and staff permission decisions; moderation and publishing behavior; privacy requests; duplicate-submit protection and recovery from failures. The tests ran serially on Node 24 against the isolated production-equivalent checkout. They did not connect to a hosted database.
- **17 live anonymous GET checks passed**: overview, moderation, staff, permissions, security, adverts, blogs, authenticators, data requests, advertising enquiries, server claims, Minecraft and FiveM APIs, plus four representative clean/flat/HTML staff document paths. APIs returned generic 401 error/request-identifier responses and no-store caching; workspace documents returned the exact generic sign-in shell, excluding Cloudflare's injected challenge script, with private/no-store caching. HTML aliases first return a canonical 308 and then the guarded 401. The redirect is not a workspace disclosure.
- All **nine staff HTML documents** reference existing local assets; their **18 distinct script dependencies** are present. Critical route handlers require current Discord sessions and use the existing server RPC authorization. The private HTML guard reads workspace templates only after current policy and required verified TOTP checks. The public menu entry remains based on strict authenticated Discord state plus the backend staff-eligibility decision.
- No concrete staff regression was found in this bounded audit. No code fix was manufactured from an unproven concern.

## UI evidence and limits

The earlier release's actual signed-in production dashboard readback confirmed **Staff panel access** immediately above **List a server**, with the matching gradient and destination `/staffpanel`. That earlier menu readback did not establish private-panel entry. Earlier eligible/ordinary browser fixtures and the current focused tests cover menu eligibility, private-view removal and session-end behavior.

After the user confirmed MFA completion, root performed a subsequent read-only check in the actual authenticated in-app browser session:

- **Overview** loaded 7 users, 63 published servers, 1 article, 1 staff member and 4 ad campaigns. Refresh worked: the displayed refresh time advanced from **02:24:33 to 02:24:35 UTC**.
- Server status distinguished **10 stale or unavailable servers out of 63** from **0 worker failures** in the **02:24:03 UTC** run. Stale or unavailable server information was not presented as a worker failure.
- The **Moderation** summary and the **Staff & roles**, **Server claims**, **Data requests** and **Reports** sections were navigated and loaded. Where queues were empty, they showed credible empty states rather than loading errors or placeholder content.
- Owner permissions remained visible. Permission-override inputs stayed disabled until a staff member was selected.
- **Menu** toggled to **Close** on the existing hit area. The actual **728px-wide** screenshot showed no clipping in the inspected staff view.

No real record was assigned, edited, published, moderated or otherwise mutated during this check. These observations establish authenticated navigation, display and refresh behavior; they do not establish completion of a real staff operation or physical-device testing.

This audit's fresh anonymous Chromium navigation to `/staffpanel/staff` timed out while waiting for network idle. It produced no successful visual result, and is not counted as a browser pass or diagnosed as an application bug. All owned browser contexts were closed and the browser slot was released for the separate reported advert issue. The subsequent authenticated readback above supplies separate current-session UI evidence; no additional provider-login/account rehearsal was started.

No authenticated production mutation, role-sync activation, migration, bot/configuration write or physical-device proof is claimed. The disabled Discord role-sync foundation stays outside the production branch. The reported directory advert layout issue is addressed by the separate `4d3b4c7` release; its source and hosted checks are recorded in the main launch checkpoint. Final Discord observations are recorded separately rather than inferred from these website tests. The latest user instruction prioritises essential Discord work and site/staff testing; do not restart cosmetic Discord work from older scope lists.

Local evidence files for this run: `/tmp/browserp-staff-audit-20260907.log` and `/tmp/browserp-staff-live-audit-20260907.json`. They contain test/readback summaries; no login cookies or private account records are included.
