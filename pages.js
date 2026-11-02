/* FATHOM — pages and modals that are not the dive itself. */
(function (root) {
  'use strict';

  const LOGBOOK_TABS = [
    { kind: 'creature', label: 'Creatures' },
    { kind: 'plant', label: 'Plants' },
    { kind: 'place', label: 'Places' },
    { kind: 'person', label: 'People' },
    { kind: 'vessel', label: 'Vessels' },
  ];
  const DATE_FMT = { weekday: 'short', day: 'numeric', month: 'short' };

  const F = () => root.Fathom;

  function niceDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, DATE_FMT));
  }
  function message(title, text) {
    const { el, render } = F();
    render(el('div', { class: 'card strong' }, [el('h2', { text: title }), el('p', { text: text }), el('a', { class: 'btn', href: '#home', text: 'Home' })]));
  }
  function notFound() { message('Nothing down here', 'That page does not exist. Surface and try the menu.'); }

  // ---------------------------------------------------------------- home
  function home() {
    const { el, dive, storage, render, esc } = F();
    const today = F().todayKey();
    const number = dive.puzzleNumber(today);
    const played = storage.getDailyResult(today);
    const streak = storage.streak(today, dive.keyPlusDays);
    const nodes = [];
    const daily = el('div', { class: 'card strong' });
    daily.append(el('div', { class: 'tiny muted', text: 'Daily Dive · ' + niceDate(today) }));
    daily.append(el('h1', { text: 'FATHOM #' + number }));
    if (played) {
      daily.append(el('p', { html: 'You reached <b>' + esc(dive.formatMeters(played.depth)) + ' m</b> today — ' + esc(dive.zoneFor(played.depth).name.toLowerCase()) + '.' }));
      daily.append(el('div', { class: 'grid-emoji', text: dive.tiersToEmoji(played.tiers) }));
      daily.append(el('div', { class: 'row', style: 'margin-top:12px' }, [el('a', { class: 'btn btn-primary', href: '#daily', text: 'See your dive' }), el('a', { class: 'btn', href: '#free', text: 'Free Dive' })]));
    } else {
      daily.append(el('p', { text: 'Seven ocean prompts, 25 seconds each. The rarer your answer, the deeper you sink. Same seven for everyone today.' }));
      daily.append(el('div', { class: 'row' }, [el('a', { class: 'btn btn-primary', href: '#daily', text: number > 0 ? 'Start today’s dive' : 'Practice dive' }), el('a', { class: 'btn', href: '#free', text: 'Free Dive' })]));
    }
    if (streak.current > 1) daily.append(el('p', { class: 'small muted', style: 'margin:12px 0 0', text: streak.current + '-day streak' }));
    nodes.push(daily);

    const lb = storage.logbook();
    const items = [
      ['#packs', '🪸', 'Themed Packs', 'Sharks, Deep Sea, Reef Life and more'],
      ['#archive', '🗓', 'Archive', 'Replay past daily dives'],
      ['#leaderboard', '🏆', 'Leaderboard', 'Today, this Tide, all time'],
      ['#logbook', '📓', 'Logbook', Object.keys(lb).length + ' logged so far'],
    ];
    nodes.push(el('div', { class: 'card' }, el('ul', { class: 'list' }, items.map(([href, icon, name, sub]) => el('li', {}, [
      el('span', { text: icon, 'aria-hidden': 'true', style: 'font-size:1.3rem' }),
      el('a', { class: 'grow', href, html: '<b>' + esc(name) + '</b><br><span class="small muted">' + esc(sub) + '</span>' }),
    ])))));
    if (root.FathomMonetise) { const ad = root.FathomMonetise.adSlot('home'); if (ad) nodes.push(ad); }
    render(nodes);
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
      nodes.push(el('div', { class: 'card' }, el('p', { text: 'The archive fills up from tomorrow. Today’s dive is on the home page.' })));
      return render(nodes);
    }
    const live = storage.allDailyResults();
    const arch = storage.get('archive', {});
    const list = el('ul', { class: 'list' });
    for (const k of keys) {
      const rec = live[k] || arch[k];
      const locked = M && !M.isArchiveUnlocked(k);
      const li = el('li', {}, [
        el('a', { class: 'grow', href: '#archive-' + k, html: '<b>FATHOM #' + dive.puzzleNumber(k) + '</b> <span class="muted small">' + esc(niceDate(k)) + '</span>' }),
        rec ? el('span', { class: 'small', html: '<b>' + esc(dive.formatMeters(rec.depth)) + ' m</b>' }) : el('span', { class: 'small muted', text: locked ? '' : 'Not played' }),
        locked ? el('span', { class: 'lock', text: '🔒 Archive Pass' }) : null,
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
    const { el, dive, storage, render, esc, entities, prompts, promptsById } = F();
    const lb = storage.logbook();
    const all = Object.values(entities);
    const kind = LOGBOOK_TABS.some(t => t.kind === tabKind) ? tabKind : 'creature';
    const hadalIds = new Set();
    for (const p of prompts) for (const a of p.answers) if (a.tier === 'hadal') hadalIds.add(a.entity);
    const hadalFound = Array.from(hadalIds).filter(id => lb[id] && lb[id].bestTier === 'hadal').length;

    const tabs = el('div', { class: 'tabs', role: 'tablist' }, LOGBOOK_TABS.map(t => el('button', { role: 'tab', 'aria-selected': String(t.kind === kind), onClick: () => F().navigate('#logbook-' + t.kind), text: t.label })));
    const ofKind = all.filter(e => e.kind === kind);
    const logged = ofKind.filter(e => lb[e.id]);
    const groups = Array.from(new Set(ofKind.map(e => e.group))).sort();
    const filter = el('select', { 'aria-label': 'Filter by group' }, [el('option', { value: '', text: 'All groups' })].concat(groups.map(g => el('option', { value: g, text: g }))));
    const listWrap = el('div');
    function drawList() {
      const g = filter.value;
      const rows = logged.filter(e => !g || e.group === g).sort((a, b) => a.name.localeCompare(b.name));
      listWrap.innerHTML = '';
      if (!rows.length) {
        listWrap.append(el('p', { class: 'muted', text: logged.length ? 'Nothing logged in that group yet.' : 'Nothing logged here yet. Every accepted answer you give, in any mode, gets written into this book.' }));
        return;
      }
      const ul = el('ul', { class: 'list' });
      for (const e of rows) {
        const entry = lb[e.id];
        const tier = dive.TIER_BY_CODE[entry.bestTier];
        const seen = (entry.prompts || []).map(id => promptsById[id]).filter(Boolean);
        ul.append(el('li', { style: 'display:block' }, el('details', {}, [
          el('summary', { style: 'display:flex;align-items:center;gap:10px;list-style:none;color:inherit' }, [
            el('span', { class: 'grow', html: '<b>' + esc(e.name) + '</b>' + (entry.bestTier === 'hadal' ? ' <span class="tier tier-hadal" title="Hadal answer">🔱</span>' : '') + '<br><span class="small muted">' + esc(e.group) + ' · first logged ' + esc(niceDate(entry.firstLogged)) + '</span>' }),
            tier ? el('span', { class: 'chip tier-' + tier.code, style: '--c: var(--tier-' + tier.code + ')', text: tier.emoji + ' ' + tier.name }) : null,
          ]),
          el('p', { class: 'fact', text: e.fact }),
          seen.length ? el('p', { class: 'small muted', html: 'Appeared in: ' + seen.map(p => esc(p.text)).join(' · ') }) : null,
        ])));
      }
      listWrap.append(ul);
    }
    filter.addEventListener('change', drawList);
    drawList();
    render([
      el('div', { class: 'card strong' }, [
        el('h1', { text: 'Logbook' }),
        el('p', { class: 'small muted', text: 'A field guide you fill in. Every creature, place, person or vessel you answer correctly is logged with its fact and the best tier it ever earned.' }),
        el('div', { class: 'row between' }, [
          el('div', { html: '<b>' + logged.length + ' of ' + ofKind.length + '</b> <span class="muted small">' + esc(LOGBOOK_TABS.find(t => t.kind === kind).label.toLowerCase()) + ' logged</span>' }),
          el('div', { html: '<span class="tier tier-hadal">🔱 Hadal hunt</span> <b>' + hadalFound + ' of ' + hadalIds.size + '</b>' }),
        ]),
      ]),
      el('div', { class: 'card' }, [tabs, el('div', { class: 'row', style: 'margin-bottom:10px' }, filter), listWrap]),
    ]);
    if (root.FathomOnline && root.FathomOnline.trackEvent) root.FathomOnline.trackEvent('logbook_opened', {});
  }

  // ---------------------------------------------------------------- leaderboard (content from online.js)
  function leaderboard(tab) {
    const { el, render } = F();
    const O = root.FathomOnline;
    const body = O && O.leaderboardPage ? O.leaderboardPage(tab) : el('p', { text: 'Leaderboards go live when FATHOM is online.' });
    render([el('div', { class: 'card strong' }, [el('h1', { text: 'Leaderboard' }), el('p', { class: 'small muted', text: 'Only daily dives count. Free dives, packs, archive dives and challenges never submit a score.' })]), body]);
    if (O && O.trackEvent) O.trackEvent('leaderboard_opened', { tab: tab || 'today' });
  }

  // ---------------------------------------------------------------- FAQ
  function faq() {
    const { el, render, config, dive, esc } = F();
    const tierRows = dive.TIERS.map(t => '<tr><td><span class="tier tier-' + t.code + '">' + t.emoji + ' ' + esc(t.name) + '</span><br><span class="small muted">' + esc(t.blurb) + '</span></td><td>' + t.points + '</td></tr>').join('');
    render(el('div', { class: 'card strong prose' }, [
      el('h1', { text: 'FAQ' }),
      el('h2', { text: 'What is FATHOM?' }),
      el('p', { text: 'A free daily trivia game about fish and the ocean. Seven open prompts, 25 seconds each, one typed answer per prompt. Every accepted answer belongs to a rarity tier; the rarer your answer, the more points you earn and the deeper you sink. A perfect dive of seven Hadal answers lands at 10,935 metres, the bottom of Challenger Deep.' }),
      el('h2', { text: 'How are the tiers set?' }),
      el('p', { text: 'Each prompt has a hand-curated list of accepted answers. We tier them by how likely an average person is to say them, from Tide Pool (the first thing anyone says) to Hadal (the single most satisfying answer for that prompt). Tiers start as our best judgement; the "Report an answer or tier" link on every result helps us fix them.' }),
      el('div', { html: '<table class="tier-table">' + tierRows + '</table>' }),
      el('h2', { text: 'How are the prompts built?' }),
      el('p', { text: 'Every prompt is an ocean fact disguised as a category — you only score if you know the fact. Answer lists come from reference works on fish, marine mammals, invertebrates and ocean geography, and every entry carries one fact we are confident is true. Spelling is forgiving: a letter or two off still counts, group names like "hammerhead" count, and plurals count.' }),
      el('h2', { text: 'How do rankings work?' }),
      el('p', { text: 'Only the Daily Dive counts. When the online features are switched on, your dive is re-scored on our server, placed on the day’s bell curve, and turned into a percentile. Each closed day gives you Daily Rank Points equal to your percentile; your rating is the average of your best 20 days in the last 30, and your league (Sunlight to Hadal) follows your rating. A Tide is one calendar month; the top 10 of each Tide go into the Hall of Fame.' }),
      el('h2', { text: 'Privacy' }),
      el('p', { text: 'Free play stays in your browser: your results, streaks, logbook and settings live in local storage on your device, and nothing is sent anywhere. If you sign in, your handle, scores, rating and league are shown on public leaderboards and your progress syncs between devices. You can hide yourself from leaderboards or delete your account and data from Settings.' }),
      el('h2', { text: 'Suggest a prompt' }),
      el('p', { html: 'Have a prompt with at least 25 good answers? Email <a href="mailto:' + esc(config.FEEDBACK_EMAIL) + '?subject=' + encodeURIComponent('FATHOM prompt idea') + '">' + esc(config.FEEDBACK_EMAIL) + '</a>.' }),
      el('h2', { id: 'contact', text: 'Contact' }),
      el('p', { html: 'Anything else: <a href="mailto:' + esc(config.FEEDBACK_EMAIL) + '">' + esc(config.FEEDBACK_EMAIL) + '</a>. Legal pages: <a href="privacy.html">Privacy</a>, <a href="terms.html">Terms</a>, <a href="refunds.html">Refunds</a>.' }),
    ]));
  }

  // ---------------------------------------------------------------- modals
  function howToModal() {
    const { el, modal, dive, esc } = F();
    const tierRows = dive.TIERS.map(t => '<tr><td><span class="tier tier-' + t.code + '">' + t.emoji + ' ' + esc(t.name) + '</span> <span class="small muted">' + esc(t.blurb) + '</span></td><td>' + t.points + '</td></tr>').join('') + '<tr><td>⬛ Miss <span class="small muted">no answer, or not accepted</span></td><td>0</td></tr>';
    modal({ title: 'How to play', body:
      '<p>Seven ocean prompts. 25 seconds each. Type <b>one</b> answer and press Enter.</p>' +
      '<p>Every accepted answer has a rarity tier. <b>The rarer your answer, the deeper you dive.</b> Skip the first thing that comes to mind.</p>' +
      '<table class="tier-table">' + tierRows + '</table>' +
      '<p class="small" style="margin-top:12px"><b>Example.</b> "Name a shark species." <i>Great white</i> is Tide Pool (10). <i>Goblin shark</i> is the pick every trivia fan reaches for — Bait Ball (15). <i>Porbeagle</i> is Twilight (60). The one Hadal answer might be a shark almost nobody has heard of.</p>' +
      '<p class="small muted">Points become depth: a perfect 700-point dive reaches 10,935 m, the bottom of Challenger Deep. A new dive opens every day at midnight Eastern.</p>' +
      '<button class="btn btn-primary btn-block" type="button" id="howto-go">Got it</button>' });
    const btn = document.getElementById('howto-go');
    if (btn) btn.addEventListener('click', F().closeModal);
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
      el('h3', { style: 'margin-top:16px', text: 'Rating' }),
      el('p', { class: 'small', html: rank ? rank : 'Rankings go live when FATHOM is online. Your daily dives are saved on this device meanwhile.' }),
      todayRec ? el('p', { class: 'small muted', html: 'Next dive in <b id="countdown">--:--:--</b>' }) : null,
    ]);
    modal({ title: 'My Fathom', body });
    if (todayRec) {
      const tick = () => { const n = document.getElementById('countdown'); if (!n) return clearInterval(iv); const ms = dive.msUntilNextDay(new Date()); n.textContent = [3600000, 60000, 1000].map((d, i) => String(Math.floor((i === 0 ? ms : ms % (i === 1 ? 3600000 : 60000)) / d)).padStart(2, '0')).join(':'); };
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
      toggle('Sound', 'sound', 'Short blips on reveals'),
      toggle('Timer in Free Dive', 'freeTimer', 'The Daily Dive is always timed'),
    ]);
    const O = root.FathomOnline;
    if (O && O.settingsSection) body.append(O.settingsSection());
    body.append(el('p', { class: 'small muted', style: 'margin-top:14px', text: 'Tip: add FATHOM to your home screen from your browser’s share or menu button — it works offline.' }));
    body.append(el('div', { class: 'switch' }, [el('div', { html: '<b>Reset local data</b><br><span class="small muted">Clears results, logbook and settings on this device</span>' }), el('button', { class: 'btn btn-sm', type: 'button', text: 'Reset', onClick: async () => { if (await F().confirmDialog('Clear everything FATHOM has saved on this device?', 'Clear it')) { storage.clearAll(); applySettings(); toast('Local data cleared'); F().navigate('#home'); } } })]));
    modal({ title: 'Settings', body });
  }

  root.FathomPages = { home, archive, packs, logbook, leaderboard, faq, notFound, message, howToModal, statsModal, settingsModal, niceDate, LOGBOOK_TABS };
})(window);
