/* ANGLER — social proof and the report inbox: the live divers-today count, community packs (submit, list, play),
 * and the one-tap report sheet that replaces the mailto link. Everything degrades to demo data or a mail link when
 * the online layer is off. */
(function (root) {
  'use strict';

  const DIVERS_MIN = 25;                       // show the live count only from this many dives
  const DIVERS_CACHE_MS = 60 * 1000;           // one request a minute at most
  const DIVERS_CACHE_KEY = 'diversToday';
  const PACK_SEARCH_MAX = 12;                  // suggestions shown under the pack-builder search box
  const REPORT_KINDS = [
    ['wrong_tier', 'The tier is wrong'],
    ['missing_answer', 'A correct answer was rejected'],
    ['wrong_fact', 'The fact is wrong'],
    ['other', 'Something else'],
  ];
  const DEMO_COMMUNITY_PACKS = [
    { id: 'demo-1', name: 'Shark Week Warm-up', emoji: '🦈', blurb: 'Seven shark prompts, easy to brutal', prompt_ids: ['shark-species', 'shark-atlantic', 'shark-reef', 'shark-live-young', 'shark-deep', 'shark-letter', 'shark-species-b'], approved: true, demo: true },
    { id: 'demo-2', name: 'Lighthouse Keeper', emoji: '🗼', blurb: 'Ports, lighthouses, straits and sea routes', prompt_ids: ['lighthouse', 'atlantic-port', 'pacific-port', 'mediterranean-port', 'shipping-route', 'strait', 'famous-beach'], approved: true, demo: true },
  ];

  const F = () => root.Fathom;
  const O = () => root.FathomOnline;
  const flags = () => root.FATHOM_FLAGS || {};
  const live = () => !!(flags().LEADERBOARD_ENABLED && O() && O().configured && O().configured());
  const demo = () => !live() && !!flags().MOCK_ONLINE_DATA;

  // ---------------------------------------------------------------- divers today
  async function diversToday(dayKey) {
    const { storage } = F();
    const cached = storage.get(DIVERS_CACHE_KEY, null);
    if (cached && cached.day === dayKey && Date.now() - cached.at < DIVERS_CACHE_MS) return cached.n;
    let n = null;
    if (live()) { try { n = Number(await O().rest('/rest/v1/rpc/divers_today', { method: 'POST', body: { p_day: dayKey } })); } catch (e) { n = null; } }
    else if (demo() && O() && O().mockDaily) n = O().mockDaily(dayKey).total;
    if (n != null) storage.set(DIVERS_CACHE_KEY, { day: dayKey, n, at: Date.now() });
    return n;
  }
  // "N divers today" — a node that fills itself in; null when the online layer is off
  function diversLine(dayKey) {
    const { el } = F();
    if (!live() && !demo()) return null;
    const node = el('p', { class: 'divers-line small muted', role: 'status' });
    node.hidden = true;
    diversToday(dayKey).then((n) => {
      if (n == null || n < DIVERS_MIN) return;
      node.hidden = false;
      node.innerHTML = '<span class="pulse" aria-hidden="true"></span> <b>' + n.toLocaleString('en-US') + '</b> divers today' + (demo() ? ' <span class="badge demo">demo</span>' : '');
    });
    return node;
  }

  // ---------------------------------------------------------------- community packs
  let communityCache = null;
  async function communityPacks() {
    if (communityCache) return communityCache;
    if (live()) {
      try { communityCache = await O().rest('/rest/v1/community_packs?select=id,name,emoji,blurb,prompt_ids,approved,created_at&order=created_at.desc&limit=50'); }
      catch (e) { communityCache = []; }
    } else communityCache = demo() ? DEMO_COMMUNITY_PACKS : [];
    return communityCache;
  }
  function communityPackById(id) { return (communityCache || []).find(p => p.id === id) || null; }
  // The section under Themed Packs: approved packs + the builder
  async function communitySection() {
    const { el, esc, storage, dive, promptsById } = F();
    if (!live() && !demo()) return null;
    const sec = el('div', { class: 'card' }, [el('h2', { class: 'card-title', text: 'Community packs' }), el('p', { class: 'small muted', text: 'Seven questions picked by a player, published once approved.' })]);
    const packs = (await communityPacks()).filter(p => p.approved && p.prompt_ids.every(id => promptsById[id]));
    if (!packs.length) sec.append(root.FathomPages.emptyState('No community packs yet', 'Be the first: pick seven questions below.'));
    else {
      const ul = el('ul', { class: 'list' });
      for (const p of packs) {
        const best = storage.getBest('pack', 'community-' + p.id);
        ul.append(el('li', {}, [
          el('span', { text: p.emoji, 'aria-hidden': 'true', style: 'font-size:1.4rem' }),
          el('a', { class: 'grow', href: '#pack-community-' + p.id, html: '<b>' + esc(p.name) + '</b>' + (p.demo ? ' <span class="badge demo">demo</span>' : '') + '<br><span class="small muted">' + esc(p.blurb || '') + '</span>' }),
          best ? el('span', { class: 'small', html: 'Best<br><b>' + esc(dive.formatMeters(best.depth)) + ' m</b>' }) : null,
        ]));
      }
      sec.append(ul);
    }
    sec.append(builder());
    return sec;
  }
  // The pack builder: name, emoji, seven prompts chosen from the bank with search
  function builder() {
    const { el, esc, prompts, toast } = F();
    const user = O() && O().user ? O().user() : null;
    const wrap = el('details', { class: 'pack-builder' }, [el('summary', { html: '<b>Suggest a pack</b> <span class="small muted">— seven questions of your choosing</span>' })]);
    if (!user && live()) { wrap.append(el('p', { class: 'small muted', text: 'Sign in (Settings) to suggest a pack.' })); return wrap; }
    const chosen = [];
    const name = el('input', { class: 'input', placeholder: 'Pack name (3–40 characters)', maxlength: '40', 'aria-label': 'Pack name' });
    const emoji = el('input', { class: 'input', placeholder: '🐟', maxlength: '4', 'aria-label': 'Pack emoji', style: 'max-width:80px' });
    const blurb = el('input', { class: 'input', placeholder: 'One line about it (optional)', maxlength: '120', 'aria-label': 'Blurb' });
    const search = el('input', { class: 'input', placeholder: 'Search questions…', 'aria-label': 'Search questions' });
    const results = el('div', { class: 'pb-results', role: 'listbox' });
    const picked = el('ol', { class: 'pb-picked' });
    const count = el('span', { class: 'small muted', text: '0 of 7 chosen' });
    const redrawPicked = () => {
      picked.innerHTML = '';
      chosen.forEach((p, i) => picked.append(el('li', {}, [el('span', { class: 'grow', text: p.text }), el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Remove', 'aria-label': 'Remove ' + p.text, onClick: () => { chosen.splice(i, 1); redrawPicked(); } })])));
      count.textContent = chosen.length + ' of 7 chosen';
      submit.disabled = chosen.length !== 7;
    };
    const redrawResults = () => {
      const q = search.value.trim().toLowerCase();
      results.innerHTML = '';
      if (q.length < 2) return;
      prompts.filter(p => p.text.toLowerCase().includes(q) && !chosen.includes(p)).slice(0, PACK_SEARCH_MAX).forEach(p => {
        results.append(el('button', { class: 'pb-result', type: 'button', role: 'option', text: p.text, onClick: () => { if (chosen.length >= 7) return toast('Seven questions make a pack'); chosen.push(p); search.value = ''; redrawResults(); redrawPicked(); } }));
      });
    };
    search.addEventListener('input', redrawResults);
    const submit = el('button', { class: 'btn btn-primary', type: 'button', text: 'Submit for approval', disabled: true, onClick: async () => {
      const n = name.value.trim(), e = emoji.value.trim() || '🐟';
      if (n.length < 3) return toast('Give the pack a name (3 characters or more)');
      if (chosen.length !== 7) return toast('Pick exactly seven questions');
      const row = { name: n, emoji: e, blurb: blurb.value.trim() || null, prompt_ids: chosen.map(p => p.id) };
      if (!live()) { toast('Pack submissions open when ' + F().dive.BRAND + ' is online'); return; }
      try {
        await O().rest('/rest/v1/community_packs', { method: 'POST', body: Object.assign({ author: user.id }, row), headers: { Prefer: 'return=minimal' } });
        toast('Submitted — it appears here once approved');
        O().trackEvent && O().trackEvent('pack_submitted', {});
        wrap.open = false; chosen.length = 0; redrawPicked(); name.value = ''; blurb.value = '';
      } catch (err) { toast('Could not submit right now'); }
    } });
    wrap.append(el('div', { class: 'stack' }, [el('div', { class: 'row' }, [emoji, name]), blurb, search, results, el('div', { class: 'row between' }, [count, submit]), picked]));
    return wrap;
  }
  // Called by game.startPack for ids like community-<uuid>
  async function communityPackSpec(id) {
    await communityPacks();
    const p = communityPackById(id);
    if (!p) return null;
    return { id: 'community-' + p.id, name: p.name, emoji: p.emoji, blurb: p.blurb || '', prompts: p.prompt_ids, community: true };
  }

  // ---------------------------------------------------------------- the report sheet
  function reportButton(prompt, result, record, mailHref) {
    const { el } = F();
    return el('button', { class: 'link-btn', type: 'button', text: 'Report an answer or tier', onClick: () => openReport(prompt, result, record, mailHref) });
  }
  function openReport(prompt, result, record, mailHref) {
    const { el, esc, modal, closeModal, storage, toast, dive, entities } = F();
    let kind = result.entityId ? 'wrong_tier' : 'missing_answer';
    const note = el('textarea', { class: 'input report-note', rows: '3', maxlength: '500', placeholder: 'What should it be? (optional)', 'aria-label': 'Details' });
    const radios = el('div', { class: 'stack report-kinds', role: 'radiogroup', 'aria-label': 'What is wrong' }, REPORT_KINDS.map(([k, label]) => {
      const input = el('input', { type: 'radio', name: 'report-kind', value: k, id: 'rk-' + k });
      if (k === kind) input.checked = true;
      input.addEventListener('change', () => { kind = k; });
      return el('label', { class: 'report-kind', for: 'rk-' + k }, [input, el('span', { text: label })]);
    }));
    const ent = result.entityId && !dive.isTaxonId(result.entityId) ? entities[result.entityId] : null;
    const body = el('div', {}, [
      el('p', { class: 'small muted', html: '<b>' + esc(prompt.text) + '</b><br>' + (ent ? 'Scored as ' + esc(ent.name) + ' (' + esc(dive.TIER_BY_CODE[result.tier].name) + ')' : result.typed ? 'You typed “' + esc(result.typed) + '” — not accepted' : 'No answer') }),
      radios, note,
      el('div', { class: 'row', style: 'margin-top:10px' }, [
        el('button', { class: 'btn btn-primary', type: 'button', text: 'Send report', onClick: async () => {
          const row = { device_id: storage.deviceId(), day: record.dayKey || null, prompt_id: prompt.id, entity_id: result.entityId || null, typed: (result.typed || '').slice(0, 80), kind, note: note.value.trim().slice(0, 500) || null };
          if (O() && O().user && O().user()) row.user_id = O().user().id;
          if (live()) {
            try { await O().rest('/rest/v1/reports', { method: 'POST', body: row, headers: { Prefer: 'return=minimal' } }); toast('Thank you — report received'); closeModal(); }
            catch (e) { toast('Could not send — opening email instead'); location.href = mailHref; }
          } else {
            // offline layer: keep it locally and open the mail link so nothing is lost
            const q = storage.get('reportsPending', []); q.push(Object.assign({ at: new Date().toISOString() }, row)); storage.set('reportsPending', q);
            toast('Thank you — report saved' + (demo() ? ' (demo: sent when online)' : ''));
            closeModal();
            if (!demo()) location.href = mailHref;
          }
          O() && O().trackEvent && O().trackEvent('report_sent', { prompt: prompt.id, kind });
        } }),
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: closeModal }),
      ]),
    ]);
    modal({ title: 'Report a problem', body });
  }

  root.FathomSocial = { diversLine, diversToday, communitySection, communityPackSpec, communityPackById, reportButton, openReport, DIVERS_MIN, REPORT_KINDS };
})(window);
