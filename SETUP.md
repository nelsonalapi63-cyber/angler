# FATHOM — setup

Phase 1 (what ships now) is a static site: every online flag in `online.js` is off, and `MOCK_ONLINE_DATA` fills the leaderboards and the daily curve with labelled demo data. Nothing below is needed to play.

Phase 2 turns on accounts, the real leaderboards, ratings, ads and purchases. Do the steps in order.

## 0. Run it locally and build the data

```
node --test 'tests/*.test.js'      # unit tests
node build.js                      # validates data/*.json, writes entities.js and prompts.js
node tests/serve.js                # http://127.0.0.1:8787/
node tests/e2e.spec.js             # full browser run (needs the pre-installed Playwright)
```

To add or fix prompts: edit `data/entities.json` and `data/prompts.json` (ids, aliases, tiers, facts), run `node build.js`, commit. The validator refuses prompts with fewer than 25 answers or without exactly one Hadal.

## 1. Deploy the static site

GitHub Pages: push the repository, enable Pages from the root of `main`. Cloudflare Pages: connect the repository, no build command, output directory `/`. All paths are relative, so a custom domain or a sub-path both work. Set `SITE_URL` in `app.js` to the final address (it is appended to share text) and bump `CACHE_VERSION` in `sw.js` on every release.

## 2. Supabase project (accounts, dives, leaderboards)

1. Create a project at supabase.com. Note the Project URL and the anon key (Settings → API).
2. Authentication → Providers → Google: enable it, paste the Google OAuth client id and secret (create them in Google Cloud Console with the Supabase callback URL shown on that page). Authentication → URL Configuration: set the Site URL to your domain and add it to the redirect allow list.
3. SQL editor: run `supabase/schema.sql`, then `supabase/cron.sql` (enable the `pg_cron` extension first under Database → Extensions).
4. Functions: install the Supabase CLI, then

```
node tools/sync-shared.js
supabase login
supabase link --project-ref <ref>
supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... STRIPE_PRICE_MAP='{}'
supabase functions deploy submit-dive
supabase functions deploy delete-account
supabase functions deploy stripe-webhook --no-verify-jwt
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.

5. In `online.js` set `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then flip `LEADERBOARD_ENABLED: true` and `MOCK_ONLINE_DATA: false`. Redeploy the site.

Re-run `node tools/sync-shared.js` and redeploy `submit-dive` whenever the data files change, otherwise the server will reject the day's prompt set.

## 3. Stripe (purchases)

1. Create four Products with one-time Prices: Dive Supporter $4.99, Archive Pass $2.99, All Packs $4.99, Single pack $1.99 (placeholder prices — change them in `monetise.js` too).
2. For each, create a Payment Link. In the link's advanced options add metadata `product_id` = `supporter`, `archive`, `packs-all` or `pack`, and set the confirmation page to redirect to `https://<your domain>/?checkout=success` so the site can refresh unlocks and thank the player. Paste each link into the matching `paymentLink` in `monetise.js`.
3. Developers → Webhooks → add endpoint `https://<ref>.supabase.co/functions/v1/stripe-webhook`, event `checkout.session.completed`. Copy the signing secret into the `STRIPE_WEBHOOK_SECRET` secret above.
4. Flip `PAYMENTS_ENABLED: true`. Buying requires sign-in; the client passes the user id as `client_reference_id`, the webhook writes the entitlement, and the site refreshes entitlements when the player returns from checkout.

To use Lemon Squeezy instead (a merchant of record that handles sales tax), keep the same `entitlements` table and replace only `supabase/functions/stripe-webhook/index.ts` with a handler for their `order_created` webhook that writes the same row.

## 4. Ads

1. Apply for Google AdSense with the live domain (the legal pages — `privacy.html`, `terms.html`, `refunds.html` — must be reachable).
2. Put the publisher id in `AD_PUBLISHER_ID` and the three slot ids in `AD_SLOT_IDS` in `monetise.js`, then flip `ADS_ENABLED: true`. The consent banner appears before any ad script loads; any purchase removes ads site-wide.

## 5. Analytics

Create a site at plausible.io (or self-host Umami and change `ANALYTICS_SCRIPT_URL`), set `ANALYTICS_DOMAIN`, flip `ANALYTICS_ENABLED: true`. Events sent: dive_started, dive_completed, dive_submitted, share_clicked, challenge_created, challenge_opened, leaderboard_opened, logbook_opened, report_clicked, upgrade_viewed, checkout_started, purchase_completed, sign_in.

## 6. Reviewing flagged dives

Near-perfect dives typed implausibly fast are stored with `flagged = true, approved = false` and stay off the top 100. Approve or delete them in the Supabase table editor (`dives`).

## Nightly job

`public.nightly()` runs at 00:05 Eastern (two cron entries cover winter and summer time; it is idempotent). It freezes yesterday's curve, writes Daily Rank Points, recomputes ratings and leagues, and on the first of a month writes the finished Tide's top 10 to the Hall of Fame.
