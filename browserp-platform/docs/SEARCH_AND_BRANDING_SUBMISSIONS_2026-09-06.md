# Search and branding submissions — 6 September 2026

## Verified provider results, later 6 September

The **browserp.com Google Search Console domain property** now shows `https://www.browserp.com/sitemap.xml` as **Success**, dated **6 September**, with **77 pages and 0 videos**. Performance and indexing reports are still processing. The sitemap had already been submitted once; it was not resubmitted during this follow-up. The processed sitemap count does not establish that all 77 pages are indexed or guarantee search ranking.

The current Bing Webmaster Tools account initially showed no sites. Added the canonical property and verified ownership against the existing DNS CNAME `e579f893ef6a575b709265b665688016.browserp.com` → `verify.bing.com`; **no DNS records were changed**. After verification, the **existing sitemap row reappeared** and showed **Success**, **77 pages**, **0 errors**, **0 warnings**, with its last crawl on **6 September**. **No sitemap was resubmitted.** Keep the existing verification and mail records.

Google Auth Platform project **`project-1e3b451d-6f1c-4d0f-83e`** now explicitly states **“Your branding has been verified and is being shown to users.”** The saved app name is **BrowseRP**, with the correct canonical homepage, privacy and terms addresses. Branding approval is complete. This provider status does not claim that a user login, consent or account-linking flow was tested.

The integrated source also passed the full Node **24.19.0** verification: **886 main tests + 35 database tests = 921 passed**, with **0 failures and 0 skipped tests**. Deployment checks retain **11 API functions and 1 middleware, 12 total**. Verification commit: `5465e3f868fc5007035f9f867d6b4ae2da4fb023`; local log: `/tmp/browserp-integrated-verify-final-20260906.log`.

## Submission and review history

Earlier on 6 September, submitted the canonical sitemap once to each verified webmaster property. Google initially reported “Sitemap submitted successfully”; Bing initially reported Submitted / Processing without then-current errors or warnings. The verified results above supersede those initial processing states.

Google Auth Platform had the BrowseRP name, logo and canonical homepage/privacy/terms saved, but its Verification Center explicitly said the branding was not yet being shown to users. Ran its branding check. The automated result alleged an insufficient privacy policy and a homepage behind login.

Unauthenticated, no-cookie HTTP checks of both exact URLs returned200 with no redirect or challenge page. The initial homepage describes the public directory and links to the privacy policy. The initial privacy HTML names the Google data requested, its use/storage/sharing, service providers, security information and access/correction/deletion route. The signed-out site also has existing three-engine browser evidence. Sent those specific facts through the built-in additional-review form, asking for the precise missing disclosure or inaccessible URL/time if the reviewer still finds a problem. No login credentials or recovery codes were supplied; no scopes, firewall protections or live authentication callbacks were changed.

After the additional-review submission, Google Verification Center temporarily showed **“Your branding is currently under review.”** That historical state is superseded by the verified approval above. Data access verification was not required because there were no sensitive/restricted scopes. Real-account consent/linking tests and recovery rehearsal were explicitly removed from this launch scope; they are not recorded as performed.

The submission answered that BrowseRP is a public production application, not personal-only, internal-only, staging-only or a Gmail SMTP plugin. Read the current verification requirements and acknowledged the submission requirements and conditional restricted-scope assessment statement. No restricted scope or paid assessment was requested.

References: [Google homepage requirements](https://support.google.com/cloud/answer/13807376), [Google verification requirements](https://support.google.com/cloud/answer/13464321), [Supabase Google branding guidance](https://supabase.com/docs/guides/auth/social-login/auth-google). Public response evidence: `google-branding-public-page-check-2026-09-06.json`.
