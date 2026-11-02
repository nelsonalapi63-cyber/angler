# FATHOM — the daily ocean dive

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
