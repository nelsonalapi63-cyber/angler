Build me FATHOM — a daily ocean-trivia website that plays like krillion.io and looks and feels like Wordle. Every prompt is about fish and the ocean.

1. THE GAME LOOP (copy Krillion's loop exactly)
- One dive = 7 prompts. Same 7 for everyone on a given day.
- Each prompt is open-ended with many valid answers, e.g. "Name a shark species". 25 seconds to type ONE answer and press Enter. One submission per prompt. No answer, or a rejected answer, = 0 points and the prompt is over (shake the input like Wordle does for an invalid word, then reveal the top answer).
- Every accepted answer has a rarity tier. Rarer = more points = deeper you sink.
- After the 7th prompt: result screen with total depth, your percentile for the day, and a share grid.

2. FATHOM'S TWIST
- Every prompt is an ocean fact disguised as a category. The fact is the constraint: "Name a fish that can breathe air", "Name an animal that lives at a hydrothermal vent", "Name a fish found below 1,000 m". You only score if you know the fact. Do NOT make it multiple choice.
- After every answer, show a one-sentence "Did you know" fact about the player's answer (or about the top-tier answer if they missed). Only facts you are confident are true and well established. No invented numbers.

3. RARITY TIERS (points → name → share emoji)
10 → Tide Pool 🐚 (the first thing anyone says)
15 → Bait Ball 🐠 (the "clever" pick everyone crowds into — not actually rare)
30 → Reef 🪸
60 → Twilight 🦑
85 → Midnight 🐙
100 → Hadal 🔱 (exactly one hand-picked best answer per prompt)
miss → ⬛
Depth: set METERS_PER_POINT so a perfect 700-point dive lands at exactly 10,935 m, the bottom of Challenger Deep. Whole meters only.

4. DEPTH GAUGE (always visible, fills as you sink, real landmarks)
200 m sunlight zone ends · 1,000 m twilight zone ends · 3,800 m Titanic wreck · 4,000 m abyssal zone begins · 6,000 m hadal zone begins · 8,336 m deepest fish ever filmed (snailfish, 2023) · 10,935 m Challenger Deep. Background darkens from turquoise to black with depth. The end screen names the zone you finished in plus one true fact about life there.

5. DATA MODEL AND ANSWER BANK — the real work, make it big and accurate
Source of truth is two JSON files in data/, and a tiny build script (node build.js) that emits browser globals from them (entities.js → window.FATHOM_ENTITIES, prompts.js → window.FATHOM_PROMPTS, loaded by plain script tags so the site works opened from disk). The server-side scoring function in section 12 imports the same JSON directly, so there is exactly one copy of the data.
- entities.json: ONE entry per thing in the ocean world. Fields: id, canonical name, aliases (common names, scientific names, plurals, regional names), kind (creature, plant, place, vessel, person), group (sharks, whales, trenches, …), one-sentence fact. Each creature exists exactly once, so the same fish can never carry two contradictory facts.
- prompts.json: each prompt = id, text, group, difficulty 1–5, and a list of {entity id, tier} pairs. Prompts reference entities; they never duplicate names or facts.
Requirements:
- AT LEAST 120 prompts, each with at least 25 accepted entities. Exactly one Hadal per prompt.
- Tiers are hand-curated by you by how familiar the answer is to an average person — there are no live player stats, so bake tiers into the data. Difficulty = how hard it is to score at all on that prompt.
- Cover: sharks, rays, whales, dolphins, seals, sea turtles, cephalopods, crustaceans, jellyfish, flatfish, deep-sea fish, bioluminescent animals, fish that move between fresh and salt water, air-breathing fish, hydrothermal-vent life, tide-pool animals, venomous and poisonous sea creatures, filter feeders, coral reefs, ocean trenches, seas and gulfs by ocean, ocean currents, famous research vessels and submersibles, ocean explorers, seaweeds and kelps, sushi fish, fish families (tuna and mackerel, cod, salmon, catfish), record holders (largest, fastest, deepest, longest-lived).
- Group names count: "hammerhead" or "tuna" typed on a species prompt should match a representative entity at Tide Pool tier, never be rejected.
- Build in batches of 20 prompts. After each batch run a validator: both files parse, every referenced entity id exists, no orphan entities, every prompt has ≥25 entities and exactly one Hadal, no two entities inside the same prompt share an alias, every entity has a fact. Do not move on until the batch passes.
- Prompts and entities can be added without touching game code: edit the JSON, run the build.

6. ANSWER MATCHING
Normalise input: lowercase, trim, strip punctuation and accents, drop a leading "the/a/an", singularise simple plurals. Exact match on canonical or alias first; otherwise accept edit distance ≤ 1 for words of 6 letters or fewer, ≤ 2 for longer. Show the canonical name the input matched to. Matching, scoring and dive construction live in ONE shared source file (shared/dive.js) used by both the browser (via the build step) and the server function — never two copies.

7. THE WEBSITE — Krillion's structure, Wordle's look
Layout like Wordle: one centered column, max width about 520 px, clean sans-serif type, generous spacing, works perfectly on a phone. Top bar: hamburger menu on the left; FATHOM wordmark in the center; help (?), stats (bar-chart icon) and settings (gear) icons on the right.
Menu pages (hash routing, no page reloads):
- Daily Dive — today's 7, puzzle number "FATHOM #N" counted from a LAUNCH_DATE constant. Once played, it shows your result and a live "Next dive in HH:MM:SS" countdown to midnight Eastern.
- Free Dive — unlimited random dives, never affects daily stats or rankings. Has a "Challenge a friend" button (section 10).
- Archive — every past daily by date, playable, each marked with your depth if you played it. Archive dives never count for rankings.
- Themed Packs — curated 7-prompt dives: Sharks, Deep Sea, Reef Life, Whales and Dolphins, Seas and Trenches, Weird Fish, Sushi Bar, Record Holders. Each is its own dive with its own best score.
- Leaderboard — see section 12.
- Logbook — see section 10.
- My Fathom (stats) — Wordle-style modal: Dives played, Average depth, Current streak, Max streak, current rating and league (section 12), and a Depth Distribution bar chart binned by zone (Sunlight / Twilight / Midnight / Abyss / Hadal) with today's bar highlighted.
- How to Play — modal that opens automatically on first visit, with the tier table and one worked example.
- Settings — dark mode (default), light mode, high-contrast mode (tiers must be told apart by label and icon, never colour alone), sound on/off, timer on/off for Free Dive only, sign in / sign out, choose handle, hide me from leaderboards, delete my account and data.
- FAQ / About — how prompts are built, how tiers are set, how rankings work, privacy note (free play stays in your browser, no account needed).
Dive construction: pick 7 prompts with a seeded shuffle from today's date in America/New_York, cycling through a seeded permutation of the whole bank so no prompt repeats until every prompt has been used once. Enforce no two prompts from the same group in one dive. Then ORDER the 7 by difficulty ascending so every dive starts shallow and ends hard. Same rules for Free Dive and packs.
Feel: Wordle-style tile flip when a tier is revealed, the depth gauge sinks smoothly, a few slow bubbles, a toast ("Copied results to clipboard", "Not an accepted answer"). Share button copies: "FATHOM #N · 4,210 m · top 18% · 🐚🪸🦑⬛🐙🔱🐠" with no spoilers (drop the percentile part when offline).
Result screen, in this order: total depth and zone reached; the daily bell curve with your marker (section 12); share button; each prompt with your answer and tier, the Hadal answer revealed; a collapsible full answer list by tier for learning; under every prompt a small "Report an answer or tier" link (section 10).
Persistence: localStorage wrapped in try/catch — daily results by date, streaks, best depths per pack, logbook, settings, anonymous device id.
Site basics: <title>, meta description, Open Graph tags, inline SVG favicon, footer with FAQ, Privacy, Terms, Refunds and Contact links. With every online flag in section 9 off, the site makes zero external requests — no fonts, no CDNs, no analytics.

8. BUILD RULES
- Static site; no backend is needed to play: index.html, styles.css, app.js, entities.js, prompts.js, shared/dive.js, monetise.js, online.js, sw.js, manifest.json, build.js, data/*.json, plus privacy.html, terms.html, refunds.html as real pages (ad networks and payment providers check for them). Vanilla HTML, CSS and JavaScript only. Must deploy to GitHub Pages or Cloudflare Pages with a custom domain and zero code changes. Server pieces live in supabase/ and deploy separately.
- Every parameter (seconds per prompt, prompts per dive, tier points, meters per point, edit-distance limits, launch date, prices, feature flags, feedback email, cache version, rating window, league thresholds, minimum dives for a curve) is a named constant at the top of its file. Nothing hardcoded inline.
- Original name, copy, tier names and art only. Do not reuse any text, logo or artwork from Krillion or Wordle.
- Before handing over: open it in a headless browser at a 390 px mobile viewport and at desktop, play a full daily dive with scripted inputs (include one alias, one group name and one one-letter typo), play one themed pack, open a challenge link in a second context and confirm it serves the identical 7 prompts, open every modal and page including the locked-item flow and the leaderboard in mock mode, reload and confirm stats and logbook persisted, go offline and confirm the site still loads and plays, run the server scoring function locally against a recorded dive and confirm it returns the same depth the browser computed, and confirm zero console errors. Take screenshots of the home, mid-dive, result (with bell curve), leaderboard and logbook screens.
- Publish it as an artifact I can open on my phone, keep the source files so I can push them to GitHub Pages later, and tell me in five lines what you built and what you'd improve next.

9. ONLINE FEATURES, ACCOUNTS AND MONETISATION — Krillion's model: free daily, ads, paid unlocks that also remove ads
Principles:
- The daily dive is free forever and never needs an account. The core loop is never behind a paywall or a sign-in wall — that is what makes Wordle-likes spread.
- Nothing commercial appears while a timer is running. Ads and upgrade cards live only on the home screen, the result screen and between Free Dive rounds.
- Every online feature sits behind a flag that defaults to OFF: ADS_ENABLED, PAYMENTS_ENABLED, ANALYTICS_ENABLED, LEADERBOARD_ENABLED, plus MOCK_ONLINE_DATA which fills leaderboards and the bell curve with clearly labelled demo data so I can see the screens in the artifact. Flags off = zero external requests. Flags on = the only allowed external domains are the ad network, Stripe, Supabase and the analytics host.
What is for sale (placeholder prices as constants in a PRODUCTS array — id, name, price, what it unlocks):
- Archive Pass, $2.99 one-time — the Archive shows the last 7 days free, everything older is locked.
- Themed packs, $1.99 each or All Packs $4.99 — Sharks and Reef Life are free, the rest locked.
- Dive Supporter, $4.99 one-time — removes ads, unlocks the archive and every pack including future ones. List this first in the unlock modal.
- Rule copied from Krillion: ANY purchase removes ads site-wide. Leaderboards and rankings are never paid.
Ads:
- Google AdSense via an AD_PUBLISHER_ID constant; render fixed-height placeholder boxes until it is set so the layout never jumps. Slots: one banner under the result screen, one between Free Dive rounds every third dive, none on any screen with a live timer. Load the ad script lazily and only when ADS_ENABLED is true and the user has no purchases.
- Consent banner before any ad loads for visitors in the EU and UK (AdSense requires it); store the choice in localStorage.
Accounts (Supabase):
- Optional Google sign-in. Needed only to appear on leaderboards, hold a rating, buy things, and sync across devices. Tables: profiles (user_id, handle, country flag chosen by the user, hidden_from_leaderboards), entitlements (user_id, product_id, purchased_at, payment_session_id), progress (stats, daily results and logbook sync), dives and ratings (section 12). Row Level Security: a user can read and write only their own private rows; leaderboard views expose handle, flag, depth, rating and nothing else.
- Handles: 3–16 characters, letters, numbers and underscores, unique, checked against a profanity list. Anonymous players get a random device id in localStorage so their dives still count toward the daily curve, shown as "Anonymous diver" and never on a leaderboard.
- Settings must offer "Delete my account and data", implemented as one server call that removes every row for that user.
Payments:
- Stripe Checkout: an Unlock button opens Stripe's hosted page, so no card data ever touches the site. A Supabase Edge Function receives the checkout.session.completed webhook and inserts the entitlement. The client refreshes entitlements on load and when returning from checkout, caches the last known entitlements in localStorage so purchases still work offline, and re-verifies when online.
- Keep the webhook and entitlement shape generic so Stripe can be swapped for Lemon Squeezy (a merchant of record that handles sales tax for me) by changing one file.
Upgrade experience (Wordle-polite, never nagging):
- One dismissible "Go deeper" card on the result screen listing what is locked, shown at most once per day.
- Locked items in menus show a small lock and the price; tapping any of them opens one Unlock modal listing every product with Dive Supporter first.
- After a purchase: a thank-you toast and the lock disappears with no reload.
Analytics behind ANALYTICS_ENABLED: Plausible or Umami (no cookies). Events: dive_started, dive_completed (with mode and depth), dive_submitted, share_clicked, challenge_created, challenge_opened, leaderboard_opened, logbook_opened, report_clicked, upgrade_viewed, checkout_started, purchase_completed, sign_in. From these I will compute daily active players, day-1 and day-7 return rates, share rate, ad revenue per thousand dives, free-to-paid conversion and revenue per daily active player.
Legal pages before anything goes live: Privacy Policy (what localStorage holds, what Supabase holds for signed-in users, that handles and scores are public on leaderboards, ad cookies if consented), Terms of Use, Refund Policy (one-time digital purchases, refund on request within 14 days), Contact.
Deliver supabase/schema.sql, supabase/functions/stripe-webhook/index.ts, supabase/functions/submit-dive/index.ts, supabase/functions/delete-account/index.ts, and a SETUP.md with exact steps: create the Supabase project, enable the Google provider, set environment variables, run the schema, deploy the functions, create the Stripe products, point the webhook at the function, schedule the nightly rating job, flip the flags.
Phasing: Phase 1 ships now with every flag off and MOCK_ONLINE_DATA on — locks and placeholder prices visible, labelled "Coming soon", leaderboards showing demo data with a "demo" badge. Phase 2 is the Supabase, leaderboard and Stripe wiring, which I turn on once I own a domain.

10. RETENTION FEATURES (no backend needed)
Logbook — a collection, like a field guide you fill in:
- Every entity the player has ever answered correctly, in any mode, gets logged with its name, fact, the best tier it ever earned, and the date first logged.
- Tabs: Creatures, Plants, Places, People and Vessels. Filter by group. Header shows "X of N logged" per tab — the number N only, never the names of unlogged entries.
- Each Hadal answer the player lands gets a gold marker. A "Hadal hunt" counter shows how many of the bank's Hadal answers they have found.
- Tapping an entry shows the fact and every prompt it has appeared in that the player has already played.
Challenge links — multiplayer with no server:
- In Free Dive, "Challenge a friend" builds a dive from a random seed and copies a URL like #/challenge/SEED-DEPTH where DEPTH is the challenger's result once they finish (or 0 if shared before playing).
- Opening the link plays the identical 7 prompts in the same order and shows "Beat 4,210 m" at the top if a depth was included.
- The challenge result screen offers "Send your score back" which copies the same link with the new depth, and a Wordle-style two-row emoji grid comparing both dives.
- Challenges never touch daily stats, streaks or rankings.
Report an answer or tier:
- Under every prompt on any result screen, a "Report an answer or tier" link opens a prefilled email (FEEDBACK_EMAIL constant) with the prompt id, the player's typed answer, the tier it got, the date and mode. If REPORT_FORM_URL is set, use that instead of mailto. This is how I fix tiers, since they start as guesses.

11. INSTALLABLE APP
- manifest.json: name, short name, standalone display, theme and background colours, inline-generated icons at 192 and 512 px.
- sw.js: service worker that pre-caches every static file on install, serves cache-first, and busts the cache by a CACHE_VERSION constant so updates reach players on next load. Register it only when supported, inside try/catch.
- Because the daily is computed from the date on the device, Daily Dive, Free Dive, packs and the logbook must all work fully offline. Only sign-in, payments, ads, analytics, dive submission and leaderboards need the network. A dive finished offline is queued and submitted when the connection returns, as long as that day is still open.
- Show a one-line "Add FATHOM to your home screen" hint in Settings; never a pop-up.

12. LEADERBOARDS, DAILY BELL CURVE AND WORLD RANKING
Why a server is needed: a static page cannot know how other people scored, and anything scored in the browser can be faked. So the browser never sends points — it sends the raw typed answers and the seconds used on each prompt, and a Supabase Edge Function (submit-dive) rescores them with the shared dive.js and the shared data files. The function also checks: the 7 prompts match that day's seeded set, the day is still open (midnight to midnight Eastern), one submission per user or device id per day (unique index), total time used is at least MIN_PLAUSIBLE_SECONDS, and rejects anything else. Flagged-but-accepted dives (e.g. seven Hadals in under 20 seconds) are stored with a review flag and hidden from the top 100 until I approve them.
Daily bell curve (the percentile):
- One RPC returns today's depth histogram in 250 m bins plus the caller's percentile and rank, cached in the browser for 60 seconds.
- Draw it as a smooth density curve on the result screen: x-axis 0 to 10,935 m with the five zones shaded underneath, a vertical marker at the player's depth, caption "Top 18% of 1,284 divers today · median 2,900 m". Anonymous dives count in the curve, so it is meaningful before many people sign in.
- Below MIN_CURVE_DIVES (constant, start at 30) show "The curve appears after 30 dives today" with just the player's depth and the count so far. The percentile shown during the day is provisional; the final one is frozen when the day closes.
Leaderboard page, four tabs:
- Today — top 100 by depth, tiebreak by less total time used. Your own row is pinned at the bottom with your rank even if you are outside the 100.
- This Tide — the current season ranking by rating (below). Shows league badge, rating, dives this Tide.
- All Time — most total meters dived (volume), and a Hall of Fame listing each past Tide's top 10.
- Friends — follow handles; the same three boards filtered to the people you follow plus you.
Rating system (skill, not grind):
- Each closed day gives every ranked diver Daily Rank Points = their final percentile that day × 100, so the day's best diver earns 100.
- Rating = mean of the player's best RATING_BEST_OF (20) daily rank points from the last RATING_WINDOW_DAYS (30). Missing a day never costs points; it just gives fewer scores to choose from. Players need MIN_RANKED_DAYS (5) scored days before they appear, and the stats modal shows "N more daily dives until you are ranked".
- Leagues by rating, named after the zones: Sunlight under 40, Twilight 40–59, Midnight 60–74, Abyss 75–89, Hadal 90 and above. League badge next to the handle everywhere.
- World #1 is the highest rating; tiebreak by mean depth over the same best-of set. Show "World #1 · [handle]" on the Leaderboard page header.
- A Tide is one calendar month in Eastern time. At the end of a Tide the top 10 are written to the Hall of Fame and ratings start a fresh window; all-time meters never reset.
- A nightly scheduled job (pg_cron at 00:05 Eastern) freezes the closed day's percentiles, writes daily rank points, recomputes ratings and leagues, and at month end snapshots the Hall of Fame. Everything it computes goes into tables the client only reads.
Privacy and integrity: only handle, chosen flag, depth, rating and league are ever public. "Hide me from leaderboards" removes the player from every board while keeping their dives in the curve. Archive dives, Free Dives, packs and challenges never submit. Leaderboards are never paid or ad-gated. With LEADERBOARD_ENABLED off the page explains that rankings go live when FATHOM is online; with MOCK_ONLINE_DATA on it shows demo boards and a demo curve with a visible "demo" badge.