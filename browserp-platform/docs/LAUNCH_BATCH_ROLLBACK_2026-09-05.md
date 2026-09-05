# Account and staff-quality release recovery

This batch starts from production `a53886d472905370fa0c128f1506af6045326c0f`, deployment `dpl_Hy49iYKL3AzWPWHdnRQc9tCAadRF`. Keep that Vercel deployment available before promoting a successor. The working branch is `launch/complete-inherited-work`; main stays untouched.

## Database impact and captured state

`launch-schema-before-2026-09-05.json` captures the exact affected existing function definitions, access lists, activity constraint, advert bucket and campaign triggers at 19:50 UTC. It contains schema metadata only, no member records, tokens or private logs. The advert bucket and new operation/cleanup functions did not exist at that checkpoint. Existing account, listing, campaign and identity records are not deleted by these changes.

New private operation tables hold short-lived account-operation leases. The activity change admits three genuine security events. Advert changes add a dedicated bucket, restrictive client-write policies and a trigger that registers approved uploaded artwork on campaigns. The shared session guard additionally honours an existing session deadline. The previous review-only inactivity migration remains in force.

This targeted schema capture is **not a full database-and-media backup**, and it does not establish disaster recovery. The Free project dashboard has no managed backups; a complete encrypted database and Storage-byte backup and isolated restore exercise remain launch work in the continuity ledger. Do not claim otherwise.

## If this application release fails

1. Restore the known-good Vercel deployment, then verify the public directory and staff sign-in. Do not merge or reset main.
2. Keep the additive database protections and any legitimate uploaded artwork. Older application code can operate with these additions present. Do not delete a bucket, factors, identities, audit history or operation records as a routine application rollback.
3. If an affected database function is the demonstrated cause, use a reviewed forward correction. The captured definition identifies the exact prior behaviour. Avoid restoring the older session guard, because it omitted session deadlines.
4. Do not blindly restore the old activity constraint: new linked/unlinked/authenticator-removal events may now exist and must be retained. Correct the writer or constraint while preserving those records.
5. If artwork ingestion must be paused, disable the upload action while preserving existing image URLs and artwork. Referenced draft, live and archived campaign images must never be swept as abandoned files.
6. Check account/security history, staff access and the current scheduler result after recovery. Record the exact affected release and correction without including credentials or raw personal information.

Preview deployments use the configured hosted services. Destructive and synthetic-user tests therefore run against isolated fixtures, not the real production database. A hosted preview read is not permission to manufacture public campaigns, accounts or announcements.
