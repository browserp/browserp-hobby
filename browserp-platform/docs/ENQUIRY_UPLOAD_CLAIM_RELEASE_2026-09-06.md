# Enquiries, uploads and claim privacy release — 6 September 2026

Release candidate 2.17 on launch/complete-inherited-work, based on live commit 406d5688f6eb81d7e43790d5e027e95f07024ec4. This record separates local validation from the subsequent hosted release.

## Result

Members can send advertising enquiries and read replies on BrowseRP. Staff can review and reply from Overview. Existing campaign management remains separate. Enquiries do not reserve a placement, charge money, send email or publish a campaign. Private queues require the current account; staff require existing permission and verified MFA. Versioned actions and immutable retry records prevent accidental duplicate submissions and stale overwrites. Own enquiries are included in new account exports.

Avatar uploads now validate compressed image pixels as well as PNG structure before storage. Real browser-prepared RGB/RGBA crops continue to work. The existing advertising image decoder shares this bounded validation.

Ownership claim history, drafts and evidence clear when a session ends or a page leaves. Account-bound requests reject stale account sessions, and uncertain submissions retain an exact retry rather than sending a changed duplicate.

## Source verification

The initial integrated full repository gate passed797 tests:762 application tests (including disposable PostgreSQL suites) and35 additional database tests, no failures or skips. Syntax checked185 JavaScript files; deployment remains11 API functions plus one middleware. See /tmp/browserp-217-full-verify.log on the host. Final review then reproduced a pagination defect in the advertising and staff data-request APIs: converting database timestamps to JavaScript milliseconds skipped36 of61 records created within one millisecond. Both APIs now preserve the validated original timestamp. SQL-backed regressions return all61 records exactly once across three pages for member/staff enquiries and the staff data-request queue. The final integrated gate after both corrections passed799 tests (764 application and35 additional database tests), zero failures or skips: /tmp/browserp-217-final-verify.log.

The advertising UI passed18 native fixture scenarios across Chromium, Firefox and WebKit at320/390/1280 CSS pixels, including repeated same-position disclosure taps/clicks, native form submission, no horizontal overflow and no application errors.320px scenarios use reduced motion. API replies in this matrix are controlled fixtures, not production account transactions.

All three native browser engines produced512px PNG crops that passed the actual server validator and browser decoding. Focused negative uploads reject corrupt, truncated, overexpanded or trailing compressed content before any storage/profile write. Independent security review found no blocking regression.

Claim validation covers private session teardown, current-account binding, out-of-order responses, unchanged retry identity, editable definite failures, real API routes and actual disposable PostgreSQL replay isolation. Native BFCache restoration, physical phones and real Discord claim proof are not established by those fixtures.

See ADVERTISING_ENQUIRIES_UI.md, AVATAR_RASTER_REVIEW_2026-09-06.md and OWNERSHIP_CLAIM_SESSION_REVIEW_2026-09-06.md for specific boundaries.

## Release gates still to record

Exact preview verification, application of20260906020500_private_advertising_enquiries.sql, metadata-only privilege readback, production promotion and exact production verification follow the reviewed commit. No candidate content is claimed live in this record until those results are appended. Main is not advanced. The additive database objects may remain if code is rolled back; do not drop real enquiry records.

This batch does not claim full account/file recovery, completed erasure, ordinary-member external consent checks, physical-device testing, a community Discord or approved Google consent branding. Existing open items remain in LAUNCH_CONTINUITY.md.

## Published and verified

Recorded 2026-09-06T02:34:43.497838+00:00. Production commit e4e923987266c5ffd44c0cb4de77cfc611936d8e is READY through dpl_GXG25DFhgMtZFHc4SZdwzDjhDDZm, with www.browserp.com and browserp.com aliases. Exact preview dpl_SVuFeFdDX6g1BruNZvifqFYtV3u5 and production each passed34 hosted checks across Chromium/Firefox/WebKit at390/1280 CSS pixels, including6 exact served assets, guest private-enquiry denials, public claim context, stationary touch/mouse Menu/Close, provider return links, visible image decoding, layout and application errors. Native browser emulation is not a physical phone test.

The first preview probe had an incorrect expected return link: the intended claim return includes ?claim=1. The probe was corrected to require that claim-resume flag; the application was unchanged. The complete corrected preview and production runs passed.

Migration20260906020500_private_advertising_enquiries.sql applied successfully. Metadata-only readback confirms2 private tables with RLS and no raw anon/member/service access,9 function ACLs,4 indexes, bounded account exports and existing staff permission/TOTP requirements. See advertising-enquiries-database-readback-2026-09-06.json.

The existing signed-in production browser loaded the member enquiry form with its empty private history and Overview’s independently authorised enquiry queue with no matching records. No synthetic production enquiry, reply, avatar upload or claim was created. Full controlled write tests are separate from these live read checks. Main remains unchanged at7fe1f17c25ce4bad8a44f258442671be159122d6.
