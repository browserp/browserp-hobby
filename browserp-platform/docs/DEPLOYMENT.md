# Deployment checklist

## Vercel project

- Root directory points to the folder containing `package.json` and `vercel.json`.
- Framework preset is Other and output directory is `public`.
- `APP_URL` is the HTTPS production origin without a trailing slash.
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` belong to the new BrowseRP project.
- `PRIVACY_HASH_SECRET` is a long random server-only value.
- Fixed Stripe price IDs are mapped to `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, and `STRIPE_PRICE_LAUNCH`.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `SUPABASE_FULFILLMENT_SECRET` are entered directly by the account owner and are never pasted into chat or committed.

## Discord and Supabase Auth

- The Discord application's OAuth redirect is `https://PROJECT_REF.supabase.co/auth/v1/callback`.
- Discord is enabled in Supabase Authentication Providers with the matching client ID and client secret.
- Supabase Site URL is the production origin.
- Supabase Redirect URLs includes `https://PRODUCTION_ORIGIN/api/auth/callback`.
- Every ordered migration in `supabase/migrations` is applied to the new project.
- Owner Discord IDs are provisioned directly in `private.discord_owner_allowlist`, never in public source.
- Supabase security and performance advisors are reviewed after schema changes.

## Stripe

- The three fixed-price GBP products exist and their price IDs match Vercel.
- The webhook endpoint is `https://PRODUCTION_ORIGIN/api/webhooks/stripe`.
- Checkout completion and asynchronous payment success events are enabled.
- The fulfillment secret hash exists in `private.secrets`; only Vercel holds its plaintext counterpart.
- A verified webhook—not a success-page redirect—is the only path that grants promotion credits.

## Release verification

- `npm run verify` passes and the deployment check reports no more than 12 functions.
- `/api/health` reports the database, Discord, and payments as configured.
- Discord sign-in returns to both `/dashboard` and `/staff`.
- An allowlisted Discord owner sees the Owner role and all permission-scoped staff queues.
- Listing approval creates exactly one published server and writes an audit event.
- Favourites persist after a refresh and notifications can be marked read.
- Signed-out boosts open the sign-in dialog; signed-in boosts enforce the daily allowance.
- Checkout cancellation grants nothing; repeated Stripe webhook delivery grants credits once.
- Mobile layout, keyboard navigation, error states, and rollback are checked on the production deployment.
- Legal policy drafts receive qualified review before public commercial launch.
