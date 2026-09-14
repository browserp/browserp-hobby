# BrowseRP website and staff design implementation brief

Status: authorised implementation, 14 September 2026. This is the team's working brief; it is not awaiting another user approval. The user permits reorganisation and redesign while requiring all existing functionality and staff access to survive. The rejected blue candidate is not a release target. `gm9926` remains the untouched historical master.

Baseline functionality: `6552414074a3d0b7d90518772e183b52a9658f77`. Reorganisation starts from integrated checkpoint `4793c8c8c781c7bcaaac679c6365b44a72ccd14b`, retaining the approved shared-control, appearance and Overview capability fixes. There is ONE staff area, with multiple sections and compatibility routes.

## 1. What the redesign must change

The prior design gives headings, nested containers and controls more prominence than communities or staff work. The new design changes that hierarchy: community identity and useful information lead public pages; pending work, record context and decisions lead staff pages. Fewer boxes alone are insufficient. Each page needs a clear purpose, a first useful action, a consistent reading order and appropriate density.

Use BrowseRP's own logo, imagery and magenta/cyan/purple accents. Dark surfaces are neutral black/charcoal; light surfaces are neutral white/grey. Do not reproduce Discord's palette or add ornamental analytics. Existing authentic content is more valuable than invented photography, counts, testimonials or decorative graphs.

## 2. Research decisions

These are design inferences, not claims that another product's implementation fits BrowseRP unchanged.

| Source | Relevant pattern | BrowseRP decision |
| --- | --- | --- |
| [Steam search](https://store.steampowered.com/search/) | Compact, image-led result rows with comparable information | Use real community logos and aligned facts; avoid a cover grid that requires artwork communities do not have. |
| [GOG catalogue](https://www.gog.com/en/games) | Catalogue content dominates; search, sorting and filters support it | Put search and useful results early; avoid a large marketing introduction above the directory. |
| [FACEIT navigation](https://support.faceit.com/hc/en-us/articles/14996885023516-Navigating-FACEIT) | Navigation responds to the user's gaming context | Preserve game context and selected state without adding a second competing navigation system. |
| [NN/g visual hierarchy](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/) | Scale, contrast and proximity direct attention | Use whitespace and typographic hierarchy before adding containers; reserve strong contrast for important content and actions. |
| [Linear triage](https://linear.app/docs/triage) | Intake is reviewed in record context before a decision | Staff review follows queue → record/evidence → existing action → outcome/history. Do not import Linear's actions or automation. |
| [Carbon data tables](https://carbondesignsystem.com/components/data-table/usage/) | Table-wide actions and record-specific actions occupy distinct locations | Keep filters/search beside the queue, decisions beside the selected record, and pagination below results. |
| [Atlassian navigation design](https://www.atlassian.com/blog/how-we-build/designing-atlassians-new-navigation) | Stable navigation tested with complex workflows | Group existing staff destinations by purpose; retain location, deep links, permissions and back navigation. |

## 3. One reusable visual system

1. **Theme:** neutral surfaces in both modes; independent readable text, field, selection, disabled and error colours. Use logo accents for primary actions, links and selected states. Never use colour alone for status.
2. **Hierarchy:** page title → section title → record title → metadata. Directory titles are compact; reading pages retain a comfortable text measure. Large type must not delay the first useful content.
3. **Spacing:** consistent rhythm between related controls and larger gaps between tasks. Separate content through alignment, whitespace and subtle dividers; cards indicate a meaningful grouped object rather than frame every heading.
4. **Controls:** one maintained Menu implementation and shared button, field, select, tab, dialog and status recipes. Public controls use 48px and compact staff controls at least 44px targets. Visual icon size can be smaller than its target.
5. **Buttons:** one visually dominant action per local task. Secondary actions are neutral, quiet links remain recognisable, destructive actions retain clear labels and existing confirmations. Loading preserves geometry and prevents duplicate submission.
6. **Dropdowns and filters:** explicit selected value, keyboard navigation, visible focus, clear expanded state and reliable dismissal. Never hide an active filter without showing that it is applied. All existing filter keys, URL persistence and clear/reset semantics remain.
7. **Motion:** subtle state feedback. The repeated BrowseRP pattern is absent in light mode; dark pattern remains full-width where used, travels right along the diagonal, and honours reduced motion. It must not compete with text or lower usable performance.
8. **Feedback:** distinguish no results, no permission, empty account, loading, stale data and request failure. Do not substitute zero for an unknown value. Keep retry and recovery actions accessible.
9. **Responsive layout:** columns collapse according to their task. Controls wrap without clipping; dialogs and menus fit short/narrow windows. Dense staff tables may scroll inside a named region when a readable stack would destroy relationships.
10. **Reuse:** developer reference remains outside product navigation. It demonstrates actual shared recipes, not a parallel set of controls that only looks similar.

## 4. Public website composition

| Surface | Intended reading/action order | Functionality that must remain |
| --- | --- | --- |
| Home | BrowseRP identity, concise promise, direct discovery, authentic community content | Logo home link, discovery links, featured/community content, existing recommendations and advertisements. Do not reinstate the removed all-games homepage block. |
| Discover `/servers` | Compact title, search, game/filter controls, result count/sort, community results | Every existing filter and URL query, pagination, shortlist/save, compare, recommendations consent, freshness/error notices, server links and player-count truth. |
| Games `/games` and `/games/:id` | Game imagery/identity, relevant communities, contextual discovery controls | All supported game destinations, upcoming availability distinctions, game-specific fields and query semantics. |
| Community `/server/:slug` | Real banner when available, name/logo and key facts, join action, description, detail/activity | Join/address copy/community links, truthful status/history, save/compare, reviews/comments, report/claim and existing ownership controls. |
| Compare | Names/logos remain recognisable; aligned differences and common facts | Add/remove/clear limits, saved selection, responsive navigation and original listing/join destinations. |
| Find a server | Short guided choices, clear progress, useful matching result | Every question, previous/next/reset behaviour, real match logic and recommendation destination. |
| Blog and article | Story title/excerpt/date lead; readable long-form content | Published article routes, metadata, links, advertiser disclosure and staff publishing output. |
| About and public staff | Clear mission and genuine people/roles with readable sections | Existing content, role/badge meaning and links. Public `/staff` is not the private staff area. |
| Advertise | Clear offer and creative examples, enquiry action | Existing campaign/enquiry fields, validation, submission and status handling. |
| Legal, privacy, terms, appeal, 404 | Legible utility pages with an obvious next action | Every legal statement, privacy control, appeal field, validation and recovery route. |
| Coins/other existing utility routes | Apply the same typography/control system without implying new availability | Preserve existing availability, destinations and behaviour; no new payment or billing functionality. |

### Discover layout specification

- Search is the main input. Game choices are compact and recognisable; the filter button shows applied state/count. Sort is visible beside results, not buried inside advanced filtering.
- Preserve the full filter panel. Opening it is presentation state and must not change requests, queries or selections. Show applied filters and a clear route to reset them.
- Use a logo-led editorial list. Name and a useful short description lead; game, region, language and access facts follow. Stable alignment makes communities easy to compare visually. Omit optional unknown filler only from the preview, while retaining truthful detail and relevant unavailable status.
- Do not simulate popularity, activity, counts, verification or artwork. Differentiate reviewed listings from owner verification. Use the original image safety rules and real fallback identity.
- Keep Save and Compare independent from opening the listing. No nested clickable control accident and no broad footer slab for two small actions.
- Insert the existing advertisement after six organic results, or after all results when fewer than six. Preserve the existing creative, link, explicit advertisement disclosure, arrows, dots, pause state and keyboard targets. At zero results retain a sensible distinct placement; it must not count as a server. Refiltering/pagination must not lose the carousel or duplicate listeners.
- Ad arrows have transparent faces at rest and a quiet background on hover/focus. Remove the large advertisement header strip and frame, while retaining a visible short disclosure.
- Recommendations use a compact optional section and truthful empty state. Consent, clear-history behaviour and local storage boundaries remain unchanged.

## 5. One staff area: architecture

The entry `/staffpanel` remains the existing sign-in gate. Authorised staff enter `/staffpanel/overview`. The common shell establishes BrowseRP identity, current section, shared Menu/theme controls and a stable route back to the public site. Navigation presents only effectively permitted destinations; an empty permission group is not shown.

### Overview: start work, then inspect the site

1. **Review work:** authorised pending counts and the recent listing/report queue with a clear route into the corresponding review section. Clearly label the recent sample; do not imply it is the entire backlog or oldest-first.
2. **My duty:** availability and clocked-in status remain distinct, with the existing controls and session context. Team/manager controls remain capability scoped.
3. **Website management:** group publishing, advertisements and listing operations by job rather than a flat pile of buttons. Keep every existing editor, upload, preview, review and save action.
4. **Site reporting:** the existing registrations chart and real totals support decisions below priority work. Use readable axes, periods, labels and no-data/error states. It is registered accounts by UTC signup, not visitors or a complete historical population series.
5. **Recent activity/security:** preserve authorised audit information and personal sign-in security. Sensitive evidence stays behind its existing gates.

### Moderation: queue → context → decision → history

| Navigation group | Existing destinations retained | Presentation purpose |
| --- | --- | --- |
| Review work | `#reports`, `#queue`, `#claims`, `#content`, `#profiles`, `#appeals` | Identify the item, inspect evidence and use its existing decision workflow. |
| Community | `#members`, `#servers` | Find the relevant person or community and manage its existing properties/actions. |
| Team | `#staff` | Roles, responsibilities, role change requests, escalations and permitted direct management/overrides. |
| Safety & records | `#bans`, `#security`, `#activity`, `#data-requests`, `#logs` | Review restrictions, protected evidence, privacy requests and audit history in context. |

- Each view has a compact purpose/title, queue search/filter toolbar and clear selected/current state. Lists use readable rows, not repeated large marketing cards.
- Record context groups identity, status and evidence before decisions. Place the existing action beside its relevant record; keep global queue actions out of individual cases.
- Existing dialogs, textarea drafts, file uploads, cancel controls, version conflicts, reason requirements, confirmations and error recovery remain. Reorganisation cannot reset unsaved work or change record IDs.
- Do not introduce bulk moderation, new backend statuses, invented assignment, automatic decisions or extra permissions. No UI-only gate is treated as authorisation.

### Scrapers: intake, review and health

Retain the existing game/source selection, intake controls, review queue and health/freshness information. Separate operation setup from reviewing results. Keep current error/retry behaviour and every review action. The section belongs to the same staff area and uses the same navigation and control system.

### Compatibility and capability preservation

Retain existing redirects: profiles → moderation `#profiles`; accounts → `#activity`; staff → `#staff`; security → `#bans`; content → overview `#overview-adverts`; old overview roles anchor → moderation `#staff`. Keep direct deep links and browser history working.

Scope controls by effective capabilities, not a guessed role name. `readStaff`, `manageStaff`, `manageRoles`, owner, privacy and erasure rights are distinct. Overview-only staff must retain authorised website tools when optional moderation access is denied. No new general Settings page or badge editor is assumed to exist.

### Honest reporting rules

- Use the existing registrations history periods (30d/90d/180d/1y/max) and source semantics. Deleted/anonymous people are excluded; say so where relevant.
- Overview counts and moderation summary counts have different scopes. Pending submissions must not be silently equated with a summary that also includes changes requested.
- Content moderation currently has no aggregate total; a loaded page count is a page count.
- No backlog history, response-time/throughput graph or staff-coverage statistic without an actual authorised source. Keep unavailable metrics visibly unavailable.

## 6. Member and owner experience

- **Dashboard:** identity and useful personal tasks first, then listings/reviews/favourites/recent/notifications/content status/profile. Shared metric strip is supporting information. Every tab and listing action remains accessible.
- **Profile:** person and account context first, profile/privacy editor next, connected accounts presented as readable rows. Preserve crop/upload/reset/cancel, moderated replacement behaviour, display name rules and connection availability.
- **List/edit server:** organise existing fields into readable groups with a clear main submit/save action. Preserve field names, validation, drafts, uploads, confirmation and review status.
- **Review, claim, report and appeal:** match the visual system while keeping the correct server/person context, current validation and success/failure states. Never turn a disabled integration into an apparently active button.

## 7. Preservation contract and verification

This brief is a design target, not completion evidence. Record the actual combined commit, screenshots, journey results and unresolved issues in the release receipt.

| Protected behaviour | Required verification |
| --- | --- |
| Staff entry, session validation, MFA/revocation, effective permissions | Source comparison plus existing focused auth/helper tests; controlled ordinary-member denial and scoped staff cases. |
| Overview split data contracts and optional denial handling | Existing real-controller tests; optional 403 preserves only freshly authorised same-account Overview; 401/ordinary denial clears as before. |
| Directory filters, URL history, sort, pagination | Test applied state, direct link, back/forward and reset; reorganisation must preserve original request parameters/results. |
| Save/compare/recommendations | Independent controls, persisted selection, limits, consent and clear-history checks. |
| Advertisement | Original creative/link, visible disclosure, targets, pause, refilter/page lifecycle and zero/short/full results. |
| Member forms and moderation decisions | Input/draft preservation on appearance change, cancellation, failure/retry, stale/conflicting record and session expiry. |
| Public content and discoverability | Existing canonical routes, metadata, server-rendered content/fallback, no accidental hidden sections or new indexing errors. |
| Responsiveness | Representative 320/390/768/960/1440/wide views plus short windows and zoom; no clipped text, menu, dialog or horizontal page overflow. |
| Themes and accessibility | Dark/light visual review, contrast/focus, keyboard operation, reduced motion, no decorative pattern in light. |
| Browser and performance | One stable combined Chromium/Firefox/WebKit run; paired baseline/candidate motion and slowdown checks. Emulation is not physical-device evidence. |

No database migration, role-policy, API handler or credential change is required by this redesign. Preserve existing fixes and Dan's integrated work. New layout-related controller edits are limited to presentation and must be reviewed for side effects. Production API outages are recorded separately from replayed visual tests; a cached result is not live-service proof.

## 8. Delivery ownership and acceptance

- Main: shared foundations, integration, this brief, preservation review, final visual judgement, release and verified delivery.
- Task 2: staff architecture and presentation, including bounded navigation grouping; no auth/data-policy changes.
- Task 3: home, game, detail, editorial and member composition in the agreed middle stylesheet section.
- Task 4: directory composition, filters, real-content cards and advertisement lifecycle.
- Task 5: final combined browser/device/lag/changed-journey verification once the source is stable.
- Task 6: targeted preservation/security review when the final changed behaviour is known; no repeated broad checks while files move.

Accept only a coherent upgrade across public, member and staff surfaces. A successful build does not establish visual quality, preserved workflows or live delivery. Review real content in both themes; fix concrete defects before promotion. Keep `gm9926` untouched and retain a reviewable source checkpoint. AI moderation, Gemini, bot hosting and billing remain deferred.
