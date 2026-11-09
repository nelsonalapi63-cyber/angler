/* ANGLER — retention: push reminders, the streak-at-risk banner, streak freezes in stats, the calendar heatmap.
 * Push goes through the push-subscribe Edge Function (service role writes); the service worker shows the
 * notification and opens #daily on tap. The permission prompt is only offered after the second completed daily
 * dive, never on a first visit, and only when the player taps "Remind me". */
(function (root) {
  'use strict';

  const ASK_AFTER_DIVES = 2;                 // offer reminders after this many completed daily dives
  const AT_RISK_HOUR = 20;                   // local hour from which the streak banner shows (8 pm)
  const HEATMAP_WEEKS = 12;
  const HOURS = Array.from({ length: 24 }, (_, h) => h);

  const F = () => root.Fathom;
  const O = () => root.FathomOnline;
  function flags() { return root.FATHOM_FLAGS || {}; }
  function supported() { return 'serviceWorker' in navigator && 'PushManager' in root && 'Notification' in root; }
  function pushLive() { return !!(flags().LEADERBOARD_ENABLED && O() && O().VAPID_PUBLIC_KEY); }
  function hourLabel(h) { return (h % 12 || 12) + (h < 12 ? ' am' : ' pm'); }
  function urlBase64ToUint8Array(s) {
    const pad = '='.repeat((4 - s.length % 4) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  // ---------------------------------------------------------------- subscriptions
  async function subscribe(hour) {
    const { storage, toast } = F();
    if (!supported()) { toast('This browser cannot show reminders'); return false; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Reminders stay off until notifications are allowed'); return false; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if (!pushLive()) { storage.updateSettings({ reminders: true, remindHour: hour }); toast('Reminder saved — it starts sending when ' + F().dive.BRAND + ' is online'); return true; }
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(O().VAPID_PUBLIC_KEY) });
    }
    if (pushLive()) {
      await O().rest('/functions/v1/push-subscribe', { method: 'POST', body: { subscription: sub.toJSON(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, remindAt: hour, deviceId: storage.deviceId() } });
    }
    storage.updateSettings({ reminders: true, remindHour: hour, pushEndpoint: sub ? sub.endpoint : null });
    O() && O().trackEvent && O().trackEvent('reminder_on', { hour });
    toast('Daily reminder set for ' + hourLabel(hour));
    return true;
  }
  async function unsubscribe() {
    const { storage } = F();
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { if (pushLive()) await O().rest('/functions/v1/push-subscribe', { method: 'POST', body: { subscription: sub.toJSON(), remove: true } }).catch(() => {}); await sub.unsubscribe(); }
    } catch (e) { /* ignore */ }
    storage.updateSettings({ reminders: false, pushEndpoint: null });
    O() && O().trackEvent && O().trackEvent('reminder_off', {});
  }

  // Offered on the result screen after the second completed daily dive, once; never on a first visit.
  function reminderCard() {
    const { el, storage } = F();
    const s = storage.settings();
    if (s.reminders || s.askedPush || !supported()) return null;
    if (Object.keys(storage.allDailyResults()).length < ASK_AFTER_DIVES) return null;
    const card = el('div', { class: 'card reminder-card' });
    const sel = hourSelect(s.remindHour);
    card.append(
      el('h2', { class: 'card-title', text: 'Come back tomorrow?' }),
      el('p', { class: 'small', text: 'A single notification when the next dive opens, at a time you choose. Nothing else, ever.' }),
      el('div', { class: 'row' }, [
        sel,
        el('button', { class: 'btn btn-primary', type: 'button', text: 'Remind me', onClick: async () => { storage.updateSettings({ askedPush: true }); if (await subscribe(Number(sel.value))) card.remove(); } }),
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'No thanks', onClick: () => { storage.updateSettings({ askedPush: true }); card.remove(); } }),
      ]),
    );
    return card;
  }
  function hourSelect(value) {
    const { el } = F();
    return el('select', { 'aria-label': 'Reminder time' }, HOURS.map(h => el('option', { value: String(h), text: hourLabel(h), selected: h === value })));
  }
  // Settings row: toggle + hour
  function settingsRow() {
    const { el, storage } = F();
    const s = storage.settings();
    const sel = hourSelect(s.remindHour);
    sel.disabled = !s.reminders;
    sel.addEventListener('change', async () => { storage.updateSettings({ remindHour: Number(sel.value) }); if (storage.settings().reminders) await subscribe(Number(sel.value)); });
    const btn = el('button', { class: 'toggle', type: 'button', role: 'switch', 'aria-checked': String(!!s.reminders), 'aria-label': 'Daily reminder', onClick: async () => {
      const on = btn.getAttribute('aria-checked') === 'true';
      if (on) { await unsubscribe(); btn.setAttribute('aria-checked', 'false'); sel.disabled = true; }
      else if (await subscribe(Number(sel.value))) { btn.setAttribute('aria-checked', 'true'); sel.disabled = false; }
    } });
    return el('div', { class: 'switch' }, [el('div', { html: '<b>Daily reminder</b><br><span class="small muted">One notification when the dive opens' + (supported() ? '' : ' (not available in this browser)') + '</span>' }), el('div', { class: 'row' }, [sel, btn])]);
  }

  // ---------------------------------------------------------------- streak at risk (home page, after 8 pm local)
  function atRiskBanner() {
    const { el, storage, dive } = F();
    const today = F().todayKey();
    if (storage.getDailyResult(today)) return null;
    if (new Date().getHours() < AT_RISK_HOUR) return null;
    const st = storage.streak(today, dive.keyPlusDays);
    if (st.current < 1) return null;
    const ms = dive.msUntilNextDay(new Date());
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return el('a', { class: 'banner at-risk', href: '#daily', role: 'status' }, [
      el('span', { class: 'banner-icon', 'aria-hidden': 'true', text: '🔥' }),
      el('span', {}, [el('b', { text: st.current + '-day streak at risk' }), el('span', { class: 'small', text: ' — today’s dive closes in ' + (h ? h + ' h ' : '') + m + ' min' + (st.freezes ? '. A freeze will cover one miss.' : '.') })]),
      el('span', { class: 'banner-cta', text: 'Dive now' }),
    ]);
  }

  // ---------------------------------------------------------------- freezes line for My ANGLER
  function freezeLine(st) {
    const { el } = F();
    return el('p', { class: 'small muted', style: 'margin:6px 0 0', html: '❄️ Streak freezes: <b>' + (st.freezes || 0) + '</b> of ' + (st.cap || 3) + ' — one is earned every ' + (st.every || 7) + ' consecutive days and covers a missed day automatically.' + (st.frozenToday ? ' Today is covered by a freeze.' : '') });
  }

  // ---------------------------------------------------------------- calendar heatmap (last 12 weeks, Monday-first columns)
  function heatmap() {
    const { el, storage, dive, esc } = F();
    const today = F().todayKey();
    const all = storage.allDailyResults();
    const fz = storage.get('freeze', { frozen: {} });
    const days = HEATMAP_WEEKS * 7;
    // start on the Monday of the week 12 weeks ago
    const [y, m, d] = today.split('-').map(Number);
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;      // 0 = Monday
    let start = dive.keyPlusDays(today, -(days - 1) - dow);
    const cells = [];
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let k = start;
    while (k <= today) {
      const rec = all[k];
      const zone = rec ? dive.zoneFor(rec.depth).code : null;
      const frozen = !!(fz.frozen && fz.frozen[k]);
      cells.push(el('span', { class: 'hm-cell' + (zone ? ' z-' + zone : frozen ? ' frozen' : '') + (k === today ? ' today' : ''), title: root.FathomPages.niceDate(k) + (rec ? ' · ' + dive.formatMeters(rec.depth) + ' m' : frozen ? ' · streak freeze' : ' · not played'), role: 'img', 'aria-label': root.FathomPages.niceDate(k) + (rec ? ', ' + dive.formatMeters(rec.depth) + ' metres' : frozen ? ', streak freeze' : ', not played') }));
      k = dive.keyPlusDays(k, 1);
    }
    const legend = el('div', { class: 'hm-legend small muted' }, [el('span', { text: 'Shallower' }), ...['sunlight', 'twilight', 'midnight', 'abyss', 'hadal'].map(z => el('span', { class: 'hm-cell z-' + z, 'aria-hidden': 'true' })), el('span', { text: 'Deeper' }), el('span', { class: 'hm-cell frozen', 'aria-hidden': 'true' }), el('span', { text: 'freeze' })]);
    return el('div', { class: 'heatmap-wrap' }, [
      el('div', { class: 'heatmap', style: '--rows: 7' }, [el('div', { class: 'hm-days', 'aria-hidden': 'true' }, names.map(n => el('span', { text: n[0] }))), el('div', { class: 'hm-grid' }, cells)]),
      legend,
    ]);
  }

  root.FathomRetain = { reminderCard, settingsRow, atRiskBanner, freezeLine, heatmap, subscribe, unsubscribe, ASK_AFTER_DIVES, AT_RISK_HOUR };
})(window);
