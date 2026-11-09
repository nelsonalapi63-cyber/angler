'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

function freshStorage(localStorageImpl) {
  // load storage.js with a controlled global
  delete require.cache[require.resolve(path.join(__dirname, '..', 'storage.js'))];
  if (localStorageImpl === 'throw') {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  } else if (localStorageImpl === 'none') {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
  } else {
    const map = new Map();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k),
      key: (i) => Array.from(map.keys())[i], get length() { return map.size; },
    } });
  }
  return require(path.join(__dirname, '..', 'storage.js'));
}
const plus = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('works with a real-ish localStorage', () => {
  const S = freshStorage('ok');
  S.saveDailyResult('2026-11-02', { depth: 100, points: 10 });
  assert.strictEqual(S.getDailyResult('2026-11-02').depth, 100);
  assert.strictEqual(S.settings().theme, 'dark');
  S.updateSettings({ theme: 'light' });
  assert.strictEqual(S.settings().theme, 'light');
  assert.ok(S.deviceId().length > 5);
  assert.strictEqual(S.deviceId(), S.deviceId());
});

test('still playable when localStorage throws (Review Focus 4)', () => {
  const S = freshStorage('throw');
  assert.strictEqual(S.set('x', 1), false);
  S.saveDailyResult('2026-11-02', { depth: 42, points: 3 });
  assert.strictEqual(S.getDailyResult('2026-11-02').depth, 42);   // in-memory fallback
  assert.strictEqual(S.settings().sound, true);
});

const pick = (s) => ({ current: s.current, max: s.max });
test('streaks count consecutive day keys', () => {
  const S = freshStorage('ok');
  S.saveDailyResult('2026-11-01', { depth: 1 });
  S.saveDailyResult('2026-11-02', { depth: 1 });
  S.saveDailyResult('2026-11-04', { depth: 1 });
  assert.deepStrictEqual(pick(S.streak('2026-11-04', plus)), { current: 1, max: 2 });
  S.saveDailyResult('2026-11-05', { depth: 1 });
  assert.deepStrictEqual(pick(S.streak('2026-11-05', plus)), { current: 2, max: 2 });
  assert.deepStrictEqual(pick(S.streak('2026-11-06', plus)), { current: 2, max: 2 });  // today not played yet, streak alive
  assert.deepStrictEqual(pick(S.streak('2026-11-07', plus)), { current: 0, max: 2 });  // missed a day, no freeze held
});

test('a streak freeze is earned at day 7 and spent on the first missed day', () => {
  const S = freshStorage('ok');
  for (let i = 1; i <= 7; i++) S.saveDailyResult('2026-11-0' + i, { depth: 1 });
  let st = S.streak('2026-11-08', plus);
  assert.deepStrictEqual(pick(st), { current: 7, max: 7 });
  assert.strictEqual(st.freezes, 1, 'one freeze earned at the 7th day');
  // 8th missed, 9th played: the freeze covers the 8th
  S.saveDailyResult('2026-11-09', { depth: 1 });
  st = S.streak('2026-11-09', plus);
  assert.deepStrictEqual(pick(st), { current: 9, max: 9 });
  assert.strictEqual(st.freezes, 0, 'the freeze was spent');
  // 10th and 11th missed, 12th played: no freeze left, the streak restarts
  S.saveDailyResult('2026-11-12', { depth: 1 });
  st = S.streak('2026-11-12', plus);
  assert.deepStrictEqual(pick(st), { current: 1, max: 9 });
  // the decision is stable: asking again changes nothing
  assert.deepStrictEqual(pick(S.streak('2026-11-12', plus)), { current: 1, max: 9 });
});

test('logbook keeps the best tier and every prompt', () => {
  const S = freshStorage('ok');
  S.logbookAdd('orca', 'reef', 30, 'p1', '2026-11-02');
  S.logbookAdd('orca', 'tidepool', 10, 'p2', '2026-11-03');
  S.logbookAdd('orca', 'hadal', 100, 'p3', '2026-11-04');
  const e = S.logbook().orca;
  assert.strictEqual(e.bestTier, 'hadal');
  assert.strictEqual(e.firstLogged, '2026-11-02');
  assert.deepStrictEqual(e.prompts, ['p1', 'p2', 'p3']);
});
