/* ANGLER — online layer: feature flags, Supabase REST client (no SDK, no CDN), sign-in, dive submission,
 * the daily bell curve, leaderboards and ratings, analytics, and deterministic demo data for mock mode. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- feature flags (Phase 1 ships with every online flag off)
  const FLAGS = {
    ADS_ENABLED: false,
    PAYMENTS_ENABLED: false,
    ANALYTICS_ENABLED: false,
    LEADERBOARD_ENABLED: false,
    MOCK_ONLINE_DATA: true,      // fills leaderboards and the bell curve with clearly labelled demo data
  };
  root.FATHOM_FLAGS = FLAGS;

  // ---------------------------------------------------------------- parameters
  const SUPABASE_URL = '';                 // e.g. 'https://abcdefgh.supabase.co'
  const SUPABASE_ANON_KEY = '';            // the public anon key (safe to ship; Row Level Security protects data)
  const ANALYTICS_SCRIPT_URL = 'https://plausible.io/js/script.js';
  const ANALYTICS_DOMAIN = '';             // e.g. 'fathom.example'
  const MIN_CURVE_DIVES = 30;              // the curve appears after this many dives today
  const MAX_GUESSES_SENT = 5;          // rejected guesses per prompt sent with a dive, so missing answers can be mined
  const CURVE_CACHE_MS = 60 * 1000;
  const RATING_WINDOW_DAYS = 30;
  const RATING_BEST_OF = 20;
  const MIN_RANKED_DAYS = 5;
  const LEAGUES = [
    { code: 'sunlight', name: 'Sunlight', min: 0 },
    { code: 'twilight', name: 'Twilight', min: 40 },
    { code: 'midnight', name: 'Midnight', min: 60 },
    { code: 'abyss', name: 'Abyss', min: 75 },
    { code: 'hadal', name: 'Hadal', min: 90 },
  ];
  const BOARD_LIMIT = 100;
  const HANDLE_RE = /^[A-Za-z0-9_]{3,16}$/;
  const HANDLE_BLOCKLIST = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'bitch', 'rape', 'nazi', 'hitler', 'kike', 'spic', 'chink', 'twat', 'wank', 'dick', 'cock', 'pussy', 'whore', 'slut'];
  const MOCK_DIVERS_MIN = 900, MOCK_DIVERS_SPREAD = 800;
  const MOCK_TIER_WEIGHTS = { miss: 0.26, tidepool: 0.30, baitball: 0.12, reef: 0.17, twilight: 0.09, midnight: 0.05, hadal: 0.01 };

  const F = () => root.Fathom;
  const flags = FLAGS;
  const leagueFor = (rating) => LEAGUES.slice().reverse().find(l => rating >= l.min) || LEAGUES[0];
  const tideKey = (dayKey) => dayKey.slice(0, 7);

  // ================================================================ session & REST
  let session = null;        // { access_token, refresh_token, expires_at, user:{id,email} }
  let profile = null;        // { handle, flag, hidden }
  let entitlementsCache = null;
  const configured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
  const onlineNeeded = () => flags.LEADERBOARD_ENABLED || flags.PAYMENTS_ENABLED;

  function loadSession() {
    session = F().storage.get('session', null);
    profile = F().storage.get('profile', null);
    entitlementsCache = F().storage.get('entitlements', null);
  }
  function saveSession() { F().storage.set('session', session); F().storage.set('profile', profile); }
  function user() { return session && session.user ? session.user : null; }
  function entitlements() { return Array.isArray(entitlementsCache) ? entitlementsCache : []; }

  function headers(extra) {
    const h = Object.assign({ 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, extra || {});
    h.Authorization = 'Bearer ' + (session && session.access_token ? session.access_token : SUPABASE_ANON_KEY);
    return h;
  }
  async function rest(path, opts) {
    if (!configured()) throw new Error('Supabase is not configured');
    await refreshIfNeeded();
    const res = await fetch(SUPABASE_URL + path, { method: (opts && opts.method) || 'GET', headers: headers(opts && opts.headers), body: opts && opts.body ? JSON.stringify(opts.body) : undefined });
    if (!res.ok) { const text = await res.text().catch(() => ''); throw new Error('HTTP ' + res.status + ' ' + text.slice(0, 200)); }
    const ct = res.headers.get('content-type') || '';
    return ct.indexOf('json') > -1 ? res.json() : res.text();
  }
  async function refreshIfNeeded() {
    if (!session || !session.refresh_token) return;
    if (Date.now() < (session.expires_at || 0) - 60000) return;
    try {
      const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
      if (!res.ok) throw new Error('refresh failed');
      const data = await res.json();
      session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + (data.expires_in || 3600) * 1000, user: data.user ? { id: data.user.id, email: data.user.email } : session.user };
      saveSession();
    } catch (e) { session = null; saveSession(); }
  }

  // ---------------------------------------------------------------- auth (implicit flow, no SDK)
  function siteRoot() { return location.href.split('#')[0]; }
  function signIn() {
    if (!configured()) { F().toast('Sign-in is not configured yet'); return; }
    location.href = SUPABASE_URL + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(siteRoot());
  }
  async function signOut() {
    try { if (configured() && session) await fetch(SUPABASE_URL + '/auth/v1/logout', { method: 'POST', headers: headers() }); } catch (e) { /* ignore */ }
    session = null; profile = null; entitlementsCache = null;
    saveSession(); F().storage.remove('entitlements');
    F().toast('Signed out');
  }
  async function handleAuthRedirect() {
    const hash = location.hash || '';
    if (hash.indexOf('access_token=') < 0 && hash.indexOf('error=') < 0) return false;
    const params = new URLSearchParams(hash.replace(/^#\/?/, ''));
    history.replaceState(null, '', siteRoot() + '#home');
    if (params.get('error')) { F().toast('Sign-in failed: ' + (params.get('error_description') || params.get('error'))); return true; }
    session = { access_token: params.get('access_token'), refresh_token: params.get('refresh_token'), expires_at: Date.now() + Number(params.get('expires_in') || 3600) * 1000, user: null };
    try {
      const u = await rest('/auth/v1/user');
      session.user = { id: u.id, email: u.email };
      saveSession();
      await loadProfile();
      await refreshEntitlements();
      await syncProgressUp();
      F().toast('Signed in');
      trackEvent('sign_in', {});
    } catch (e) { session = null; saveSession(); F().toast('Sign-in failed'); }
    return true;
  }
  async function loadProfile() {
    if (!user()) return null;
    const rows = await rest('/rest/v1/profiles?select=handle,flag,hidden&user_id=eq.' + user().id);
    profile = rows && rows[0] ? rows[0] : null;
    saveSession();
    return profile;
  }
  function handleProblem(h) {
    if (!HANDLE_RE.test(h)) return 'Handles are 3–16 letters, numbers or underscores.';
    const low = h.toLowerCase();
    if (HANDLE_BLOCKLIST.some(w => low.indexOf(w) > -1)) return 'That handle is not allowed.';
    return null;
  }
  async function saveProfile(patch) {
    if (!user()) throw new Error('not signed in');
    const body = Object.assign({ user_id: user().id }, profile || {}, patch);
    await rest('/rest/v1/profiles?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body });
    profile = Object.assign({}, profile || {}, patch);
    saveSession();
  }
  async function deleteAccount() {
    await rest('/functions/v1/delete-account', { method: 'POST', body: {} });
    session = null; profile = null; entitlementsCache = null;
    saveSession(); F().storage.remove('entitlements');
  }
  async function refreshRating() {
    if (!flags.LEADERBOARD_ENABLED || !configured() || !user()) return;
    try {
      const rows = await rest('/rest/v1/ratings?select=rating,league,rank,dives,tide&user_id=eq.' + user().id);
      if (rows && rows[0]) F().storage.set('rating', rows[0]); else F().storage.remove('rating');
    } catch (e) { /* keep what we have */ }
  }
  async function refreshEntitlements() {
    if (!flags.PAYMENTS_ENABLED || !configured() || !user()) return entitlements();
    try {
      const rows = await rest('/rest/v1/entitlements?select=product_id');
      entitlementsCache = rows.map(r => r.product_id);
      F().storage.set('entitlements', entitlementsCache);
    } catch (e) { /* keep cache */ }
    return entitlements();
  }
  async function syncProgressUp() {
    if (!configured() || !user()) return;
    const { storage } = F();
    const payload = { user_id: user().id, daily: storage.allDailyResults(), logbook: storage.logbook(), best: storage.get('best', {}), badges: storage.get('badges', {}), updated_at: new Date().toISOString() };
    try { await rest('/rest/v1/progress?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: payload }); } catch (e) { /* best effort */ }
  }
  async function syncProgressDown() {
    if (!configured() || !user()) return;
    const { storage } = F();
    try {
      const rows = await rest('/rest/v1/progress?select=daily,logbook,best,badges&user_id=eq.' + user().id);
      const remote = rows && rows[0];
      if (!remote) return;
      const daily = Object.assign({}, remote.daily || {}, storage.allDailyResults());
      storage.set('daily', daily);
      const lb = Object.assign({}, remote.logbook || {}, storage.logbook());
      storage.set('logbook', lb);
      const badges = Object.assign({}, remote.badges || {}, storage.get('badges', {}));
      storage.set('badges', badges);
    } catch (e) { /* ignore */ }
  }

  // ================================================================ dive submission (daily only)
  async function submitDaily(record) {
    if (!flags.LEADERBOARD_ENABLED) return null;
    const { storage } = F();
    const payload = {
      day: record.dayKey,
      promptIds: record.promptIds,
      answers: record.results.map(r => ({ typed: r.typed || '', secondsUsed: r.secondsUsed, hint: !!r.hint, guesses: (r.guesses || []).slice(0, MAX_GUESSES_SENT).map(g => String(g).slice(0, 60)) })),
      deviceId: storage.deviceId(),
      clientDepth: record.depth,
      dataVersion: root.FATHOM_DATA_VERSION || null,
    };
    trackEvent('dive_submitted', { depth: record.depth });
    try {
      const res = await rest('/functions/v1/submit-dive', { method: 'POST', body: payload });
      rememberCurve(record.dayKey, res);
      setSubmitState(record.dayKey, 'ok');
      return res;
    } catch (e) {
      storage.enqueue(payload);
      setSubmitState(record.dayKey, 'failed', e && e.message);
      return null;
    }
  }
  // Submission state for the result screen: 'ok' | 'failed' | 'pending' | null (offline features off)
  const submitState = {};
  const submitListeners = new Set();
  function setSubmitState(dayKey, state, reason) { submitState[dayKey] = { state, reason: reason || null }; submitListeners.forEach(fn => { try { fn(dayKey); } catch (e) { /* ignore */ } }); }
  function getSubmitState(dayKey) {
    if (!flags.LEADERBOARD_ENABLED) return null;
    const rec = F().storage.getDailyResult(dayKey);
    if (rec && rec.online) return { state: 'ok' };
    if (submitState[dayKey]) return submitState[dayKey];
    return F().storage.queue().some(i => i.day === dayKey) ? { state: 'failed' } : null;
  }
  // A line under the result: submitted / failed with Retry / retrying. Returns null when the online layer is off.
  function submitStatusLine(record) {
    const { el } = F();
    if (!flags.LEADERBOARD_ENABLED || record.mode !== 'daily') return null;
    const node = el('p', { class: 'small submit-status', role: 'status' });
    const draw = () => {
      const st = getSubmitState(record.dayKey);
      node.innerHTML = '';
      if (!st || st.state === 'ok') { node.textContent = st ? 'Score submitted and verified.' : ''; node.hidden = !st; return; }
      node.hidden = false;
      if (st.state === 'pending') { node.textContent = 'Submitting your dive…'; return; }
      node.append('Your score has not reached the server yet' + (navigator.onLine === false ? ' (you are offline)' : '') + '. ');
      node.append(el('button', { class: 'link-btn', type: 'button', text: 'Retry now', onClick: async () => { setSubmitState(record.dayKey, 'pending'); await drainQueue(); if (getSubmitState(record.dayKey).state !== 'ok') setSubmitState(record.dayKey, 'failed'); } }));
      node.append(' It will also retry on its own when you come back.');
    };
    submitListeners.add(draw);
    draw();
    return node;
  }
  // The server's verdict (percentile, rank, total) is stored on the day's record so it survives reloads.
  function rememberCurve(dayKey, res) {
    if (!res || res.percentile == null) return;
    const { storage } = F();
    const rec = storage.getDailyResult(dayKey);
    if (rec) { rec.online = { percentile: res.percentile, rank: res.rank, total: res.total, depth: res.depth, flagged: !!res.flagged }; storage.saveDailyResult(dayKey, rec); }
  }
  async function drainQueue() {
    if (!flags.LEADERBOARD_ENABLED || !configured()) return;
    const { storage } = F();
    const today = F().todayKey();
    let q = storage.queue().filter(item => item.day === today);     // a closed day can no longer be submitted
    storage.setQueue(q);
    while (q.length) {
      const item = q[0];
      try { const res = await rest('/functions/v1/submit-dive', { method: 'POST', body: item }); rememberCurve(item.day, res); setSubmitState(item.day, 'ok'); }
      catch (e) { setSubmitState(item.day, 'failed', e && e.message); break; }
      q = q.slice(1);
      storage.setQueue(q);
    }
  }

  // ================================================================ curve & percentile
  const curveCache = {};      // dayKey -> { at, data }   (server data only; demo data is never cached here)
  function lastPercentile(record) {   // only a percentile the server computed goes into share text
    if (record.mode !== 'daily') return null;
    const rec = F().storage.getDailyResult(record.dayKey) || record;
    if (rec.online && rec.online.percentile != null) return rec.online.percentile;
    const c = curveCache[record.dayKey];
    return c && c.data && c.data.percentile != null ? c.data.percentile : null;
  }
  async function fetchCurve(dayKey) {
    const c = curveCache[dayKey];
    if (c && Date.now() - c.at < CURVE_CACHE_MS) return c.data;
    const data = await rest('/rest/v1/rpc/daily_curve', { method: 'POST', body: { p_day: dayKey, p_device: F().storage.deviceId() } });
    curveCache[dayKey] = { at: Date.now(), data };
    return data;
  }
  function percentileOf(depth, depths) {       // "top X%": share of divers at or above this depth
    const n = depths.length;
    if (!n) return null;
    let atOrAbove = 0;
    for (const d of depths) if (d >= depth) atOrAbove++;
    return Math.max(1, Math.round((atOrAbove / n) * 100));
  }

  function curveSection(record) {
    const { el, charts, dive, esc } = F();
    if (!flags.LEADERBOARD_ENABLED && !flags.MOCK_ONLINE_DATA) return null;
    const card = el('div', { class: 'card' });
    const head = el('div', { class: 'row between' }, [el('h3', { text: 'Today’s divers' })]);
    card.append(head);
    const body = el('div', { html: '<p class="small muted">Loading today’s curve…</p>' });
    card.append(body);
    const draw = (data, demo) => {
      if (demo) head.append(el('span', { class: 'badge demo', text: 'demo data' }));
      body.innerHTML = '';
      if (!data || data.total < MIN_CURVE_DIVES) {
        body.append(el('p', { class: 'small', html: 'The curve appears after ' + MIN_CURVE_DIVES + ' dives today. So far: <b>' + (data ? data.total : 0) + '</b> dives, and you reached <b>' + esc(dive.formatMeters(record.depth)) + ' m</b>.' }));
        return;
      }
      const pct = data.percentile;
      body.append(el('div', { html: charts.bellCurve({ bins: data.bins, total: data.total, median: data.median, playerDepth: record.depth, percentile: pct }) }));
      body.append(el('p', { class: 'small', style: 'margin:8px 0 0', html: '<b>Top ' + pct + '%</b> of ' + data.total.toLocaleString('en-US') + ' divers today · median ' + esc(dive.formatMeters(data.median)) + ' m' + (data.provisional ? ' <span class="muted">(provisional until the day closes)</span>' : '') }));
    };
    if (flags.LEADERBOARD_ENABLED && configured()) {
      fetchCurve(record.dayKey).then(d => { if (d && d.percentile == null) d.percentile = percentileOf(record.depth, expandBins(d.bins)); draw(Object.assign({ provisional: true }, d), false); })
        .catch(() => { body.innerHTML = '<p class="small muted">' + (navigator.onLine ? 'The curve could not be loaded right now.' : 'You are offline — the curve appears when you reconnect.') + '</p>'; });
    } else {
      const m = mockDaily(record.dayKey);
      const data = { bins: m.bins, total: m.total, median: m.median, percentile: percentileOf(record.depth, m.depths), provisional: true };
      draw(data, true);
    }
    return card;
  }
  // "What others answered today": the three most-given answers per prompt and how many found the Hadal one.
  // Server: rpc top_answers(p_day) -> [{prompt_id, entity_id, n, total}]; demo: deterministic per day.
  const TOP_ANSWERS_N = 3;
  const MIN_OTHERS_DIVES = 30;
  function mockTopAnswers(dayKey, promptIds) {
    const { dive, entities, promptsById } = F();
    const rng = dive.seededRng('mock-answers:' + dayKey);
    const total = mockDaily(dayKey).total;
    const out = {};
    for (const pid of promptIds) {
      const prompt = promptsById[pid];
      if (!prompt) continue;
      const rows = [];
      let left = total;
      // answers are given roughly by tier: a Tide Pool answer is said far more often than a Hadal one
      const weight = { tidepool: 30, baitball: 12, reef: 7, twilight: 3, midnight: 1.2, hadal: 0.5 };
      const pool = prompt.answers.filter(a => entities[a.entity]).map(a => ({ a, w: weight[a.tier] * (0.5 + rng()) }));
      const sum = pool.reduce((n, x) => n + x.w, 0) * 1.35;             // the rest are misses
      for (const x of pool) { const n = Math.round(total * x.w / sum); rows.push({ entityId: x.a.entity, tier: x.a.tier, n }); left -= n; }
      rows.sort((p, q) => q.n - p.n);
      const hadal = rows.find(r => r.tier === 'hadal');
      out[pid] = { total, top: rows.slice(0, TOP_ANSWERS_N), hadal: hadal ? hadal.n : 0, misses: Math.max(0, left) };
    }
    return out;
  }
  function othersSection(record) {
    const { el, esc, dive, entities, promptsById } = F();
    if (!flags.LEADERBOARD_ENABLED && !flags.MOCK_ONLINE_DATA) return null;
    const card = el('div', { class: 'card' });
    const head = el('div', { class: 'row between' }, [el('h3', { text: 'What others answered today' })]);
    const body = el('div', { html: '<p class="small muted">Loading…</p>' });
    card.append(head, body);
    const draw = (data, demo) => {
      if (demo) head.append(el('span', { class: 'badge demo', text: 'demo data' }));
      body.innerHTML = '';
      const anyTotal = Object.values(data).map(d => d.total)[0] || 0;
      if (!anyTotal || anyTotal < MIN_OTHERS_DIVES) { body.append(el('p', { class: 'small muted', text: 'Appears after ' + MIN_OTHERS_DIVES + ' dives today.' })); return; }
      const ul = el('ul', { class: 'others' });
      record.results.forEach((r, i) => {
        const d = data[r.promptId];
        const prompt = promptsById[r.promptId];
        if (!d || !prompt) return;
        const name = (id) => (dive.isTaxonId(id) ? id.slice(6).replace(/-/g, ' ') : (entities[id] ? entities[id].name : id));
        const pct = (n) => Math.max(1, Math.round(100 * n / d.total)) + '%';
        const tops = d.top.map(t => '<span class="tier tier-' + t.tier + '">' + esc(name(t.entityId)) + '</span> ' + pct(t.n)).join(' · ');
        const mine = r.entityId ? '<b>You:</b> ' + esc(name(r.entityId)) + (r.tier ? ' (' + esc(dive.TIER_BY_CODE[r.tier].name) + ')' : '') : '<b>You:</b> miss';
        ul.append(el('li', {}, [
          el('div', { class: 'small', html: '<b>' + (i + 1) + '.</b> ' + esc(prompt.text) }),
          el('div', { class: 'small', html: tops + (d.hadal ? ' · <span class="tier tier-hadal">🔱</span> ' + pct(d.hadal) + ' found the Hadal answer' : '') }),
          el('div', { class: 'tiny muted', html: mine }),
        ]));
      });
      body.append(ul);
    };
    if (flags.LEADERBOARD_ENABLED && configured()) {
      rest('/rest/v1/rpc/top_answers', { method: 'POST', body: { p_day: record.dayKey } }).then((rows) => {
        const data = {};
        for (const row of rows || []) {
          const d = data[row.prompt_id] || (data[row.prompt_id] = { total: row.total || 0, top: [], hadal: 0, misses: 0 });
          const p = promptsById[row.prompt_id];
          const a = p && p.answers.find(x => x.entity === row.entity_id);
          const tier = a ? a.tier : (dive.isTaxonId(row.entity_id) ? dive.TAXON_TIER : null);
          if (tier === 'hadal') d.hadal += row.n;
          if (d.top.length < TOP_ANSWERS_N) d.top.push({ entityId: row.entity_id, tier, n: row.n });
        }
        draw(data, false);
      }).catch(() => { body.innerHTML = '<p class="small muted">Could not load today’s answers right now.</p>'; });
    } else draw(mockTopAnswers(record.dayKey, record.promptIds), true);
    return card;
  }
  function expandBins(bins) {        // approximate depths from a histogram (bin centres)
    const out = [];
    const w = F().charts.CURVE_BIN_M;
    (bins || []).forEach((n, i) => { for (let k = 0; k < n; k++) out.push((i + 0.5) * w); });
    return out;
  }

  // ================================================================ mock data (deterministic per day)
  const MOCK_ADJ = ['Abyssal', 'Salty', 'Tidal', 'Benthic', 'Pelagic', 'Brackish', 'Coral', 'Kelp', 'Hadal', 'Neritic', 'Boreal', 'Glassy', 'Briny', 'Deep', 'Silver', 'Bioluminous'];
  const MOCK_NOUN = ['Narwhal', 'Manta', 'Oarfish', 'Angler', 'Nautilus', 'Blobfish', 'Snailfish', 'Sunfish', 'Lamprey', 'Isopod', 'Wobbegong', 'Coelacanth', 'Dugong', 'Seadragon', 'Grouper', 'Cuttle'];
  const MOCK_FLAGS = ['🇺🇸', '🇬🇧', '🇦🇺', '🇨🇦', '🇯🇵', '🇧🇷', '🇩🇪', '🇫🇷', '🇳🇿', '🇮🇳', '🇿🇦', '🇳🇴', '🇲🇽', '🇰🇷', '🇪🇸', '🇮🇹', '🇵🇭', '🇮🇩', '🇵🇹', '🇸🇪'];
  const mockCache = {};
  function mockHandle(rng, i) { return MOCK_ADJ[Math.floor(rng() * MOCK_ADJ.length)] + MOCK_NOUN[Math.floor(rng() * MOCK_NOUN.length)] + (10 + Math.floor(rng() * 89)); }
  function mockTier(rng) {
    let r = rng();
    for (const [code, w] of Object.entries(MOCK_TIER_WEIGHTS)) { if (r < w) return code; r -= w; }
    return 'miss';
  }
  function mockDive(rng) {
    const { dive } = F();
    let points = 0, seconds = 0;
    const tiers = [];
    for (let i = 0; i < dive.PROMPTS_PER_DIVE; i++) {
      const t = mockTier(rng);
      tiers.push(t === 'miss' ? null : t);
      points += t === 'miss' ? 0 : dive.TIER_BY_CODE[t].points;
      seconds += 4 + rng() * 18;
    }
    return { depth: dive.depthFor(points), points, tiers, seconds: Math.round(seconds * 10) / 10 };
  }
  function mockDaily(dayKey) {
    if (mockCache[dayKey]) return mockCache[dayKey];
    const { dive, charts } = F();
    const rng = dive.seededRng('mock-daily:' + dayKey);
    const total = MOCK_DIVERS_MIN + Math.floor(rng() * MOCK_DIVERS_SPREAD);
    const depths = [];
    const nBins = Math.ceil(dive.CHALLENGER_DEEP_M / charts.CURVE_BIN_M);
    const bins = new Array(nBins).fill(0);
    const top = [];
    for (let i = 0; i < total; i++) {
      const d = mockDive(rng);
      depths.push(d.depth);
      bins[Math.min(nBins - 1, Math.floor(d.depth / charts.CURVE_BIN_M))]++;
      if (top.length < 400 || d.depth > top[top.length - 1].depth) {
        top.push({ handle: mockHandle(rng, i), flag: MOCK_FLAGS[Math.floor(rng() * MOCK_FLAGS.length)], depth: d.depth, seconds: d.seconds, tiers: d.tiers, rating: 35 + rng() * 60 });
        top.sort((a, b) => b.depth - a.depth || a.seconds - b.seconds);
        if (top.length > 400) top.length = 400;
      }
    }
    const sorted = depths.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const out = { total, depths, bins, median, top };
    mockCache[dayKey] = out;
    return out;
  }
  function mockBoards(dayKey) {
    const key = 'boards:' + tideKey(dayKey);
    if (mockCache[key]) return mockCache[key];
    const { dive } = F();
    const rng = dive.seededRng('mock-boards:' + tideKey(dayKey));
    const tide = [];
    for (let i = 0; i < BOARD_LIMIT; i++) {
      const rating = Math.round((97 - i * 0.45 - rng() * 3) * 10) / 10;
      tide.push({ handle: mockHandle(rng, i), flag: MOCK_FLAGS[Math.floor(rng() * MOCK_FLAGS.length)], rating: Math.max(5, rating), dives: 5 + Math.floor(rng() * 26), meanDepth: Math.round(4000 + rng() * 6000) });
    }
    tide.sort((a, b) => b.rating - a.rating || b.meanDepth - a.meanDepth);
    const alltime = tide.map(r => ({ handle: r.handle, flag: r.flag, meters: Math.round(r.meanDepth * (20 + rng() * 300)) })).sort((a, b) => b.meters - a.meters);
    const hall = [];
    for (let m = 1; m <= 3; m++) {
      const t = tideKey(dive.keyPlusDays(dayKey.slice(0, 7) + '-01', -28 * m));
      const rows = [];
      for (let i = 0; i < 10; i++) rows.push({ rank: i + 1, handle: mockHandle(rng, i), flag: MOCK_FLAGS[Math.floor(rng() * MOCK_FLAGS.length)], rating: Math.round((96 - i * 1.3 - rng() * 2) * 10) / 10 });
      hall.push({ tide: t, rows });
    }
    const out = { tide, alltime, hall };
    mockCache[key] = out;
    return out;
  }

  // ================================================================ leaderboard page
  const TABS = [['today', 'Today'], ['tide', 'This Tide'], ['alltime', 'All Time'], ['friends', 'Friends']];
  function leaderboardPage(tab) {
    const { el, esc, dive, storage, charts } = F();
    const t = TABS.some(x => x[0] === tab) ? tab : 'today';
    const wrap = el('div', { class: 'card' });
    if (!flags.LEADERBOARD_ENABLED && !flags.MOCK_ONLINE_DATA) {
      wrap.append(el('p', { text: 'Rankings go live when ' + F().dive.BRAND + ' is online. Your daily dives are saved on this device meanwhile.' }));
      return wrap;
    }
    const demo = !flags.LEADERBOARD_ENABLED;
    const today = F().todayKey();
    const tabs = el('div', { class: 'tabs', role: 'tablist' }, TABS.map(([code, label]) => el('button', { role: 'tab', 'aria-selected': String(code === t), text: label, onClick: () => F().navigate('#leaderboard-' + code) })));
    const head = el('div', { class: 'row between', style: 'margin-bottom:8px' }, [el('div', { id: 'world-one', class: 'small', html: '' }), demo ? el('span', { class: 'badge demo', text: 'demo data' }) : null]);
    const body = el('div', { html: '<p class="small muted">Loading…</p>' });
    wrap.append(head, tabs, body);

    const row = (rank, who, value, extra, me) => el('li', { class: me ? 'lb-me' : '' }, [
      el('span', { class: 'lb-rank', text: rank == null ? '\u2014' : String(rank) }),
      el('span', { class: 'grow lb-who' }, [el('span', { class: 'lb-name', html: who.name }), who.rating != null ? el('span', {}, el('span', { class: 'badge league', title: 'League', text: leagueFor(who.rating).name })) : null]),
      el('span', { class: 'lb-val', html: '<b>' + value + '</b>' + (extra ? '<br><span class="small muted">' + extra + '</span>' : '') }),
    ]);
    const leagueBadge = (rating) => '<span class="badge league" title="League">' + esc(leagueFor(rating).name) + '</span>';
    const whoHtml = (r) => ({ name: (r.flag ? r.flag + ' ' : '') + '<b>' + esc(r.handle) + '</b>', rating: r.rating });

    function drawToday(top, myRank, myDepth) {
      body.innerHTML = '';
      const ul = el('ul', { class: 'list' });
      top.slice(0, BOARD_LIMIT).forEach((r, i) => ul.append(row(i + 1, whoHtml(r), esc(dive.formatMeters(r.depth)) + ' m', Math.round(r.seconds) + ' s')));
      if (myDepth != null) ul.append(row(myRank, { name: '<b>You</b>' + (user() ? '' : ' <span class="small muted">(anonymous diver)</span>') }, esc(dive.formatMeters(myDepth)) + ' m', myRank ? 'your rank' : 'not submitted', true));
      body.append(ul);
    }
    function drawTide(rows) {
      body.innerHTML = '';
      const ul = el('ul', { class: 'list' });
      rows.forEach((r, i) => ul.append(row(i + 1, whoHtml(r), r.rating.toFixed(1), r.dives + ' dives')));
      body.append(el('p', { class: 'small muted', text: 'Rating = average of your best ' + RATING_BEST_OF + ' daily percentiles in the last ' + RATING_WINDOW_DAYS + ' days. Tide ' + tideKey(today) + '.' }), ul);
    }
    function drawAllTime(rows, hall) {
      body.innerHTML = '';
      const ul = el('ul', { class: 'list' });
      rows.forEach((r, i) => ul.append(row(i + 1, whoHtml(r), esc(dive.formatMeters(r.meters)) + ' m')));
      body.append(el('h3', { text: 'Most metres dived' }), ul);
      body.append(el('h3', { style: 'margin-top:16px', text: 'Hall of Fame' }));
      for (const h of hall) {
        const hul = el('ul', { class: 'list' });
        h.rows.forEach(r => hul.append(row(r.rank, whoHtml(r), r.rating.toFixed(1))));
        body.append(el('details', {}, [el('summary', { text: 'Tide ' + h.tide + ' — top 10' }), hul]));
      }
    }
    function drawFriends(rows, note) {
      body.innerHTML = '';
      if (!rows || !rows.length) { body.append(root.FathomPages.emptyState('No friends on the board yet', note)); return; }
      body.append(el('p', { class: 'small muted', text: note }));
      const ul = el('ul', { class: 'list' }); rows.forEach((r, i) => ul.append(row(i + 1, whoHtml(r), esc(dive.formatMeters(r.depth)) + ' m'))); body.append(ul);
      body.append(friendsCurve(rows.map(r => r.depth), storage.getDailyResult(today) ? storage.getDailyResult(today).depth : null));
    }
    // a bell curve drawn from just your friends' depths today (and yours)
    function friendsCurve(depths, mine) {
      const all = depths.slice(); if (mine != null) all.push(mine);
      if (all.length < 2) return el('p', { class: 'tiny muted', text: 'The friends curve appears once two of you have dived today.' });
      const bins = []; for (const d of all) { const i = Math.floor(d / charts.CURVE_BIN_M); bins[i] = (bins[i] || 0) + 1; }
      for (let i = 0; i < bins.length; i++) bins[i] = bins[i] || 0;
      const sorted = all.slice().sort((a, b) => a - b); const median = sorted[Math.floor(sorted.length / 2)];
      const pct = mine != null ? Math.round(100 * all.filter(d => d > mine).length / all.length) : null;
      return el('div', { class: 'friends-curve' }, [el('h4', { text: 'Friends curve · today' }), el('div', { html: charts.bellCurve({ bins, total: all.length, median, playerDepth: mine, percentile: pct }) })]);
    }

    if (demo) {
      const m = mockDaily(today);
      const b = mockBoards(today);
      head.querySelector('#world-one').innerHTML = 'World #1 · <b>' + esc(b.tide[0].handle) + '</b> ' + leagueBadge(b.tide[0].rating);
      const mine = storage.getDailyResult(today);
      if (t === 'today') drawToday(m.top, mine ? m.depths.filter(d => d > mine.depth).length + 1 : null, mine ? mine.depth : null);
      else if (t === 'tide') drawTide(b.tide);
      else if (t === 'alltime') drawAllTime(b.alltime, b.hall);
      else {
        const demoFriends = m.top.slice(3, 7).map(r => ({ handle: r.handle, flag: r.flag, depth: r.depth, rating: r.rating }));
        body.append(el('form', { class: 'row', onSubmit: (e) => { e.preventDefault(); F().toast('Following opens when ' + F().dive.BRAND + ' is online'); } }, [el('input', { class: 'input', placeholder: 'Follow a handle', 'aria-label': 'Handle to follow' }), el('button', { class: 'btn', type: 'submit', text: 'Follow' })]));
        const holder = el('div');
        body.append(holder);
        const saved = body; // drawFriends clears body; draw into the holder instead
        holder.append(el('p', { class: 'small muted', text: 'Demo friends — follow real handles once ' + F().dive.BRAND + ' is online.' }));
        const ul = el('ul', { class: 'list' }); demoFriends.forEach((r, i) => ul.append(row(i + 1, whoHtml(r), esc(dive.formatMeters(r.depth)) + ' m'))); holder.append(ul);
        holder.append(friendsCurve(demoFriends.map(r => r.depth), storage.getDailyResult(today) ? storage.getDailyResult(today).depth : null));
        void saved;
      }
      return wrap;
    }
    (async () => {
      try {
        const w1 = await rest('/rest/v1/leaderboard_tide?select=handle,flag,rating&order=rank.asc.nullslast&limit=1');
        if (w1 && w1[0]) head.querySelector('#world-one').innerHTML = 'World #1 · <b>' + esc(w1[0].handle) + '</b> ' + leagueBadge(w1[0].rating);
        if (t === 'today') {
          const rows = await rest('/rest/v1/leaderboard_today?select=handle,flag,depth,seconds_used,rating&day=eq.' + today + '&order=depth.desc,seconds_used.asc&limit=' + BOARD_LIMIT);
          const mine = storage.getDailyResult(today);
          drawToday(rows.map(r => ({ handle: r.handle, flag: r.flag, depth: r.depth, seconds: r.seconds_used, rating: r.rating })), mine && mine.online ? mine.online.rank : null, mine ? mine.depth : null);
        } else if (t === 'tide') {
          const rows = await rest('/rest/v1/leaderboard_tide?select=handle,flag,rating,dives&order=rank.asc.nullslast&limit=' + BOARD_LIMIT);
          drawTide(rows);
        } else if (t === 'alltime') {
          const rows = await rest('/rest/v1/leaderboard_alltime?select=handle,flag,meters&order=meters.desc&limit=' + BOARD_LIMIT);
          const hallRows = await rest('/rest/v1/hall_of_fame?select=tide,rank,handle,flag,rating&order=tide.desc,rank.asc&limit=100');
          const hall = [];
          for (const r of hallRows) { let h = hall.find(x => x.tide === r.tide); if (!h) { h = { tide: r.tide, rows: [] }; hall.push(h); } h.rows.push(r); }
          drawAllTime(rows, hall);
        } else {
          if (!user()) return drawFriends([], 'Sign in to follow friends and see them here.');
          const form = el('form', { class: 'row', onSubmit: async (e) => { e.preventDefault(); const h = form.querySelector('input').value.trim(); if (!h) return; try { await rest('/rest/v1/rpc/follow_handle', { method: 'POST', body: { p_handle: h } }); F().toast('Following ' + h); F().navigate('#leaderboard-friends'); } catch (err) { F().toast('No diver with that handle'); } } }, [el('input', { class: 'input', placeholder: 'Follow a handle', 'aria-label': 'Handle to follow' }), el('button', { class: 'btn', type: 'submit', text: 'Follow' })]);
          const sub = el('div', { class: 'tabs', role: 'tablist' });
          const subBody = el('div');
          const drawSub = async (which) => {
            sub.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.which === which)));
            subBody.innerHTML = '<p class="small muted">Loading…</p>';
            try {
              if (which === 'today') {
                const rows = await rest('/rest/v1/rpc/friends_today', { method: 'POST', body: { p_day: today } });
                subBody.innerHTML = ''; const ul = el('ul', { class: 'list' }); rows.forEach((r, i) => ul.append(row(i + 1, whoHtml(r), esc(dive.formatMeters(r.depth)) + ' m'))); subBody.append(rows.length ? ul : root.FathomPages.emptyState('No dives from your friends today', 'Follow a handle above, or send a challenge link from any result screen.'));
                if (rows.length) subBody.append(friendsCurve(rows.map(r => r.depth), storage.getDailyResult(today) ? storage.getDailyResult(today).depth : null));
              } else if (which === 'tide') {
                const rows = await rest('/rest/v1/rpc/friends_tide', { method: 'POST', body: {} });
                subBody.innerHTML = ''; const ul = el('ul', { class: 'list' }); rows.forEach((r, i) => ul.append(row(i + 1, whoHtml(r), Number(r.rating).toFixed(1), r.dives + ' dives'))); subBody.append(rows.length ? ul : el('p', { class: 'small muted', text: 'Nobody ranked yet.' }));
              } else {
                const rows = await rest('/rest/v1/rpc/friends_alltime', { method: 'POST', body: {} });
                subBody.innerHTML = ''; const ul = el('ul', { class: 'list' }); rows.forEach((r, i) => ul.append(row(i + 1, whoHtml(r), esc(dive.formatMeters(r.meters)) + ' m'))); subBody.append(rows.length ? ul : el('p', { class: 'small muted', text: 'No metres yet.' }));
              }
            } catch (err) { subBody.innerHTML = '<p class="small muted">Could not load this board right now.</p>'; }
          };
          for (const [code, label] of [['today', 'Today'], ['tide', 'This Tide'], ['alltime', 'All Time']]) sub.append(el('button', { role: 'tab', dataset: { which: code }, 'aria-selected': 'false', text: label, onClick: () => drawSub(code) }));
          body.innerHTML = '';
          body.append(el('p', { class: 'small muted', text: 'You and the divers you follow.' }), form, sub, subBody);
          drawSub('today');
        }
      } catch (e) {
        body.innerHTML = '<p class="small muted">' + (navigator.onLine ? 'The leaderboard could not be loaded right now.' : 'You are offline — leaderboards need a connection.') + '</p>';
      }
    })();
    return wrap;
  }

  // ---------------------------------------------------------------- rating summary (stats modal)
  function ratingSummary() {
    const { storage, esc } = F();
    if (!flags.LEADERBOARD_ENABLED && !flags.MOCK_ONLINE_DATA) return null;
    const played = Object.keys(storage.allDailyResults()).length;
    const need = Math.max(0, MIN_RANKED_DAYS - played);
    if (!flags.LEADERBOARD_ENABLED) {
      return '<span class="badge demo">demo</span> Rankings use demo data until ' + F().dive.BRAND + ' is online. ' + (need ? need + ' more daily dive' + (need === 1 ? '' : 's') + ' until you are ranked.' : 'You have enough daily dives to be ranked.');
    }
    if (!user()) return 'Sign in (Settings) to hold a rating and appear on leaderboards. ' + (need ? need + ' more daily dives until you are ranked.' : '');
    const r = F().storage.get('rating', null);
    if (!r) return need ? need + ' more daily dive' + (need === 1 ? '' : 's') + ' until you are ranked.' : 'Your rating appears after tonight’s close.';
    if (r.rank == null) return '<b>' + Number(r.rating).toFixed(1) + '</b> provisional · ' + Math.max(0, MIN_RANKED_DAYS - (r.dives || 0)) + ' more scored days until you are ranked.';
    return '<b>' + Number(r.rating).toFixed(1) + '</b> · ' + esc(leagueFor(Number(r.rating)).name) + ' league · world #' + r.rank;
  }

  // ---------------------------------------------------------------- settings section (sign-in, handle, hide, delete)
  function settingsSection() {
    const { el, esc, storage, toast } = F();
    const box = el('div', { style: 'margin-top:12px' });
    if (!onlineNeeded()) {
      box.append(el('div', { class: 'switch' }, el('div', { html: '<b>Account</b><br><span class="small muted">Sign-in, leaderboards and purchases open when ' + F().dive.BRAND + ' is online. Free play never needs an account.</span>' })));
      return box;
    }
    const u = user();
    if (!u) {
      box.append(el('div', { class: 'switch' }, [el('div', { html: '<b>Account</b><br><span class="small muted">Sign in with Google to join leaderboards, hold a rating and sync across devices.</span>' }), el('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Sign in', onClick: signIn })]));
      return box;
    }
    const handleInput = el('input', { type: 'text', value: (profile && profile.handle) || '', placeholder: 'Pick a handle', 'aria-label': 'Handle', maxlength: '16' });
    const saveBtn = el('button', { class: 'btn btn-sm', type: 'button', text: 'Save', onClick: async () => {
      const h = handleInput.value.trim();
      const problem = handleProblem(h);
      if (problem) return toast(problem);
      try { await saveProfile({ handle: h }); toast('Handle saved'); } catch (e) { toast(/duplicate|unique|409/i.test(e.message) ? 'That handle is taken' : 'Could not save the handle'); }
    } });
    const flagSel = el('select', { 'aria-label': 'Flag', onChange: async (e) => { try { await saveProfile({ flag: e.target.value }); } catch (err) { toast('Could not save'); } } }, [el('option', { value: '', text: 'No flag' })].concat(MOCK_FLAGS.map(f => el('option', { value: f, text: f, selected: profile && profile.flag === f }))));
    const hideBtn = el('button', { class: 'toggle', type: 'button', role: 'switch', 'aria-checked': String(!!(profile && profile.hidden)), 'aria-label': 'Hide me from leaderboards', onClick: async () => {
      const cur = hideBtn.getAttribute('aria-checked') === 'true';
      try { await saveProfile({ hidden: !cur }); hideBtn.setAttribute('aria-checked', String(!cur)); } catch (e) { toast('Could not save'); }
    } });
    box.append(
      el('div', { class: 'switch' }, [el('div', { html: '<b>Signed in</b><br><span class="small muted">' + esc(u.email || '') + '</span>' }), el('button', { class: 'btn btn-sm', type: 'button', text: 'Sign out', onClick: async () => { await signOut(); F().closeModal(); } })]),
      el('div', { class: 'switch' }, [el('div', { html: '<b>Handle</b><br><span class="small muted">Shown on leaderboards. 3–16 letters, numbers, underscores.</span>' }), el('div', { class: 'row' }, [handleInput, saveBtn])]),
      el('div', { class: 'switch' }, [el('div', { html: '<b>Flag</b><br><span class="small muted">Optional, chosen by you.</span>' }), flagSel]),
      el('div', { class: 'switch' }, [el('div', { html: '<b>Hide me from leaderboards</b><br><span class="small muted">Your dives still count in the daily curve.</span>' }), hideBtn]),
      el('div', { class: 'switch' }, [el('div', { html: '<b>Delete my account and data</b><br><span class="small muted">Removes everything stored for you on our server.</span>' }), el('button', { class: 'btn btn-sm', type: 'button', text: 'Delete', onClick: async () => { if (!(await F().confirmDialog('Delete your account and all server data? This cannot be undone.', 'Delete'))) return; try { await deleteAccount(); toast('Account deleted'); } catch (e) { toast('Could not delete right now'); } } })]),
    );
    return box;
  }

  // ================================================================ analytics
  let analyticsLoaded = false;
  function loadAnalytics() {
    if (!flags.ANALYTICS_ENABLED || !ANALYTICS_DOMAIN || analyticsLoaded) return;
    analyticsLoaded = true;
    const s = document.createElement('script');
    s.defer = true; s.setAttribute('data-domain', ANALYTICS_DOMAIN); s.src = ANALYTICS_SCRIPT_URL;
    document.head.appendChild(s);
  }
  function trackEvent(name, props) {
    if (!flags.ANALYTICS_ENABLED) return;
    try { if (typeof root.plausible === 'function') root.plausible(name, { props: props || {} }); } catch (e) { /* ignore */ }
  }

  // ================================================================ init
  function init() {
    loadSession();
    loadAnalytics();
    handleAuthRedirect().then(async (handled) => {
      if (handled) { await syncProgressDown(); await refreshRating(); F().navigate('#home'); }
      else if (user()) { await loadProfile().catch(() => {}); await refreshEntitlements(); await syncProgressDown(); await refreshRating(); }
      // back from Stripe Checkout (the Payment Link's confirmation page redirects to ?checkout=success)
      if (/[?&]checkout=success/.test(location.search)) {
        const before = entitlements().length;
        await refreshEntitlements();
        try { history.replaceState(null, '', siteRoot().split('?')[0] + (location.hash || '#home')); } catch (e) { /* ignore */ }
        if (entitlements().length > before) { F().toast('Thank you — unlocked'); trackEvent('purchase_completed', {}); }
        else F().toast('Payment received — unlocks appear in a moment');
      }
      drainQueue();
    });
    root.addEventListener('online', drainQueue);
  }

  root.FathomOnline = {
    FLAGS, LEAGUES, MIN_CURVE_DIVES, RATING_WINDOW_DAYS, RATING_BEST_OF, MIN_RANKED_DAYS, HANDLE_RE,
    init, user, entitlements, refreshEntitlements, signIn, signOut, handleProblem, saveProfile, deleteAccount,
    submitDaily, drainQueue, submitStatusLine, getSubmitState, fetchCurve, curveSection, othersSection, lastPercentile, percentileOf, refreshRating, syncProgressUp,
    leaderboardPage, ratingSummary, settingsSection, trackEvent, leagueFor, mockDaily, mockBoards,
    _rest: rest, _headers: headers, _configured: configured,
  };
})(window);
