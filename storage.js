/* FATHOM — localStorage wrapper. Every call is guarded: a browser that throws on storage
 * (private mode, disabled cookies) still gets a playable game with in-memory state. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.FathomStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const PREFIX = 'fathom.v1.';
  const memory = {};                           // fallback when localStorage is unavailable

  function store() {
    try { return root.localStorage; } catch (e) { return null; }
  }
  function get(key, fallback) {
    const k = PREFIX + key;
    try {
      const s = store();
      const raw = s ? s.getItem(k) : null;
      if (raw == null) return key in memory ? memory[key] : fallback;
      return JSON.parse(raw);
    } catch (e) {
      return key in memory ? memory[key] : fallback;
    }
  }
  function set(key, value) {
    memory[key] = value;
    try { const s = store(); if (!s) return false; s.setItem(PREFIX + key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function remove(key) {
    delete memory[key];
    try { const s = store(); if (s) s.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
  }
  function clearAll() {
    for (const k of Object.keys(memory)) delete memory[k];
    try {
      const s = store();
      if (!s) return;
      const keys = [];
      for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.indexOf(PREFIX) === 0) keys.push(k); }
      keys.forEach(k => s.removeItem(k));
    } catch (e) { /* ignore */ }
  }

  // ---- settings
  const DEFAULT_SETTINGS = { theme: 'dark', contrast: false, sound: true, freeTimer: true, seenHowTo: false, consent: null, hintSeen: false };
  function settings() { return Object.assign({}, DEFAULT_SETTINGS, get('settings', {})); }
  function updateSettings(patch) { const s = Object.assign(settings(), patch); set('settings', s); return s; }

  // ---- device id (anonymous)
  function deviceId() {
    let id = get('deviceId', null);
    if (!id) {
      id = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      set('deviceId', id);
    }
    return id;
  }

  // ---- daily results: { 'YYYY-MM-DD': record }
  function allDailyResults() { return get('daily', {}); }
  function getDailyResult(dayKey) { return allDailyResults()[dayKey] || null; }
  function saveDailyResult(dayKey, record) {
    const all = allDailyResults();
    all[dayKey] = record;
    set('daily', all);
    return record;
  }

  // ---- bests
  function getBest(kind, id) { const b = get('best', {}); return (b[kind] && b[kind][id]) || null; }
  function saveBest(kind, id, record) {
    const b = get('best', {});
    b[kind] = b[kind] || {};
    const cur = b[kind][id];
    if (!cur || record.depth > cur.depth) { b[kind][id] = { depth: record.depth, points: record.points, finishedAt: record.finishedAt }; set('best', b); return true; }
    return false;
  }
  function freeDiveCount() { return get('freeCount', 0); }
  function bumpFreeDiveCount() { const n = freeDiveCount() + 1; set('freeCount', n); return n; }

  // ---- streak (consecutive daily dives, counted on the day keys played)
  function streak(todayKey, keyPlusDays) {
    const all = allDailyResults();
    const keys = Object.keys(all).sort();
    if (!keys.length) return { current: 0, max: 0 };
    let max = 0, run = 0, prev = null;
    for (const k of keys) {
      run = (prev && keyPlusDays(prev, 1) === k) ? run + 1 : 1;
      if (run > max) max = run;
      prev = k;
    }
    const last = keys[keys.length - 1];
    const current = (last === todayKey || keyPlusDays(last, 1) === todayKey) ? run : 0;
    return { current, max };
  }

  // ---- logbook: { entityId: { bestTier, bestPoints, firstLogged, prompts: [] } }
  function logbook() { return get('logbook', {}); }
  function logbookAdd(entityId, tier, points, promptId, dateKey) {
    if (!entityId) return;
    const lb = logbook();
    const cur = lb[entityId] || { bestTier: tier, bestPoints: points, firstLogged: dateKey, prompts: [] };
    if (points > cur.bestPoints) { cur.bestPoints = points; cur.bestTier = tier; }
    if (cur.prompts.indexOf(promptId) < 0) cur.prompts.push(promptId);
    lb[entityId] = cur;
    set('logbook', lb);
  }

  // ---- misc small flags
  function lastGoDeeperDay() { return get('goDeeperDay', null); }
  function setGoDeeperDay(k) { set('goDeeperDay', k); }

  // ---- offline submission queue
  function queue() { return get('queue', []); }
  function enqueue(item) { const q = queue(); q.push(item); set('queue', q); }
  function setQueue(q) { set('queue', q); }

  return {
    PREFIX, get, set, remove, clearAll,
    settings, updateSettings, DEFAULT_SETTINGS, deviceId,
    allDailyResults, getDailyResult, saveDailyResult,
    getBest, saveBest, freeDiveCount, bumpFreeDiveCount,
    streak, logbook, logbookAdd, lastGoDeeperDay, setGoDeeperDay,
    queue, enqueue, setQueue,
  };
});
