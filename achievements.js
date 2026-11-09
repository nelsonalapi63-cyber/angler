/* ANGLER — achievements: badges earned by dives, streaks and the logbook. Stored locally ({ badgeId: dayKey })
 * and synced with the player's progress when signed in. */
(function (root) {
  'use strict';

  const F = () => root.Fathom;
  const STORAGE_KEY = 'badges';
  const TOAST_MS = 2600;

  // Each badge: id, emoji, name, blurb, and a test on (record, ctx). ctx carries streak, logbook size, daily count.
  const BADGES = [
    { id: 'first-dive', emoji: '🫧', name: 'First splash', blurb: 'Finish your first dive.', test: () => true },
    { id: 'daily-first', emoji: '📅', name: 'Daily diver', blurb: 'Finish a Daily Dive.', test: (r) => r.mode === 'daily' },
    { id: 'twilight', emoji: '🌘', name: 'Into the Twilight', blurb: 'Pass 200 m in one dive.', test: (r) => r.depth >= 200 },
    { id: 'midnight', emoji: '🌑', name: 'Lights out', blurb: 'Pass 1,000 m in one dive.', test: (r) => r.depth >= 1000 },
    { id: 'titanic', emoji: '🚢', name: 'Past the Titanic', blurb: 'Pass 3,800 m in one dive.', test: (r) => r.depth >= 3800 },
    { id: 'abyss', emoji: '🕳️', name: 'Abyssal', blurb: 'Pass 4,000 m in one dive.', test: (r) => r.depth >= 4000 },
    { id: 'hadal-zone', emoji: '⚓', name: 'Hadal', blurb: 'Pass 6,000 m in one dive.', test: (r) => r.depth >= 6000 },
    { id: 'deepest-fish', emoji: '🐟', name: 'Deeper than any fish', blurb: 'Pass 8,336 m, the deepest a fish has been filmed.', test: (r) => r.depth >= 8336 },
    { id: 'challenger', emoji: '🏆', name: 'Challenger Deep', blurb: 'A perfect dive: 10,935 m.', test: (r) => r.depth >= 10935 },
    { id: 'first-hadal', emoji: '🔱', name: 'Trident', blurb: 'Give a Hadal answer.', test: (r) => r.tiers.includes('hadal') },
    { id: 'hadal-three', emoji: '🔱', name: 'Three tridents', blurb: 'Three Hadal answers in one dive.', test: (r) => r.tiers.filter(t => t === 'hadal').length >= 3 },
    { id: 'no-miss', emoji: '🧹', name: 'Clean sweep', blurb: 'A dive with no misses.', test: (r) => r.tiers.length >= 7 && r.tiers.every(Boolean) },
    { id: 'full-spectrum', emoji: '🌈', name: 'Full spectrum', blurb: 'Every tier, Tide Pool to Hadal, in one dive.', test: (r) => ['tidepool', 'baitball', 'reef', 'twilight', 'midnight', 'hadal'].every(t => r.tiers.includes(t)) },
    { id: 'quick', emoji: '⚡', name: 'Quick draw', blurb: 'A timed seven-prompt dive in under 60 seconds.', test: (r) => r.timerOn && r.tiers.length >= 7 && r.secondsUsed < 60 && r.depth > 0 },
    { id: 'second-wind', emoji: '🌬️', name: 'Second wind', blurb: 'Land an answer after two rejected guesses.', test: (r) => r.results.some(x => x.entityId && (x.attempts || 1) >= 3) },
    { id: 'unaided', emoji: '🧭', name: 'Unaided', blurb: 'A Daily Dive past 2,000 m with no hints.', test: (r) => r.mode === 'daily' && r.depth >= 2000 && !(r.hints > 0) },
    { id: 'streak-3', emoji: '🔥', name: 'Three in a row', blurb: 'A 3-day daily streak.', test: (r, c) => c.streak >= 3 },
    { id: 'streak-7', emoji: '🌊', name: 'Tide keeper', blurb: 'A 7-day daily streak.', test: (r, c) => c.streak >= 7 },
    { id: 'streak-30', emoji: '🌕', name: 'Moon cycle', blurb: 'A 30-day daily streak.', test: (r, c) => c.streak >= 30 },
    { id: 'logbook-50', emoji: '📓', name: 'Field notes', blurb: '50 entries in the logbook.', test: (r, c) => c.logged >= 50 },
    { id: 'logbook-250', emoji: '🔬', name: 'Naturalist', blurb: '250 entries in the logbook.', test: (r, c) => c.logged >= 250 },
    { id: 'duel', emoji: '⚔️', name: 'Duel', blurb: 'Beat a friend’s depth in a challenge.', test: (r) => r.mode === 'challenge' && r.challenge && r.challenge.depth && r.depth > r.challenge.depth },
    { id: 'specialist', emoji: '🪸', name: 'Specialist', blurb: 'Finish a themed pack.', test: (r) => r.mode === 'pack' },
  ];
  const BY_ID = Object.fromEntries(BADGES.map(b => [b.id, b]));

  function unlocked() { return F().storage.get(STORAGE_KEY, {}); }
  function context() {
    const { storage, dive } = F();
    const today = F().todayKey();
    return {
      streak: storage.streak(today, dive.keyPlusDays).current,
      logged: Object.keys(storage.logbook()).length,
    };
  }
  // Called once per finished dive (never for the tutorial). Returns the badges unlocked by this dive, newest first.
  function afterDive(record) {
    const { storage, toast } = F();
    const have = unlocked();
    const ctx = context();
    const fresh = [];
    for (const b of BADGES) {
      if (have[b.id]) continue;
      let ok = false;
      try { ok = !!b.test(record, ctx); } catch (e) { ok = false; }
      if (ok) { have[b.id] = F().todayKey(); fresh.push(b); }
    }
    if (fresh.length) {
      storage.set(STORAGE_KEY, have);
      // one toast, however many badges: the result screen lists them all in the "New badges" card
      setTimeout(() => toast(fresh.length === 1 ? fresh[0].emoji + ' Badge unlocked: ' + fresh[0].name : fresh.map(b => b.emoji).join(' ') + ' ' + fresh.length + ' new badges — see below', TOAST_MS), 400);
      if (root.FathomOnline && root.FathomOnline.trackEvent) root.FathomOnline.trackEvent('badge_unlocked', { ids: fresh.map(b => b.id).join(',') });
      if (root.FathomOnline && root.FathomOnline.syncProgressUp) root.FathomOnline.syncProgressUp();
    }
    return fresh;
  }
  function unlockedCard(list) {
    const { el, esc } = F();
    return el('div', { class: 'card badge-card' }, [
      el('h2', { class: 'card-title', text: list.length === 1 ? 'New badge' : 'New badges' }),
      el('div', { class: 'badge-row' }, list.map(b => el('div', { class: 'badge-item on' }, [el('span', { class: 'badge-emoji', text: b.emoji }), el('div', {}, [el('b', { text: b.name }), el('div', { class: 'small muted', text: b.blurb })])]))),
      el('p', { class: 'small muted', style: 'margin:10px 0 0', html: 'All your badges live in <a href="#logbook-badges">the logbook</a>.' }),
    ]);
  }
  // The badge wall: every badge, lit when earned (with the day), dimmed with its blurb when not.
  function wall(opts) {
    const { el, esc } = F();
    const have = unlocked();
    const compact = opts && opts.compact;
    const grid = el('div', { class: 'badge-wall' + (compact ? ' compact' : ''), role: 'list', 'aria-label': 'Badges' });
    for (const b of BADGES) {
      const on = !!have[b.id];
      grid.append(el('div', { class: 'badge-item' + (on ? ' on' : ''), role: 'listitem', title: b.name + ' — ' + b.blurb }, [
        el('span', { class: 'badge-emoji', 'aria-hidden': 'true', text: on ? b.emoji : '🔒' }),
        el('div', { class: 'badge-text' }, [
          el('b', { text: b.name }),
          el('div', { class: 'tiny muted', text: on ? 'Earned ' + root.FathomPages.niceDate(have[b.id]) : b.blurb }),
        ]),
      ]));
    }
    const n = Object.keys(have).filter(id => BY_ID[id]).length;
    return el('div', {}, [el('p', { class: 'small muted', html: '<b>' + n + ' of ' + BADGES.length + '</b> badges earned' }), grid]);
  }
  function count() { return Object.keys(unlocked()).filter(id => BY_ID[id]).length; }

  root.FathomAchievements = { BADGES, afterDive, unlockedCard, wall, unlocked, count, STORAGE_KEY };
})(window);
