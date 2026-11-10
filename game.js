/* ANGLER — the dive itself: questions, timer, guesses, the hint, the submarine's descent, reveal, result screen. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- parameters
  const TIMER_TICK_MS = 100;
  const LOW_TIME_SECONDS = 5;          // timer ring turns red and pulses below this
  const MAX_TYPED_LENGTH = 60;         // same limit as the server
  const NEXT_GUARD_MS = 450;           // a second Enter right after a reveal must not skip it
  const STALL_MS = 2000;               // v4: a miss shows the stalled sub on the takeover for this long before its one button
  const REDUCED_BUTTON_MS = 600;       // v4: under reduced motion the takeover crossfades and the button comes after this
  const RESULT_LIST_FACT = true;       // show the fact under each question on the result screen
  const TILE_DELAY_FRACTION = 0.35;    // the tier badge appears this far into the descent…
  const TILE_DELAY_MAX_MS = 900;       // …but never later than this
  const DESCENT_LEAD_MS = 320;         // the rarity line lands first; the sub starts sinking this long after
  const REJECT_FLASH_MS = 650;         // red flash + shake on a rejected guess
  const ACCEPT_FLASH_MS = 700;         // the answer box flashes the tier colour on an accepted answer
  const RADIO_MS = 4200;               // a pilot line stays this long
  const TUTORIAL_PROMPT_IDS = ['shark-species', 'whale-species', 'tide-pool'];
  const TUTORIAL_COACH = [
    'Type the first shark you can think of, then press Dive. There is no timer in the tutorial.',
    'Rarer answers sink you deeper. Try a whale most people would not say — or use the Hint to see the shape of a rare one. You get one hint per dive.',
    'Last one. A guess that is not accepted does not end the question: you can try again until the timer runs out, and a close spelling still counts.',
  ];
  const MODE_LABELS = { daily: 'Daily Dive', free: 'Free Dive', pack: 'Themed Pack', archive: 'Archive Dive', challenge: 'Challenge', tutorial: 'Tutorial' };
  // What the pilot radios up after each answer (every line under 60 characters). Picked by question number, so a dive cycles through them.
  const RADIO = {
    start: ['Dive in. Seven questions, deeper each time.'],
    tidepool: ['Everyone knows that one. Still, down we go.', 'The first thing anyone says. A nudge deeper.', 'Safe answer, captain. Shallow water.'],
    baitball: ['The clever pick. Half the fleet said it too.', 'Trivia-night answer. A little deeper.', 'Crowded down here — everyone had that idea.'],
    reef: ['Solid. Past the obvious now.', 'That one earns its keep. Diving.', 'Good call — the reef is behind us.'],
    twilight: ['Uncommon! The light is fading up there.', 'Now we’re talking. Twilight water.', 'Few would say that. Lamp on.'],
    midnight: ['Specialist stuff. It’s pitch black out here.', 'Where did you learn that? Deep, deep water.', 'Only the real nerds know that one. Love it.'],
    hadal: ['Nobody says that. DIVING!', 'The one perfect answer. Hold on tight!', 'That’s the Hadal answer, captain. Full speed!'],
    skip: ['Nothing in the net. We hold position.', 'No answer, no descent. Next one.'],
    timeout: ['Out of time. The lamp is flickering…', 'Clock ran out. We drift here.'],
    last: ['Last one — make it count.'],
    hint: ['Hint lit: the first letter of a rarer answer.'],
    best: ['New personal best. Log it, captain!'],
  };

  const F = () => root.Fathom;
  let state = null;          // the live dive
  let countdownTimer = null;
  let resultScene = null;    // the resting sub on the result screen

  // ---------------------------------------------------------------- helpers
  // v4: a day already played keeps the answers it was played with (data/frozen.json), whatever the bank does later
  function frozenPrompt(dayKey, prompt) {
    const frozen = F().frozen;
    const day = frozen && dayKey && frozen[dayKey];
    if (!day || !prompt || !day[prompt.id]) return prompt;
    const cache = (state && state.frozenCache) || null;
    if (cache && cache[prompt.id]) return cache[prompt.id];
    const copy = Object.assign({}, prompt, { answers: day[prompt.id].map(a => ({ entity: a.entity, tier: a.tier })), _index: null, _frozen: true });
    if (cache) cache[prompt.id] = copy;
    return copy;
  }
  function promptFor(id) {
    const p = F().promptsById[id];
    return state && state.spec && state.spec.dayKey ? frozenPrompt(state.spec.dayKey, p) : p;
  }
  function promptIndex(prompt) {
    if (!prompt._index) prompt._index = F().dive.buildIndex(prompt, F().entities, F().taxa);
    return prompt._index;
  }
  function hadalEntity(prompt) {
    const a = prompt.answers.find(x => x.tier === 'hadal');
    return a ? F().entities[a.entity] : null;
  }
  function answersByTier(prompt) {
    const { dive, entities } = F();
    const groups = dive.TIERS.slice().reverse().map(t => ({ tier: t, names: [] }));
    for (const a of prompt.answers) {
      const g = groups.find(x => x.tier.code === a.tier);
      const e = entities[a.entity];
      if (g && e) g.names.push(e.name);
    }
    groups.forEach(g => g.names.sort());
    return groups.filter(g => g.names.length);
  }
  function artNode(ent, size) {
    if (!ent || !ent.art) return null;
    return F().el('img', { class: 'art', src: 'data/illustrations/' + ent.id + '.svg', alt: '', width: String(size || 96), height: String(size || 96), loading: 'lazy', decoding: 'async' });
  }
  function modeLabel(record) {
    const { packsById, dive } = F();
    if (record.mode === 'daily') return dive.BRAND + ' #' + record.number;
    if (record.mode === 'archive') return 'Archive · ' + dive.BRAND + ' #' + dive.puzzleNumber(record.dayKey);
    if (record.mode === 'pack') return record.packName || (packsById[record.packId] ? packsById[record.packId].name : 'Pack');
    if (record.mode === 'challenge') return 'Challenge';
    if (record.mode === 'tutorial') return 'Tutorial';
    return 'Free Dive';
  }
  function reportHref(prompt, result, record) {
    const { config, dive } = F();
    const subject = dive.BRAND + ' report: ' + prompt.id;
    const when = record.dayKey || (record.finishedAt ? record.finishedAt.slice(0, 10) : F().todayKey());
    const body = 'Question: ' + prompt.text + '\nQuestion id: ' + prompt.id + '\nMode: ' + record.mode + ' (' + when + ')' +
      '\nI typed: ' + (result.typed || '(nothing)') + '\nIt scored: ' + (result.tier ? dive.TIER_BY_CODE[result.tier].name : 'miss') +
      '\n\nWhat is wrong (answer missing, wrong tier, wrong fact):\n';
    if (config.REPORT_FORM_URL) {
      const sep = config.REPORT_FORM_URL.indexOf('?') > -1 ? '&' : '?';
      return config.REPORT_FORM_URL + sep + 'prompt=' + encodeURIComponent(prompt.id) + '&typed=' + encodeURIComponent(result.typed || '') + '&tier=' + encodeURIComponent(result.tier || 'miss') + '&mode=' + encodeURIComponent(record.mode) + '&date=' + encodeURIComponent(when);
    }
    return 'mailto:' + config.FEEDBACK_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }
  function clearTimers() {
    if (state) {
      if (state.timer) clearInterval(state.timer);
      if (state.revealTimer) clearTimeout(state.revealTimer);
      if (state.tileTimer) clearTimeout(state.tileTimer);
      if (state.leadTimer) clearTimeout(state.leadTimer);
      if (state.radioTimer) clearTimeout(state.radioTimer);
      if (state.takeoverTimer) clearTimeout(state.takeoverTimer);
      state.timer = state.revealTimer = state.tileTimer = state.leadTimer = state.radioTimer = state.takeoverTimer = null;
    }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }
  function leaveDive() {
    clearTimers();
    if (state && state.scene) state.scene.destroy();
    if (resultScene) { resultScene.destroy(); resultScene = null; }
    state = null;
    document.body.classList.remove('diving', 'takeover');
  }
  function track(name, props) { if (root.FathomOnline && root.FathomOnline.trackEvent) root.FathomOnline.trackEvent(name, props || {}); }
  function radioLine(kind, n) { const lines = RADIO[kind] || []; return lines.length ? lines[(n || 0) % lines.length] : ''; }

  // The boot bundle carries only today's and tomorrow's questions; anything else waits for the full bank.
  function loadThen(fn) {
    const { render, ensureBank } = F();
    render(F().skeleton('dive'));
    const hash = location.hash;
    ensureBank().then(() => { if (location.hash === hash) fn(); })
      .catch(() => root.FathomPages.message('Could not load the answer bank', 'Check your connection and try again.'));
  }

  // ---------------------------------------------------------------- starting dives
  function startDaily() {
    const { dive, storage, prompts, schedule } = F();
    const today = F().todayKey();
    const existing = storage.getDailyResult(today);
    if (existing) return resultScreen(existing, { fresh: false });
    const promptIds = dive.dailyPromptIds(today, prompts, dive.LAUNCH_DATE, schedule);
    if (!F().bankLoaded && !(schedule && schedule[today] && promptIds && F().hasPromptData(promptIds))) return loadThen(startDaily);
    if (!promptIds) return root.FathomPages.message('Not yet', dive.BRAND + ' #1 opens on ' + dive.LAUNCH_DATE + ' (Eastern time). Try a Free Dive meanwhile.');
    // A daily dive that was left half-way (refresh, back button, closed tab) resumes where it was. The question that
    // was on screen keeps its original 25-second deadline measured on the wall clock, so reloading never buys time.
    const progress = storage.get('progress', null);
    if (progress && progress.mode === 'daily' && progress.dayKey === today && progress.promptIds.join('|') === promptIds.join('|')) {
      return startDive({ mode: 'daily', promptIds, dayKey: today, number: dive.puzzleNumber(today), resume: progress });
    }
    startDive({ mode: 'daily', promptIds, dayKey: today, number: dive.puzzleNumber(today) });
  }
  function startFree(seed) {
    const { dive, prompts } = F();
    const s = seed || dive.randomSeed(6);
    if (location.hash !== '#free-' + s) { history.replaceState(null, '', '#free-' + s); }
    startDive({ mode: 'free', promptIds: dive.freePromptIds(s, prompts), seed: s });
  }
  function startArchive(dayKey) {
    const { dive, storage, prompts, schedule } = F();
    const today = F().todayKey();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || dayKey < dive.LAUNCH_DATE || dayKey >= today) return root.FathomPages.archive();
    const M = root.FathomMonetise;
    if (M && !M.isArchiveUnlocked(dayKey)) { root.FathomPages.archive(); M.openUnlock('archive'); return; }
    const existing = (storage.get('archive', {}))[dayKey];
    if (existing) return resultScreen(existing, { fresh: false });
    startDive({ mode: 'archive', promptIds: dive.dailyPromptIds(dayKey, prompts, dive.LAUNCH_DATE, schedule), dayKey, number: dive.puzzleNumber(dayKey) });
  }
  function startPack(packId) {
    const { dive, prompts, packsById } = F();
    if (/^community-/.test(packId) && root.FathomSocial) {
      return root.FathomSocial.communityPackSpec(packId.replace(/^community-/, '')).then((pack) => {
        if (!pack) return root.FathomPages.packs();
        const ids = dive.packPromptIds(pack, prompts);
        if (ids.length !== dive.PROMPTS_PER_DIVE) return root.FathomPages.message('Pack unavailable', 'This community pack refers to questions that are not in this build.');
        startDive({ mode: 'pack', promptIds: ids, packId: pack.id, packName: pack.name });
      });
    }
    const pack = packsById[packId];
    if (!pack) return root.FathomPages.packs();
    const M = root.FathomMonetise;
    if (M && !M.isPackUnlocked(packId)) { root.FathomPages.packs(); M.openUnlock('pack', packId); return; }
    startDive({ mode: 'pack', promptIds: dive.packPromptIds(pack, prompts), packId });
  }
  // A challenge link replays the challenger's exact seven: a free seed, a day ('d20261109' → that daily or archive
  // dive) or a pack ('k2'). Daily and pack challenges still count as that daily or pack (saved and submitted as usual).
  function startChallenge(hash) {
    const { dive, prompts, packs, schedule, storage, toast } = F();
    const parsed = dive.parseChallenge(hash);
    if (!parsed) { toast('That challenge link is not valid — here is a fresh dive.'); return startFree(); }
    const challenge = { depth: parsed.depth, tiers: parsed.tiers, seed: parsed.seed };
    track('challenge_opened', { kind: parsed.kind });
    if (parsed.kind === 'day') {
      const today = F().todayKey();
      const promptIds = dive.dailyPromptIds(parsed.dayKey, prompts, dive.LAUNCH_DATE, schedule);
      if (!promptIds || parsed.dayKey > today) { toast('That dive is not open yet — here is a fresh one.'); return startFree(); }
      if (parsed.dayKey === today) {
        const existing = storage.getDailyResult(today);
        if (existing) return resultScreen(Object.assign({}, existing, { challenge }), { fresh: false });
        return startDive({ mode: 'daily', promptIds, dayKey: today, number: dive.puzzleNumber(today), challenge });
      }
      const M = root.FathomMonetise;
      if (M && !M.isArchiveUnlocked(parsed.dayKey)) { root.FathomPages.archive(); M.openUnlock('archive'); return; }
      const done = (storage.get('archive', {}))[parsed.dayKey];
      if (done) return resultScreen(Object.assign({}, done, { challenge }), { fresh: false });
      return startDive({ mode: 'archive', promptIds, dayKey: parsed.dayKey, number: dive.puzzleNumber(parsed.dayKey), challenge });
    }
    if (parsed.kind === 'pack') {
      const pack = packs[parsed.packIndex];
      if (!pack) { toast('That pack does not exist — here is a fresh dive.'); return startFree(); }
      const M = root.FathomMonetise;
      if (M && !M.isPackUnlocked(pack.id)) { root.FathomPages.packs(); M.openUnlock('pack', pack.id); return; }
      return startDive({ mode: 'pack', promptIds: dive.packPromptIds(pack, prompts), packId: pack.id, challenge });
    }
    startDive({ mode: 'challenge', promptIds: dive.freePromptIds(parsed.seed, prompts), seed: parsed.seed, challenge });
  }
  // Three untimed questions with a coach line each; nothing is saved.
  function startTutorial() {
    const ids = TUTORIAL_PROMPT_IDS.filter(id => F().promptsById[id]);
    if (ids.length < TUTORIAL_PROMPT_IDS.length && !F().bankLoaded) return loadThen(startTutorial);
    if (!ids.length) return root.FathomPages.message('Tutorial unavailable', 'The tutorial questions are missing from this build. Start a Free Dive instead.');
    track('tutorial_started');
    startDive({ mode: 'tutorial', promptIds: ids });
  }

  // ---------------------------------------------------------------- the dive loop
  function startDive(spec) {
    const { storage, dive, sound } = F();
    leaveDive();
    const timerOn = spec.mode === 'tutorial' ? false : spec.mode === 'free' ? storage.settings().freeTimer !== false : true;
    state = { spec, total: spec.promptIds.length, idx: 0, results: [], points: 0, depth: 0, timerOn, timer: null, revealTimer: null, tileTimer: null, leadTimer: null, radioTimer: null, answered: false, promptStart: 0, deadline: 0, attempts: 0, hint: null, hintUsed: false, rejected: [], rarity: null, scene: null, ask: null, takeover: null, takeoverTimer: null, frozenCache: {} };
    let remainingMs = null;
    let carry = null;
    if (spec.resume) {
      state.results = spec.resume.results.slice();
      state.points = state.results.reduce((n, r) => n + (r.points || 0), 0);
      state.depth = dive.depthFor(state.points);
      state.idx = state.results.length;
      state.hintUsed = !!spec.resume.hintUsed || state.results.some(r => r.hint);
      if (spec.resume.shownAt && spec.resume.shownIdx === state.idx) {
        remainingMs = dive.SECONDS_PER_PROMPT * 1000 - (Date.now() - spec.resume.shownAt);
        carry = { attempts: spec.resume.attempts || 0, hint: spec.resume.hint || null, rejected: spec.resume.rejected || [] };
      }
      if (state.idx >= state.total) return finish();
    } else {
      track('dive_started', { mode: spec.mode });
      sound.splash();
    }
    renderDiveShell();
    F().setSceneDepth(state.depth);
    if (spec.mode === 'daily' && root.FathomOnline && root.FathomOnline.rarityFor) root.FathomOnline.rarityFor(spec.dayKey, spec.promptIds).then((r) => { if (state && state.spec === spec) state.rarity = r; }).catch(() => {});
    if (remainingMs !== null && remainingMs <= 0) { renderPrompt(0, carry); submit(null, true); return; }
    renderPrompt(remainingMs, carry);
  }
  function saveProgress(shownAt) {
    if (!state || state.spec.mode !== 'daily') return;
    F().storage.set('progress', {
      mode: 'daily', dayKey: state.spec.dayKey, promptIds: state.spec.promptIds, results: state.results, shownIdx: state.idx, shownAt: shownAt || null,
      attempts: state.attempts || 0, hint: state.hint || null, hintUsed: !!state.hintUsed, rejected: state.rejected || [],
    });
  }

  // Two columns at every width: the water column with the submarine on the left, the question and the answer box on the right.
  function renderDiveShell() {
    const { el, render } = F();
    const sceneWrap = el('div', { class: 'dive-scene', id: 'dive-scene' });
    const mainCol = el('div', { class: 'dive-main' });
    render(el('section', { class: 'dive', 'aria-label': 'Dive' }, [sceneWrap, mainCol]));
    document.body.classList.add('diving');
    state.mainCol = mainCol;
    state.scene = root.FathomSub ? root.FathomSub.mount(sceneWrap, {
      mode: 'dive', depth: state.depth,
      onLandmark: (lm) => landmarkPass(lm),
      onFrame: (d) => {
        if (!state) return;
        if (state.metersNode) state.metersNode.textContent = '+' + F().dive.formatMeters(Math.round(d - state.prevDepth)) + ' m';
        if (state.takeover) updateDepthCounter(d);
      },
    }) : null;
  }

  function progressDots() {
    const { el } = F();
    const dots = [];
    for (let i = 0; i < state.total; i++) {
      const r = state.results[i];
      const cls = r ? (r.tier ? 'tier-' + r.tier : 'miss') : (i === state.idx ? 'cur' : '');
      dots.push(el('span', { class: cls, style: r && r.tier ? '--c: var(--tier-' + r.tier + ')' : (r ? '--c: var(--tier-miss)' : ''), 'aria-hidden': 'true' }));
    }
    return el('div', { class: 'progress-dots' }, dots);
  }

  function timerNode(seconds) {
    const { el, dive } = F();
    if (!state.timerOn) return el('div', { class: 'muted small', text: 'No timer' });
    const C = 2 * Math.PI * 20;
    const secs = seconds == null ? dive.SECONDS_PER_PROMPT : seconds;
    return el('div', { class: 'timer', role: 'timer', 'aria-live': 'off' }, [
      el('div', { html: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="track" cx="24" cy="24" r="20"/><circle class="arc" cx="24" cy="24" r="20" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - secs / dive.SECONDS_PER_PROMPT)).toFixed(1) + '"/></svg>' }),
      el('div', { class: 'num', text: String(Math.ceil(secs)) }),
    ]);
  }
  // one tap to mute, remembered in settings
  function muteButton() {
    const { el, storage, applySettings } = F();
    const on = storage.settings().sound !== false;
    const btn = el('button', { class: 'icon-btn mute-btn', type: 'button', id: 'mute-btn', 'aria-pressed': String(!on), 'aria-label': on ? 'Mute sound and vibration' : 'Unmute sound and vibration', title: on ? 'Mute' : 'Unmute', text: on ? '🔊' : '🔇', onClick: () => {
      const now = storage.settings().sound !== false;
      storage.updateSettings({ sound: !now });
      applySettings();
      btn.textContent = now ? '🔇' : '🔊';
      btn.setAttribute('aria-pressed', String(now));
      btn.setAttribute('aria-label', now ? 'Unmute sound and vibration' : 'Mute sound and vibration');
      btn.title = now ? 'Unmute' : 'Mute';
      if (!now) F().sound.reveal('reef');
    } });
    return btn;
  }

  function hintsAllowed() { return !!state && state.spec.mode !== 'challenge' && !state.spec.challenge; }

  function renderPrompt(remainingMs, carry) {
    const { el, dive, esc } = F();
    const promptId = state.spec.promptIds[state.idx];
    const prompt = promptFor(promptId);
    state.answered = false;
    state.attempts = carry && carry.attempts ? carry.attempts : 0;
    state.hint = carry && carry.hint ? carry.hint : null;
    state.rejected = carry && carry.rejected ? carry.rejected.slice() : [];
    state.metersNode = null;
    const last = state.idx === state.total - 1;
    const input = el('input', { class: 'input', id: 'answer', type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', placeholder: 'Your answer…', 'aria-label': 'Your answer', 'aria-describedby': 'question-text', maxlength: String(MAX_TYPED_LENGTH) });
    const submitBtn = el('button', { class: 'btn btn-primary btn-dive', type: 'submit', text: 'Dive' });
    const form = el('form', { class: 'answer-form', onSubmit: (e) => {
      e.preventDefault();
      // Enter while the box asks "Did you mean to spell X?" with exactly one X submits that spelling
      if (state.ask && state.ask.options.length === 1 && (!input.value.trim() || input.value.trim() === state.ask.from)) return submit(state.ask.options[0].name);
      submit(input.value);
    } }, [input, submitBtn]);
    input.addEventListener('input', () => { if (state && state.ask && input.value.trim() !== state.ask.from) clearAsk(); });
    const suggest = el('div', { id: 'suggest', class: 'suggest', 'aria-live': 'polite' });
    const reject = el('div', { id: 'reject', class: 'reject-msg', role: 'status' });
    const hintBtn = hintsAllowed() ? el('button', { class: 'hint-box' + (state.hintUsed ? ' used' : ''), type: 'button', id: 'hint-btn', disabled: state.hintUsed ? true : null, title: state.hintUsed ? 'Your one hint for this dive is used' : 'Light up the first letter and shape of a rarer answer — once per dive', onClick: useHint }, [
      el('span', { class: 'lure', 'aria-hidden': 'true' }),
      el('span', { text: state.hintUsed ? 'Hint used' : 'Hint' }),
      state.hintUsed ? null : el('span', { class: 'tiny muted', text: '1 per dive' }),
    ]) : null;
    const skipBtn = el('button', { class: 'btn btn-sm btn-ghost', type: 'button', id: 'skip-btn', text: 'Skip', 'aria-label': 'Skip this question', onClick: () => skip() });
    const helpRow = el('div', { class: 'help-row' }, [hintBtn, skipBtn, el('span', { class: 'tiny muted help-note', text: 'Wrong guesses do not end the question' })]);
    const hintText = el('div', { id: 'hint-text', class: 'hint-text' });
    const allowedMs = remainingMs != null ? Math.max(0, Math.min(remainingMs, dive.SECONDS_PER_PROMPT * 1000)) : dive.SECONDS_PER_PROMPT * 1000;
    const head = el('div', { class: 'dive-head' }, [
      el('div', { class: 'dive-head-left' }, [
        el('div', { class: 'tiny muted', text: (MODE_LABELS[state.spec.mode] || '') + (state.spec.number ? ' · ' + dive.BRAND + ' #' + state.spec.number : '') }),
        el('div', { class: 'small', html: '<b>Question ' + (state.idx + 1) + ' of ' + state.total + '</b>' + (last ? ' <span class="last-tag">last one</span>' : '') }),
        progressDots(),
      ]),
      el('div', { class: 'dive-head-right' }, [timerNode(allowedMs / 1000), muteButton()]),
    ]);
    const challengeNote = state.spec.challenge && state.spec.challenge.depth ? el('p', { class: 'small', html: 'Beat <b>' + esc(dive.formatMeters(state.spec.challenge.depth)) + ' m</b> to win this challenge.' + (hintsAllowed() ? '' : ' No hint.') }) : null;
    const coach = state.spec.mode === 'tutorial' ? el('p', { class: 'coach', html: '<b>Tutorial ' + (state.idx + 1) + '/' + state.total + ':</b> ' + esc(TUTORIAL_COACH[state.idx] || '') }) : null;
    const radio = el('div', { id: 'radio', class: 'radio', role: 'status' });
    const centre = el('div', { class: 'dive-centre' }, [
      challengeNote, coach, radio,
      el('h1', { class: 'question-text', id: 'question-text', text: prompt.text }),
      suggest, form, reject, helpRow, hintText,
      el('div', { id: 'reveal', 'aria-live': 'polite' }),
    ]);
    state.mainCol.innerHTML = '';
    state.mainCol.append(head, centre);
    state.input = input;
    state.form = form;
    if (state.hint) showHint(state.hint);
    if (state.attempts) reject.innerHTML = '<b>' + state.attempts + (state.attempts === 1 ? ' guess' : ' guesses') + '</b> not accepted so far — try again';
    if (last) say('last', 0); else if (state.idx === 0 && !carry) say('start', 0);
    setTimeout(() => input.focus(), 30);
    state.promptStart = performance.now();
    state.shownAt = Date.now() - (dive.SECONDS_PER_PROMPT * 1000 - allowedMs);
    saveProgress(state.shownAt);
    if (state.timerOn) {
      state.deadline = state.promptStart + allowedMs;
      const arc = state.mainCol.querySelector('.timer .arc');
      const num = state.mainCol.querySelector('.timer .num');
      const timerEl = state.mainCol.querySelector('.timer');
      const C = 2 * Math.PI * 20;
      let lastWhole = dive.SECONDS_PER_PROMPT;
      state.timer = setInterval(() => {
        const remaining = Math.max(0, state.deadline - performance.now()) / 1000;
        if (arc) arc.setAttribute('stroke-dashoffset', (C * (1 - remaining / dive.SECONDS_PER_PROMPT)).toFixed(1));
        const whole = Math.ceil(remaining);
        if (num && whole !== lastWhole) { num.textContent = String(whole); lastWhole = whole; if (whole <= LOW_TIME_SECONDS && whole > 0) { F().sound.tick(); F().haptics.buzz('tick'); } }
        if (timerEl) timerEl.classList.toggle('low', remaining <= LOW_TIME_SECONDS);
        if (remaining <= 0) { const typedSoFar = state.input ? state.input.value.trim() : ''; submit(typedSoFar || null, true); }
      }, TIMER_TICK_MS);
    }
  }
  // The pilot radios a line up: a small speech bubble pointing at the submarine.
  function say(kind, n) {
    const node = document.getElementById('radio');
    if (!node || !state) return;
    const text = radioLine(kind, n);
    if (!text) return;
    if (state.takeover) state.takeover.radio.textContent = text;
    node.textContent = text;
    node.classList.remove('show'); void node.offsetWidth; node.classList.add('show');
    if (state.radioTimer) clearTimeout(state.radioTimer);
    state.radioTimer = setTimeout(() => { node.classList.remove('show'); }, RADIO_MS);
  }

  // ---------------------------------------------------------------- the hint (one per dive, free)
  function useHint() {
    if (!state || state.answered || state.hint || state.hintUsed || !hintsAllowed()) return;
    const { dive, entities, toast } = F();
    const prompt = promptFor(state.spec.promptIds[state.idx]);
    // seeded per question and dive, so a reload (or everyone playing today's dive) sees the same hint
    const rng = dive.seededRng('hint:' + prompt.id + ':' + (state.spec.dayKey || state.spec.seed || state.spec.packId || 'free'));
    const h = dive.pickHint(prompt, entities, [], rng);
    if (!h) { toast('No hint for this one — try the next question'); return; }
    state.hint = h;
    state.hintUsed = true;
    showHint(h);
    say('hint', 0);
    saveProgress(state.shownAt);
    track('hint_used', { prompt: prompt.id });
  }
  function showHint(h) {
    const { dive, esc } = F();
    const btn = document.getElementById('hint-btn');
    if (btn) { btn.disabled = true; btn.classList.add('used'); btn.innerHTML = '<span class="lure" aria-hidden="true"></span><span>Hint used</span>'; }
    const t = document.getElementById('hint-text');
    const tier = dive.TIER_BY_CODE[h.tier];
    if (t) t.innerHTML = '<b>' + esc(tier.emoji + ' ' + tier.name) + ' answer lit up:</b> <span class="shape">' + esc(h.shape) + '</span> <span class="muted">(' + h.letters + ' letters)</span>';
    if (state && state.input && !state.answered) state.input.focus();
  }

  // ---------------------------------------------------------------- answering
  function submit(typed, timedOut) {
    if (!state || state.answered) return;
    const { dive } = F();
    const prompt = promptFor(state.spec.promptIds[state.idx]);
    const text = typed == null ? '' : String(typed).trim();
    if (!timedOut) {
      if (!text) { nudge(); return; }
      const m = dive.matchAnswer(text, promptIndex(prompt), F().entities);
      if (!m.entityId) { reject(text, prompt, m); return; }
      accept(m, text, false, prompt);
      return;
    }
    const m = text ? dive.matchAnswer(text, promptIndex(prompt), F().entities) : null;
    if (m && m.entityId) accept(m, text, true, prompt);
    else miss('timeout', text, prompt);
  }
  function skip() {
    if (!state || state.answered) return;
    miss('skip', state.input ? state.input.value.trim() : '', promptFor(state.spec.promptIds[state.idx]));
  }
  function nudge() {
    const input = state.input;
    input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
    const msg = document.getElementById('reject');
    if (msg) msg.textContent = 'Type an answer — or press Skip';
    input.focus();
  }
  // A guess that is not accepted does not end the question: shake, flash, clear, keep the timer running — and when the
  // guess could mean two answers, offer both at once.
  function reject(text, prompt, m) {
    const { dive, entities, sound, haptics, esc } = F();
    state.attempts++;
    state.rejected.push(text);
    const input = state.input;
    const msg = document.getElementById('reject');
    const ambiguous = m && m.ambiguous && m.ambiguous.length;
    const ask = m && m.correction && !m.correction.accepted ? m.correction : null;
    clearAsk();
    if (ask) {
      // a near-miss: the text stays in the box and the box asks; Yes / Enter submits the spelling, No clears, the clock runs on
      input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
      setTimeout(() => input.classList.remove('shake'), REJECT_FLASH_MS);
      if (msg) msg.innerHTML = '';
      state.ask = { from: ask.from, options: ask.options };
      renderAsk(document.getElementById('suggest'), ask, {
        onYes: (name) => { if (!state || state.answered) return; clearAsk(); input.value = name; submit(name); },
        onNo: () => { if (!state || state.answered) return; clearAsk(); input.value = ''; input.focus(); },
      });
    } else {
      input.value = '';
      input.classList.remove('shake', 'reject'); void input.offsetWidth; input.classList.add('shake', 'reject');
      setTimeout(() => input.classList.remove('shake', 'reject'), REJECT_FLASH_MS);
      if (msg) msg.innerHTML = ambiguous ? '<b>“' + esc(text) + '”</b> could mean ' + m.ambiguous.length + ' answers — pick one' : '<b>“' + esc(text) + '”</b> is not an accepted answer — try again' + (state.attempts > 1 ? ' <span class="muted">(' + state.attempts + ' tries)</span>' : '');
      renderChips(ambiguous ? dive.suggestAnswers(text, promptIndex(prompt), entities) : []);
    }
    sound.miss();
    haptics.buzz('miss');
    saveProgress(state.shownAt);
    input.focus();
  }
  function clearAsk() {
    if (state) state.ask = null;
    const box = document.getElementById('suggest');
    if (box && box.querySelector('.ask')) box.innerHTML = '';
  }
  // "Did you mean to spell X?" — one spelling gets Yes / No; two get a chip each with the same wording. Shared with Duel.
  function renderAsk(box, correction, handlers) {
    const { el } = F();
    if (!box) return;
    box.innerHTML = '';
    const options = correction.options || [];
    if (!options.length) return;
    const ask = el('div', { class: 'ask', role: 'status' });
    if (options.length === 1) {
      ask.append(el('span', { class: 'ask-q', html: 'Did you mean to spell <b>' + F().esc(options[0].name) + '</b>?' }));
      ask.append(el('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Yes', 'aria-label': 'Yes, I meant ' + options[0].name, onClick: () => handlers.onYes(options[0].name) }));
    } else {
      ask.append(el('span', { class: 'ask-q', text: 'Did you mean to spell' }));
      options.forEach((o, i) => { if (i) ask.append(el('span', { class: 'muted', text: 'or' })); ask.append(el('button', { class: 'chip-btn', type: 'button', text: o.name, 'aria-label': 'Yes, I meant ' + o.name, onClick: () => handlers.onYes(o.name) })); });
      ask.append(el('span', { class: 'ask-q', text: '?' }));
    }
    ask.append(el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'No', 'aria-label': 'No, clear the box', onClick: () => handlers.onNo() }));
    box.append(ask);
  }
  function renderChips(chips) {
    const { el } = F();
    const box = document.getElementById('suggest');
    if (!box) return;
    box.innerHTML = '';
    if (!chips || !chips.length) return;
    box.append(el('span', { class: 'small muted', text: 'Did you mean' }));
    for (const c of chips) {
      box.append(el('button', { class: 'chip-btn', type: 'button', text: c.name, onClick: () => { if (!state || state.answered) return; state.input.value = c.name; box.innerHTML = ''; submit(c.name); } }));
    }
  }
  function lockPrompt() {
    state.answered = true;
    state.ask = null;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    state.input.disabled = true;
    state.form.querySelector('button').disabled = true;
    ['suggest', 'reject', 'hint-text'].forEach(id => { const n = document.getElementById(id); if (n) n.innerHTML = ''; });
    const help = state.mainCol.querySelector('.help-row');
    if (help) help.remove();
  }
  function secondsUsed() {
    const { dive } = F();
    return Math.round(Math.min(dive.SECONDS_PER_PROMPT, Math.max(0, (performance.now() - state.promptStart) / 1000)) * 10) / 10;
  }
  // v4: the ONE button that ends the takeover. Nothing advances on its own — on phones or desktop — and waiting costs nothing.
  function nextButton() {
    const { el } = F();
    // a keyboard "click" (Enter/Space, event.detail === 0) within the guard is the player's double Enter — ignore it;
    // a real tap or mouse click always advances
    const btn = el('button', { class: 'btn btn-primary', type: 'button', text: state.idx + 1 >= state.total ? 'See your dive' : 'Next question', onClick: (e) => { if (e.detail === 0 && state && performance.now() - state.revealedAt < NEXT_GUARD_MS) return; next(); } });
    state.revealedAt = performance.now();
    return btn;
  }
  // The water column takes the whole viewport (same scene instance, resized by CSS) and the reveal moves onto a dark plate over it.
  function enterTakeover() {
    const { el, dive } = F();
    const sceneWrap = document.getElementById('dive-scene');
    const section = sceneWrap && sceneWrap.closest('.dive');
    if (!sceneWrap || !section || state.takeover) return;
    const depthNode = el('div', { class: 'num', text: dive.formatMeters(state.prevDepth != null ? state.prevDepth : state.depth) + ' m' });
    const zoneNode = el('div', { class: 'zone', text: zoneName(state.prevDepth != null ? state.prevDepth : state.depth) });
    const radio = el('div', { class: 'takeover-radio', role: 'status' });
    const plate = el('div', { class: 'takeover-plate' });
    const reveal = state.mainCol.querySelector('#reveal');
    if (reveal) plate.append(reveal);                       // the reveal itself moves onto the plate (tier, +N m, rarity, fact, the button)
    const hud = el('div', { class: 'takeover-hud' }, [
      el('div', { class: 'takeover-top' }, [el('div', { class: 'takeover-depth', 'aria-live': 'off' }, [depthNode, zoneNode]), radio]),
      plate,
    ]);
    sceneWrap.append(hud);
    section.classList.add('takeover');
    document.body.classList.add('takeover');
    state.mainCol.setAttribute('inert', '');
    state.mainCol.setAttribute('aria-hidden', 'true');
    state.takeover = { hud, plate, radio, depthNode, zoneNode };
  }
  function leaveTakeover() {
    if (!state || !state.takeover) return;
    const section = document.querySelector('.dive');
    if (section) section.classList.remove('takeover');
    document.body.classList.remove('takeover');
    state.takeover.hud.remove();
    state.mainCol.removeAttribute('inert');
    state.mainCol.removeAttribute('aria-hidden');
    state.takeover = null;
  }
  function zoneName(depth) { const z = F().dive.zoneFor(depth); return z ? z.name : ''; }       // ZONES names already end in "zone"
  function updateDepthCounter(d) {
    const { dive } = F();
    const t = state.takeover;
    if (!t) return;
    t.depthNode.textContent = dive.formatMeters(Math.round(d)) + ' m';
    const z = zoneName(d);
    if (t.zoneNode.textContent !== z) t.zoneNode.textContent = z;
  }
  // The one button, when the descent (or the stall) is over: appended to the plate and focused.
  function showNextButton(reveal, afterMs) {
    const { el } = F();
    const place = () => {
      state.takeoverTimer = null;
      if (!state || !reveal.isConnected) return;
      reveal.append(el('div', { class: 'next-row' }, [progressDots(), nextButton()]));
      const btn = reveal.querySelector('.next-row button');
      btn.focus({ preventScroll: true });
      showNext(reveal);
    };
    if (afterMs > 0) state.takeoverTimer = setTimeout(place, afterMs); else place();
  }
  // "Only 4% said that": from today's answer counts when they are known, otherwise the tier's own blurb.
  function rarityLine(prompt, entityId, tier) {
    const r = state.rarity && state.rarity[prompt.id];
    if (r && r.total >= 10) {
      const n = r.counts[entityId] || 0;
      if (!n) return 'Nobody else has said that today';
      const pct = Math.max(1, Math.round(100 * n / r.total));
      return pct <= 15 ? 'Only ' + pct + '% said that' : pct < 50 ? pct + '% said that' : pct + '% said that too';
    }
    const blurb = tier.blurb || '';
    return blurb.charAt(0).toUpperCase() + blurb.slice(1);
  }

  // An accepted answer: the box flashes the tier colour at once, the pilot radios up how rare it was, and a beat
  // later the submarine sinks the distance it earned (landmarks pop as they pass; the tier badge lands part-way down).
  function accept(m, text, timedOut, prompt) {
    const { el, dive, entities, storage, esc, sound, haptics, setSceneDepth } = F();
    const taxonHit = dive.isTaxonId(m.entityId);
    const ent = taxonHit ? { id: m.entityId, name: m.name || text, fact: dive.taxonFact(promptIndex(prompt).taxon), kind: 'creature' } : entities[m.entityId];
    const tier = dive.TIER_BY_CODE[m.tier];
    const earned = m.points;
    const input = state.input;
    const corrected = m.correction && m.correction.accepted ? m.correction : null;
    clearAsk();
    if (corrected) { input.value = corrected.to; input.classList.remove('corrected'); void input.offsetWidth; input.classList.add('corrected'); }
    input.classList.remove('accept'); void input.offsetWidth; input.style.setProperty('--c', 'var(--tier-' + m.tier + ')'); input.classList.add('accept');
    setTimeout(() => { if (input) input.classList.remove('accept'); }, ACCEPT_FLASH_MS);
    lockPrompt();
    const result = { promptId: prompt.id, typed: text, entityId: m.entityId, tier: m.tier, points: earned, via: m.via, secondsUsed: secondsUsed(), timedOut: !!timedOut, attempts: state.attempts + 1, hint: !!state.hint, guesses: state.rejected.concat([text]) };
    state.results.push(result);
    state.points += earned;
    const prevDepth = state.depth;
    state.prevDepth = prevDepth;
    state.depth = dive.depthFor(state.points);
    saveProgress(null);
    if (!taxonHit && state.spec.mode !== 'tutorial') storage.logbookAdd(m.entityId, m.tier, m.points, prompt.id, F().todayKey());
    const rarity = rarityLine(prompt, m.entityId, tier);
    const reveal = state.mainCol.querySelector('#reveal');
    reveal.innerHTML = '';
    enterTakeover();
    if (corrected) reveal.append(el('p', { class: 'corrected-note', role: 'status', html: 'Did you mean to spell <b>' + esc(corrected.to) + '</b>? Accepted.' }));
    reveal.append(el('p', { class: 'rarity tier-' + m.tier, role: 'status', html: '<span class="tier tier-' + m.tier + '">' + esc(tier.emoji + ' ' + tier.name) + '</span> · ' + esc(rarity) }));
    say(m.tier, state.idx);
    sound.reveal(m.tier);
    haptics.buzz(m.tier === 'hadal' ? 'hadal' : 'accept');
    const reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wantMs = root.FathomSub ? root.FathomSub.takeoverMs(state.depth - prevDepth) : 0;
    const drop = () => {
      state.leadTimer = null;
      const ms = state.scene ? state.scene.descendTo(state.depth, { tier: m.tier, ms: wantMs }) : 0;
      setSceneDepth(state.depth);
      sound.descend(prevDepth, state.depth, ms);
      if (!ms) updateDepthCounter(state.depth);
      // the one button: when the sub has settled (2–3 s), or 600 ms into the crossfade under reduced motion
      showNextButton(reveal, reduced || !ms ? REDUCED_BUTTON_MS : ms);
      const showTile = () => {
        state.tileTimer = null;
        const shownSoFar = state.scene ? Math.max(prevDepth, Math.min(state.depth, state.scene.getDepth())) : state.depth;
        state.metersNode = el('div', { class: 'tile-meters', text: '+' + dive.formatMeters(Math.round((ms ? shownSoFar : state.depth) - prevDepth)) + ' m' });
        const subBits = [(corrected ? corrected.to : ent.name) + (m.via === 'group' ? ' (for “' + text + '”)' : '') + ' · ' + tier.points + ' points'];
        if (result.attempts > 1) subBits.push(result.attempts + ' tries');
        const tile = el('div', { class: 'tile tier-' + m.tier + (m.tier === 'hadal' ? ' hadal' : ''), style: '--c: var(--tier-' + m.tier + ')' }, [
          el('div', { class: 'tile-top' }, [el('div', { class: 'tile-name', text: tier.emoji + ' ' + tier.name }), state.metersNode]),
          el('div', { class: 'tile-sub', text: subBits.join(' · ') }),
          artNode(ent, 112),
        ]);
        reveal.append(tile);
        if (ent.fact) reveal.append(el('p', { class: 'fact', html: '<b>Did you know?</b> ' + esc(ent.fact) }));
        if (taxonHit) reveal.append(el('p', { class: 'small muted', text: 'Not on our hand-written list, but a real species — it scores Midnight. Tell us if it deserves a tier of its own.' }));
        if (m.tier === 'hadal') sound.hadal();
      };
      const tileAt = ms ? Math.min(TILE_DELAY_MAX_MS, ms * TILE_DELAY_FRACTION) : 0;
      if (tileAt) state.tileTimer = setTimeout(showTile, tileAt); else showTile();
    };
    state.leadTimer = setTimeout(drop, DESCENT_LEAD_MS);
  }

  function miss(kind, text, prompt) {
    const { el, dive, esc, sound, haptics } = F();
    lockPrompt();
    const guesses = state.rejected.concat(text ? [text] : []);
    const result = { promptId: prompt.id, typed: guesses.length ? guesses[guesses.length - 1] : '', entityId: null, tier: null, points: 0, secondsUsed: secondsUsed(), timedOut: kind === 'timeout', skipped: kind === 'skip', attempts: guesses.length, hint: !!state.hint, guesses };
    state.results.push(result);
    saveProgress(null);
    const hadal = hadalEntity(prompt);
    if (state.scene) { if (kind === 'timeout') { state.scene.flicker(); state.scene.stall(); } else state.scene.stall(); }
    say(kind === 'timeout' ? 'timeout' : 'skip', state.idx);
    sound.miss();
    haptics.buzz('miss');
    const label = kind === 'timeout' ? '⏱ Out of time' : '⬛ Skipped';
    const sub = (text && kind === 'timeout' ? '“' + text + '” was not accepted. ' : '') + (hadal ? 'The Hadal answer was ' + hadal.name + '.' : '');
    const tile = el('div', { class: 'tile tile-miss', style: '--c: var(--tier-miss)' }, [
      el('div', { class: 'tile-top' }, [el('div', { class: 'tile-name', text: label }), el('div', { class: 'tile-meters', text: '+0 m' })]),
      el('div', { class: 'tile-sub', text: sub }),
      artNode(hadal, 112),
    ]);
    const reveal = state.mainCol.querySelector('#reveal');
    reveal.innerHTML = '';
    state.prevDepth = state.depth;
    enterTakeover();
    updateDepthCounter(state.depth);
    reveal.append(el('p', { class: 'rarity miss', role: 'status', text: kind === 'timeout' ? 'The sub stalls — no descent this time' : 'The sub holds its depth' }));
    reveal.append(tile);
    if (hadal && hadal.fact) reveal.append(el('p', { class: 'fact', html: '<b>Did you know?</b> ' + esc(hadal.fact) }));
    const reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    showNextButton(reveal, reduced ? REDUCED_BUTTON_MS : STALL_MS);
  }
  // On a phone the reveal can run past the bottom edge: bring the Next button into view with the smallest possible scroll.
  function showNext(reveal) {
    const row = reveal.querySelector('.next-row');
    if (!row || !row.scrollIntoView) return;
    const reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { row.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); } catch (e) { /* older browsers */ }
  }

  // A landmark crossed by the sub: the scene pops its label; here it is announced and chimed.
  function landmarkPass(lm) {
    const { el, dive, sound } = F();
    sound.landmark();
    const live = document.getElementById('reveal');
    if (live) { const n = el('span', { class: 'sr-only', text: 'Passed ' + lm.label + ', ' + dive.formatMeters(lm.depth) + ' metres' }); live.append(n); setTimeout(() => n.remove(), 2500); }
  }

  function next() {
    if (!state) return;
    if (state.revealTimer) { clearTimeout(state.revealTimer); state.revealTimer = null; }
    if (state.tileTimer) { clearTimeout(state.tileTimer); state.tileTimer = null; }
    if (state.takeoverTimer) { clearTimeout(state.takeoverTimer); state.takeoverTimer = null; }
    if (state.leadTimer) { clearTimeout(state.leadTimer); state.leadTimer = null; if (state.scene) state.scene.setDepth(state.depth); F().setSceneDepth(state.depth); }
    leaveTakeover();
    state.idx++;
    if (state.idx >= state.total) return finish();
    renderPrompt();
  }

  function finish() {
    const { dive, storage } = F();
    const s = state.spec;
    const record = {
      mode: s.mode, dayKey: s.dayKey || null, number: s.number || null, seed: s.seed || null, packId: s.packId || null, packName: s.packName || null,
      promptIds: s.promptIds.slice(), results: state.results, points: state.points, depth: state.depth,
      tiers: state.results.map(r => r.tier), secondsUsed: Math.round(state.results.reduce((n, r) => n + r.secondsUsed, 0) * 10) / 10,
      hints: state.hintUsed || state.results.some(r => r.hint) ? 1 : 0, attempts: state.results.reduce((n, r) => n + (r.attempts || 0), 0),
      finishedAt: new Date().toISOString(), challenge: s.challenge || null, timerOn: state.timerOn,
    };
    clearTimers();
    leaveTakeover();
    if (state.scene) state.scene.destroy();
    state = null;
    if (s.mode === 'tutorial') {
      storage.updateSettings({ tutorialDone: true });
      track('tutorial_completed', { depth: record.depth });
      return resultScreen(record, { fresh: true });
    }
    storage.markPlayed(s.promptIds);
    // a personal best needs something to beat: the first dive of a kind is never one
    const best = (kind, id) => { const had = !!storage.getBest(kind, id); return storage.saveBest(kind, id, record) && had; };
    let personalBest = false;
    if (s.mode === 'daily') {
      const previous = Object.values(storage.allDailyResults()).map(r => r.depth || 0);
      personalBest = previous.length > 0 && record.depth > Math.max(...previous);
      storage.remove('progress');
      storage.saveDailyResult(s.dayKey, record);
      if (root.FathomOnline && root.FathomOnline.submitDaily) root.FathomOnline.submitDaily(record);
    } else if (s.mode === 'free') {
      storage.bumpFreeDiveCount();
      personalBest = best('free', 'free');
    } else if (s.mode === 'pack') {
      personalBest = best('pack', s.packId);
    } else if (s.mode === 'archive') {
      const all = storage.get('archive', {});
      all[s.dayKey] = record;
      storage.set('archive', all);
    } else if (s.mode === 'challenge') {
      personalBest = best('challenge', s.seed);
    }
    track('dive_completed', { mode: record.mode, depth: record.depth });
    const unlocked = root.FathomAchievements ? root.FathomAchievements.afterDive(record) : [];
    resultScreen(record, { fresh: true, unlocked, personalBest });
  }

  // ---------------------------------------------------------------- result screen
  function resultScreen(record, opts) {
    const { el, dive, promptsById, entities, esc, render, config, packsById, storage } = F();
    opts = opts || {};
    leaveDive();
    F().setSceneDepth(record.depth);
    const zone = dive.zoneFor(record.depth);
    const nodes = [];
    const tutorial = record.mode === 'tutorial';

    // the sub resting at its final depth on the left, the verdict on the right
    const sceneWrap = el('div', { class: 'result-scene', id: 'result-scene' });
    let pendingStanding = null;
    const verdict = el('div', { class: 'result-verdict' }, [
      el('div', { class: 'tiny muted', text: (tutorial ? 'Tutorial complete' : modeLabel(record)) + (record.mode === 'free' && record.seed ? ' · ' + record.seed : '') }),
      el('h1', { class: 'result-depth', html: esc(dive.formatMeters(record.depth)) + '<small>m</small>' }),
      el('div', { html: '<b>' + esc(zone.name) + '</b>' }),
      el('p', { class: 'small muted', text: zone.fact }),
      el('div', { class: 'grid-emoji', role: 'img', 'aria-label': 'Tier grid: ' + record.tiers.map(t => t ? dive.TIER_BY_CODE[t].name : 'miss').join(', '), text: dive.tiersToEmoji(record.tiers) }),
      opts.personalBest ? el('p', { class: 'best-line', role: 'status', text: '🏅 New personal best' }) : null,
      el('p', { class: 'standing', id: 'standing', role: 'status' }),
    ]);
    const head = el('div', { class: 'card strong result-head' }, [sceneWrap, verdict]);
    nodes.push(head);

    if (tutorial) {
      nodes.push(el('div', { class: 'card' }, [
        el('h2', { class: 'card-title', text: 'You are ready' }),
        el('p', { text: 'The real dive has seven questions and a 25-second timer on each. Same seven for everyone, once a day. Nothing from the tutorial is saved.' }),
        el('div', { class: 'row' }, [el('a', { class: 'btn btn-primary', href: '#daily', text: 'Start today’s dive' }), el('a', { class: 'btn', href: '#free', text: 'Free Dive' })]),
      ]));
    }

    // new badges
    if (opts.unlocked && opts.unlocked.length && root.FathomAchievements) {
      nodes.push(root.FathomAchievements.unlockedCard(opts.unlocked));
    }

    // challenge comparison (any mode can carry a challenge)
    const challengeSeed = dive.challengeSeedFor(record, packsById && F().packs);
    if (record.challenge && record.mode !== 'tutorial') {
      const c = record.challenge;
      const grid = el('div', { class: 'compare-grid' });
      if (c.tiers) grid.append(el('div', {}, [el('span', { class: 'who', text: 'Them' }), el('span', { text: dive.tiersToEmoji(c.tiers) })]));
      grid.append(el('div', {}, [el('span', { class: 'who', text: 'You' }), el('span', { text: dive.tiersToEmoji(record.tiers) })]));
      const verdictText = c.depth ? (record.depth > c.depth ? 'You beat ' + dive.formatMeters(c.depth) + ' m.' : record.depth === c.depth ? 'A tie at ' + dive.formatMeters(c.depth) + ' m.' : 'They went deeper: ' + dive.formatMeters(c.depth) + ' m.') : 'Send your score back to compare.';
      const sendBack = el('button', { class: 'btn btn-primary', type: 'button', text: 'Send your score back', onClick: () => copyText(location.href.split('#')[0] + dive.makeChallengeHash(challengeSeed || record.seed, record.depth, record.tiers), 'Challenge link copied') });
      nodes.push(el('div', { class: 'card' }, [el('h2', { class: 'card-title', text: 'Challenge' }), el('p', { text: verdictText }), grid, el('div', { class: 'row', style: 'margin-top:10px' }, sendBack)]));
    }

    // the bell curve — always, for the daily — then what others answered
    if (record.mode === 'daily' && root.FathomSocial && root.FathomSocial.diversLine) { const dl = root.FathomSocial.diversLine(record.dayKey); if (dl) verdict.append(dl); }
    if (record.mode === 'daily' && root.FathomOnline) {
      if (root.FathomOnline.curveSection) { const sec = root.FathomOnline.curveSection(record, { onStanding: (s) => { pendingStanding = s; drawStanding(s); } }); if (sec) nodes.push(sec); }
    }

    // reasons to return, in order: tomorrow's countdown, the streak and its next badge, a challenge, the weekly recap
    if (record.mode === 'daily') nodes.push(returnHooks(record, challengeSeed));

    // share / actions
    if (!tutorial) {
      const actions = el('div', { class: 'card' });
      const shareBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Share results', onClick: () => {
        const st0 = root.FathomOnline && root.FathomOnline.lastStanding ? root.FathomOnline.lastStanding(record) : null;
        const st = st0 && !st0.demo ? st0 : null;      // demo numbers never leave the page
        const label = record.mode === 'daily' ? null : record.mode === 'pack' ? (packsById[record.packId] ? packsById[record.packId].name + ' pack' : 'Pack') : record.mode === 'challenge' ? 'Challenge' : record.mode === 'archive' ? 'Archive #' + record.number : 'Free Dive';
        const text = dive.shareText({ number: record.number || dive.puzzleNumber(F().todayKey()), label, depth: record.depth, beat: st ? st.beat : null, rank: st ? st.rank : null, total: st ? st.total : null, tiers: record.tiers, siteUrl: config.SITE_URL });
        copyText(text, 'Copied results to clipboard');
        track('share_clicked', { mode: record.mode });
      } });
      const row = el('div', { class: 'row' }, [shareBtn]);
      if (root.FathomShare) row.append(el('button', { class: 'btn', type: 'button', text: 'Share as image', onClick: () => { root.FathomShare.open(record); track('share_image', { mode: record.mode }); } }));
      if (challengeSeed && record.mode !== 'daily') {
        row.append(el('button', { class: 'btn', type: 'button', id: 'challenge-btn', text: 'Challenge a friend', onClick: () => {
          copyText(location.href.split('#')[0] + dive.makeChallengeHash(challengeSeed, record.depth, record.tiers), 'Challenge link copied — send it to a friend');
          track('challenge_created', { mode: record.mode });
        } }));
      }
      if (record.mode === 'daily') {
        row.append(el('a', { class: 'btn', href: '#free', text: 'Free Dive' }));
        const status = root.FathomOnline && root.FathomOnline.submitStatusLine ? root.FathomOnline.submitStatusLine(record) : null;
        actions.append(row, status || '');
      } else {
        row.append(el('a', { class: 'btn', href: record.mode === 'pack' ? '#packs' : '#free', text: record.mode === 'pack' ? 'More packs' : 'Dive again' }));
        actions.append(row);
      }
      nodes.push(actions);
    }
    if (record.mode === 'daily' && root.FathomOnline && root.FathomOnline.othersSection) { const sec = root.FathomOnline.othersSection(record); if (sec) nodes.push(sec); }

    // per question breakdown
    const list = el('ul', { class: 'result-list' });
    record.results.forEach((r, i) => {
      const prompt = frozenPrompt(record.dayKey, promptsById[r.promptId]);   // a played day keeps its answer list
      if (!prompt) return;
      const taxonHit = dive.isTaxonId(r.entityId);
      const ent = r.entityId ? (taxonHit ? { name: r.typed } : entities[r.entityId]) : null;
      const tier = r.tier ? dive.TIER_BY_CODE[r.tier] : null;
      const hadal = hadalEntity(prompt);
      const meta = [];
      if (r.attempts > 1) meta.push(r.attempts + ' tries');
      if (r.hint) meta.push('✦ hint');
      const li = el('li', {}, [
        el('div', { class: 'q', text: (i + 1) + '. ' + prompt.text }),
        el('div', { class: 'a' }, [
          el('span', { text: ent ? ent.name + (r.typed && dive.normalise(r.typed) !== dive.normalise(ent.name) ? ' (you typed “' + r.typed + '”)' : '') : (r.typed ? '“' + r.typed + '” — not accepted' : (r.timedOut ? 'Out of time' : r.skipped ? 'Skipped' : 'No answer')) }),
          tier ? el('span', { class: 'chip tier-' + tier.code, style: '--c: var(--tier-' + tier.code + ')', text: tier.emoji + ' ' + tier.name + ' +' + dive.formatMeters(dive.depthFor(r.points != null ? r.points : tier.points)) + ' m' }) : el('span', { class: 'chip chip-miss', text: '⬛ Miss' }),
        ]),
        meta.length ? el('div', { class: 'tiny muted', text: meta.join(' · ') }) : null,
        hadal ? el('div', { class: 'hadal-answer' }, [artNode(hadal, 36), el('span', { html: '<span class="tier tier-hadal">🔱 Hadal:</span> ' + esc(hadal.name) + (RESULT_LIST_FACT ? ' <span class="muted">— ' + esc(hadal.fact) + '</span>' : '') })]) : null,
        el('details', {}, [
          el('summary', { text: 'All accepted answers' }),
          el('div', { class: 'answer-groups', html: answersByTier(prompt).map(g => '<div><span class="tier tier-' + g.tier.code + '">' + g.tier.emoji + ' ' + esc(g.tier.name) + '</span><br>' + g.names.map(esc).join(', ') + '</div>').join('') + (prompt.taxon ? '<div class="small muted">Plus any real species on our ' + esc(dive.taxonGroups(prompt.taxon).join(', ').replace(/-/g, ' ')) + ' reference list' + (dive.taxonGroups(prompt.taxon).length > 1 ? 's' : '') + ' (Midnight).</div>' : '') }),
        ]),
        tutorial ? null : el('div', { style: 'margin-top:6px' }, root.FathomSocial && root.FathomSocial.reportButton ? root.FathomSocial.reportButton(prompt, r, record, reportHref(prompt, r, record)) : el('a', { class: 'link-btn', href: reportHref(prompt, r, record), target: config.REPORT_FORM_URL ? '_blank' : null, rel: 'noopener', text: 'Report an answer or tier', onClick: () => track('report_clicked', { prompt: prompt.id }) })),
      ]);
      list.append(li);
    });
    nodes.push(el('div', { class: 'card' }, [el('h2', { class: 'card-title', text: tutorial ? 'Your three questions' : 'Your seven questions' }), list]));
    // commercial bits live UNDER the result, never beside a timer
    if (record.mode === 'daily' && root.FathomMonetise) {
      const gd = root.FathomMonetise.goDeeperCard(record.dayKey);
      if (gd) nodes.push(gd);
      const ad = root.FathomMonetise.adSlot('result');
      if (ad) nodes.push(ad);
    } else if (record.mode === 'free' && root.FathomMonetise) {
      const ad = root.FathomMonetise.adSlot('free');       // every third Free Dive
      if (ad) nodes.push(ad);
    }
    nodes.push(el('div', { class: 'row center', style: 'justify-content:center' }, [el('a', { class: 'btn btn-ghost', href: '#logbook', text: 'Open the logbook' }), el('a', { class: 'btn btn-ghost', href: '#home', text: 'Home' })]));
    render(nodes);
    if (pendingStanding) drawStanding(pendingStanding);       // the demo curve answers before the screen is in the document
    if (root.FathomSub) {
      resultScene = root.FathomSub.mount(sceneWrap, { mode: 'rest', depth: record.depth });
      if (opts.fresh && (opts.personalBest || record.tiers.includes('hadal'))) setTimeout(() => { if (resultScene) resultScene.celebrate(); if (opts.personalBest) F().sound.hadal(); }, 500);
    }
    if (record.mode === 'daily') { startCountdown(record.dayKey); if (!opts.fresh) { const st = root.FathomOnline && root.FathomOnline.lastStanding ? root.FathomOnline.lastStanding(record) : null; if (st) drawStanding(st); } }
  }
  // "You beat 83% of divers today · Ranked #12 of 71 worldwide" — filled from the server, or the local estimate meanwhile.
  function drawStanding(st) {
    const node = document.getElementById('standing');
    if (!node || !st) return;
    if (st.total != null && st.total < 2) { node.textContent = 'You’re the first diver today — #1 of 1'; return; }
    const bits = [];
    if (st.beat != null) bits.push('You beat <b>' + st.beat + '%</b> of divers today');
    if (st.rank != null && st.total != null) bits.push('Ranked <b>#' + st.rank + '</b> of ' + Number(st.total).toLocaleString('en-US') + ' worldwide');
    node.innerHTML = bits.join(' · ') + (st.early ? ' <span class="muted">(early)</span>' : '') + (st.demo ? ' <span class="badge demo">demo</span>' : '');
  }
  // The four reasons to come back, one tap each.
  function returnHooks(record, challengeSeed) {
    const { el, dive, storage, esc } = F();
    const today = F().todayKey();
    const streak = storage.streak(today, dive.keyPlusDays);
    const card = el('div', { class: 'card hooks' }, [el('h2', { class: 'card-title', text: 'Come back deeper' })]);
    const list = el('ul', { class: 'hook-list' });
    // 1. tomorrow's countdown → one tap sets a reminder
    const cd = el('li', { class: 'hook' }, [
      el('span', { class: 'hook-icon', 'aria-hidden': 'true', text: '⏳' }),
      el('span', { class: 'hook-text', html: 'Next dive in <b id="countdown">--:--:--</b>' }),
      root.FathomRetain && !storage.settings().reminders ? el('button', { class: 'btn btn-sm', type: 'button', id: 'hook-remind', text: 'Remind me', onClick: async () => { storage.updateSettings({ askedPush: true }); await root.FathomRetain.subscribe(storage.settings().remindHour); } }) : el('span', { class: 'tiny muted', text: storage.settings().reminders ? 'reminder on' : '' }),
    ]);
    list.append(cd);
    // 2. the streak and the next streak badge
    const streakBadges = [['streak-3', 3], ['streak-7', 7], ['streak-30', 30]];
    const have = root.FathomAchievements ? root.FathomAchievements.unlocked() : {};
    const nextStreak = streakBadges.find(([id, n]) => !have[id] && n > streak.current);
    const badgeName = (id) => { const b = root.FathomAchievements ? root.FathomAchievements.BADGES.find(x => x.id === id) : null; return b ? b.emoji + ' ' + b.name : ''; };
    list.append(el('li', { class: 'hook' }, [
      el('span', { class: 'hook-icon', 'aria-hidden': 'true', text: '🔥' }),
      el('span', { class: 'hook-text', html: '<b>' + streak.current + '-day streak</b>' + (nextStreak ? ' · ' + (nextStreak[1] - streak.current) + ' more day' + (nextStreak[1] - streak.current === 1 ? '' : 's') + ' to ' + esc(badgeName(nextStreak[0])) : ' · every streak badge earned') }),
      el('a', { class: 'btn btn-sm', href: '#logbook-badges', text: 'Badges' }),
    ]));
    // 3. challenge a friend: the link carries your depth; the card draws the sub at it
    list.append(el('li', { class: 'hook' }, [
      el('span', { class: 'hook-icon', 'aria-hidden': 'true', text: '⚔️' }),
      el('span', { class: 'hook-text', html: 'Same seven, your depth to beat' }),
      el('button', { class: 'btn btn-sm btn-primary', type: 'button', id: 'challenge-btn', text: 'Challenge a friend', onClick: () => {
        copyText(location.href.split('#')[0] + dive.makeChallengeHash(challengeSeed, record.depth, record.tiers), 'Challenge link copied — send it to a friend');
        track('challenge_created', { mode: record.mode });
      } }),
    ]));
    // 4. the weekly recap
    const O = root.FathomOnline;
    const signedIn = O && O.user && O.user();
    list.append(el('li', { class: 'hook' }, [
      el('span', { class: 'hook-icon', 'aria-hidden': 'true', text: '✉️' }),
      el('span', { class: 'hook-text', html: 'A Sunday recap: your week, best depth, badges' }),
      signedIn ? (O.recapToggle ? O.recapToggle() : null) : el('button', { class: 'btn btn-sm', type: 'button', id: 'hook-recap', text: 'Email me', onClick: () => { if (O && O.emailSignInModal) O.emailSignInModal(); else F().toast('Sign in from Settings to get the recap'); } }),
    ]));
    card.append(list);
    // first week: yesterday's dive and one badge still locked
    const yesterday = dive.keyPlusDays(today, -1);
    const extras = [];
    if (yesterday >= dive.LAUNCH_DATE && !(storage.get('archive', {}))[yesterday] && !storage.getDailyResult(yesterday)) extras.push(el('a', { class: 'link-btn', href: '#archive-' + yesterday, text: 'Try yesterday’s dive →' }));
    if (root.FathomAchievements) {
      const locked = root.FathomAchievements.BADGES.find(b => !have[b.id] && /^(twilight|midnight|titanic|abyss|hadal-zone|deepest-fish|challenger|first-hadal|no-miss|full-spectrum)$/.test(b.id));
      if (locked) extras.push(el('span', { class: 'badge-item locked-next', title: locked.blurb }, [el('span', { class: 'badge-emoji', 'aria-hidden': 'true', text: '🔒' }), el('span', { class: 'badge-text' }, [el('b', { text: locked.name }), el('span', { class: 'tiny muted', text: locked.blurb })])]));
    }
    if (extras.length) card.append(el('div', { class: 'hook-extras' }, extras));
    return card;
  }

  function copyText(text, okMsg) {
    const { toast } = F();
    const done = () => toast(okMsg || 'Copied');
    const showBox = () => {   // the host refused the clipboard: show the text so the player can copy it by hand
      const { el, modal } = F();
      const ta = el('textarea', { class: 'copy-box', readonly: true, 'aria-label': 'Text to copy' });
      ta.value = text;
      modal({ title: 'Copy this', body: el('div', {}, [el('p', { class: 'small muted', text: 'Your browser did not allow copying automatically. Select the text below and copy it.' }), ta]) });
      ta.focus(); ta.select();
    };
    const fallback = () => {
      let ok = false;
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
      } catch (e) { ok = false; }
      if (ok) done(); else showBox();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  function startCountdown(dayKey) {
    const { dive, config } = F();
    const tick = () => {
      const node = document.getElementById('countdown');
      if (!node) { if (countdownTimer) clearInterval(countdownTimer); countdownTimer = null; return; }
      if (dayKey && F().todayKey() !== dayKey) { clearInterval(countdownTimer); countdownTimer = null; F().navigate('#daily'); return; }
      const ms = dive.msUntilNextDay(new Date());
      const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
      node.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    };
    tick();
    countdownTimer = setInterval(tick, config.COUNTDOWN_TICK_MS);
  }

  // keyboard shortcuts (wired in app.js): only while a question is open
  function shortcut(what) {
    if (!state || state.answered) return;
    if (what === 'lure') useHint();
    else if (what === 'skip') skip();
  }

  root.FathomGame = { startDaily, startFree, startArchive, startPack, startChallenge, startTutorial, startDive, resultScreen, leaveDive, copyText, hadalEntity, answersByTier, artNode, shortcut, drawStanding, renderAsk, RADIO, TUTORIAL_PROMPT_IDS };
})(window);
