# Game labels and search suggestion cleanup

The owner requested removal of unrelated game symbols and repair of the rectangular GAME label shown in search suggestions.

- Game badges are text-only in initial server-rendered HTML and client-rendered cards, metadata and server facts. Existing game colours, names and filter semantics remain.
- Public menu game links are text-only too. Real publisher artwork on game cards and pages is unchanged.
- The search category uses muted text on a transparent background and sizes to its content instead of stretching into a tinted 88px bar. Long suggestion values can wrap without overlap. Keyboard and pointer selection still apply the real game filter.
- Asset references for changed scripts/styles use 2.19.4. No function, authentication, database, payment or plan changes.

## Verification

825 application tests and 35 database tests passed. The 42 focused platform/navigation/search/public-rendering tests passed. Syntax/function checks passed (12 functions); the new optional visual helper was syntax checked separately.

Actual Chrome at 1366px and 390px verified text-only directory/detail badges, four text-only menu game links, a transparent natural-width GAME label, non-overlapping row text and clicking FiveM setting the actual platform filter. No uncaught browser errors. The mobile suggestion screenshot was inspected.

Production deployment evidence is appended after exact-source confirmation. This is a scoped UI fix, not a hosting change or load test.
