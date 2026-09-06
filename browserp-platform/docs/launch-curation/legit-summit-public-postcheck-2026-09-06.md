# Legit RP and Summit RP publication check

Observed **6 September 2026, 00:39:25–00:41:09 UTC**. Read-only public HTTP/API checks; no new imports, edits, account joins/messages or browser sessions. Root supplied the current 37 FiveM / 19 RedM / 3 Minecraft catalogue count; this pass did not independently recount the entire catalogue.

**Result: both additions are live with accurate current count snapshots, exact managed artwork, correct canonical links and the intended joining requirements. One concrete filter-mapping gap remains: “Police RP” does not match their stored “police” feature.**

| Check | Legit RP | Summit RP |
|---|---|---|
| Published page | [Legit RP](https://www.browserp.com/server/legit-rp-ex853d) — HTTP200 | [Summit RP](https://www.browserp.com/server/summit-rp-javxzp) — HTTP200 |
| Exact source | `ex853d`, project name Legit RP | `javxzp`, project name Summit RP / Custom Systems & In-House Development |
| Detail count | **125/150**, online, read00:40:06.860UTC | **177/200**, online, read00:40:07.850UTC |
| Upstream agreement | Exact125/150, fallback=false, source observed00:38:59.037UTC, approximately68s old | Exact177/200, fallback=false, source observed00:37:13.731UTC, approximately174s old |
| Access | `allowlisted` → **Whitelisted**, application and approval explicitly described | `public` → **Public**, Discord membership and self-claimed Civilian role explicitly described; no staff application approval for general entry |
| Setup / language / region | Qbox / English / United States | QBCore / English / United States |
| Canonical join | [Cfx ex853d](https://cfx.re/join/ex853d) | [Cfx javxzp](https://cfx.re/join/javxzp) |
| Canonical community | [LegitRP Discord](https://discord.gg/LegitRP) | [Summit RP Discord](https://discord.gg/summitrp) |
| Canonical website | [legitrp.gg](https://legitrp.gg/) | [summitrp.gg](https://summitrp.gg/) |

The detail API returns joining requirements in `engagement.accessType`, and the Cfx join link in `engagement.cfxJoinUrl`. Directory/discover returns `access_type`. The existing detail renderer consumes those fields; this difference in payload shape is expected, not a missing access label. The canonical community URLs match the reviewed candidate values and the current Cfx-provided Discord values. This was not a new assessment of every community policy or private Discord experience.

Source responses: [Legit Cfx](https://frontend.cfx-services.net/api/servers/single/ex853d), [Summit Cfx](https://frontend.cfx-services.net/api/servers/single/javxzp). Both source ages were below the repository's five-minute freshness cutoff. No fallback record or unavailable count was converted to zero. Initial ordinary search at00:39:25 returned Legit126/150 from the earlier00:36:54 observation and Summit177/200; the following detail read refreshed Legit to125/150 in agreement with its newer source observation. This is legitimate snapshot progression, not search losing its count.

## Managed artwork

At00:41:04–00:41:06UTC, both stored objects returned HTTP200 with `image/png`, fully decoded into96×96 pixels, and matched the current source icon **byte-for-byte and pixel-for-pixel**. Their storage filename hashes match the downloaded bytes. No plaintext image files were written.

- Legit:3,096bytes; SHA256 `ed6edf04685908ca47028d0e20ec798e46764f1303583d28dc10d0b70fe1a7a2`. [Managed logo](https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/server-media/ex853d/ed6edf04685908ca47028d0e20ec798e46764f1303583d28dc10d0b70fe1a7a2.png), [Cfx original](https://frontend.cfx-services.net/api/servers/icon/ex853d/-2035864745.png).
- Summit:8,041bytes; SHA256 `1600e21292b17c37ee96b2b3ef373c46125d99f4b6d7b7a86693645aec8a129d`. [Managed logo](https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/server-media/javxzp/1600e21292b17c37ee96b2b3ef373c46125d99f4b6d7b7a86693645aec8a129d.png), [Cfx original](https://frontend.cfx-services.net/api/servers/icon/javxzp/1927522292.png).

Both banners remain null, matching the reviewed payloads. No substitute or unsupported banner was added.

## Search and filter checks

Eight expected positive/negative checks passed, retaining numeric player counts whenever the listing was included:

- Legit matches FiveM + Whitelisted + Qbox + Economy + English + United States; it is excluded by Public.
- Summit matches FiveM + Public + QBCore + Economy + English + United States; it is excluded by Whitelisted.
- Both match Serious RP.
- Summit matches Custom cars; Legit is excluded because that feature was not claimed in its reviewed tags.

**Unresolved: two Police RP checks failed.** Both listings include the reviewed `police` tag and their descriptions include emergency services, but these canonical-filter requests returned HTTP200 with zero matches:

- [Legit + Police RP](https://www.browserp.com/api/servers?discover=true&limit=20&query=legit&platform=fivem&feature=police+rp)
- [Summit + Police RP](https://www.browserp.com/api/servers?discover=true&limit=20&query=summit&platform=fivem&feature=police+rp)

Current `public/discovery-model.js` defines canonical `police rp` with aliases `law enforcement`, `leo` and `police roleplay`, but omits plain `police`. The initial search facets expose `police` separately. This is a concrete taxonomy consistency gap; align the public model and server-side canonicalization together, then verify both old stored `police` tags and canonical Police RP records match the same option. No data or code was changed by this audit.

A later optional raw-`police` control request with Python's default user agent returned HTTP403. That control was not counted as passed; no browser/authenticated route or alternate identity was used to bypass the denial. The already recorded named-client public API checks above remain the evidence for the result.

## Validation boundary

The public detail routes returned the expected client-rendered HTML shell and loaded script reference. This HTTP-only pass does not establish rendered layout, browser animation or physical-device interaction. It verifies the actual public API payloads used by those routes and full image decoding; a coordinated browser batch remains separate. Counts are measured snapshots, not a guaranteed future value or an uptime certificate. Existing subjective community-quality caveats remain in `docs/launch-curation/fivem-final-five-options-2026-09-06.md`.

Exact retained observations: `legit-summit-postcheck-evidence-2026-09-06.json`.
