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

The last Lighthouse mobile run (dist build, simulated slow 4G and a 4× slower CPU) scored performance 96–97 (total blocking time varies between runs), accessibility 100, best practices 100, SEO 100; the report is `tests/reports/lighthouse-mobile.report.html`. The browser run writes `tests/reports/axe-report.json` (axe-core, default rules, zero violations on every screen).

Content lives in `data/prompt-seeds.json` (one entry per prompt, with `taxon`/`taxonFilter` for the taxa safety net and `retired` for questions that could not reach the floor), `data/prompts.json` + `data/entities.json` (the bank itself) and `data/taxa/*.json` (scientific and common names per group, merged by `node tools/merge-taxa.js`). `node tools/add-batch.js` merges a batch, `node tools/validate-data.js` checks the whole bank, `node tools/apply-patch.js data/patches/<file>.json` applies corrections (including the admin inbox export). Past days in `data/schedule.json` are frozen and `data/frozen.json` keeps the exact answer sets those days were played with; the build only fills future days.

### The v4 bank floor (75 sourced answers per live question)

```
node tools/bank/build.js --concurrency 8      # tops every live question up to 75 answers; hours the first time (every page is cached under tools/bank/cache/)
node tools/bank/refresh-facts.js              # repairs any fact cut short and restores hand-written facts the builder touched
node tools/bank/legacy-list.js                # rebuilds data/legacy-entities.json (pre-v4 entities without a source; it can only shrink)
node tools/validate-data.js                   # must print OK: every live question 75+ answers and the tier floors, every v4 answer a source, 211+ live questions
node tools/check-leniency.js                  # name collisions must still be zero
node build.js                                 # then upload the bank (step 5 of §2) and redeploy submit-dive and duel
```

`tools/bank/questions.js` says where each question's candidates come from (a reference list, the existing bank, or a hand list in `tools/bank/lists/`) and the FishBase / SeaLifeBase / Wikipedia test a candidate must pass; a question whose config is `retire: true`, or that still cannot reach 75 verified answers, is retired (`retired: true` on the prompt and its seed): it keeps its answers for the archive and the days it was played on, and is never scheduled or dealt again. Replacement questions are the `REPLACE` list in the same file. `tools/bank/report.json` is the before/after count of the last run. The builder never rewrites a hand-written entity: new answers get a page-derived fact and a `source`; pre-v4 answers keep their own fact and are counted by the validator (`data/legacy-entities.json`).

## 1. Deploy on your domain

The site address is set once, in `data/site.json` (`siteUrl`) — currently `https://nelsonalapi63-cyber.github.io/angler`. The build writes it into share text, `canonical`, `og:image`, `sitemap.xml` and `robots.txt`; for a domain of your own (anything that is not a github.io address) it also writes the `CNAME` file in `dist/`.

1. Create a GitHub repository and push `main`.
2. Repository → Settings → Pages → Source: **GitHub Actions**. `.github/workflows/deploy.yml` runs on every push to `main` and daily at 00:05 Eastern (05:05 UTC): tests, `node build.js --dist`, `node tools/make-icons.js --og-days` (30 per-day Open Graph images), commits the frozen schedule, and publishes `dist/`.
3. Custom domain: at your DNS host add `A` records for the apex to GitHub's four Pages addresses (or a `CNAME` for `www` to `YOUR-USER.github.io`), then Settings → Pages → Custom domain → enter it → Enforce HTTPS once the certificate is issued. The `CNAME` file is already in `dist/`.
4. Bump `CACHE_VERSION` in `sw.js` on every release so installed players pick the new files up.

`404.html` turns `/daily`, `/archive`, `/leaderboard`… into the matching `#route`, so deep links work on Pages.

## 2. Supabase (accounts, dives, leaderboards, sync, friends, community packs, reports, analytics)

**Live project:** `angler` (ref `yxnkzqiyyeqpuwqyqubg`, us-east-1) in the organization "Nelson Alapi Companies.org". The schema, the cron jobs, the six Edge Functions and the answer bank are installed; `online.js` carries its URL and anon key with `LEADERBOARD_ENABLED` and `ANALYTICS_ENABLED` on. What follows is how it was done, for a fresh project or a rebuild.

1. Create a project at supabase.com. Note the Project URL and the anon key (Settings → API).
2. Authentication → URL Configuration: Site URL = the site address (`https://nelsonalapi63-cyber.github.io/angler/`), and add it to the Redirect URLs (plus any other address the game runs at, e.g. the claude.ai artifact). This is where the email sign-in link and Google send the player back to. Optional: Authentication → Providers → Google — enable it and paste a Google OAuth client id and secret (created in Google Cloud Console with the callback URL shown on that page); the email link works without it.
3. SQL editor: run `supabase/schema.sql`, then `supabase/cron.sql` after filling in its three `cron_settings` values (project ref, anon key, a random `bank_token`). Then make yourself the admin:

```sql
insert into public.admin_emails (email) values ('you@example.com');
```

4. Edge Functions — install the Supabase CLI, then:

```
node tools/check-leniency.js                    # the matching rules applied to every answer: name collisions must be zero before the rules ship
node tools/sync-shared.js                       # copies shared/dive.js next to each function that needs it (redeploy submit-dive after every rules change)
supabase login
supabase link --project-ref <ref>
supabase functions deploy submit-dive
supabase functions deploy duel                 # v4: private duel rooms (verify_jwt off — guests play with the anon key; every call is checked in the function)
supabase functions deploy delete-account
supabase functions deploy push-subscribe
supabase functions deploy send-reminders
supabase functions deploy weekly-recap
supabase functions deploy bank-upload
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.

5. Upload the answer bank — the server scores dives with it, so it must match what the players see:

```
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon key> BANK_TOKEN=<the bank_token you chose> node tools/upload-bank.js
```

Add those three as repository secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BANK_TOKEN`) and the deploy workflow re-uploads the bank after every build. The token can write the bank and nothing else; the service role key never leaves Supabase.

   v3 note: `daily_curve` now also returns `at_or_above` and `below` (the browser turns them into "You beat X% of divers today"); re-run the `daily_curve` block of `schema.sql` on a project created before v3. The hint is free (`HINT_COST = 0` in `shared/dive.js`) and limited to one per dive by the game itself.

   v4 note — Duel: run the "v4 Duel" block of `schema.sql` (tables `duel_rooms`, `duel_secrets`, `duel_players`, `duel_events`, their policies, the Realtime publication and the `duel_played` / `duel_wins` profile columns), then deploy the `duel` function (`node tools/sync-shared.js` first: it copies `shared/dive.js` and `shared/duel.js` next to it). Players only ever read `duel_rooms` and `duel_events` (Realtime broadcasts the public state; the hidden fuse lives in `duel_secrets`, which nobody can read) and every write goes through the function with a per-player token. Check a deployment with `SUPABASE_URL=… SUPABASE_ANON_KEY=… node tools/duel-smoke.js` — it plays a whole two-player room (create, join, start, refused turn, refused repeat, the pop on the server clock, the next round, leave, rematch) in about 35 seconds; the same run is the env-gated last test of `tests/online.test.js`. Finished rooms are swept six hours after they end, untouched rooms after two days.

6. In `online.js` set `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then `LEADERBOARD_ENABLED: true`, `ANALYTICS_ENABLED: true`, `MOCK_ONLINE_DATA: false`. Redeploy (push to `main`). The browser tests keep running in demo mode: they set `localStorage['angler.mock'] = '1'`, which turns the online flags off for that browser only.

### Secrets (Edge Functions → Secrets in the dashboard)

| Secret | Used by | Where it comes from |
|---|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `send-reminders` | `node tools/vapid-keys.js` — the public half is already in `online.js`; the private half is in `supabase/vapid-private.key` (gitignored). **Never commit the private key.** |
| `VAPID_SUBJECT` | `send-reminders` | `mailto:you@yourdomain` |
| `RESEND_API_KEY` | `weekly-recap` | resend.com → API Keys, after verifying your sending domain |
| `RECAP_FROM` | `weekly-recap` | e.g. `ANGLER <recap@yourdomain>` |
| `SITE_URL` | `weekly-recap` | the same value as `data/site.json` (`https://nelsonalapi63-cyber.github.io/angler`) |

Until the VAPID secrets exist, `send-reminders` answers `VAPID keys not set` and sends nothing; until the Resend secrets exist, `weekly-recap` answers `RESEND_API_KEY not set`. Both are safe to leave for later.

### Scheduled jobs (`supabase/cron.sql`)

| Job | When | What |
|---|---|---|
| `angler-nightly-winter` / `-summer` | 00:05 Eastern (two entries cover winter and summer time) | freezes yesterday's curve, Daily Rank Points, ratings, leagues, Hall of Fame on the 1st |
| `angler-reminders` | every hour at :07 | `send-reminders` pushes to divers whose chosen reminder hour it is and who have not dived today |
| `angler-weekly-recap` | Sunday 15:00 UTC | `weekly-recap` emails the opted-in divers their week |

The two function jobs call the Edge Functions through `pg_net` with the project's public anon key (read from `public.cron_settings`, which no client can read). Both functions are idempotent — one reminder per subscription per day, one recap per diver per week — so an early or repeated call changes nothing.

### Anti-cheat

`submit-dive` re-scores every dive with the same rules file and bank as the browser, refuses a day that is closed or a prompt set that is not today's, refuses seven answers typed in under 7 seconds, and holds near-perfect dives typed in under 20 seconds for review (`flagged`, off the board until approved). A refused dive is not retried; the result screen says why.

## 3. Admin dashboard

`admin.html` is deployed with the site but shows nothing to anyone who is not in `admin_emails` (every `admin_*` RPC checks `is_admin()` on the server). Sign in with the Google account you inserted. It shows the funnel, per-question miss rate and hint use, the most-typed rejected guesses per question, retention cohorts and the report inbox. Accept the reports that are right, then **Export accepted → inbox.json**, save the download as `data/patches/inbox.json`, fill the mechanical sections from its `review` list, run `node tools/apply-patch.js data/patches/inbox.json`, `node build.js`, commit.

## 4. Ads and payments

Off, and not part of this release. `monetise.js` and `supabase/functions/stripe-webhook` are kept so they can be switched on later without new code; `ADS_ENABLED` and `PAYMENTS_ENABLED` must stay `false`.

## 5. Reviewing flagged dives

Near-perfect dives typed implausibly fast are stored with `flagged = true, approved = false` and stay off the top 100. Approve or delete them in the Supabase table editor (`dives`).
