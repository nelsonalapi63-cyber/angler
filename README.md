# ANGLER — the daily ocean dive

Seven ocean questions a day, 25 seconds each, one typed answer per question. Every accepted answer has a rarity tier — Tide Pool, Bait Ball, Reef, Twilight, Midnight, Hadal — and the rarer your answer, the deeper your submarine sinks. A perfect dive lands at 10,935 m, the bottom of Challenger Deep.

A static site: vanilla HTML, CSS and JavaScript, no framework, no build step beyond `node build.js` for the data. Deploys to GitHub Pages or Cloudflare Pages unchanged.

## Layout

| File | What it does |
|---|---|
| `index.html`, `styles.css`, `fonts/` | the shell, the look, and the self-hosted Outfit + Inter typefaces (Open Font License) |
| `app.js` | configuration, router, lazy answer bank, menu, modals, toasts, theme, sound, haptics, keyboard shortcuts, the mascot |
| `game.js` | the dive: timer, matching, the one hint per dive, the pilot's radio lines, reveal, the submarine's descent, result screen (curve, standing, return hooks), share, challenges, reports |
| `sub.js` | the water column: a canvas strip from the surface to Challenger Deep with the submarine and its pilot, landmarks, bubbles, creatures of each zone; exported camera and timing maths for the tests |
| `pages.js` | home, archive, packs, logbook, FAQ, welcome, stats (My ANGLER) and settings |
| `surface.js` | the canvas animation of the sea surface on the home hero, with the submarine waiting to dive |
| `retain.js` | push reminders, streak freezes, the streak-at-risk banner, the calendar heatmap, the recap opt-in |
| `social.js` | the live divers count, community packs (builder and play), the report sheet |
| `achievements.js`, `share.js` | badges; the share text and the share card image |
| `charts.js` | the daily bell curve (with its early-week and first-diver states), zone distribution |
| `storage.js` | guarded localStorage: results, streaks and freezes, logbook, settings, queues |
| `online.js` | feature flags, Supabase REST client, sign-in, dive submission with retry, leaderboards, friends, ratings, first-party analytics, demo data |
| `monetise.js` | products, unlock modal, ad slots, consent banner — all switched off |
| `admin.html`, `admin.js` | the owner's dashboard: funnel, per-question miss rate, rejected guesses, cohorts, report inbox and its export |
| `shared/dive.js` | the one copy of the rules: lenient matching (optional group words, typo bands, unambiguous short forms), scoring, hints, taxa, depth, zones, seeded dive and challenge construction — used by the browser, the tests and the server |
| `data/` | the answer bank. `prompt-seeds.json` (prompts, `taxon` filters, `min` overrides), `batches/` (answers, aliases, facts, tiers), `taxa/` (reference name lists), `illustrations/` (SVG art for every Hadal answer), `patches/` (corrections), `site.json` (the site address) — `node build.js` writes `boot.js`, `entities.js`, `prompts.js`, `taxa.js`, `robots.txt` and `sitemap.xml` |
| `tools/` | `add-batch.js`, `validate-batch.js`, `validate-data.js`, `apply-patch.js`, `merge-taxa.js`, `make-icons.js` (mascot icons, favicon, Open Graph images), `vapid-keys.js`, `sync-shared.js`, `check-leniency.js` (the matcher applied to every answer of every question: name collisions must be zero; writes `tests/reports/leniency-report.txt`) |
| `supabase/` | schema, cron jobs and Edge Functions (`submit-dive`, `push-subscribe`, `send-reminders`, `weekly-recap`, `delete-account`, `stripe-webhook`) |
| `sw.js`, `manifest.json`, `icons/`, `404.html` | installable, works offline, deep links on GitHub Pages |
| `.github/workflows/deploy.yml` | tests, builds `dist/`, freezes the schedule, publishes to GitHub Pages on push and daily |
| `tests/` | unit tests (`node --test 'tests/*.test.js'`), the Playwright run with axe-core (`node tests/e2e.spec.js`), `serve.js` (`--dist` for a production-style server), `reports/` |

See `SETUP.md` for deployment and switching on accounts, leaderboards, ads and purchases. Every parameter is a named constant at the top of its file.

## Deploy to a real domain (GitHub Pages)

1. **Create the repository.** On github.com → New repository → name it `angler` (public or private both work with Pages). Then from this folder:
   ```bash
   git remote add origin git@github.com:YOUR-USER/angler.git
   git push -u origin main
   ```
2. **Enable Pages.** Repository → Settings → Pages → Build and deployment → Source: **GitHub Actions**. The workflow in `.github/workflows/deploy.yml` runs on every push to `main` and every day at 05:05 UTC; it tests, builds `dist/`, and publishes it. The first run gives you `https://YOUR-USER.github.io/angler/`.
3. **Buy the domain** at any registrar (Cloudflare, Porkbun, Namecheap — about $10–15 a year for a `.com`). Then put it in **one place**: `data/site.json` → `"siteUrl": "https://playangler.com"` (your domain). Commit and push. The build writes `dist/CNAME`, the canonical and Open Graph tags, `robots.txt` and `sitemap.xml` from that value, and the share text carries it.
4. **Point the domain at GitHub.** At the registrar's DNS page add:
   - for the bare domain (`playangler.com`): four `A` records → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - for `www`: a `CNAME` record → `YOUR-USER.github.io`
   Then Repository → Settings → Pages → Custom domain → type the domain → Save, and tick **Enforce HTTPS** once the certificate appears (a few minutes to an hour).
5. **Check it.** Open the domain: the service worker, manifest and `404.html` all work at the root. `https://yourdomain/archive` redirects to `/#archive`. Install it to a phone home screen from the browser menu.

The daily scheduled run also commits `data/schedule.json` back to `main`, so the frozen past days are the same in the repository, on the site and on the server (`tools/sync-shared.js`).

