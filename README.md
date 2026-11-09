# ANGLER — the daily ocean dive

Seven ocean prompts a day, 25 seconds each, one typed answer per prompt. Every accepted answer has a rarity tier — Tide Pool, Bait Ball, Reef, Twilight, Midnight, Hadal — and the rarer your answer, the deeper you sink. A perfect dive lands at 10,935 m, the bottom of Challenger Deep.

A static site: vanilla HTML, CSS and JavaScript, no framework, no build step beyond `node build.js` for the data. Deploys to GitHub Pages or Cloudflare Pages unchanged.

## Layout

| File | What it does |
|---|---|
| `index.html`, `styles.css` | the shell and the look |
| `app.js` | configuration, router, menu, modals, toasts, theme, sound |
| `game.js` | the dive: timer, matching, reveal, result screen, share, challenges |
| `pages.js` | home, archive, packs, logbook, FAQ, stats and settings modals |
| `charts.js` | depth gauge, daily bell curve, zone distribution |
| `storage.js` | guarded localStorage: results, streaks, logbook, settings, queue |
| `online.js` | feature flags, Supabase REST client, sign-in, dive submission, leaderboards, ratings, analytics, demo data |
| `monetise.js` | products, unlock modal, "Go deeper" card, ad slots, consent banner |
| `shared/dive.js` | the one copy of the rules: matching, scoring, depth, zones, seeded dive construction — used by the browser, the tests and the server |
| `data/*.json` | the answer bank (entities, prompts, packs) — the source of truth; `node build.js` writes `entities.js` and `prompts.js`. `data/batches/` holds the raw material the bank was merged from; `data/patches/` holds review corrections applied with `tools/apply-patch.js` |
| `supabase/` | schema, cron, Edge Functions for Phase 2 |
| `sw.js`, `manifest.json`, `icons/` | installable, works offline |
| `tests/` | unit tests (`node --test 'tests/*.test.js'`) and the Playwright run (`node tests/e2e.spec.js`) |

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

