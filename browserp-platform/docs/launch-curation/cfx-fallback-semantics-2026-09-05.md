# Cfx fallback signal review — 5 September 2026

The current official FiveM server-list website served `/assets/serversList-CSOAtSlY.js` at 21:14 UTC. Its own `isServerOffline` function returns true when `fallback` is true (also for explicit offline or absent connection endpoints). Its server-data conversion independently sets `offline=true` when the raw data has `fallback`. This is primary implementation evidence for retaining BrowseRP’s existing conservative guard.

Source: https://servers.fivem.net/assets/serversList-CSOAtSlY.js, linked by https://servers.fivem.net/. The actual fetched code was inspected, rather than inferred from an unrelated definition of fallback.

A recent lastSeen or changing raw client count alone therefore does not justify publishing that response as a verified live count. This does not establish that a community has closed or is low quality. Wild RP, Wanted and New Day source holds remain separate from their qualitative selection and may be revisited when an ordinary authoritative response recovers. No parser guard was weakened and no unavailable count was converted to zero.
