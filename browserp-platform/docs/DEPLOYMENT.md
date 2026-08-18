# Deployment checklist

- New Supabase project created; no legacy BrowseRP database reused.
- Core and storage migrations applied in order.
- Supabase security and performance advisors reviewed.
- Discord provider enabled and redirect allow-list configured.
- Stripe fixed-price products created in GBP and price IDs copied to Vercel.
- Stripe webhook signing secret configured server-side.
- Fulfillment secret hash stored in `private.secrets`; plaintext stored only in Vercel.
- Vercel environment variables present in Preview and Production as appropriate.
- Smoke tests, mobile layout, keyboard navigation, auth, checkout cancellation and webhook replay verified.
- A real staff owner membership is granted manually with a recorded reason.
- Legal policy drafts receive qualified review before public commercial launch.
