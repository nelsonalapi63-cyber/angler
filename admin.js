/* ANGLER — admin.html: the owner's dashboard. Funnel, per-prompt miss rate, the most-typed rejected guesses,
 * hint usage, retention cohorts, and the report inbox with a one-click export to data/patches/inbox.json.
 * Reads through the admin_* RPCs (every one checks is_admin() on the server). With the online layer off it
 * shows clearly labelled demo data so the page can be designed and reviewed before launch. */
(function (root) {
  'use strict';

  const DAYS = 30;
  const COHORT_WEEKS = 8;
  const TOP_PROMPTS = 40;
  const dive = root.FathomDive;
  const storage = root.FathomStorage;
  const prompts = root.FATHOM_PROMPTS || [];
  const entities = root.FATHOM_ENTITIES || {};
  const promptsById = dive.byId(prompts);
  const flags = root.FATHOM_FLAGS || {};

  // ---------------------------------------------------------------- tiny shell (admin.html has no app.js)
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) return c.forEach(add); node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); };
    add(children);
    return node;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function toast(msg) { const r = document.getElementById('toast-root'); const t = el('div', { class: 'toast', text: msg }); r.appendChild(t); setTimeout(() => t.remove(), 2600); }
  function render(nodes) { const m = document.getElementById('main'); m.innerHTML = ''; (Array.isArray(nodes) ? nodes : [nodes]).forEach(n => n && m.appendChild(n)); }
  // online.js expects window.Fathom with a few helpers
  root.Fathom = { el, esc, toast, storage, dive, config: {}, navigate: (h) => { location.hash = h; }, todayKey: () => dive.dayKey(new Date()), closeModal: () => {}, modal: () => {}, render };
  const O = root.FathomOnline;
  const live = flags.LEADERBOARD_ENABLED && O && O.configured();
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  // ---------------------------------------------------------------- demo data (deterministic)
  function demoData() {
    const rng = dive.seededRng('admin-demo');
    const today = dive.dayKey(new Date());
    const funnel = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const day = dive.keyPlusDays(today, -i);
      const visits = Math.round(900 + 400 * rng() + (DAYS - i) * 18);
      const started = Math.round(visits * (0.62 + 0.1 * rng()));
      const completed = Math.round(started * (0.84 + 0.08 * rng()));
      funnel.push({ day, visits, dive_started: started, dive_completed: completed, shared: Math.round(completed * (0.17 + 0.06 * rng())), hints: Math.round(completed * (0.9 + 0.5 * rng())) });
    }
    const stats = prompts.slice().sort(() => rng() - 0.5).slice(0, TOP_PROMPTS).map(p => { const shown = Math.round(300 + 900 * rng()); const missed = Math.round(shown * (0.05 + 0.4 * rng())); return { prompt_id: p.id, shown, missed, miss_rate: Math.round(1000 * missed / shown) / 10, hints: Math.round(shown * (0.08 + 0.2 * rng())) }; }).sort((a, b) => b.miss_rate - a.miss_rate);
    const guesses = (pid) => { const p = promptsById[pid]; if (!p) return []; const r = dive.seededRng('g:' + pid); const names = p.answers.slice(0, 6).map(a => (entities[a.entity] || {}).name || a.entity); return [['mola mola', 41], ['sea bass', 33], ['jelly fish', 27], ['starfish', 22], ['manta', 19], ['nemo', 15], ['shark', 12], ['dolphin', 9]].map(([g, n], i) => ({ guess: i % 3 === 0 ? g : (names[i] || g).toLowerCase() + (i % 2 ? 's' : ''), n: Math.round(n * (0.6 + r())) })); };
    const cohorts = []; for (let w = COHORT_WEEKS; w >= 1; w--) { const divers = Math.round(400 + 300 * rng()); cohorts.push({ cohort_week: dive.keyPlusDays(today, -7 * w), divers, week1: Math.round(divers * (0.38 + 0.1 * rng())), week2: Math.round(divers * (0.27 + 0.08 * rng())), week4: w >= 4 ? Math.round(divers * (0.18 + 0.07 * rng())) : null }); }
    const kinds = ['wrong_tier', 'missing_answer', 'wrong_fact', 'other'];
    const reports = prompts.slice(0, 14).map((p, i) => { const a = p.answers[i % p.answers.length]; return { id: 1000 + i, created_at: new Date(Date.now() - i * 5.3e6).toISOString(), prompt_id: p.id, entity_id: i % 3 === 1 ? null : a.entity, typed: i % 3 === 1 ? 'spiney dogfish' : (entities[a.entity] || {}).name, kind: kinds[i % 4], note: ['Should be Twilight at least, nobody says this.', 'This is a real species — Squalus acanthias.', 'The depth figure is off by a factor of ten.', 'Great prompt.'][i % 4], status: i < 9 ? 'new' : i < 12 ? 'accepted' : 'rejected' }; });
    return { funnel, stats, guesses, cohorts, reports };
  }

  // ---------------------------------------------------------------- data access
  async function rpc(name, body) { return O.rest('/rest/v1/rpc/' + name, { method: 'POST', body: body || {} }); }
  async function load() {
    if (!live) { const d = demoData(); return Object.assign({ demo: true, guesses: async (pid) => d.guesses(pid), setReport: async () => {} }, d); }
    const [funnel, stats, cohorts, reports] = await Promise.all([rpc('admin_funnel', { p_days: DAYS }), rpc('admin_prompt_stats', { p_days: DAYS }), rpc('admin_cohorts', { p_weeks: COHORT_WEEKS }), rpc('admin_reports', { p_status: 'all' })]);
    return { demo: false, funnel, stats: stats.slice(0, TOP_PROMPTS), cohorts, reports, guesses: (pid) => rpc('admin_rejected_guesses', { p_prompt: pid, p_days: DAYS }), setReport: (id, status) => rpc('admin_set_report', { p_id: id, p_status: status }) };
  }

  // ---------------------------------------------------------------- sections
  function barChart(rows, key, dimKey, labelFn) {
    const max = Math.max(1, ...rows.map(r => Number(r[key]) || 0));
    return el('div', { class: 'bars', role: 'img', 'aria-label': key + ' by day' }, rows.map(r => el('div', { style: 'position:relative;height:100%;display:flex;align-items:flex-end;gap:1px' }, [
      el('div', { class: 'bar', style: 'width:60%;height:' + (100 * (Number(r[key]) || 0) / max) + '%', 'data-label': labelFn(r) }),
      dimKey ? el('div', { class: 'bar dim', style: 'width:40%;height:' + (100 * (Number(r[dimKey]) || 0) / max) + '%', 'data-label': r.day + ': ' + fmt(r[dimKey]) + ' ' + dimKey }) : null,
    ])));
  }
  function funnelSection(d) {
    const sum = (k) => d.funnel.reduce((n, r) => n + (Number(r[k]) || 0), 0);
    const v = sum('visits'), s = sum('dive_started'), c = sum('dive_completed'), sh = sum('shared'), h = sum('hints');
    const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '–';
    return el('section', { class: 'card' }, [
      el('h2', { text: 'Funnel · last ' + DAYS + ' days' + (d.demo ? ' ' : '') }, d.demo ? el('span', { class: 'badge demo', text: 'demo data' }) : null),
      el('div', { class: 'stat-grid', style: 'grid-template-columns:repeat(4,1fr)' }, [
        el('div', { html: '<b>' + fmt(v) + '</b><span>Visits (devices)</span>' }),
        el('div', { html: '<b>' + fmt(s) + '</b><span>Dives started · ' + pct(s, v) + '</span>' }),
        el('div', { html: '<b>' + fmt(c) + '</b><span>Completed · ' + pct(c, s) + '</span>' }),
        el('div', { html: '<b>' + fmt(sh) + '</b><span>Shared · ' + pct(sh, c) + '</span>' }),
      ]),
      barChart(d.funnel, 'visits', 'dive_completed', r => r.day + ': ' + fmt(r.visits) + ' visits'),
      el('div', { class: 'legend' }, [el('span', { html: '<i style="background:var(--accent)"></i>visits' }), el('span', { html: '<i style="background:var(--tier-midnight)"></i>completed dives' }), el('span', { text: 'Lure used ' + fmt(h) + ' times (' + pct(h, c * 7) + ' of prompts)' })]),
    ]);
  }
  function promptSection(d) {
    const box = el('div');
    const table = el('table', {}, [el('thead', {}, el('tr', {}, [el('th', { text: 'Prompt' }), el('th', { class: 'num', text: 'Shown' }), el('th', { class: 'num', text: 'Missed' }), el('th', { text: 'Miss rate' }), el('th', { class: 'num', text: 'Lure' }), el('th', { text: 'Rejected guesses' })])),
      el('tbody', {}, d.stats.map(r => el('tr', {}, [
        el('td', { html: '<b>' + esc((promptsById[r.prompt_id] || {}).text || r.prompt_id) + '</b><br><span class="tiny muted">' + esc(r.prompt_id) + '</span>' }),
        el('td', { class: 'num', text: fmt(r.shown) }), el('td', { class: 'num', text: fmt(r.missed) }),
        el('td', {}, [el('div', { class: 'miss-bar', title: r.miss_rate + '%' }, el('i', { style: 'width:' + Math.min(100, r.miss_rate) + '%' })), el('span', { class: 'tiny muted', text: r.miss_rate + '%' })]),
        el('td', { class: 'num', text: fmt(r.hints) }),
        el('td', {}, el('button', { class: 'btn btn-sm', type: 'button', text: 'Guesses', onClick: async () => { const rows = await d.guesses(r.prompt_id); box.innerHTML = ''; box.append(el('h3', { text: 'Most-typed rejected guesses · ' + ((promptsById[r.prompt_id] || {}).text || r.prompt_id) }), el('p', { class: 'small muted', text: 'What players typed that was not accepted. Real answers hiding here become aliases or new entities; nonsense tells you the prompt is unclear.' }), rows.length ? el('table', {}, [el('thead', {}, el('tr', {}, [el('th', { text: 'Guess' }), el('th', { class: 'num', text: 'Times' })])), el('tbody', {}, rows.map(g => el('tr', {}, [el('td', { text: g.guess }), el('td', { class: 'num', text: fmt(g.n) })])))]) : el('p', { class: 'muted', text: 'No rejected guesses recorded for this prompt yet.' })); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); } })),
      ])))]);
    return el('section', { class: 'card' }, [el('h2', { text: 'Prompts · miss rate and lure use' }), el('p', { class: 'small muted', text: 'A high miss rate with many rejected guesses usually means answers are missing from the list; a high miss rate with few guesses means the prompt is too hard or unclear.' }), el('div', { style: 'overflow:auto' }, table), box]);
  }
  function cohortSection(d) {
    return el('section', { class: 'card' }, [el('h2', { text: 'Retention by cohort' }), el('p', { class: 'small muted', text: 'Divers grouped by the week of their first dive; the share who dived again in week 1, 2 and 4.' }),
      el('table', {}, [el('thead', {}, el('tr', {}, [el('th', { text: 'First dive week' }), el('th', { class: 'num', text: 'Divers' }), el('th', { class: 'num', text: 'Week 1' }), el('th', { class: 'num', text: 'Week 2' }), el('th', { class: 'num', text: 'Week 4' })])),
        el('tbody', {}, d.cohorts.map(c => { const p = (n) => n == null ? '–' : Math.round(100 * n / Math.max(1, c.divers)) + '%'; return el('tr', {}, [el('td', { text: c.cohort_week }), el('td', { class: 'num', text: fmt(c.divers) }), el('td', { class: 'num', text: p(c.week1) }), el('td', { class: 'num', text: p(c.week2) }), el('td', { class: 'num', text: p(c.week4) })]); }))])]);
  }
  function reportsSection(d) {
    const list = el('tbody');
    const kinds = { wrong_tier: 'Wrong tier', missing_answer: 'Missing answer', wrong_fact: 'Wrong fact', other: 'Other' };
    const draw = () => {
      list.innerHTML = '';
      for (const r of d.reports) {
        const p = promptsById[r.prompt_id]; const e = r.entity_id ? entities[r.entity_id] : null;
        list.append(el('tr', {}, [
          el('td', { html: '<span class="tiny muted">' + esc(String(r.created_at).slice(0, 10)) + '</span><br><b>' + esc(kinds[r.kind] || r.kind) + '</b>' }),
          el('td', { html: esc(p ? p.text : r.prompt_id) + '<br><span class="small muted">' + (e ? 'scored as ' + esc(e.name) : r.typed ? 'typed “' + esc(r.typed) + '”' : '') + '</span>' }),
          el('td', { text: r.note || '' }),
          el('td', {}, [el('span', { class: 'status-' + r.status, text: r.status }), el('div', { class: 'row', style: 'margin-top:4px' }, [
            r.status !== 'accepted' ? el('button', { class: 'btn btn-sm', type: 'button', text: 'Accept', onClick: async () => { await d.setReport(r.id, 'accepted'); r.status = 'accepted'; draw(); } }) : null,
            r.status !== 'rejected' ? el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Reject', onClick: async () => { await d.setReport(r.id, 'rejected'); r.status = 'rejected'; draw(); } }) : null,
          ])]),
        ]));
      }
    };
    draw();
    const exportBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Export accepted → inbox.json', onClick: () => {
      const accepted = d.reports.filter(r => r.status === 'accepted');
      // apply-patch.js reads facts / removeFromPrompt / retier / aliasAdd / aliasRemove / rename and ignores `review`,
      // so the mechanical sections start empty and the review list is the worklist to fill them from.
      const patch = { review: accepted.map(r => ({ report: r.id, kind: r.kind, prompt: r.prompt_id, entity: r.entity_id, typed: r.typed, note: r.note, day: r.day })), facts: {}, removeFromPrompt: [], retier: [], aliasAdd: [], aliasRemove: [], rename: {} };
      for (const r of accepted) if (r.kind === 'missing_answer' && r.typed && r.entity_id) patch.aliasAdd.push({ entity: r.entity_id, alias: r.typed });
      const blob = new Blob([JSON.stringify(patch, null, 1)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'inbox.json' }); document.body.appendChild(a); a.click(); a.remove();
      toast(accepted.length + ' accepted reports exported — save as data/patches/inbox.json and run node tools/apply-patch.js');
    } });
    return el('section', { class: 'card' }, [el('div', { class: 'row between' }, [el('h2', { text: 'Report inbox' }), exportBtn]), el('p', { class: 'small muted', text: 'What players flagged from result screens. Accept what is right, then export; the file is a patch skeleton for tools/apply-patch.js with the accepted reports listed under review.' }),
      el('div', { style: 'overflow:auto' }, el('table', {}, [el('thead', {}, el('tr', {}, [el('th', { text: 'When · kind' }), el('th', { text: 'Prompt' }), el('th', { text: 'Note' }), el('th', { text: 'Status' })])), list]))]);
  }

  // ---------------------------------------------------------------- boot
  async function main() {
    if (live) {
      O.init();
      const u = O.user();
      if (!u) { render(el('div', { class: 'card strong center' }, [el('h1', { text: 'Admin' }), el('p', { text: 'Sign in with the owner account.' }), el('button', { class: 'btn btn-primary', type: 'button', text: 'Sign in', onClick: () => O.signIn() })])); return; }
      let ok = false; try { ok = await rpc('is_admin'); } catch (e) { ok = false; }
      if (!ok) { render(el('div', { class: 'card strong center' }, [el('h1', { text: 'Not authorised' }), el('p', { class: 'muted', text: (u.email || 'This account') + ' is not in admin_emails.' })])); return; }
    }
    render(el('div', { class: 'card strong center' }, el('p', { class: 'muted', text: 'Loading…' })));
    try {
      const d = await load();
      render([
        el('div', { class: 'card strong' }, [el('h1', { text: 'ANGLER admin' }), el('p', { class: 'small muted', html: (d.demo ? '<span class="badge demo">demo data</span> The online layer is off; these numbers are generated so the page can be designed. ' : '') + 'Everything here is aggregated — no individual diver is identifiable.' })]),
        funnelSection(d), cohortSection(d), promptSection(d), reportsSection(d),
      ]);
    } catch (e) { render(el('div', { class: 'card strong' }, [el('h1', { text: 'Could not load' }), el('p', { class: 'muted', text: e && e.message || String(e) })])); }
  }
  main();
})(window);
