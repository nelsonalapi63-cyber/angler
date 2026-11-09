/* ANGLER — pages and modals that are not the dive itself. */
(function (root) {
  'use strict';

  const LOGBOOK_TABS = [
    { kind: 'creature', label: 'Creatures' },
    { kind: 'plant', label: 'Plants' },
    { kind: 'place', label: 'Places' },
    { kind: 'person', label: 'People' },
    { kind: 'vessel', label: 'Vessels' },
    { kind: 'other', label: 'Other' },
    { kind: 'badges', label: 'Badges' },
  ];
  const DATE_FMT = { weekday: 'short', day: 'numeric', month: 'short' };
  const HOME_TILES = [
    ['#free', '🌊', 'Free Dive', 'Random seven, any time'],
    ['#packs', '🪸', 'Themed Packs', 'Sharks, Deep Sea, Reef Life…'],
    ['#archive', '🗓', 'Archive', 'Replay past daily dives'],
    ['#leaderboard', '🏆', 'Leaderboard', 'Today, this Tide, all time'],
    ['#logbook', '📓', 'Logbook', ''],
    ['#tutorial', '🎓', 'Tutorial', 'One minute, no timer'],
  ];
  const HOW_IT_WORKS = [
    ['1', 'Answer', 'Seven prompts, 25 seconds each. Type one answer; a wrong guess lets you try again.'],
    ['2', 'Sink', 'Every accepted answer has a rarity tier. The rarer it is, the further you sink.'],
    ['3', 'Compare', 'See where you landed on today’s bell curve, climb the leaderboard, share your dive.'],
  ];

  const F = () => root.Fathom;
  let homeTimer = null;

  function niceDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, DATE_FMT));
  }
  function message(title, text) {
    const { el, render } = F();
    render(el('div', { class: 'card strong' }, [el('h2', { text: title }), el('p', { text: text }), el('a', { class: 'btn', href: '#home', text: 'Home' })]));
  }
  function notFound() {
    const { el, render } = F();
    render(el('div', { class: 'card strong' }, [emptyState('Nothing down here', 'That page does not exist. Surface and try the menu.'), el('div', { class: 'row center', style: 'justify-content:center' }, [el('a', { class: 'btn btn-primary', href: '#home', text: 'Home' })])]));
  }
  // An empty state with the mascot: title, one line of direction, optional action node.
  function emptyState(title, text, action) {
    const { el } = F();
    return el('div', { class: 'empty' }, [el('div', { html: F().mascotSvg(96, { glow: 0.4 }) }), el('b', { text: title }), el('p', { class: 'small muted', style: 'margin:0 auto;max-width:36ch', text }), action || null]);
  }
  function hms(ms) { return [3600000, 60000, 1000].map((d, i) => String(Math.floor((i === 0 ? ms : ms % (i === 1 ? 3600000 : 60000)) / d)).padStart(2, '0')).join(':'); }
  // keeps a countdown node ticking until it leaves the document
  function liveCountdown(node) {
    const { dive } = F();
    if (homeTimer) clearInterval(homeTimer);
    const tick = () => { if (!document.contains(node)) { clearInterval(homeTimer); homeTimer = null; return; } node.textContent = hms(dive.msUntilNextDay(new Date())); };
    tick();
    homeTimer = setInterval(tick, 1000);
  }
  function tierLegend() {
    const { el, dive } = F();
    return el('div', { class: 'tier-legend', 'aria-label': 'Tiers' }, dive.TIERS.map(t => el('span', { class: 'chip tier-' + t.code, style: '--c: var(--tier-' + t.code + ')', text: t.emoji + ' ' + t.name + ' ' + t.points })));
  }
  function heroSvg() {
    // the surface: light rays fanning down, three wave bands, a few bubbles — all original, all vector
    return '<svg viewBox="0 0 600 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
      '<defs><linearGradient id="ray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EAF4F7" stop-opacity=".28"/><stop offset="1" stop-color="#EAF4F7" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="deep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0F4C5C" stop-opacity="0"/><stop offset="1" stop-color="#071D33" stop-opacity=".9"/></linearGradient></defs>' +
      '<g fill="url(#ray)"><polygon points="60,40 110,40 190,240 20,240"/><polygon points="210,40 250,40 330,240 200,240"/><polygon points="360,40 410,40 520,240 380,240"/><polygon points="470,40 500,40 600,210 600,240 560,240"/></g>' +
      '<path class="wave w1" d="M-40 46 Q 20 26 80 46 T 200 46 T 320 46 T 440 46 T 560 46 T 680 46 V 0 H -40 Z" fill="#0C2A3A" opacity=".9"/>' +
      '<path class="wave w2" d="M-60 54 Q 0 36 60 54 T 180 54 T 300 54 T 420 54 T 540 54 T 660 54" fill="none" stroke="#2BD1C6" stroke-width="3" stroke-linecap="round" opacity=".9"/>' +
      '<path class="wave w3" d="M-60 68 Q 0 52 60 68 T 180 68 T 300 68 T 420 68 T 540 68 T 660 68" fill="none" stroke="#86D9EC" stroke-width="2" stroke-linecap="round" opacity=".45"/>' +
      '<g fill="none" stroke="#EAF4F7" stroke-opacity=".35" stroke-width="1.5"><circle cx="120" cy="190" r="5"/><circle cx="135" cy="166" r="3"/><circle cx="455" cy="200" r="6"/><circle cx="470" cy="175" r="3.5"/></g>' +
      '<rect x="0" y="120" width="600" height="120" fill="url(#deep)"/></svg>';
  }

  // ---------------------------------------------------------------- home
  function home() {
    const { el, dive, storage, render, esc } = F();
    const today = F().todayKey();
    const number = dive.puzzleNumber(today);
    const played = storage.getDailyResult(today);
    const streak = storage.streak(today, dive.keyPlusDays);
    const progress = storage.get('progress', null);
    const inProgress = !played && progress && progress.mode === 'daily' && progress.dayKey === today;
    const nodes = [];

    const body = el('div', { class: 'hero-body' }, [
      el('div', { class: 'hero-kicker', text: 'The daily ocean dive · ' + niceDate(today) }),
      el('h1', { class: 'hero-title', text: dive.BRAND }),
      el('p', { class: 'hero-tag', text: dive.TAGLINE }),
    ]);
    let countdownNode = null;
    if (played) {
      body.append(el('div', { class: 'hero-result' }, [
        el('div', { html: 'Today you reached <b>' + esc(dive.formatMeters(played.depth)) + ' m</b> — ' + esc(dive.zoneFor(played.depth).name.toLowerCase()) + '.' }),
        el('div', { class: 'grid-emoji', text: dive.tiersToEmoji(played.tiers) }),
      ]));
      countdownNode = el('b', { id: 'home-countdown', text: '--:--:--' });
      body.append(el('div', { class: 'hero-cta' }, [
        el('a', { class: 'btn btn-primary btn-big', href: '#daily', text: 'See your dive' }),
        el('a', { class: 'btn btn-big', href: '#free', text: 'Free Dive' }),
      ]));
      body.append(el('p', { class: 'hero-sub' }, [dive.BRAND + ' #' + (number + 1) + ' opens in ', countdownNode]));
    } else {
      body.append(el('div', { class: 'hero-cta' }, [
        el('a', { class: 'btn btn-primary btn-big', href: '#daily', html: (inProgress ? 'Resume ' : 'Play ') + dive.BRAND + ' #' + number }),
      ]));
      body.append(el('p', { class: 'hero-sub', text: 'Same seven prompts for everyone today · 25 seconds each · free' }));
    }
    if (streak.current > 1) body.append(el('p', { class: 'hero-streak', text: '🔥 ' + streak.current + '-day streak' }));
    nodes.push(el('section', { class: 'hero card strong' }, [el('div', { class: 'hero-art', html: heroSvg() + F().mascotSvg(128, { class: 'hero-mascot', face: 'right' }) }), body]));

    const lb = Object.keys(storage.logbook()).length;
    const badges = root.FathomAchievements ? root.FathomAchievements.count() : 0;
    const tiles = HOME_TILES.map(([href, icon, name, sub]) => {
      const s = href === '#logbook' ? (lb.toLocaleString('en-US') + ' logged · ' + badges + (badges === 1 ? ' badge' : ' badges')) : sub;
      return el('a', { class: 'tile-link', href }, [el('span', { class: 'tl-icon', 'aria-hidden': 'true', text: icon }), el('span', { class: 'tl-name', text: name }), el('span', { class: 'tl-sub', text: s })]);
    });
    nodes.push(el('nav', { class: 'tile-grid', 'aria-label': 'Ways to play' }, tiles));

    nodes.push(el('section', { class: 'card how' }, [
      el('h2', { text: 'How it works' }),
      el('ol', { class: 'how-steps' }, HOW_IT_WORKS.map(([n, title, text]) => el('li', {}, [el('span', { class: 'how-n', 'aria-hidden': 'true', text: n }), el('div', {}, [el('b', { text: title }), el('div', { class: 'small muted', text })])]))),
      tierLegend(),
      el('p', { class: 'small muted', style: 'margin:12px 0 0', text: 'Points become metres: a perfect 700-point dive reaches 10,935 m, the bottom of Challenger Deep. A new dive opens every day at midnight Eastern.' }),
    ]));
    if (root.FathomMonetise) { const ad = root.FathomMonetise.adSlot('home'); if (ad) nodes.push(ad); }
    render(nodes);
    if (countdownNode) liveCountdown(countdownNode);
  }

  // ---------------------------------------------------------------- archive
  function archive() {
    const { el, dive, storage, render, esc } = F();
    const today = F().todayKey();
    const M = root.FathomMonetise;
    const nodes = [el('div', { class: 'card strong' }, [el('h1', { text: 'Archive' }), el('p', { class: 'small muted', text: 'Every past daily dive, by date. Archive dives do not count for streaks or rankings.' })])];
    const keys = [];
    for (let k = dive.keyPlusDays(today, -1); k >= dive.LAUNCH_DATE; k = dive.keyPlusDays(k, -1)) keys.push(k);
    if (!keys.length) {
      nodes.push(el('div', { class: 'card' }, emptyState('The archive opens tomorrow', 'Every past daily dive lands here the day after. Today’s dive is on the home page.', el('a', { class: 'btn btn-primary', href: '#daily', text: 'Play today’s dive' }))));
      return render(nodes);
    }
    const live = storage.allDailyResults();
    const arch = storage.get('archive', {});
    const list = el('ul', { class: 'list' });
    for (const k of keys) {
      const rec = live[k] || arch[k];
      const locked = M && !M.isArchiveUnlocked(k);
      const li = el('li', {}, [
        el('a', { class: 'grow', href: '#archive-' + k, html: '<b>' + dive.BRAND + ' #' + dive.puzzleNumber(k) + '</b> <span class="muted small">' + esc(niceDate(k)) + '</span>' }),
        rec ? el('span', { class: 'small', html: '<b>' + esc(dive.formatMeters(rec.depth)) + ' m</b>' }) : el('span', { class: 'small muted', text: locked ? '' : 'Not played' }),
        locked ? el('span', { class: 'lock', text: '🔒 Archive Pass ' + (M ? M.priceLabel('archive') : '') }) : null,
      ]);
      list.append(li);
    }
    nodes.push(el('div', { class: 'card' }, list));
    render(nodes);
  }

  // ---------------------------------------------------------------- packs
  function packs() {
    const { el, dive, storage, render, esc, packs } = F();
    const M = root.FathomMonetise;
    const list = el('ul', { class: 'list' });
    for (const p of packs) {
      const best = storage.getBest('pack', p.id);
      const locked = M && !M.isPackUnlocked(p.id);
      list.append(el('li', {}, [
        el('span', { text: p.emoji, 'aria-hidden': 'true', style: 'font-size:1.4rem' }),
        el('a', { class: 'grow', href: '#pack-' + p.id, html: '<b>' + esc(p.name) + '</b><br><span class="small muted">' + esc(p.blurb) + '</span>' }),
        best ? el('span', { class: 'small', html: 'Best<br><b>' + esc(dive.formatMeters(best.depth)) + ' m</b>' }) : null,
        locked ? el('span', { class: 'lock', text: '🔒 ' + (M ? M.priceLabel('pack') : '') }) : null,
      ]));
    }
    render([el('div', { class: 'card strong' }, [el('h1', { text: 'Themed Packs' }), el('p', { class: 'small muted', text: 'Seven hand-picked prompts on one theme. Each pack keeps its own best depth.' })]), el('div', { class: 'card' }, list)]);
  }

  // ---------------------------------------------------------------- logbook
  function logbook(tabKind) {
    const { el, dive, storage, render, esc, entities, prompts } = F();
    const lb = storage.logbook();
    const all = Object.values(entities);
    const kind = LOGBOOK_TABS.some(t => t.kind === tabKind) ? tabKind : 'creature';
    const hadalIds = new Set();
    for (const p of prompts) for (const a of p.answers) if (a.tier === 'hadal') hadalIds.add(a.entity);
    const hadalFound = Array.from(hadalIds).filter(id => lb[id] && lb[id].bestTier === 'hadal').length;
    const tabs = el('div', { class: 'tabs', role: 'tablist' }, LOGBOOK_TABS.map(t => el('button', { role: 'tab', 'aria-selected': String(t.kind === kind), onClick: () => F().navigate('#logbook-' + t.kind), text: t.label })));
    const head = el('div', { class: 'card strong' }, [
      el('h1', { text: 'Logbook' }),
      el('p', { class: 'small muted', text: 'A field guide you fill in. Every creature, place, person or vessel you answer correctly is logged with its fact and the best tier it ever earned.' }),
    ]);
    if (kind === 'badges') {
      head.append(el('div', { class: 'row between' }, [
        el('div', { html: '<b>' + Object.keys(lb).length.toLocaleString('en-US') + '</b> <span class="muted small">entries logged</span>' }),
        el('div', { html: '<span class="tier tier-hadal">🔱 Hadal hunt</span> <b>' + hadalFound + ' of ' + hadalIds.size + '</b>' }),
      ]));
      render([head, el('div', { class: 'card' }, [tabs, root.FathomAchievements ? root.FathomAchievements.wall() : el('p', { class: 'muted', text: 'Badges are not available in this build.' })])]);
      return;
    }
    const ofKind = all.filter(e => (e.kind || 'other') === kind);
    const logged = ofKind.filter(e => lb[e.id]);
    const groups = Array.from(new Set(ofKind.map(e => e.group))).sort();
    const filter = el('select', { 'aria-label': 'Filter by group' }, [el('option', { value: '', text: 'All groups' })].concat(groups.map(g => el('option', { value: g, text: g }))));
    const listWrap = el('div');
    const art = root.FathomGame && root.FathomGame.artNode ? root.FathomGame.artNode : () => null;
    function drawList() {
      const g = filter.value;
      const rows = logged.filter(e => !g || e.group === g).sort((a, b) => a.name.localeCompare(b.name));
      listWrap.innerHTML = '';
      if (!rows.length) {
        listWrap.append(logged.length ? el('p', { class: 'muted', text: 'Nothing logged in that group yet.' }) : emptyState('Nothing logged here yet', 'Every accepted answer you give, in any mode, gets written into this book.', el('a', { class: 'btn btn-primary', href: '#free', text: 'Start a Free Dive' })));
        return;
      }
      const ul = el('ul', { class: 'list' });
      const played = storage.playedPrompts();
      for (const e of rows) {
        const entry = lb[e.id];
        const tier = dive.TIER_BY_CODE[entry.bestTier];
        const seen = prompts.filter(p => played[p.id] && p.answers.some(a => a.entity === e.id));
        ul.append(el('li', { style: 'display:block' }, el('details', {}, [
          el('summary', { style: 'display:flex;align-items:center;gap:10px;list-style:none;color:inherit' }, [
            art(e, 40),
            el('span', { class: 'grow', html: '<b>' + esc(e.name) + '</b>' + (entry.bestTier === 'hadal' ? ' <span class="tier tier-hadal" title="Hadal answer">🔱</span>' : '') + '<br><span class="small muted">' + esc(e.group) + ' · first logged ' + esc(niceDate(entry.firstLogged)) + '</span>' }),
            tier ? el('span', { class: 'chip tier-' + tier.code, style: '--c: var(--tier-' + tier.code + ')', text: tier.emoji + ' ' + tier.name }) : null,
          ]),
          e.art ? el('div', { class: 'art-wrap' }, art(e, 128)) : null,
          el('p', { class: 'fact', text: e.fact }),
          e.aliases && e.aliases.length ? el('p', { class: 'tiny muted', text: 'Also known as: ' + e.aliases.join(', ') }) : null,
          seen.length ? el('p', { class: 'small muted', html: 'Appeared in: ' + seen.map(p => esc(p.text)).join(' · ') }) : null,
        ])));
      }
      listWrap.append(ul);
    }
    filter.addEventListener('change', drawList);
    drawList();
    head.append(el('div', { class: 'row between' }, [
      el('div', { html: '<b>' + logged.length.toLocaleString('en-US') + ' of ' + ofKind.length.toLocaleString('en-US') + '</b> <span class="muted small">' + esc(LOGBOOK_TABS.find(t => t.kind === kind).label.toLowerCase()) + ' logged</span>' }),
      el('div', { html: '<span class="tier tier-hadal">🔱 Hadal hunt</span> <b>' + hadalFound + ' of ' + hadalIds.size + '</b>' }),
    ]));
    render([head, el('div', { class: 'card' }, [tabs, el('div', { class: 'row', style: 'margin-bottom:10px' }, filter), listWrap])]);
    if (root.FathomOnline && root.FathomOnline.trackEvent) root.FathomOnline.trackEvent('logbook_opened', {});
  }

  // ---------------------------------------------------------------- leaderboard (content from online.js)
  function leaderboard(tab) {
    const { el, render } = F();
    const O = root.FathomOnline;
    const body = O && O.leaderboardPage ? O.leaderboardPage(tab) : el('p', { text: 'Leaderboards go live when ' + F().dive.BRAND + ' is online.' });
    render([el('div', { class: 'card strong' }, [el('h1', { text: 'Leaderboard' }), el('p', { class: 'small muted', text: 'Only daily dives count. Free dives, packs, archive dives and challenges never submit a score.' })]), body]);
    if (O && O.trackEvent) O.trackEvent('leaderboard_opened', { tab: tab || 'today' });
  }

  // ---------------------------------------------------------------- FAQ
  function faq() {
    const { el, render, config, dive, esc } = F();
    const tierRows = dive.TIERS.map(t => '<tr><td><span class="tier tier-' + t.code + '">' + t.emoji + ' ' + esc(t.name) + '</span><br><span class="small muted">' + esc(t.blurb) + '</span></td><td>' + t.points + '</td></tr>').join('');
    render(el('div', { class: 'card strong prose' }, [
      el('h1', { text: 'FAQ' }),
      el('h2', { text: 'What is ' + dive.BRAND + '?' }),
      el('p', { text: dive.BRAND + ' is a free daily trivia game about fish and the ocean. Seven open prompts, 25 seconds each. Every accepted answer belongs to a rarity tier; the rarer your answer, the more points you earn and the deeper you sink. A perfect dive of seven Hadal answers lands at 10,935 metres, the bottom of Challenger Deep.' }),
      el('h2', { text: 'How are the tiers set?' }),
      el('p', { text: 'Each prompt has a hand-curated list of accepted answers. We tier them by how likely an average person is to say them, from Tide Pool (the first thing anyone says) to Hadal (the single most satisfying answer for that prompt). Tiers start as our best judgement; the "Report an answer or tier" link on every result helps us fix them.' }),
      el('div', { html: '<table class="tier-table">' + tierRows + '</table>' }),
      el('h2', { text: 'What if my answer is not accepted?' }),
      el('p', { text: 'A guess that is not on the list does not end the prompt: the box clears and you can try again until the timer runs out. If you were close to a real answer, up to two spelling suggestions appear above the box — tap one to use it. Scientific names count, and for species prompts any real species on our reference lists scores Midnight even when it is not on our hand-written list.' }),
      el('h2', { text: 'What is the lure?' }),
      el('p', { text: 'An anglerfish lights a lure to draw prey out of the dark. Once per prompt you can light yours: it shows the first letter and word shape of a rarer answer, for ' + dive.HINT_COST + ' points off that prompt. The lure is off in challenges, so both players face the same odds.' }),
      el('h2', { text: 'How are the prompts built?' }),
      el('p', { text: 'Every prompt is an ocean fact disguised as a category — you only score if you know the fact. Answer lists come from reference works on fish, marine mammals, invertebrates and ocean geography, and every entry carries one fact we are confident is true. Spelling is forgiving: a letter or two off still counts, group names like "hammerhead" count, and plurals count.' }),
      el('h2', { text: 'How do rankings work?' }),
      el('p', { text: 'Only the Daily Dive counts. When the online features are switched on, your dive is re-scored on our server, placed on the day’s bell curve, and turned into a percentile. Each closed day gives you Daily Rank Points equal to your percentile; your rating is the average of your best 20 days in the last 30, and your league (Sunlight to Hadal) follows your rating. A Tide is one calendar month; the top 10 of each Tide go into the Hall of Fame.' }),
      el('h2', { text: 'Privacy' }),
      el('p', { text: 'Free play stays in your browser: your results, streaks, logbook, badges and settings live in local storage on your device, and nothing is sent anywhere. If you sign in, your handle, scores, rating and league are shown on public leaderboards and your progress syncs between devices. You can hide yourself from leaderboards or delete your account and data from Settings.' }),
      el('h2', { text: 'Suggest a prompt' }),
      el('p', { html: 'Have a prompt with at least 40 good answers? Email <a href="mailto:' + esc(config.FEEDBACK_EMAIL) + '?subject=' + encodeURIComponent(dive.BRAND + ' prompt idea') + '">' + esc(config.FEEDBACK_EMAIL) + '</a>.' }),
      el('h2', { id: 'contact', text: 'Contact' }),
      el('p', { html: 'Anything else: <a href="mailto:' + esc(config.FEEDBACK_EMAIL) + '">' + esc(config.FEEDBACK_EMAIL) + '</a>. Legal pages: <a href="privacy.html">Privacy</a>, <a href="terms.html">Terms</a>, <a href="refunds.html">Refunds</a>.' }),
    ]));
  }

  // ---------------------------------------------------------------- modals
  function howToModal() {
    const { el, modal, dive, esc } = F();
    const tierRows = dive.TIERS.map(t => '<tr><td><span class="tier tier-' + t.code + '">' + t.emoji + ' ' + esc(t.name) + '</span> <span class="small muted">' + esc(t.blurb) + '</span></td><td>' + t.points + '</td></tr>').join('') + '<tr><td>⬛ Miss <span class="small muted">out of time, or skipped</span></td><td>0</td></tr>';
    modal({ title: 'How to play', body:
      '<p>Seven ocean prompts. 25 seconds each. Type an answer and press Enter — a guess that is not accepted lets you try again.</p>' +
      '<p>Every accepted answer has a rarity tier. <b>The rarer your answer, the deeper you dive.</b> Skip the first thing that comes to mind.</p>' +
      '<table class="tier-table">' + tierRows + '</table>' +
      '<p class="small" style="margin-top:12px"><b>Example.</b> "Name a shark species." <i>Great white</i> is Tide Pool (10). <i>Goblin shark</i> is the pick every trivia fan reaches for — Bait Ball (15). <i>Porbeagle</i> is Twilight (60). The one Hadal answer might be a shark almost nobody has heard of.</p>' +
      '<p class="small muted">✦ The lure lights up the first letter of a rarer answer for ' + dive.HINT_COST + ' points. Points become depth: a perfect 700-point dive reaches 10,935 m, the bottom of Challenger Deep. A new dive opens every day at midnight Eastern.</p>' +
      '<div class="row"><button class="btn btn-primary" type="button" id="howto-go">Got it</button><a class="btn" href="#tutorial" id="howto-tutorial">Play the tutorial</a></div>' });
    const btn = document.getElementById('howto-go');
    if (btn) btn.addEventListener('click', F().closeModal);
  }

  // First visit: offer the untimed tutorial before the real thing.
  function welcomeModal() {
    const { el, modal, closeModal } = F();
    const body = el('div', {}, [
      el('div', { class: 'center', html: F().mascotSvg(110, { glow: 0.6 }) }),
      el('p', { text: 'Seven ocean questions a day. Type an answer; the rarer it is, the deeper you dive. Same seven for everyone, once a day.' }),
      tierLegend(),
      el('div', { class: 'stack', style: 'margin-top:14px' }, [
        el('a', { class: 'btn btn-primary btn-block', href: '#tutorial', id: 'welcome-tutorial', text: 'Play the tutorial (1 minute, no timer)', onClick: closeModal }),
        el('button', { class: 'btn btn-block', type: 'button', id: 'welcome-skip', text: 'Skip — I know how it works', onClick: closeModal }),
      ]),
      el('p', { class: 'tiny muted', style: 'margin:12px 0 0', text: 'You can replay the tutorial any time from Settings.' }),
    ]);
    modal({ title: 'Welcome to ' + F().dive.BRAND, body });
  }

  function statsModal() {
    const { el, modal, dive, storage, charts, esc } = F();
    const today = F().todayKey();
    const all = storage.allDailyResults();
    const recs = Object.values(all);
    const played = recs.length;
    const avg = played ? Math.round(recs.reduce((n, r) => n + r.depth, 0) / played) : 0;
    const streak = storage.streak(today, dive.keyPlusDays);
    const counts = {};
    for (const r of recs) { const z = dive.zoneFor(r.depth).code; counts[z] = (counts[z] || 0) + 1; }
    const todayRec = all[today];
    const O = root.FathomOnline;
    const rank = O && O.ratingSummary ? O.ratingSummary() : null;
    const body = el('div', {}, [
      el('div', { class: 'stat-grid' }, [
        el('div', { html: '<b>' + played + '</b><span>Dives played</span>' }),
        el('div', { html: '<b>' + esc(dive.formatMeters(avg)) + '</b><span>Average depth (m)</span>' }),
        el('div', { html: '<b>' + streak.current + '</b><span>Current streak</span>' }),
        el('div', { html: '<b>' + streak.max + '</b><span>Max streak</span>' }),
      ]),
      el('h3', { text: 'Depth distribution' }),
      el('div', { html: charts.distributionBars(counts, todayRec ? dive.zoneFor(todayRec.depth).code : null) }),
      el('h3', { style: 'margin-top:16px', text: 'Badges' }),
      root.FathomAchievements ? root.FathomAchievements.wall({ compact: true }) : null,
      el('h3', { style: 'margin-top:16px', text: 'Rating' }),
      el('p', { class: 'small', html: rank ? rank : 'Rankings go live when ' + dive.BRAND + ' is online. Your daily dives are saved on this device meanwhile.' }),
      todayRec ? el('p', { class: 'small muted', html: 'Next dive in <b id="countdown-modal">--:--:--</b>' }) : null,
    ]);
    modal({ title: 'My ' + dive.BRAND, body });
    if (todayRec) {
      const tick = () => { const n = document.getElementById('countdown-modal'); if (!n) return clearInterval(iv); n.textContent = hms(dive.msUntilNextDay(new Date())); };
      const iv = setInterval(tick, 1000); tick();
    }
  }

  function settingsModal() {
    const { el, modal, storage, applySettings, toast } = F();
    const s = storage.settings();
    function toggle(label, key, hint) {
      const btn = el('button', { class: 'toggle', type: 'button', role: 'switch', 'aria-checked': String(!!s[key]), 'aria-label': label, onClick: () => {
        const cur = btn.getAttribute('aria-checked') === 'true';
        btn.setAttribute('aria-checked', String(!cur));
        storage.updateSettings({ [key]: !cur });
        applySettings();
      } });
      return el('div', { class: 'switch' }, [el('div', { html: '<b>' + label + '</b>' + (hint ? '<br><span class="small muted">' + hint + '</span>' : '') }), btn]);
    }
    const theme = el('select', { 'aria-label': 'Theme', onChange: (e) => { storage.updateSettings({ theme: e.target.value }); applySettings(); } }, [
      el('option', { value: 'dark', text: 'Dark (deep water)', selected: s.theme !== 'light' }),
      el('option', { value: 'light', text: 'Light (shallows)', selected: s.theme === 'light' }),
    ]);
    const body = el('div', {}, [
      el('div', { class: 'switch' }, [el('div', { html: '<b>Theme</b>' }), theme]),
      toggle('High contrast', 'contrast', 'Tiers are always labelled; this strengthens outlines and colours'),
      toggle('Sound and vibration', 'sound', 'Splash, descent hum, tier chimes, a buzz on phones'),
      toggle('Timer in Free Dive', 'freeTimer', 'The Daily Dive is always timed'),
      el('div', { class: 'switch' }, [el('div', { html: '<b>Tutorial</b><br><span class="small muted">Three untimed prompts; nothing is saved</span>' }), el('a', { class: 'btn btn-sm', href: '#tutorial', id: 'settings-tutorial', text: 'Replay' })]),
    ]);
    const O = root.FathomOnline;
    if (O && O.settingsSection) body.append(O.settingsSection());
    if (root.FathomMonetise && root.FathomMonetise.settingsSection) { const m = root.FathomMonetise.settingsSection(); if (m) body.append(m); }
    body.append(el('p', { class: 'small muted', style: 'margin-top:14px', text: 'Tip: add ' + F().dive.BRAND + ' to your home screen from your browser’s share or menu button — it works offline.' }));
    body.append(el('div', { class: 'switch' }, [el('div', { html: '<b>Reset local data</b><br><span class="small muted">Clears results, logbook, badges and settings on this device</span>' }), el('button', { class: 'btn btn-sm', type: 'button', text: 'Reset', onClick: async () => { if (await F().confirmDialog('Clear everything ' + F().dive.BRAND + ' has saved on this device?', 'Clear it')) { storage.clearAll(); applySettings(); toast('Local data cleared'); F().navigate('#home'); } } })]));
    modal({ title: 'Settings', body });
  }

  root.FathomPages = { home, archive, packs, logbook, leaderboard, faq, notFound, message, emptyState, howToModal, welcomeModal, statsModal, settingsModal, niceDate, tierLegend, LOGBOOK_TABS };
})(window);
