# ANGLER — setup

What ships by default is a static site: every online flag in `online.js` is off and `MOCK_ONLINE_DATA` fills the leaderboards, the daily curve, the friends tab, the community packs and `admin.html` with clearly labelled demo data. Nothing below is needed to play.

The online layer turns on accounts, real leaderboards and curves, cross-device sync, the live divers count, friends, community packs, reports, first-party analytics, push reminders and the weekly recap. Ads and payments stay off. Do the steps in order; each one is independent of the ones after it.

## 0. Run it locally and build the data

```
node --test 'tests/*.test.js'      # unit tests (rules, storage, streak freezes, challenge seeds)
node build.js                      # validates data/*.json, writes boot.js, entities.js, prompts.js, taxa.js, sitemap, robots
node tests/serve.js                # http://127.0.0.1:8787/
node tests/e2e.spec.js             # full browser run with axe-core, screenshots in tests/screenshots/
node build.js --dist               # production copy in dist/ with CNAME and .nojekyll (what the workflow deploys)
node tests/serve.js --dist         # serves dist/ with gzip and cache headers, roughly what GitHub Pages sends
npx lighthouse http://127.0.0.1:8787/ --form-factor=mobile --screenEmulation.mobile --output=html --output-path=tests/reports/lighthouse-mobile.report.html
```

The last Lighthouse mobile run (dist build, simulated slow 4G and a 4× slower CPU) scored performance 97, accessibility 100, best practices 100, SEO 100; the report is `tests/reports/lighthouse-mobile.report.html`. The browser run writes `tests/reports/axe-report.json` (axe-core, default rules, zero violations on every screen).

Content lives in `data/prompt-seeds.json` (one entry per prompt, with `taxon`/`taxonFilter` for the taxa safety net and `min` only where 40 answers are impossible), `data/batches/*` (answers, aliases, facts, tiers) and `data/taxa/*.json` (scientific and common names per group, merged by `node tools/merge-taxa.js`). `node tools/add-batch.js` merges a batch, `node tools/validate-data.js` checks the whole bank, `node tools/apply-patch.js data/patches/<file>.json` applies corrections (including the admin inbox export). Past days in `data/schedule.json` are frozen; the build only fills future days.

## 1. Deploy on your domain

The site address is set once, in `data/site.json` (`siteUrl`). The build writes it into share text, `canonical`, `og:image`, `sitemap.xml`, `robots.txt` and the `CNAME` file in `dist/`.

1. Create a GitHub repository and push `main`.
2. Repository → Settings → Pages → Source: **GitHub Actions**. `.github/workflows/deploy.yml` runs on every push to `main` and daily at 00:05 Eastern (05:05 UTC): tests, `node build.js --dist`, `node tools/make-icons.js --og-days` (30 per-day Open Graph images), commits the frozen schedule, and publishes `dist/`.
3. Custom domain: at your DNS host add `A` records for the apex to GitHub's four Pages addresses (or a `CNAME` for `www` to `YOUR-USER.github.io`), then Settings → Pages → Custom domain → enter it → Enforce HTTPS once the certificate is issued. The `CNAME` file is already in `dist/`.
4. Bump `CACHE_VERSION` in `sw.js` on every release so installed players pick the new files up.

`404.html` turns `/daily`, `/archive`, `/leaderboard`… into the matching `#route`, so deep links work on Pages.

## 2. Supabase (accounts, dives, leaderboards, sync, friends, community packs, reports, analytics)

1. Create a project at supabase.com. Note the Project URL and the anon key (Settings → API).
2. Authentication → Providers → Google: enable it and paste the Google OAuth client id and secret (create them in Google Cloud Console with the callback URL shown on that page). Authentication → URL Configuration: Site URL = your domain; add it to the redirect allow list.
3. Database → Extensions: enable `pg_cron` and `pg_net`.
4. SQL editor: run `supabase/schema.sql`, then `supabase/cron.sql`. Then make yourself the admin:

```sql
insert into public.admin_emails (email) values ('you@example.com');
```

5. Edge Functions — install the Supabase CLI, then:

```
node tools/sync-shared.js                       # copies shared/dive.js and the data files into supabase/functions/_shared
supabase login
supabase link --project-ref <ref>
supabase functions deploy submit-dive
supabase functions deploy delete-account
supabase functions deploy push-subscribe
supabase functions deploy send-reminders
supabase functions deploy weekly-recap
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.

6. In `online.js` set `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then set `LEADERBOARD_ENABLED: true`, `ANALYTICS_ENABLED: true`, `MOCK_ONLINE_DATA: false`. Redeploy (push to `main`).

Re-run `node build.js`, `node tools/sync-shared.js` and redeploy `submit-dive` whenever the data files change, so the server scores with the same bank the players see.

### Secrets

| Secret | Used by | Where it comes from |
|---|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `send-reminders` | `node tools/vapid-keys.js` — the public half is already in `online.js`; the private half is in `supabase/vapid-private.key` (gitignored). **Never commit the private key.** |
| `VAPID_SUBJECT` | `send-reminders` | `mailto:you@yourdomain` |
| `RESEND_API_KEY` | `weekly-recap` | resend.com → API Keys, after verifying your sending domain |
| `RECAP_FROM` | `weekly-recap` | e.g. `ANGLER <recap@yourdomain>` |
| `SITE_URL` | `weekly-recap`, `send-reminders` | the same value as `data/site.json` |

```
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@yourdomain
supabase secrets set RESEND_API_KEY=re_... RECAP_FROM="ANGLER <recap@yourdomain>" SITE_URL=https://yourdomain
```

### Scheduled jobs (`supabase/cron.sql`)

| Job | When | What |
|---|---|---|
| `nightly` | 00:05 Eastern (two entries cover winter and summer time) | freezes yesterday's curve, Daily Rank Points, ratings, leagues, Hall of Fame on the 1st |
| `angler-reminders` | every hour at :07 | `send-reminders` pushes to divers whose chosen reminder hour it is and who have not dived today |
| `angler-weekly-recap` | Sunday 15:00 UTC | `weekly-recap` emails the opted-in divers their week |

The two v2 entries call the functions through `pg_net`. Before running `cron.sql`, replace `YOUR-PROJECT-REF` and `YOUR-SERVICE-ROLE-KEY` in its two `alter database … set app.*` lines (Settings → API); the file is safe to re-run.

## 3. Admin dashboard

`admin.html` is deployed with the site but shows nothing to anyone who is not in `admin_emails` (every `admin_*` RPC checks `is_admin()` on the server). Sign in with the Google account you inserted. It shows the funnel, per-prompt miss rate and lure use, the most-typed rejected guesses per prompt, retention cohorts and the report inbox. Accept the reports that are right, then **Export accepted → inbox.json**, save the download as `data/patches/inbox.json`, fill the mechanical sections from its `review` list, run `node tools/apply-patch.js data/patches/inbox.json`, `node build.js`, commit.

## 4. Ads and payments

Off, and not part of this release. `monetise.js` and `supabase/functions/stripe-webhook` are kept so they can be switched on later without new code; `ADS_ENABLED` and `PAYMENTS_ENABLED` must stay `false`.

## 5. Reviewing flagged dives

Near-perfect dives typed implausibly fast are stored with `flagged = true, approved = false` and stay off the top 100. Approve or delete them in the Supabase table editor (`dives`).
