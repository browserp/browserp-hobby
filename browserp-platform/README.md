# BrowseRP

BrowseRP is a clean-slate, multi-platform roleplay discovery product. The repository contains the public directory, Discord authentication boundary, owner and staff workspaces, developer and resource catalogs, moderated listing flow, fixed-value Stripe promotion checkout, privacy-aware auditing, and a Supabase schema with Row Level Security.

## Why this architecture conserves credits

- Search, filtering, ranking, hashing, name generation and clear moderation rules are deterministic.
- AI is not required for a page view, search, boost, checkout or dashboard request.
- Public reads are cacheable and backed by narrow database functions.
- Promotion can contribute at most 6% of the discovery score.
- External classifiers can be added only behind confidence gates and review queues.

## Local verification

```bash
npm run verify
npm run dev
```

The application runs on `http://127.0.0.1:8080`. Public catalog examples are used only when the new Supabase project has not been connected.

## Production setup

1. Create a brand-new Supabase project and apply the ordered SQL migrations in `supabase/migrations`.
2. Enable Discord in Supabase Auth and allow `/api/auth/callback` on the production origin.
3. Generate a long fulfillment secret. Store its bcrypt hash in `private.secrets` under `stripe_fulfillment`; set the plaintext only in the Vercel runtime.
4. Create the three fixed-price Stripe products and map their price IDs to the Vercel variables in `.env.example`.
5. Add `/api/webhooks/stripe` as a Stripe webhook for Checkout completion and async payment success.
6. Configure the remaining Vercel variables and deploy.

Never put Stripe secrets, OAuth tokens, recovery codes, Supabase privileged keys or raw network addresses in the browser bundle.
