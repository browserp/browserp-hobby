# BrowseRP v2.0.0 candidate record

Prepared: 19 August 2026

Status: **candidate — not production until the verified preview is promoted**

## Baseline

The authoritative transfer message records v1.3.0 as healthy on `browserp.com`, with payments and Google disabled and GitHub `main` still at the old v1.1.0 source. v2 starts from that operational state; it does not erase the v1.3 migration history or invent provider/legal details.

## Candidate scope

- replaces the crowded presentation with a readable, FiveM-first multipage design;
- uses the supplied RP artwork with an HTML `Browse` wordmark;
- removes fictional live directory cards and public staff/developer/resource/tool navigation;
- keeps staff at a direct, unlinked and `noindex` route with real Discord permission checks;
- provides functional public directory, server-detail, authenticated listing submission and member dashboard paths;
- adds versioned, allowlisted staff management for safe website text/boolean settings without exposing raw HTML editing;
- adds replay-safe listing submission provenance and tighter direct-write/RLS boundaries;
- adds active privileged health checks and build-SHA reporting;
- hardens OAuth state/nonce/PKCE, cookie, CSRF, JSON/body-size, origin, URL and upstream-timeout boundaries;
- keeps payments out of the public product and disabled pending the original webhook/refund/dispute work;
- runs verification during every Vercel build on Node.js 24;
- places all database-bound Functions in `dub1` and keeps the deployment at exactly 12 Functions;
- adds HSTS, a no-inline CSP, private/no-store authenticated shells and mixed-release-safe asset revalidation;
- defines Cloudflare as a strict-TLS/WAF/rate-limit layer while preserving Vercel and Supabase authorization.

## Database artifact

`20260819164347_v2_application_boundaries.sql` was applied exactly once to production as provider migration `20260819164347`. It is additive to the recorded v1.3 schema and supplies the v2 submission and website-content RPCs.

## Mandatory release evidence

Before changing this record to production, capture in the private release log:

- candidate Git commit and Vercel deployment ID/URL;
- successful Node 24 verifier output and exact function count;
- exact production migration result;
- browser/console/header checks on desktop and mobile;
- signed-out and authorised staff/API checks;
- one real submit → review → publish → public-detail journey;
- website-content draft → publish → public read → rollback journey;
- production health/build SHA and runtime error scan;
- the known-good v1.3 rollback deployment;
- Cloudflare DNS/TLS/WAF and mail-DNS checks;
- GitHub recovery reference, CI result and non-force `main` update.

Do not record a step as passed from code inspection alone when it requires provider or browser evidence.

## Local verification evidence

The integrated candidate passed the repository verifier with bundled Node.js `v24.19.0` on 19 August 2026:

- 35 JavaScript syntax checks;
- exactly 12 Vercel Functions;
- 26 of 26 Node tests;
- `git diff --check` with no whitespace errors.

This is local evidence only. It does not replace preview, provider, database or production checks.

## Deliberately out of scope

- Google sign-in launch;
- Stripe checkout launch, webhook replacement, refunds, disputes or reconciliation;
- unverified LCAPUK company number, registered address or other legal identity claims;
- analytics, advertising, non-essential cookies or a consent-management platform;
- arbitrary HTML/code editing from the staff centre.
