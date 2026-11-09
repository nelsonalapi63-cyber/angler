'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

// Loads online.js into a fake browser with a fetch spy. By default the demo-mode key is set (as the browser tests
// do), which turns every online flag off; pass { live: true } to load it the way players get it.
function loadOnline(opts) {
  const dive = require(path.join(__dirname, '..', 'shared', 'dive.js'));
  delete require.cache[require.resolve(path.join(__dirname, '..', 'storage.js'))];
  const map = new Map();
  if (!(opts && opts.live)) map.set('angler.mock', '1');
  const fetchCalls = [];
  const win = {
    localStorage: { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), key: (i) => Array.from(map.keys())[i], get length() { return map.size; } },
    addEventListener() {}, matchMedia: () => ({ matches: false }),
    location: { hash: '#/', href: 'http://localhost/' }, history: { replaceState() {} },
    navigator: { onLine: true },
    document: { createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }), head: { appendChild() {} }, body: { appendChild() {} }, addEventListener() {}, hidden: false },
    fetch: (...args) => { fetchCalls.push(args); return Promise.reject(new Error('no network in tests')); },
    Intl, Date, Math, JSON, Object, Array, Number, String, Promise, Error, URLSearchParams, setTimeout, clearTimeout,
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'storage.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'charts.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'online.js'), 'utf8'), ctx);
  win.FathomDive = dive;
  win.Fathom = { dive, storage: win.FathomStorage, charts: win.FathomCharts, todayKey: () => dive.dayKey(new Date()), toast() {}, navigate() {}, el: () => ({ append() {}, querySelector: () => ({}) }), esc: (s) => s };
  return { O: win.FathomOnline, fetchCalls, win };
}

test('in demo mode (the angler.mock key) nothing touches the network', async () => {
  const { O, fetchCalls } = loadOnline();
  O.init();
  await new Promise(r => setTimeout(r, 10));
  const res = await O.submitDaily({ dayKey: '2026-11-02', promptIds: [], results: [], depth: 100 });
  assert.strictEqual(res, null);
  O.trackEvent('share_clicked', {});
  await O.drainQueue();
  assert.strictEqual(fetchCalls.length, 0);
  assert.strictEqual(O.FLAGS.LEADERBOARD_ENABLED, false);
  assert.strictEqual(O.FLAGS.ADS_ENABLED, false);
  assert.strictEqual(O.FLAGS.PAYMENTS_ENABLED, false);
  assert.strictEqual(O.FLAGS.ANALYTICS_ENABLED, false);
});

test('request headers carry the anon key and bearer token', () => {
  const { O } = loadOnline();
  const h = O._headers();
  assert.ok('apikey' in h);
  assert.ok(/^eyJ/.test(h.apikey), 'the anon key is a JWT');
  assert.strictEqual(h.Authorization, 'Bearer ' + h.apikey, 'signed out: the bearer token is the anon key');
  assert.strictEqual(O._configured(), true);      // the live project URL and anon key ship with the site
});

test('players get the live flags; the demo key turns them off', () => {
  const live = loadOnline({ live: true }).O.FLAGS;
  assert.deepStrictEqual([live.LEADERBOARD_ENABLED, live.ANALYTICS_ENABLED, live.MOCK_ONLINE_DATA, live.ADS_ENABLED, live.PAYMENTS_ENABLED], [true, true, false, false, false]);
  const demo = loadOnline().O.FLAGS;
  assert.deepStrictEqual([demo.LEADERBOARD_ENABLED, demo.ANALYTICS_ENABLED, demo.MOCK_ONLINE_DATA], [false, false, true]);
});

test('mock daily data is deterministic and self-consistent', () => {
  const { O } = loadOnline();
  const a = O.mockDaily('2026-11-02');
  const b = O.mockDaily('2026-11-02');
  assert.strictEqual(a.total, b.total);
  assert.strictEqual(a.bins.reduce((n, x) => n + x, 0), a.total);
  assert.strictEqual(a.depths.length, a.total);
  assert.ok(a.median > 0 && a.median < 10935);
  const top = a.top;
  for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].depth >= top[i].depth);
  assert.notStrictEqual(O.mockDaily('2026-11-03').total + O.mockDaily('2026-11-03').median, a.total + a.median);
});

test('percentile is "top X%" and leagues follow thresholds', () => {
  const { O } = loadOnline();
  assert.strictEqual(O.percentileOf(100, [10, 50, 100, 200]), 50);   // at or above: 100, 200 → 2/4
  assert.strictEqual(O.percentileOf(200, [10, 50, 100, 200]), 25);
  assert.strictEqual(O.percentileOf(5, [10, 50, 100, 200]), 100);
  assert.strictEqual(O.percentileOf(5, []), null);
  assert.strictEqual(O.leagueFor(39.9).code, 'sunlight');
  assert.strictEqual(O.leagueFor(40).code, 'twilight');
  assert.strictEqual(O.leagueFor(60).code, 'midnight');
  assert.strictEqual(O.leagueFor(75).code, 'abyss');
  assert.strictEqual(O.leagueFor(90).code, 'hadal');
});

test('handles are validated', () => {
  const { O } = loadOnline();
  assert.strictEqual(O.handleProblem('deep_diver'), null);
  assert.ok(O.handleProblem('ab'));
  assert.ok(O.handleProblem('has space'));
  assert.ok(O.handleProblem('shithead'));
});
