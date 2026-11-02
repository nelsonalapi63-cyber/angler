/* FATHOM — the dive itself: prompts, timer, matching, reveal, result screen. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- parameters
  const TIMER_TICK_MS = 100;
  const LOW_TIME_SECONDS = 5;          // timer ring turns red below this
  const RESULT_LIST_FACT = true;       // show the fact under each prompt on the result screen
  const MODE_LABELS = { daily: 'Daily Dive', free: 'Free Dive', pack: 'Themed Pack', archive: 'Archive Dive', challenge: 'Challenge' };

  const F = () => root.Fathom;
  let state = null;          // the live dive
  let countdownTimer = null;

  // ---------------------------------------------------------------- helpers
  function promptIndex(prompt) {
    if (!prompt._index) prompt._index = F().dive.buildIndex(prompt, F().entities);
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
  function modeLabel(record) {
    const { packsById, dive } = F();
    if (record.mode === 'daily') return 'FATHOM #' + record.number;
    if (record.mode === 'archive') return 'Archive · FATHOM #' + dive.puzzleNumber(record.dayKey);
    if (record.mode === 'pack') return (packsById[record.packId] ? packsById[record.packId].name : 'Pack');
    if (record.mode === 'challenge') return 'Challenge';
    return 'Free Dive';
  }
  function reportHref(prompt, result, record) {
    const { config, dive } = F();
    const subject = 'FATHOM report: ' + prompt.id;
    const body = 'Prompt: ' + prompt.text + '\nPrompt id: ' + prompt.id + '\nMode: ' + record.mode + (record.dayKey ? ' (' + record.dayKey + ')' : '') +
      '\nI typed: ' + (result.typed || '(nothing)') + '\nIt scored: ' + (result.tier ? dive.TIER_BY_CODE[result.tier].name : 'miss') +
      '\n\nWhat is wrong (answer missing, wrong tier, wrong fact):\n';
    if (config.REPORT_FORM_URL) {
      const sep = config.REPORT_FORM_URL.indexOf('?') > -1 ? '&' : '?';
      return config.REPORT_FORM_URL + sep + 'prompt=' + encodeURIComponent(prompt.id) + '&typed=' + encodeURIComponent(result.typed || '') + '&tier=' + encodeURIComponent(result.tier || 'miss') + '&mode=' + encodeURIComponent(record.mode);
    }
    return 'mailto:' + config.FEEDBACK_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }
  function clearTimers() {
    if (state) {
      if (state.timer) clearInterval(state.timer);
      if (state.revealTimer) clearTimeout(state.revealTimer);
      state.timer = state.revealTimer = null;
    }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }
  function leaveDive() { clearTimers(); state = null; }

  // ---------------------------------------------------------------- starting dives
  function startDaily() {
    const { dive, storage, prompts, toast } = F();
    const today = F().todayKey();
    const existing = storage.getDailyResult(today);
    if (existing) return resultScreen(existing, { fresh: false });
    const promptIds = dive.dailyPromptIds(today, prompts, dive.LAUNCH_DATE);
    if (!promptIds) return root.FathomPages.message('Not yet', 'FATHOM #1 opens on ' + dive.LAUNCH_DATE + ' (Eastern time). Try a Free Dive meanwhile.');
    startDive({ mode: 'daily', promptIds, dayKey: today, number: dive.puzzleNumber(today) });
  }
  function startFree(seed) {
    const { dive, prompts } = F();
    const s = seed || dive.randomSeed(6);
    if (location.hash !== '#free-' + s) { history.replaceState(null, '', '#free-' + s); }
    startDive({ mode: 'free', promptIds: dive.freePromptIds(s, prompts), seed: s });
  }
  function startArchive(dayKey) {
    const { dive, storage, prompts } = F();
    const today = F().todayKey();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || dayKey < dive.LAUNCH_DATE || dayKey >= today) return root.FathomPages.archive();
    const M = root.FathomMonetise;
    if (M && !M.isArchiveUnlocked(dayKey)) { root.FathomPages.archive(); M.openUnlock('archive'); return; }
    const existing = (storage.get('archive', {}))[dayKey];
    if (existing) return resultScreen(existing, { fresh: false });
    startDive({ mode: 'archive', promptIds: dive.dailyPromptIds(dayKey, prompts, dive.LAUNCH_DATE), dayKey, number: dive.puzzleNumber(dayKey) });
  }
  function startPack(packId) {
    const { dive, prompts, packsById } = F();
    const pack = packsById[packId];
    if (!pack) return root.FathomPages.packs();
    const M = root.FathomMonetise;
    if (M && !M.isPackUnlocked(packId)) { root.FathomPages.packs(); M.openUnlock('pack', packId); return; }
    startDive({ mode: 'pack', promptIds: dive.packPromptIds(pack, prompts), packId });
  }
  function startChallenge(hash) {
    const { dive, prompts, toast } = F();
    const parsed = dive.parseChallenge(hash);
    if (!parsed) { toast('That challenge link is not valid — here is a fresh dive.'); return startFree(); }
    startDive({ mode: 'challenge', promptIds: dive.freePromptIds(parsed.seed, prompts), seed: parsed.seed, challenge: { depth: parsed.depth, tiers: parsed.tiers } });
  }

  // ---------------------------------------------------------------- the dive loop
  function startDive(spec) {
    const { storage, dive } = F();
    clearTimers();
    const timerOn = spec.mode === 'free' ? storage.settings().freeTimer !== false : true;
    state = { spec, idx: 0, results: [], points: 0, depth: 0, timerOn, timer: null, revealTimer: null, answered: false, promptStart: 0, deadline: 0 };
    if (root.FathomOnline && root.FathomOnline.trackEvent) root.FathomOnline.trackEvent('dive_started', { mode: spec.mode });
    renderDiveShell();
    renderPrompt();
  }

  function renderDiveShell() {
    const { el, charts, render } = F();
    const compact = !root.matchMedia('(min-width: 560px)').matches;
    const gaugeWrap = el('div', { class: 'gauge-wrap', html: charts.gaugeSvg(0, compact) });
    const mainCol = el('div', { class: 'dive-main' });
    render(el('section', { class: 'dive', 'aria-label': 'Dive' }, [gaugeWrap, mainCol]));
    state.gauge = gaugeWrap.querySelector('svg');
    state.mainCol = mainCol;
  }

  function progressDots() {
    const { el, dive } = F();
    const dots = [];
    for (let i = 0; i < dive.PROMPTS_PER_DIVE; i++) {
      const r = state.results[i];
      const cls = r ? (r.tier ? 'tier-' + r.tier : 'miss') : (i === state.idx ? 'cur' : '');
      dots.push(el('span', { class: cls, style: r && r.tier ? '--c: var(--tier-' + r.tier + ')' : (r ? '--c: var(--tier-miss)' : ''), 'aria-hidden': 'true' }));
    }
    return el('div', { class: 'progress-dots' }, dots);
  }

  function timerNode() {
    const { el, dive } = F();
    if (!state.timerOn) return el('div', { class: 'muted small', text: 'No timer' });
    const C = 2 * Math.PI * 20;
    const t = el('div', { class: 'timer', role: 'timer', 'aria-live': 'off' }, [
      el('div', { html: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="track" cx="24" cy="24" r="20"/><circle class="arc" cx="24" cy="24" r="20" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="0"/></svg>' }),
      el('div', { class: 'num', text: String(dive.SECONDS_PER_PROMPT) }),
    ]);
    return t;
  }

  function renderPrompt() {
    const { el, dive, promptsById, esc, config } = F();
    const promptId = state.spec.promptIds[state.idx];
    const prompt = promptsById[promptId];
    state.answered = false;
    const input = el('input', { class: 'input', id: 'answer', type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', placeholder: 'Type one answer…', 'aria-label': 'Your answer', maxlength: '60' });
    const submitBtn = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Dive' });
    const form = el('form', { class: 'answer-form', onSubmit: (e) => { e.preventDefault(); submit(input.value); } }, [input, submitBtn]);
    const head = el('div', { class: 'dive-head' }, [
      el('div', {}, [
        el('div', { class: 'tiny muted', text: (MODE_LABELS[state.spec.mode] || '') + (state.spec.number ? ' · FATHOM #' + state.spec.number : '') }),
        el('div', { class: 'small', html: '<b>Prompt ' + (state.idx + 1) + ' of ' + dive.PROMPTS_PER_DIVE + '</b>' }),
        progressDots(),
      ]),
      timerNode(),
    ]);
    const challengeNote = state.spec.challenge && state.spec.challenge.depth ? el('p', { class: 'small', html: 'Beat <b>' + esc(dive.formatMeters(state.spec.challenge.depth)) + ' m</b> to win this challenge.' }) : null;
    state.mainCol.innerHTML = '';
    state.mainCol.append(head, challengeNote || '', el('h2', { class: 'prompt-text', id: 'prompt-text', text: prompt.text }), form, el('div', { id: 'reveal' }));
    state.input = input;
    state.form = form;
    setTimeout(() => input.focus(), 30);
    state.promptStart = performance.now();
    if (state.timerOn) {
      state.deadline = state.promptStart + dive.SECONDS_PER_PROMPT * 1000;
      const arc = state.mainCol.querySelector('.timer .arc');
      const num = state.mainCol.querySelector('.timer .num');
      const timerEl = state.mainCol.querySelector('.timer');
      const C = 2 * Math.PI * 20;
      let lastWhole = dive.SECONDS_PER_PROMPT;
      state.timer = setInterval(() => {
        const remaining = Math.max(0, state.deadline - performance.now()) / 1000;
        if (arc) arc.setAttribute('stroke-dashoffset', (C * (1 - remaining / dive.SECONDS_PER_PROMPT)).toFixed(1));
        const whole = Math.ceil(remaining);
        if (num && whole !== lastWhole) { num.textContent = String(whole); lastWhole = whole; if (whole <= LOW_TIME_SECONDS && whole > 0) F().sound.tick(); }
        if (timerEl) timerEl.classList.toggle('low', remaining <= LOW_TIME_SECONDS);
        if (remaining <= 0) submit(null);
      }, TIMER_TICK_MS);
    }
  }

  function submit(typed) {
    if (!state || state.answered) return;
    const { el, dive, promptsById, entities, charts, storage, config, esc, sound, applyDepthTint } = F();
    state.answered = true;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    const promptId = state.spec.promptIds[state.idx];
    const prompt = promptsById[promptId];
    const secondsUsed = Math.min(dive.SECONDS_PER_PROMPT, Math.max(0, (performance.now() - state.promptStart) / 1000));
    const text = typed == null ? '' : String(typed).trim();
    const m = text ? dive.matchAnswer(text, promptIndex(prompt)) : { entityId: null, tier: null, points: 0, via: null };
    const result = { promptId, typed: text, entityId: m.entityId, tier: m.tier, points: m.points, secondsUsed: Math.round(secondsUsed * 10) / 10, timedOut: typed == null };
    state.results.push(result);
    state.points += m.points;
    const prevDepth = state.depth;
    state.depth = dive.depthFor(state.points);
    state.input.disabled = true;
    state.form.querySelector('button').disabled = true;

    const reveal = state.mainCol.querySelector('#reveal');
    const hadal = hadalEntity(prompt);
    let tile, factText;
    if (m.entityId) {
      const ent = entities[m.entityId];
      const tier = dive.TIER_BY_CODE[m.tier];
      storage.logbookAdd(m.entityId, m.tier, m.points, promptId, F().todayKey());
      tile = el('div', { class: 'tile tier-' + m.tier, style: '--c: var(--tier-' + m.tier + ')' }, [
        el('div', { class: 'tile-top' }, [
          el('div', { class: 'tile-name', text: tier.emoji + ' ' + tier.name }),
          el('div', { class: 'tile-meters', text: '+' + dive.formatMeters(state.depth - prevDepth) + ' m' }),
        ]),
        el('div', { class: 'tile-sub', text: ent.name + (m.via === 'fuzzy' ? ' (close enough)' : '') + ' · ' + tier.points + ' points' }),
      ]);
      factText = ent.fact;
      sound.reveal(m.tier);
    } else {
      state.input.classList.add('shake');
      tile = el('div', { class: 'tile tile-miss', style: '--c: var(--tier-miss)' }, [
        el('div', { class: 'tile-top' }, [
          el('div', { class: 'tile-name', text: (typed == null ? '⏱ Out of time' : '⬛ Not an accepted answer') }),
          el('div', { class: 'tile-meters', text: '+0 m' }),
        ]),
        el('div', { class: 'tile-sub', text: hadal ? 'The Hadal answer was ' + hadal.name + '.' : '' }),
      ]);
      factText = hadal ? hadal.fact : '';
      sound.miss();
      if (typed != null) F().toast('Not an accepted answer');
    }
    reveal.innerHTML = '';
    reveal.append(tile);
    if (factText) reveal.append(el('p', { class: 'fact', html: '<b>Did you know?</b> ' + esc(factText) }));
    const nextBtn = el('button', { class: 'btn btn-primary', type: 'button', text: state.idx + 1 >= dive.PROMPTS_PER_DIVE ? 'See your dive' : 'Next prompt', onClick: next });
    reveal.append(el('div', { class: 'next-row' }, [progressDots(), nextBtn]));
    nextBtn.focus();
    charts.updateGauge(state.gauge, state.depth);
    applyDepthTint(state.depth);
    state.revealTimer = setTimeout(next, config.REVEAL_MS + (m.entityId ? 600 : 300));
  }

  function next() {
    if (!state) return;
    if (state.revealTimer) { clearTimeout(state.revealTimer); state.revealTimer = null; }
    state.idx++;
    if (state.idx >= F().dive.PROMPTS_PER_DIVE) return finish();
    renderPrompt();
  }

  function finish() {
    const { dive, storage, packsById } = F();
    const s = state.spec;
    const record = {
      mode: s.mode, dayKey: s.dayKey || null, number: s.number || null, seed: s.seed || null, packId: s.packId || null,
      promptIds: s.promptIds.slice(), results: state.results, points: state.points, depth: state.depth,
      tiers: state.results.map(r => r.tier), secondsUsed: Math.round(state.results.reduce((n, r) => n + r.secondsUsed, 0) * 10) / 10,
      finishedAt: new Date().toISOString(), challenge: s.challenge || null, timerOn: state.timerOn,
    };
    if (s.mode === 'daily') {
      storage.saveDailyResult(s.dayKey, record);
      if (root.FathomOnline && root.FathomOnline.submitDaily) root.FathomOnline.submitDaily(record);
    } else if (s.mode === 'free') {
      storage.bumpFreeDiveCount();
      storage.saveBest('free', 'free', record);
    } else if (s.mode === 'pack') {
      storage.saveBest('pack', s.packId, record);
    } else if (s.mode === 'archive') {
      const all = storage.get('archive', {});
      all[s.dayKey] = record;
      storage.set('archive', all);
    } else if (s.mode === 'challenge') {
      storage.saveBest('challenge', s.seed, record);
    }
    clearTimers();
    state = null;
    if (root.FathomOnline && root.FathomOnline.trackEvent) root.FathomOnline.trackEvent('dive_completed', { mode: record.mode, depth: record.depth });
    resultScreen(record, { fresh: true });
  }

  // ---------------------------------------------------------------- result screen
  function resultScreen(record, opts) {
    const { el, dive, promptsById, entities, esc, render, toast, config, storage, packsById } = F();
    clearTimers();
    F().applyDepthTint(record.depth);
    const zone = dive.zoneFor(record.depth);
    const nodes = [];

    const head = el('div', { class: 'card strong center' }, [
      el('div', { class: 'tiny muted', text: modeLabel(record) + (record.mode === 'free' && record.seed ? ' · ' + record.seed : '') }),
      el('div', { class: 'result-depth', html: esc(dive.formatMeters(record.depth)) + '<small>m</small>' }),
      el('div', { html: '<b>' + esc(zone.name) + '</b>' }),
      el('p', { class: 'small muted', text: zone.fact }),
      el('div', { class: 'grid-emoji', 'aria-label': 'Tier grid', text: dive.tiersToEmoji(record.tiers) }),
    ]);
    nodes.push(head);

    // challenge comparison
    if (record.mode === 'challenge' && record.challenge) {
      const c = record.challenge;
      const grid = el('div', { class: 'compare-grid' });
      if (c.tiers) grid.append(el('div', {}, [el('span', { class: 'who', text: 'Them' }), el('span', { text: dive.tiersToEmoji(c.tiers) })]));
      grid.append(el('div', {}, [el('span', { class: 'who', text: 'You' }), el('span', { text: dive.tiersToEmoji(record.tiers) })]));
      const verdict = c.depth ? (record.depth > c.depth ? 'You beat ' + dive.formatMeters(c.depth) + ' m.' : record.depth === c.depth ? 'A tie at ' + dive.formatMeters(c.depth) + ' m.' : 'They went deeper: ' + dive.formatMeters(c.depth) + ' m.') : 'Send your score back to compare.';
      const sendBack = el('button', { class: 'btn btn-primary', type: 'button', text: 'Send your score back', onClick: () => copyText(location.href.split('#')[0] + dive.makeChallengeHash(record.seed, record.depth, record.tiers), 'Challenge link copied') });
      nodes.push(el('div', { class: 'card' }, [el('h3', { text: 'Challenge' }), el('p', { text: verdict }), grid, el('div', { class: 'row', style: 'margin-top:10px' }, sendBack)]));
    }

    // bell curve (daily only, when online or mock)
    if (record.mode === 'daily' && root.FathomOnline && root.FathomOnline.curveSection) {
      const sec = root.FathomOnline.curveSection(record);
      if (sec) nodes.push(sec);
    }

    // share / actions
    const actions = el('div', { class: 'card' });
    const shareBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Share', onClick: () => {
      const pct = root.FathomOnline && root.FathomOnline.lastPercentile ? root.FathomOnline.lastPercentile(record) : null;
      const text = dive.shareText({ number: record.number || dive.puzzleNumber(F().todayKey()), depth: record.depth, percentile: record.mode === 'daily' ? pct : null, tiers: record.tiers, siteUrl: config.SITE_URL });
      copyText(text, 'Copied results to clipboard');
      if (root.FathomOnline && root.FathomOnline.trackEvent) root.FathomOnline.trackEvent('share_clicked', { mode: record.mode });
    } });
    const row = el('div', { class: 'row' }, [shareBtn]);
    if (record.mode === 'free') {
      row.append(el('button', { class: 'btn', type: 'button', text: 'Challenge a friend', onClick: () => {
        copyText(location.href.split('#')[0] + dive.makeChallengeHash(record.seed, record.depth, record.tiers), 'Challenge link copied — send it to a friend');
        if (root.FathomOnline && root.FathomOnline.trackEvent) root.FathomOnline.trackEvent('challenge_created', {});
      } }));
    }
    if (record.mode === 'daily') {
      const cd = el('p', { class: 'small muted', style: 'margin:12px 0 0', html: 'Next dive in <b id="countdown">--:--:--</b>' });
      row.append(el('a', { class: 'btn', href: '#free', text: 'Free Dive' }));
      actions.append(row, cd);
    } else {
      row.append(el('a', { class: 'btn', href: record.mode === 'pack' ? '#packs' : '#free', text: record.mode === 'pack' ? 'More packs' : 'Dive again' }));
      actions.append(row);
    }
    nodes.push(actions);

    if (record.mode === 'daily' && root.FathomMonetise) {
      const gd = root.FathomMonetise.goDeeperCard(record.dayKey);
      if (gd) nodes.push(gd);
      const ad = root.FathomMonetise.adSlot('result');
      if (ad) nodes.push(ad);
    }

    // per prompt breakdown
    const list = el('ul', { class: 'result-list' });
    record.results.forEach((r, i) => {
      const prompt = promptsById[r.promptId];
      if (!prompt) return;
      const ent = r.entityId ? entities[r.entityId] : null;
      const tier = r.tier ? dive.TIER_BY_CODE[r.tier] : null;
      const hadal = hadalEntity(prompt);
      const li = el('li', {}, [
        el('div', { class: 'q', text: (i + 1) + '. ' + prompt.text }),
        el('div', { class: 'a' }, [
          el('span', { text: ent ? ent.name + (r.typed && dive.normalise(r.typed) !== dive.normalise(ent.name) ? ' (you typed “' + r.typed + '”)' : '') : (r.typed ? '“' + r.typed + '” — not accepted' : (r.timedOut ? 'Out of time' : 'No answer')) }),
          tier ? el('span', { class: 'chip tier-' + tier.code, style: '--c: var(--tier-' + tier.code + ')', text: tier.emoji + ' ' + tier.name + ' +' + dive.formatMeters(dive.depthFor(tier.points)) + ' m' }) : el('span', { class: 'chip chip-miss', text: '⬛ Miss' }),
        ]),
        hadal ? el('div', { class: 'hadal-answer', html: '<span class="tier tier-hadal">🔱 Hadal:</span> ' + esc(hadal.name) + (RESULT_LIST_FACT ? ' <span class="muted">— ' + esc(hadal.fact) + '</span>' : '') }) : null,
        el('details', {}, [
          el('summary', { text: 'All accepted answers' }),
          el('div', { class: 'answer-groups', html: answersByTier(prompt).map(g => '<div><span class="tier tier-' + g.tier.code + '">' + g.tier.emoji + ' ' + esc(g.tier.name) + '</span><br>' + g.names.map(esc).join(', ') + '</div>').join('') }),
        ]),
        el('div', { style: 'margin-top:6px' }, el('a', { class: 'link-btn', href: reportHref(prompt, r, record), target: config.REPORT_FORM_URL ? '_blank' : null, rel: 'noopener', text: 'Report an answer or tier', onClick: () => { if (root.FathomOnline && root.FathomOnline.trackEvent) root.FathomOnline.trackEvent('report_clicked', { prompt: prompt.id }); } })),
      ]);
      list.append(li);
    });
    nodes.push(el('div', { class: 'card' }, [el('h3', { text: 'Your seven prompts' }), list]));
    nodes.push(el('div', { class: 'row center', style: 'justify-content:center' }, [el('a', { class: 'btn btn-ghost', href: '#logbook', text: 'Open the logbook' }), el('a', { class: 'btn btn-ghost', href: '#home', text: 'Home' })]));
    render(nodes);
    if (record.mode === 'daily') startCountdown();
  }

  function copyText(text, okMsg) {
    const { toast } = F();
    const done = () => toast(okMsg || 'Copied');
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();
      } catch (e) { toast('Could not copy — select the text to share it'); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  function startCountdown() {
    const { dive, config } = F();
    const tick = () => {
      const node = document.getElementById('countdown');
      if (!node) { if (countdownTimer) clearInterval(countdownTimer); countdownTimer = null; return; }
      const ms = dive.msUntilNextDay(new Date());
      const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
      node.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      if (ms <= 0) { clearInterval(countdownTimer); countdownTimer = null; F().navigate('#daily'); }
    };
    tick();
    countdownTimer = setInterval(tick, config.COUNTDOWN_TICK_MS);
  }

  root.FathomGame = { startDaily, startFree, startArchive, startPack, startChallenge, startDive, resultScreen, leaveDive, copyText, hadalEntity, answersByTier };
})(window);
