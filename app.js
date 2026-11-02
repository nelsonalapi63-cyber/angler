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
    DEPTH_TINT_STOPS: {                 // page background by depth fraction (0 = surface, 1 = Challenger Deep)
      dark:  [[0, '#0F4C5C'], [0.09, '#0B3A52'], [0.37, '#071D33'], [0.55, '#040F1E'], [1, '#02060D']],
      light: [[0, '#D9EEF2'], [0.37, '#B6D3E0'], [0.75, '#90B0C4'], [1, '#7F9DB0']],
    },
  };

  const dive = root.FathomDive;
  const storage = root.FathomStorage;
  const charts = root.FathomCharts;

  // ---------------------------------------------------------------- data
  const entities = root.FATHOM_ENTITIES || {};
  const prompts = root.FATHOM_PROMPTS || [];
  const packs = root.FATHOM_PACKS || [];
  const promptsById = dive.byId(prompts);
  const packsById = Object.fromEntries(packs.map(p => [p.id, p]));

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

  // ---------------------------------------------------------------- sound (tiny synthesized blips, no files)
  let audioCtx = null;
  function playTone(freq, ms, type) {
    if (!storage.settings().sound) return;
    try {
      audioCtx = audioCtx || new (root.AudioContext || root.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.value = CONFIG.SOUND_VOLUME;
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + ms / 1000);
    } catch (e) { /* no audio */ }
  }
  const sound = {
    reveal(tierCode) {
      const base = { tidepool: 330, baitball: 370, reef: 440, twilight: 523, midnight: 659, hadal: 784 }[tierCode] || 300;
      playTone(base, 180, 'sine');
      if (tierCode === 'hadal') setTimeout(() => playTone(base * 1.5, 260, 'triangle'), 120);
    },
    miss() { playTone(140, 260, 'sawtooth'); },
    tick() { playTone(880, 40, 'square'); },
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
    if (/^challenge[-\/]/i.test(raw)) return game.startChallenge(hash);
    const dash = raw.indexOf('-');
    const page = dash > -1 ? raw.slice(0, dash) : raw;
    const param = dash > -1 ? raw.slice(dash + 1) : '';
    document.querySelectorAll('#menu a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + page));
    if (hash.indexOf('access_token=') > -1 || hash.indexOf('error=') > -1) { return; } // handled by online.js on load
    switch (page) {
      case '': case 'home': return pages.home();
      case 'daily': return game.startDaily();
      case 'free': return game.startFree(param);
      case 'archive': return param ? game.startArchive(param) : pages.archive();
      case 'packs': return pages.packs();
      case 'pack': return game.startPack(param);
      case 'leaderboard': return pages.leaderboard(param);
      case 'logbook': return pages.logbook(param);
      case 'stats': pages.home(); return pages.statsModal();
      case 'faq': return pages.faq();
      case 'challenge': return game.startChallenge(hash);
      default: return pages.notFound();
    }
  }

  // ---------------------------------------------------------------- init
  function init() {
    root.Fathom = {
      config: CONFIG, dive, storage, charts, entities, prompts, promptsById, packs, packsById,
      el, esc, render, navigate, modal, closeModal, confirmDialog, toast, applyDepthTint, applySettings, sound,
      todayKey: () => dive.dayKey(new Date()),
    };
    applySettings();
    makeBubbles();
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
      root.FathomPages.howToModal();
    }
    if ('serviceWorker' in navigator) {
      try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* ignore */ }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
