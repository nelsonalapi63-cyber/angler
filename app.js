/* FATHOM — app shell: configuration, DOM helpers, router, menu, modals, toasts, theme, sound. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- parameters
  const CONFIG = {
    SITE_URL: '',                       // e.g. 'https://fathom.example' once the site has a domain (added to share text)
    FEEDBACK_EMAIL: 'hello@fathom.example',
    REPORT_FORM_URL: '',                // if set, "Report an answer" opens this instead of email
    REVEAL_MS: 2600,                    // how long a tier reveal stays before auto-advancing
    SOUND_VOLUME: 0.07,
    BUBBLE_COUNT: 7,
    COUNTDOWN_TICK_MS: 1000,
    SCENE_PX_PER_M: 0.35,               // how far the background scrolls per metre of depth (the descent)
    DESCENT_BASE_MS: 700,               // descent animation: base duration…
    DESCENT_MS_PER_100M: 90,            // …plus this per 100 m of drop…
    DESCENT_MAX_MS: 2600,               // …capped here
    HAPTICS: { accept: [25], miss: [12, 40, 12], hadal: [40, 30, 40, 30, 140], tick: [8] },
    BANK_FILES: ['entities.js', 'prompts.js', 'taxa.js'],   // the full answer bank, loaded after boot
    DEPTH_TINT_STOPS: {                 // page background by depth fraction (0 = surface, 1 = Challenger Deep)
      dark:  [[0, '#0F4C5C'], [0.09, '#0B3A52'], [0.37, '#071D33'], [0.55, '#040F1E'], [1, '#02060D']],
      light: [[0, '#D9EEF2'], [0.37, '#B6D3E0'], [0.75, '#90B0C4'], [1, '#7F9DB0']],
    },
  };

  const dive = root.FathomDive;
  const storage = root.FathomStorage;
  const charts = root.FathomCharts;

  // ---------------------------------------------------------------- data
  // boot.js carries today's and tomorrow's prompts (plus the tutorial's) so the page opens fast; the full bank
  // (entities.js, prompts.js, taxa.js) is fetched in the background and swapped in by ensureBank().
  const boot = root.FATHOM_BOOT || null;
  const data = {
    entities: root.FATHOM_ENTITIES || (boot ? boot.entities : {}),
    prompts: root.FATHOM_PROMPTS || (boot ? boot.prompts : []),
    packs: root.FATHOM_PACKS || (boot ? boot.packs : []),
    schedule: root.FATHOM_SCHEDULE || (boot ? boot.schedule : {}),
    taxa: root.FATHOM_TAXA || (boot ? boot.taxa : {}),
    full: !!root.FATHOM_PROMPTS,
  };
  function refreshIndexes() {
    data.promptsById = dive.byId(data.prompts);
    data.packsById = Object.fromEntries(data.packs.map(p => [p.id, p]));
    if (root.Fathom) Object.assign(root.Fathom, { entities: data.entities, prompts: data.prompts, promptsById: data.promptsById, packs: data.packs, packsById: data.packsById, schedule: data.schedule, taxa: data.taxa, bankLoaded: data.full });
  }
  refreshIndexes();
  let bankPromise = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = resolve; el.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(el);
    });
  }
  function ensureBank() {
    if (data.full) return Promise.resolve(data);
    if (!bankPromise) {
      bankPromise = Promise.all(CONFIG.BANK_FILES.map(loadScript)).then(() => {
        data.entities = root.FATHOM_ENTITIES || data.entities;
        data.prompts = root.FATHOM_PROMPTS || data.prompts;
        data.packs = root.FATHOM_PACKS || data.packs;
        data.schedule = root.FATHOM_SCHEDULE || data.schedule;
        data.taxa = root.FATHOM_TAXA || data.taxa;
        data.full = true;
        refreshIndexes();
        document.dispatchEvent(new CustomEvent('fathom:bank'));
        return data;
      }).catch((e) => { bankPromise = null; throw e; });
    }
    return bankPromise;
  }
  function hasPromptData(promptIds) {
    return (promptIds || []).every(id => data.promptsById[id] && data.promptsById[id].answers.every(a => data.entities[a.entity]));
  }

  // ---------------------------------------------------------------- DOM helpers
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) return c.forEach(add);
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    };
    add(children);
    return node;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const main = () => document.getElementById('main');
  function render(nodes) {
    const m = main();
    m.innerHTML = '';
    (Array.isArray(nodes) ? nodes : [nodes]).forEach(n => n && m.appendChild(n));
    root.scrollTo({ top: 0 });
  }

  // ---------------------------------------------------------------- toast
  function toast(msg, ms) {
    const t = el('div', { class: 'toast', role: 'status', text: msg });
    document.getElementById('toast-root').appendChild(t);
    setTimeout(() => t.remove(), ms || 1800);
  }

  // ---------------------------------------------------------------- modal
  let modalEl = null;
  let modalTrigger = null;
  function closeModal() {
    if (!modalEl) return;
    const onClose = modalEl._onClose;
    modalEl.remove();
    modalEl = null;
    if (onClose) onClose();
    if (modalTrigger && document.contains(modalTrigger)) { try { modalTrigger.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    modalTrigger = null;
  }
  function modal(opts) {
    closeModal();
    const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Dialog' });
    const head = el('div', { class: 'modal-head' }, [
      el('h2', { text: opts.title || '' }),
      el('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: closeModal, html: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>' }),
    ]);
    box.appendChild(head);
    if (typeof opts.body === 'string') box.appendChild(el('div', { html: opts.body }));
    else if (opts.body) box.appendChild(opts.body);
    const wrap = el('div', { class: 'modal-wrap', onClick: (e) => { if (e.target === wrap) closeModal(); } }, box);
    wrap._onClose = opts.onClose;
    document.getElementById('modal-root').appendChild(wrap);
    modalEl = wrap;
    modalTrigger = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const heading = head.querySelector('h2');
    heading.setAttribute('tabindex', '-1');
    try { heading.focus({ preventScroll: true }); } catch (e) { heading.focus(); }   // read the title first; never open scrolled
    return box;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeMenu(); } });
  // A small yes/no dialog that sits on top of whatever modal is open (Cancel returns to it).
  function confirmDialog(message, okLabel) {
    return new Promise((resolve) => {
      let answered = false;
      const wrap = el('div', { class: 'modal-wrap confirm' });
      const done = (v) => { if (answered) return; answered = true; wrap.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      const box = el('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Are you sure?' }, [
        el('div', { class: 'modal-head' }, el('h2', { text: 'Are you sure?' })),
        el('p', { text: message }),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn btn-primary', type: 'button', text: okLabel || 'Yes', onClick: () => done(true) }),
          el('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => done(false) }),
        ]),
      ]);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) done(false); });
      wrap.appendChild(box);
      document.getElementById('modal-root').appendChild(wrap);
      document.addEventListener('keydown', onKey, true);
      box.querySelector('.btn').focus();
    });
  }

  // ---------------------------------------------------------------- menu drawer
  const menu = () => document.getElementById('menu');
  function openMenu() {
    menu().hidden = false;
    document.getElementById('scrim').hidden = false;
    document.getElementById('btn-menu').setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    if (!menu()) return;
    menu().hidden = true;
    document.getElementById('scrim').hidden = true;
    document.getElementById('btn-menu').setAttribute('aria-expanded', 'false');
  }

  // ---------------------------------------------------------------- theme and depth tint
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(stops, t) {
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
    const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
    const ca = hexToRgb(a[1]), cb = hexToRgb(b[1]);
    const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * f));
    return 'rgb(' + c.join(',') + ')';
  }
  let currentDepthTint = 0;
  function applyDepthTint(depth) {
    currentDepthTint = depth || 0;
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const t = Math.min(1, Math.max(0, currentDepthTint / dive.CHALLENGER_DEEP_M));
    document.documentElement.style.setProperty('--bg-depth', mix(CONFIG.DEPTH_TINT_STOPS[theme], t));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mix(CONFIG.DEPTH_TINT_STOPS[theme], t));
  }
  function applySettings() {
    const s = storage.settings();
    document.documentElement.dataset.theme = s.theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.contrast = s.contrast ? 'true' : 'false';
    applyDepthTint(currentDepthTint);
  }

  // ---------------------------------------------------------------- the scene: a tall column behind everything that scrolls up as you sink
  let sceneEl = null;
  function buildScene() {
    sceneEl = document.getElementById('scene');
    if (!sceneEl) return;
    const px = CONFIG.SCENE_PX_PER_M;
    const total = Math.round(dive.CHALLENGER_DEEP_M * px);
    const col = el('div', { class: 'scene-col', style: 'height:' + (total + 1400) + 'px' });
    for (let m = 500; m < dive.CHALLENGER_DEEP_M; m += 500) {
      col.appendChild(el('div', { class: 'scene-tick' + (m % 1000 === 0 ? ' major' : ''), style: 'top:' + Math.round(m * px) + 'px', text: m % 1000 === 0 ? dive.formatMeters(m) + ' m' : '' }));
    }
    for (const lm of dive.LANDMARKS) {
      col.appendChild(el('div', { class: 'scene-landmark', style: 'top:' + Math.round(lm.depth * px) + 'px', html: '<span>' + esc(lm.label) + ' · ' + esc(dive.formatMeters(lm.depth)) + ' m</span>' }));
    }
    for (let i = 0; i < 40; i++) {
      col.appendChild(el('i', { class: 'scene-mote', style: 'top:' + Math.round(Math.random() * total) + 'px;left:' + Math.round(Math.random() * 100) + '%;opacity:' + (0.15 + Math.random() * 0.35).toFixed(2) + ';transform:scale(' + (0.5 + Math.random()).toFixed(2) + ')' }));
    }
    sceneEl.innerHTML = '';
    sceneEl.appendChild(col);
  }
  let sceneDepth = 0;
  // Move the scene to a depth. Returns the duration used so callers can time badges and sounds to it.
  function setSceneDepth(depth, animate) {
    const d = Math.max(0, depth || 0);
    const drop = Math.abs(d - sceneDepth);
    const reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ms = animate && !reduced ? Math.min(CONFIG.DESCENT_MAX_MS, CONFIG.DESCENT_BASE_MS + CONFIG.DESCENT_MS_PER_100M * drop / 100) : 0;
    sceneDepth = d;
    if (sceneEl) {
      const col = sceneEl.firstChild;
      if (col) {
        col.style.transition = ms ? 'transform ' + ms + 'ms cubic-bezier(.25,.6,.3,1)' : 'none';
        col.style.transform = 'translateY(' + (-Math.round(d * CONFIG.SCENE_PX_PER_M)) + 'px)';
      }
    }
    document.documentElement.style.setProperty('--descent-ms', ms + 'ms');
    applyDepthTint(d);
    return ms;
  }

  // ---------------------------------------------------------------- sound (synthesised, no files) and haptics
  let audioCtx = null;
  function ctx() {
    if (!storage.settings().sound) return null;
    try { audioCtx = audioCtx || new (root.AudioContext || root.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {}); return audioCtx; } catch (e) { return null; }
  }
  function playTone(freq, ms, type, vol) {
    const c = ctx(); if (!c) return;
    try {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.value = vol || CONFIG.SOUND_VOLUME;
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + ms / 1000);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + ms / 1000);
    } catch (e) { /* no audio */ }
  }
  function noiseBurst(ms, vol) {        // a splash: filtered white noise with a fast decay
    const c = ctx(); if (!c) return;
    try {
      const len = Math.floor(c.sampleRate * ms / 1000), buf = c.createBuffer(1, len, c.sampleRate), ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
      const g = c.createGain(); g.gain.value = vol || CONFIG.SOUND_VOLUME * 1.6;
      src.connect(f); f.connect(g); g.connect(c.destination); src.start();
    } catch (e) { /* ignore */ }
  }
  const sound = {
    splash() { noiseBurst(420); playTone(220, 120, 'sine', CONFIG.SOUND_VOLUME * 0.6); },
    reveal(tierCode) {
      const base = { tidepool: 330, baitball: 370, reef: 440, twilight: 523, midnight: 659, hadal: 784 }[tierCode] || 300;
      playTone(base, 180, 'sine');
    },
    hadal() { [784, 988, 1175, 1568].forEach((f, i) => setTimeout(() => playTone(f, 320, 'triangle'), i * 110)); },
    miss() { playTone(140, 260, 'sawtooth'); },
    tick() { playTone(880, 40, 'square'); },
    landmark() { playTone(587, 90, 'sine', CONFIG.SOUND_VOLUME * 0.7); },
    // the descent hum: a low tone that slides deeper with the dive
    descend(fromDepth, toDepth, ms) {
      const c = ctx(); if (!c || ms < 150) return;
      try {
        const f = (d) => 180 - 110 * Math.min(1, d / dive.CHALLENGER_DEEP_M);
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(f(fromDepth), c.currentTime);
        o.frequency.linearRampToValueAtTime(f(toDepth), c.currentTime + ms / 1000);
        g.gain.setValueAtTime(0.0001, c.currentTime);
        g.gain.exponentialRampToValueAtTime(CONFIG.SOUND_VOLUME * 0.9, c.currentTime + 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + ms / 1000);
        o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + ms / 1000 + 0.05);
      } catch (e) { /* ignore */ }
    },
  };
  const haptics = {
    buzz(kind) {
      if (!storage.settings().sound) return;
      try { if (navigator.vibrate && CONFIG.HAPTICS[kind]) navigator.vibrate(CONFIG.HAPTICS[kind]); } catch (e) { /* ignore */ }
    },
  };

  // ---------------------------------------------------------------- bubbles
  function makeBubbles() {
    const host = document.getElementById('bubbles');
    if (!host) return;
    for (let i = 0; i < CONFIG.BUBBLE_COUNT; i++) {
      const s = document.createElement('span');
      const size = 6 + Math.random() * 10;
      s.style.left = (Math.random() * 100) + '%';
      s.style.width = s.style.height = size + 'px';
      s.style.animationDuration = (18 + Math.random() * 16) + 's';
      s.style.animationDelay = (-Math.random() * 30) + 's';
      host.appendChild(s);
    }
  }

  // ---------------------------------------------------------------- router
  function currentHash() { return location.hash || '#home'; }
  function navigate(hash) { if (currentHash() === hash) route(); else location.hash = hash; }
  function route() {
    closeMenu();
    closeModal();
    const hash = currentHash();
    const pages = root.FathomPages;
    const game = root.FathomGame;
    if (game.leaveDive) game.leaveDive();
    applyDepthTint(0);
    // Routes are plain hash names (#daily, #pack-sharks, #archive-2026-11-01): the first word is the page,
    // the rest is its parameter. Plain names survive every host, including ones that only pass #name through.
    const raw = hash.replace(/^#\/?/, '');
    const dash = raw.indexOf('-');
    const page = /^challenge[-\/]/i.test(raw) ? 'challenge' : dash > -1 ? raw.slice(0, dash) : raw;
    const param = dash > -1 ? raw.slice(dash + 1) : '';
    document.querySelectorAll('#menu a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + page));
    if (hash.indexOf('access_token=') > -1 || hash.indexOf('error=') > -1) { return; } // handled by online.js on load
    setSceneDepth(0, false);
    const withBank = (fn) => {
      if (data.full) return fn();
      render(el('div', { class: 'card strong center' }, [el('p', { class: 'muted', text: 'Loading the rest of the ocean…' })]));
      return ensureBank().then(() => { if (currentHash() === hash) fn(); }).catch(() => render(el('div', { class: 'card strong' }, [el('h2', { text: 'Could not load the answer bank' }), el('p', { text: 'Check your connection and try again.' }), el('a', { class: 'btn', href: '#home', text: 'Home' })])));
    };
    switch (page) {
      case '': case 'home': return pages.home();
      case 'daily': return game.startDaily();
      case 'tutorial': return game.startTutorial();
      case 'free': return withBank(() => game.startFree(param));
      case 'archive': return withBank(() => (param ? game.startArchive(param) : pages.archive()));
      case 'packs': return withBank(() => pages.packs());
      case 'pack': return withBank(() => game.startPack(param));
      case 'leaderboard': return pages.leaderboard(param);
      case 'logbook': return withBank(() => pages.logbook(param));
      case 'stats': pages.home(); return pages.statsModal();
      case 'faq': return pages.faq();
      case 'challenge': return withBank(() => game.startChallenge(hash));
      default: return pages.notFound();
    }
  }

  // ---------------------------------------------------------------- init
  function init() {
    root.Fathom = {
      config: CONFIG, dive, storage, charts,
      entities: data.entities, prompts: data.prompts, promptsById: data.promptsById, packs: data.packs, packsById: data.packsById, schedule: data.schedule, taxa: data.taxa, bankLoaded: data.full,
      ensureBank, hasPromptData,
      el, esc, render, navigate, modal, closeModal, confirmDialog, toast, applyDepthTint, applySettings, sound, haptics, setSceneDepth,
      todayKey: () => dive.dayKey(new Date()),
    };
    applySettings();
    buildScene();
    makeBubbles();
    if (!data.full) setTimeout(() => ensureBank().catch(() => {}), 1500);   // warm the full bank in the background
    document.getElementById('btn-menu').addEventListener('click', () => (menu().hidden ? openMenu() : closeMenu()));
    document.getElementById('scrim').addEventListener('click', closeMenu);
    document.getElementById('btn-help').addEventListener('click', () => root.FathomPages.howToModal());
    document.getElementById('btn-stats').addEventListener('click', () => root.FathomPages.statsModal());
    document.getElementById('btn-settings').addEventListener('click', () => root.FathomPages.settingsModal());
    document.getElementById('footer-contact').addEventListener('click', (e) => { e.preventDefault(); navigate('#faq'); setTimeout(() => { const c = document.getElementById('contact'); if (c) c.scrollIntoView(); }, 50); });
    root.addEventListener('hashchange', route);
    if (root.FathomOnline && root.FathomOnline.init) root.FathomOnline.init();
    if (root.FathomMonetise && root.FathomMonetise.init) root.FathomMonetise.init();
    route();
    if (!storage.settings().seenHowTo) {
      storage.updateSettings({ seenHowTo: true });
      root.FathomPages.welcomeModal();
    }
    if ('serviceWorker' in navigator) {
      try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* ignore */ }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
