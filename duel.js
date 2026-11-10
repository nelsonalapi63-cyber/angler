/* ANGLER Duel — the room screen, the pass-and-play driver (everyone on one phone) and the online driver (private
 * rooms by code through the `duel` Edge Function and Supabase Realtime). The rules live in shared/duel.js. */
(function (root) {
  'use strict';
  const F = () => root.Fathom;
  const D = () => root.FathomDuel;
  const TICK_MS = 500;                 // how often a client asks the clock (local) or the server (online) whether the puffer popped
  const POP_PAUSE_MS = 2600;           // the popped puffer stays on screen this long before the next round
  const WOBBLE_AFTER_MS = 10000;       // the puffer could pop from here on: it wobbles
  const SWELL_FULL_MS = 30000;         // fully swollen at the longest fuse
  const PASS_BANNER_MS = 2200;
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  const GUEST_KEY = 'duelGuestName';
  let view = null;                     // the live room screen { driver, root nodes, timers }

  // ---------------------------------------------------------------- helpers
  function guestName() { const s = F().storage; return s.get(GUEST_KEY, '') || ''; }
  function saveGuestName(n) { F().storage.set(GUEST_KEY, String(n || '').trim().slice(0, 20)); }
  function displayName() {
    const o = root.FathomOnline;
    const p = o && o.profile ? o.profile() : null;
    return (p && p.handle) || guestName() || '';
  }
  function track(name, props) { if (root.FathomOnline && root.FathomOnline.trackEvent) root.FathomOnline.trackEvent(name, props || {}); }
  const tierOf = (code) => F().dive.TIER_BY_CODE[code] || F().dive.MISS;
  function siteLink(code) { const base = (root.FATHOM_SITE && root.FATHOM_SITE.siteUrl) || (location.origin + location.pathname); return base.replace(/\/$/, '') + '/#duel-' + code; }

  // ---------------------------------------------------------------- the local driver: pass-and-play on one device
  // Same reducer, same matcher; the fuse is drawn here and the clock is this device's.
  function localDriver(names) {
    const { dive, entities, prompts, taxa } = F();
    const duel = D();
    let state = duel.initial({ code: 'PHONE', hostId: 'p1', t: Date.now() });
    names.forEach((n, i) => { state = duel.reduce(state, { type: 'join', playerId: 'p' + (i + 1), name: n, t: Date.now() }); });
    const listeners = new Set();
    let timer = null, popping = false;
    const emit = () => { for (const fn of listeners) fn(duel.publicState(state), state.round ? state.round.holder : null); };
    const index = (promptId) => { const p = F().promptsById[promptId]; if (!p._index) p._index = dive.buildIndex(p, entities, taxa); return p._index; };
    function deal() { return duel.pickPrompt(prompts, state.used); }
    // the browser test run (mock mode) can shorten the hidden fuse so a whole duel fits in seconds
    const fuse = () => { const t = root.FATHOM_DUEL_TEST; return t && t.fuseMs > 0 && F().storage.get && root.FATHOM_FLAGS && root.FATHOM_FLAGS.MOCK_ONLINE_DATA ? t.fuseMs : duel.drawFuse(); };
    function tick() {
      if (state.status !== 'playing' || !state.round || popping) return;
      if (Date.now() >= state.round.deadline) {
        popping = true;
        state = duel.reduce(state, { type: 'pop', t: Date.now() });
        emit();
        setTimeout(() => {
          popping = false;
          if (state.status === 'playing') { const pid = deal(); if (pid) state = duel.reduce(state, { type: 'next_round', t: Date.now(), promptId: pid, fuseMs: fuse() }); else state = duel.reduce(state, { type: 'end', t: Date.now() }); }
          emit();
        }, POP_PAUSE_MS);
      }
    }
    return {
      mode: 'local', me: () => (state.round ? state.round.holder : null), isHost: () => true, allLocal: true,
      state: () => duel.publicState(state), now: () => Date.now(),
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      async start() {
        const pid = deal();
        if (!pid) throw new Error('No questions to deal');
        state = duel.reduce(state, { type: 'start', t: Date.now(), promptId: pid, fuseMs: fuse() });
        if (timer) clearInterval(timer);
        timer = setInterval(tick, TICK_MS);
        emit();
        return this.state();
      },
      async answer(typed) {
        if (state.status !== 'playing' || !state.round) return { accepted: false, reason: 'not_playing' };
        const prompt = F().promptsById[state.round.promptId];
        const m = dive.matchAnswer(typed, index(prompt.id), entities);
        if (!m.entityId) return { accepted: false, reason: 'not_accepted', correction: m.correction || null, ambiguous: m.ambiguous || null, state: this.state() };
        const said = duel.alreadySaid(state, m.entityId);
        if (said) return { accepted: false, reason: 'already_said', name: said.name, byName: said.byName, state: this.state() };
        const ent = dive.isTaxonId(m.entityId) ? { name: m.name || typed } : entities[m.entityId];
        const t = Date.now();
        state = duel.reduce(state, { type: 'answer', playerId: state.round.holder, entityId: m.entityId, name: ent.name, tier: m.tier, t });
        state = duel.reduce(state, { type: 'pass', t });
        emit();
        return { accepted: true, entityId: m.entityId, name: ent.name, tier: m.tier, correction: m.correction && m.correction.accepted ? m.correction : null, state: this.state() };
      },
      async tick() { tick(); return this.state(); },
      async leave() { if (timer) clearInterval(timer); timer = null; },
      async rematch() { state = duel.reduce(state, { type: 'rematch', t: Date.now() }); emit(); return this.state(); },
      destroy() { if (timer) clearInterval(timer); timer = null; listeners.clear(); },
    };
  }

  // ---------------------------------------------------------------- the online driver: private rooms through the Edge Function
  function onlineDriver(room) {
    // room: { roomId, code, playerId, token, state, now }
    const o = root.FathomOnline;
    const listeners = new Set();
    let state = room.state, offset = (room.now || Date.now()) - Date.now(), timer = null, channel = null, client = null, destroyed = false;
    const emit = () => { for (const fn of listeners) fn(state, room.playerId); };
    async function call(action, body) {
      const res = await fetch(o.supabaseUrl() + '/functions/v1/duel', { method: 'POST', headers: o._headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(Object.assign({ action, roomId: room.roomId, token: room.token }, body || {})) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      if (data.now) offset = data.now - Date.now();
      if (data.state && (!state || data.state.seq >= state.seq)) { state = data.state; emit(); }
      return data;
    }
    async function tick() { if (destroyed || !state || state.status !== 'playing') return; try { await call('tick'); } catch (e) { /* next tick */ } }
    async function subscribe() {
      try {
        if (!root.supabase) await loadScript(SUPABASE_JS);
        client = root.supabase.createClient(o.supabaseUrl(), o.anonKey(), { realtime: { params: { eventsPerSecond: 5 } } });
        channel = client.channel('duel:' + room.roomId, { config: { presence: { key: room.playerId } } });
        channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'duel_rooms', filter: 'id=eq.' + room.roomId }, (payload) => {
          const s = payload.new && payload.new.state;
          if (s && (!state || s.seq >= state.seq)) { state = s; emit(); }
        });
        channel.on('presence', { event: 'sync' }, () => { const here = Object.keys(channel.presenceState()); for (const fn of listeners) fn(state, room.playerId, here); });
        channel.subscribe(async (status) => { if (status === 'SUBSCRIBED') await channel.track({ playerId: room.playerId, at: Date.now() }); });
      } catch (e) { /* no realtime: the tick keeps the room in step */ }
    }
    subscribe();
    timer = setInterval(tick, 1000);
    return {
      mode: 'online', me: () => room.playerId, isHost: () => state && state.hostId === room.playerId, allLocal: false, code: room.code, roomId: room.roomId,
      state: () => state, now: () => Date.now() + offset,
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      async start() { return (await call('start')).state; },
      async answer(typed) { return call('answer', { typed }); },
      async tick() { return (await call('tick')).state; },
      async leave() { try { await call('leave'); } catch (e) { /* ignore */ } },
      async rematch() { return (await call('rematch')).state; },
      destroy() { destroyed = true; if (timer) clearInterval(timer); timer = null; listeners.clear(); try { if (channel) client.removeChannel(channel); } catch (e) { /* ignore */ } },
    };
  }
  function loadScript(src) { return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error('failed to load ' + src)); document.head.appendChild(s); }); }
  async function createOnline(name) {
    const o = root.FathomOnline;
    const res = await fetch(o.supabaseUrl() + '/functions/v1/duel', { method: 'POST', headers: o._headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action: 'create', name, deviceId: F().storage.deviceId() }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }
  async function joinOnline(code, name) {
    const o = root.FathomOnline;
    const res = await fetch(o.supabaseUrl() + '/functions/v1/duel', { method: 'POST', headers: o._headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action: 'join', code, name, deviceId: F().storage.deviceId() }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  // ---------------------------------------------------------------- screens
  function open(param) {
    if (view) { view.destroy(); view = null; }
    const code = String(param || '').toUpperCase();
    if (!code) return landing();
    if (code === 'LOCAL') return localSetup();
    if (/^[A-Z]{4}$/.test(code)) return joinScreen(code);
    return landing();
  }
  function landing() {
    const { el, render, dive } = F();
    const online = !!(root.FathomOnline && root.FathomOnline.configured && root.FathomOnline.configured());
    const nameBox = el('input', { class: 'input', id: 'duel-name', type: 'text', maxlength: '20', placeholder: 'Your name', value: displayName(), 'aria-label': 'Your name in the room', autocomplete: 'nickname' });
    const codeBox = el('input', { class: 'input', id: 'duel-code', type: 'text', maxlength: '4', placeholder: 'Room code', 'aria-label': 'Room code', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', style: 'text-transform:uppercase;max-width:140px' });
    const msg = el('p', { class: 'reject-msg', id: 'duel-msg', role: 'status' });
    const needName = () => { const n = nameBox.value.trim(); if (!n) { msg.textContent = 'Type a name first'; nameBox.focus(); return null; } if (!(root.FathomOnline && root.FathomOnline.profile && root.FathomOnline.profile() && root.FathomOnline.profile().handle)) saveGuestName(n); return n; };
    const create = async () => { const n = needName(); if (!n || !online) return; msg.textContent = 'Opening a room…'; try { const r = await createOnline(n); track('duel_created', {}); roomScreen(onlineDriver(r)); } catch (e) { msg.textContent = 'Could not open a room: ' + e.message; } };
    const join = async () => { const n = needName(); if (!n) return; const c = codeBox.value.trim().toUpperCase(); if (!/^[A-Z]{4}$/.test(c)) { msg.textContent = 'A room code is four letters'; codeBox.focus(); return; } msg.textContent = 'Joining ' + c + '…'; try { const r = await joinOnline(c, n); track('duel_joined', { code: c }); roomScreen(onlineDriver(r)); } catch (e) { msg.textContent = 'Could not join ' + c + ': ' + e.message; } };
    render(el('div', { class: 'card strong duel-landing' }, [
      el('h1', { text: 'Duel' }),
      el('p', { class: 'lead', text: 'Pass the puffer. One ocean question, everyone takes turns naming an answer nobody has said. The fuse is hidden — if the puffer pops on you, you lose a life. Two lives each, two to eight players, last one floating wins.' }),
      el('div', { class: 'duel-name-row' }, [el('label', { for: 'duel-name', class: 'small muted', text: 'Play as' }), nameBox]),
      el('div', { class: 'duel-ways' }, [
        el('div', { class: 'duel-way' }, [el('h2', { text: 'Online, with a code' }), el('p', { class: 'small muted', text: online ? 'Open a private room and send the code or link. Nobody needs to sign in.' : 'Online rooms are off in this build.' }),
          el('div', { class: 'row' }, [el('button', { class: 'btn btn-primary', type: 'button', id: 'duel-create', text: 'Create a room', disabled: online ? null : true, onClick: create })]),
          el('form', { class: 'row', onSubmit: (e) => { e.preventDefault(); join(); } }, [codeBox, el('button', { class: 'btn', type: 'submit', id: 'duel-join', text: 'Join', disabled: online ? null : true })])]),
        el('div', { class: 'duel-way' }, [el('h2', { text: 'On this phone' }), el('p', { class: 'small muted', text: 'Pass one device around the table. Same rules, no connection needed.' }),
          el('a', { class: 'btn', href: '#duel-local', id: 'duel-local-btn', text: 'Play on this phone' })]),
      ]),
      msg,
      el('p', { class: 'small muted', html: 'Rarity still shows — a rare answer sinks your little sub further on the shared rail — but it never decides the winner. <a href="#faq">How Duel works</a>.' }),
    ]));
    document.title = dive.BRAND + ' Duel';
  }
  function joinScreen(code) {
    const { el, render } = F();
    const online = !!(root.FathomOnline && root.FathomOnline.configured && root.FathomOnline.configured());
    const nameBox = el('input', { class: 'input', id: 'duel-name', type: 'text', maxlength: '20', placeholder: 'Your name', value: displayName(), 'aria-label': 'Your name in the room', autocomplete: 'nickname' });
    const msg = el('p', { class: 'reject-msg', role: 'status' });
    const go = async () => { const n = nameBox.value.trim(); if (!n) { msg.textContent = 'Type a name first'; return; } saveGuestName(n); msg.textContent = 'Joining ' + code + '…'; try { const r = await joinOnline(code, n); track('duel_joined', { code }); roomScreen(onlineDriver(r)); } catch (e) { msg.textContent = 'Could not join ' + code + ': ' + e.message; } };
    render(el('div', { class: 'card strong duel-landing' }, [
      el('h1', { text: 'Join room ' + code }),
      el('p', { class: 'muted', text: online ? 'Pick a name and jump in.' : 'Online rooms are off in this build.' }),
      el('form', { class: 'row', onSubmit: (e) => { e.preventDefault(); go(); } }, [nameBox, el('button', { class: 'btn btn-primary', type: 'submit', text: 'Join', disabled: online ? null : true })]),
      msg,
      el('p', { class: 'small' }, [el('a', { href: '#duel', text: 'Back to Duel' })]),
    ]));
    setTimeout(() => nameBox.focus(), 30);
  }
  function localSetup() {
    const { el, render } = F();
    const names = [displayName() || 'Player 1', 'Player 2'];
    const list = el('div', { class: 'duel-names' });
    const msg = el('p', { class: 'reject-msg', role: 'status' });
    const draw = () => {
      list.innerHTML = '';
      names.forEach((n, i) => list.append(el('div', { class: 'row duel-name-line' }, [
        el('input', { class: 'input', type: 'text', maxlength: '20', value: n, 'aria-label': 'Player ' + (i + 1) + ' name', onInput: (e) => { names[i] = e.target.value; } }),
        names.length > 2 ? el('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': 'Remove player ' + (i + 1), text: '✕', onClick: () => { names.splice(i, 1); draw(); } }) : null,
      ])));
      list.append(el('div', { class: 'row' }, [names.length < D().MAX_PLAYERS ? el('button', { class: 'btn btn-sm', type: 'button', id: 'duel-add-player', text: '+ Add a player', onClick: () => { names.push('Player ' + (names.length + 1)); draw(); } }) : el('span', { class: 'small muted', text: 'Eight is the table' })]));
    };
    draw();
    render(el('div', { class: 'card strong duel-landing' }, [
      el('h1', { text: 'Duel on this phone' }),
      el('p', { class: 'muted', text: 'Two to eight players. Type a name each; the phone goes round the table with the puffer.' }),
      list, msg,
      el('div', { class: 'row' }, [
        el('button', { class: 'btn btn-primary btn-big', type: 'button', id: 'duel-local-start', text: 'Start the duel', onClick: () => {
          const clean = names.map(n => String(n).trim()).filter(Boolean);
          if (clean.length < 2) { msg.textContent = 'Two players at least'; return; }
          if (new Set(clean.map(n => n.toLowerCase())).size !== clean.length) { msg.textContent = 'Every name must be different'; return; }
          const driver = localDriver(clean);
          track('duel_created', { local: true, players: clean.length });
          roomScreen(driver, { autoStart: true });
        } }),
        el('a', { class: 'btn', href: '#duel', text: 'Back' }),
      ]),
    ]));
  }

  // ---------------------------------------------------------------- the room
  function roomScreen(driver, opts) {
    const { el, render, dive, esc } = F();
    const duel = D();
    if (view) view.destroy();
    const nodes = {};
    const v = { driver, timers: [], lastHolder: null, lastRound: null, lastSeq: -1, ask: null, holderSince: Date.now(), here: null,
      destroy() { for (const t of v.timers) clearInterval(t); v.timers = []; driver.destroy(); document.body.classList.remove('duel-playing'); } };
    view = v;
    const shell = el('section', { class: 'duel', 'aria-label': 'Duel' });
    render(shell);
    document.title = dive.BRAND + ' Duel';

    function draw(state, me, here) {
      if (here) v.here = here;
      if (!state) return;
      const changedRound = !!(state.round && state.round.n !== v.lastRound);
      if (changedRound) { v.lastRound = state.round.n; v.holderSince = Date.now(); }
      if (state.round && state.round.holder !== v.lastHolder) { if (v.lastHolder && state.status === 'playing') F().sound.pass(); v.lastHolder = state.round.holder; v.holderSince = Date.now(); }
      if (state.status === 'lobby') drawLobby(state, me);
      else if (state.status === 'playing' && !state.round) drawBetween(state, me);
      else if (state.status === 'playing') drawPlay(state, me, changedRound);
      else drawResult(state, me);
      v.lastSeq = state.seq;
    }

    function drawLobby(state, me) {
      document.body.classList.remove('duel-playing');
      const link = driver.mode === 'online' ? siteLink(state.code) : null;
      shell.innerHTML = '';
      shell.append(el('div', { class: 'card strong duel-lobby' }, [
        el('div', { class: 'tiny muted', text: driver.mode === 'online' ? 'Private room' : 'Pass-and-play' }),
        driver.mode === 'online' ? el('div', { class: 'duel-code', 'aria-label': 'Room code ' + state.code.split('').join(' ') }, [el('span', { text: state.code })]) : el('h1', { text: 'Duel on this phone' }),
        driver.mode === 'online' ? el('div', { class: 'row' }, [
          el('button', { class: 'btn btn-sm', type: 'button', id: 'duel-copy-code', text: 'Copy code', onClick: () => root.FathomGame.copyText(state.code, 'Code copied') }),
          el('button', { class: 'btn btn-sm', type: 'button', id: 'duel-copy-link', text: 'Copy link', onClick: () => root.FathomGame.copyText(link, 'Link copied') }),
          navigator.share ? el('button', { class: 'btn btn-sm', type: 'button', text: 'Share', onClick: () => navigator.share({ title: dive.BRAND + ' Duel', text: 'Join my ' + dive.BRAND + ' Duel room ' + state.code, url: link }).catch(() => {}) }) : null,
        ]) : null,
        el('h2', { text: 'Players (' + state.players.length + ' of ' + duel.MAX_PLAYERS + ')' }),
        el('ul', { class: 'duel-players-list' }, state.players.map(p => el('li', { text: p.name + (p.id === state.hostId ? ' · host' : '') + (p.id === me && driver.mode === 'online' ? ' (you)' : '') + (v.here && driver.mode === 'online' && !v.here.includes(p.id) ? ' · away' : '') }))),
        el('p', { class: 'small muted', text: state.players.length < duel.MIN_PLAYERS ? 'Waiting for one more… send the code.' : (driver.isHost() ? 'Everyone in? Start when you are ready.' : 'Waiting for ' + (state.players.find(p => p.id === state.hostId) || {}).name + ' to start.') }),
        el('div', { class: 'row' }, [
          driver.isHost() ? el('button', { class: 'btn btn-primary btn-big', type: 'button', id: 'duel-start', text: state.match > 1 ? 'Start the rematch' : 'Start the duel', disabled: state.players.length < duel.MIN_PLAYERS ? true : null, onClick: async () => { try { await driver.start(); track('duel_started', { players: state.players.length, mode: driver.mode }); } catch (e) { F().toast('Could not start: ' + e.message); } } }) : null,
          el('button', { class: 'btn btn-ghost', type: 'button', id: 'duel-leave', text: 'Leave', onClick: leave }),
        ]),
      ]));
    }

    function puffer() {
      // the puffer: a round fish facing right, spines all round, swelling with the time elapsed in the round and wobbling once it could pop
      const spines = [];
      for (let a = -150; a < 210; a += 20) {
        if (a > 150 && a < 210) continue;                                        // no spines where the tail joins
        const r = Math.PI * a / 180, c = Math.cos(r), sn = Math.sin(r);
        const bx = 64 + 40 * c, by = 60 + 36 * sn, tx = 64 + 54 * c, ty = 60 + 50 * sn;
        const px = -sn * 3.2, py = c * 3.2;                                        // a tapered triangle: base on the body, point outward
        spines.push('<path d="M' + (bx + px).toFixed(1) + ' ' + (by + py).toFixed(1) + ' L' + tx.toFixed(1) + ' ' + ty.toFixed(1) + ' L' + (bx - px).toFixed(1) + ' ' + (by - py).toFixed(1) + ' Z"/>');
      }
      return el('div', { class: 'puffer-wrap', 'aria-hidden': 'true' }, [el('div', { class: 'puffer', html:
        '<svg viewBox="0 0 120 120" width="120" height="120">' +
        '<path class="tail" d="M28 60 L8 44 Q14 60 8 76 Z" fill="#E4B94E" stroke="#B88A1F" stroke-width="2.5" stroke-linejoin="round"/>' +
        '<g class="spines" fill="#F2E7C6" stroke="#B88A1F" stroke-width="1.2" stroke-linejoin="round">' + spines.join('') + '</g>' +
        '<ellipse cx="64" cy="60" rx="40" ry="36" fill="#F6D27A" stroke="#B88A1F" stroke-width="3"/>' +
        '<ellipse cx="64" cy="72" rx="30" ry="18" fill="#FBEBB5"/>' +
        '<g fill="#C99A2E" opacity=".55"><circle cx="44" cy="46" r="3.5"/><circle cx="56" cy="36" r="2.5"/><circle cx="40" cy="62" r="2.5"/><circle cx="72" cy="34" r="3"/><circle cx="52" cy="54" r="2"/></g>' +
        '<path class="fin" d="M50 68 Q40 78 52 84 Q58 76 50 68 Z" fill="#E4B94E" stroke="#B88A1F" stroke-width="2"/>' +
        '<circle cx="82" cy="50" r="9" fill="#fff" stroke="#B88A1F" stroke-width="2"/><circle cx="84" cy="51" r="5" fill="#1E2430"/><circle cx="86" cy="49" r="1.8" fill="#fff"/>' +
        '<path d="M98 64 q5 2 0 6" stroke="#7A5A10" stroke-width="3" fill="none" stroke-linecap="round"/>' +
        '<ellipse cx="60" cy="40" rx="14" ry="5" fill="rgba(255,255,255,.28)"/></svg>' })]);
    }
    function tankIcons(p) {
      const out = [];
      for (let i = 0; i < D().LIVES; i++) out.push(el('span', { class: 'tank' + (i < p.lives ? ' full' : ' empty'), 'aria-hidden': 'true' }));
      return el('span', { class: 'tanks', role: 'img', 'aria-label': p.lives + (p.lives === 1 ? ' life' : ' lives') }, out);
    }
    function playerRing(state) {
      return el('ul', { class: 'duel-ring', 'aria-label': 'Players' }, state.players.map(p => el('li', { class: 'ring-player' + (state.round && state.round.holder === p.id ? ' holder' : '') + (!p.alive ? ' out' : ''), 'data-player': p.id }, [
        el('span', { class: 'ring-name', text: p.name }), tankIcons(p), !p.alive ? el('span', { class: 'tiny muted', text: p.left ? 'left' : 'out' }) : null,
      ])));
    }
    function depthRail(state) {
      const max = Math.max(1500, ...state.players.map(p => p.depthM || 0));
      return el('div', { class: 'duel-rail', 'aria-label': 'Depth rail' }, [
        el('div', { class: 'rail-line' }),
        ...state.players.map((p, i) => el('div', { class: 'rail-sub' + (!p.alive ? ' out' : ''), style: 'left:' + (4 + 92 * Math.min(1, (p.depthM || 0) / max)).toFixed(1) + '%;top:' + (6 + (i % 4) * 22) + '%', title: p.name + ' · ' + dive.formatMeters(p.depthM || 0) + ' m' }, [el('span', { class: 'sub-glyph', 'aria-hidden': 'true', text: '🚤' }), el('span', { class: 'tiny', text: p.name.slice(0, 8) + ' ' + dive.formatMeters(p.depthM || 0) + ' m' })])),
      ]);
    }
    function saidByTier(state) {
      const groups = dive.TIERS.slice().reverse().map(t => ({ tier: t, items: [] }));
      for (const a of state.round ? state.round.said : []) { const g = groups.find(x => x.tier.code === a.tier); if (g) g.items.push(a); }
      const wrap = el('div', { class: 'duel-said', 'aria-label': 'Answers already said' });
      if (!state.round || !state.round.said.length) wrap.append(el('p', { class: 'small muted', text: 'Nothing said yet.' }));
      for (const g of groups) if (g.items.length) wrap.append(el('div', { class: 'said-group' }, [el('span', { class: 'tier tier-' + g.tier.code, text: g.tier.emoji + ' ' + g.tier.name }), el('span', { class: 'said-list', text: g.items.map(a => a.name + ' (' + (state.players.find(p => p.id === a.by) || {}).name + ')').join(' · ') })]));
      return wrap;
    }
    function feedList(state) {
      return el('ol', { class: 'duel-feed', 'aria-label': 'What just happened' }, state.feed.slice(-5).reverse().map(f => el('li', { class: 'feed-' + f.type, text: f.text })));
    }

    function drawPlay(state, me, changedRound) {
      document.body.classList.add('duel-playing');
      const prompt = F().promptsById[state.round.promptId];
      const holder = state.players.find(p => p.id === state.round.holder);
      const myTurn = driver.allLocal || state.round.holder === me;
      const meP = state.players.find(p => p.id === me);
      const input = el('input', { class: 'input', id: 'duel-answer', type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', placeholder: myTurn ? 'Name one nobody has said…' : (holder ? holder.name + ' is thinking…' : ''), 'aria-label': 'Your answer', maxlength: '60', disabled: myTurn ? null : true });
      const btn = el('button', { class: 'btn btn-primary btn-dive', type: 'submit', text: 'Pass', disabled: myTurn ? null : true });
      const suggest = el('div', { id: 'duel-suggest', class: 'suggest', 'aria-live': 'polite' });
      const msg = el('div', { id: 'duel-msg', class: 'reject-msg', role: 'status' });
      const form = el('form', { class: 'answer-form', onSubmit: (e) => { e.preventDefault(); if (v.ask && v.ask.options.length === 1 && (!input.value.trim() || input.value.trim() === v.ask.from)) return submit(v.ask.options[0].name); submit(input.value); } }, [input, btn]);
      input.addEventListener('input', () => { if (v.ask && input.value.trim() !== v.ask.from) clearAsk(); });
      const clearAsk = () => { v.ask = null; if (suggest.querySelector('.ask')) suggest.innerHTML = ''; };
      async function submit(typed) {
        const text = String(typed || '').trim();
        if (!text) { input.focus(); return; }
        btn.disabled = true;
        let r;
        try { r = await driver.answer(text); } catch (e) { msg.textContent = 'Lost the room for a moment — try again'; btn.disabled = false; return; }
        if (r.accepted) {
          clearAsk();
          const tier = tierOf(r.tier);
          input.value = r.correction ? r.correction.to : '';
          input.classList.remove('accept'); void input.offsetWidth; input.style.setProperty('--c', 'var(--tier-' + r.tier + ')'); input.classList.add('accept');
          msg.innerHTML = (r.correction ? 'Did you mean to spell <b>' + esc(r.correction.to) + '</b>? Accepted. ' : '') + '<span class="tier tier-' + r.tier + '">' + esc(tier.emoji + ' ' + tier.name) + '</span> · ' + esc(r.name);
          F().sound.reveal(r.tier);
          track('duel_answer', { tier: r.tier });
          return;                                           // the state change redraws the screen
        }
        btn.disabled = false;
        if (r.reason === 'already_said') { msg.innerHTML = '<b>Already said</b> — ' + esc(r.name) + ' (' + esc(r.byName) + ')'; input.value = ''; shake(input); F().sound.miss(); input.focus(); return; }
        if (r.reason === 'not_accepted') {
          if (r.correction && !r.correction.accepted) {
            v.ask = { from: r.correction.from, options: r.correction.options };
            msg.textContent = '';
            root.FathomGame.renderAsk(suggest, r.correction, { onYes: (name) => { clearAsk(); input.value = name; submit(name); }, onNo: () => { clearAsk(); input.value = ''; input.focus(); } });
            shake(input);
          } else {
            input.value = ''; shake(input, true);
            msg.innerHTML = r.ambiguous && r.ambiguous.length ? '<b>“' + esc(text) + '”</b> could mean ' + r.ambiguous.length + ' answers — pick one' : '<b>“' + esc(text) + '”</b> is not an accepted answer — try again';
            suggest.innerHTML = '';
            if (r.ambiguous && r.ambiguous.length) { suggest.append(el('span', { class: 'small muted', text: 'Did you mean' })); for (const c of r.ambiguous) suggest.append(el('button', { class: 'chip-btn', type: 'button', text: c.name, onClick: () => submit(c.name) })); }
          }
          F().sound.miss();
          input.focus();
          return;
        }
        msg.textContent = 'Not your turn';
      }
      const shake = (node, red) => { node.classList.remove('shake', 'reject'); void node.offsetWidth; node.classList.add('shake'); if (red) node.classList.add('reject'); setTimeout(() => node.classList.remove('shake', 'reject'), 650); };

      shell.innerHTML = '';
      const left = el('div', { class: 'duel-left' }, [
        el('div', { class: 'tiny muted', text: 'Round ' + state.round.n + ' · ' + (driver.mode === 'online' ? 'room ' + state.code : 'pass-and-play') }),
        puffer(),
        el('div', { class: 'duel-holder', id: 'duel-holder', role: 'status', text: holder ? (myTurn && !driver.allLocal ? 'You hold the puffer' : holder.name + ' holds the puffer') : '' }),
        playerRing(state),
        depthRail(state),
      ]);
      const right = el('div', { class: 'duel-main' }, [
        changedRound || driver.allLocal ? el('div', { class: 'duel-banner', id: 'duel-banner', role: 'status', text: driver.allLocal ? '📱 ' + (holder ? holder.name : '') + ' — your turn' : '' }) : el('div', { class: 'duel-banner', id: 'duel-banner', role: 'status' }),
        el('h1', { class: 'question-text', id: 'question-text', text: prompt ? prompt.text : '' }),
        suggest, form, msg,
        el('p', { class: 'tiny muted', text: 'Wrong or repeated answers are not accepted — the clock keeps running. Only a pop costs a life.' }),
        el('h2', { class: 'small', text: 'Already said' }), saidByTier(state),
        el('h2', { class: 'small', text: 'Feed' }), feedList(state),
        el('div', { class: 'row' }, [el('button', { class: 'btn btn-sm btn-ghost', type: 'button', id: 'duel-leave', text: 'Leave', onClick: leave })]),
      ]);
      shell.append(left, right);
      if (myTurn) setTimeout(() => input.focus(), 30);
      if (meP && !meP.alive && !driver.allLocal) { input.placeholder = 'You are out — watch the others'; }
    }

    // between rounds: the puffer has just popped; the next question is dealt in a moment
    function drawBetween(state, me) {
      const last = state.rounds[state.rounds.length - 1];
      const popped = last && last.poppedId ? state.players.find(p => p.id === last.poppedId) : null;
      shell.innerHTML = '';
      const pf = puffer(); pf.querySelector('.puffer').classList.add('popped');
      shell.append(
        el('div', { class: 'duel-left' }, [el('div', { class: 'tiny muted', text: 'Round ' + (last ? last.n : state.rounds.length) + ' over' }), pf, el('div', { class: 'duel-holder', id: 'duel-holder', role: 'status', text: popped ? 'Pop! ' + popped.name + (popped.lives === 0 ? ' is out' : ' loses a tank') : 'Pop!' }), playerRing(state), depthRail(state)]),
        el('div', { class: 'duel-main' }, [el('div', { class: 'duel-banner', id: 'duel-banner', role: 'status', text: 'Next question in a moment…' }), el('h2', { class: 'small', text: 'Feed' }), feedList(state)]),
      );
    }
    function drawResult(state, me) {
      document.body.classList.remove('duel-playing');
      const sum = duel.summary(state);
      const line = duel.shareLine(state);
      shell.innerHTML = '';
      shell.append(el('div', { class: 'card strong duel-result' }, [
        el('div', { class: 'tiny muted', text: 'Duel over · ' + sum.rounds + (sum.rounds === 1 ? ' round' : ' rounds') }),
        el('h1', { class: 'result-depth', text: sum.winnerName ? sum.winnerName + ' wins' : 'No one left floating' }),
        el('p', { class: 'lead', text: sum.winnerName ? 'Last one floating' + (sum.winnerId === me && driver.mode === 'online' ? ' — that is you.' : '.') : '' }),
        el('div', { class: 'duel-summary' }, sum.players.map(p => el('div', { class: 'duel-sum-player' + (p.id === sum.winnerId ? ' winner' : '') }, [
          el('div', { class: 'row' }, [el('b', { text: p.name }), tankIcons(p), el('span', { class: 'small muted', text: dive.formatMeters(p.depthM) + ' m · best streak ' + p.bestStreak })]),
          el('p', { class: 'small', text: p.answers.length ? p.answers.map(a => a.name + ' ' + tierOf(a.tier).emoji).join(' · ') : 'No answers' }),
        ]))),
        sum.deepest ? el('p', { class: 'small', html: 'Deepest answer: <b>' + esc(sum.deepest.name) + '</b> (' + esc(tierOf(sum.deepest.tier).name + ' ' + tierOf(sum.deepest.tier).emoji) + ') by ' + esc(sum.deepest.playerName) + (sum.longestStreak ? ' · longest pass streak ' + sum.longestStreak.streak + ' by ' + esc(sum.longestStreak.playerName) : '') }) : null,
        el('div', { class: 'row' }, [
          driver.isHost() ? el('button', { class: 'btn btn-primary', type: 'button', id: 'duel-rematch', text: 'Rematch', onClick: async () => { try { await driver.rematch(); if (driver.allLocal) await driver.start(); } catch (e) { F().toast('Could not start a rematch: ' + e.message); } } }) : el('span', { class: 'small muted', text: 'The host can start a rematch.' }),
          el('button', { class: 'btn', type: 'button', id: 'duel-share', text: 'Share', onClick: () => { if (navigator.share) navigator.share({ text: line }).catch(() => {}); else root.FathomGame.copyText(line, 'Copied'); } }),
          el('a', { class: 'btn btn-ghost', href: '#duel', text: 'Leave' }),
        ]),
        el('p', { class: 'small muted share-preview', text: line.split('\n')[0] }),
      ]));
      track('duel_finished', { rounds: sum.rounds, winner: sum.winnerId === me });
    }

    async function leave() {
      if (!(await F().confirmDialog('Leave the duel? The others carry on without you.', 'Leave'))) return;
      await driver.leave();
      v.destroy(); view = null;
      F().navigate('#duel');
    }

    // the puffer's swelling, the quickening tick and the pass banner run on this clock
    let lastTick = 0, lastPopSeq = -1;
    const clock = setInterval(() => {
      const state = driver.state();
      if (!state || state.status !== 'playing' || !state.round) return;
      const elapsed = Math.max(0, driver.now() - state.round.startedAt);
      const swell = Math.min(1, elapsed / SWELL_FULL_MS);
      const p = shell.querySelector('.puffer');
      if (p) { p.style.setProperty('--swell', (1 + 0.55 * swell).toFixed(3)); p.classList.toggle('wobble', elapsed >= WOBBLE_AFTER_MS); }
      const period = Math.max(140, 1000 - 860 * swell);
      if (Date.now() - lastTick >= period) { lastTick = Date.now(); F().sound.duelTick(swell); }
      const banner = shell.querySelector('#duel-banner');
      if (banner && driver.allLocal && Date.now() - v.holderSince > PASS_BANNER_MS && banner.textContent) banner.textContent = '';
    }, 100);
    v.timers.push(clock);
    driver.on((state, me, here) => {
      // a pop: sound and the burst, then the redraw
      const lastRound = state.rounds[state.rounds.length - 1];
      if (lastRound && lastRound.poppedId && state.rounds.length !== lastPopSeq) { lastPopSeq = state.rounds.length; F().sound.pop(); F().haptics.buzz('miss'); const p = shell.querySelector('.puffer'); if (p) p.classList.add('popped'); setTimeout(() => draw(state, me, here), 250); track('duel_pop', { lives: (state.players.find(x => x.id === lastRound.poppedId) || {}).lives }); return; }
      draw(state, me, here);
    });
    draw(driver.state(), driver.me(), null);
    if (opts && opts.autoStart) driver.start().catch(e => F().toast('Could not start: ' + e.message));
  }

  root.FathomDuelUI = { open, landing, localDriver, onlineDriver };
})(window);
