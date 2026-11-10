'use strict';
/* v4: days already played keep the answer sets they were played with (data/frozen.json), whatever the bank does later. */
const test = require('node:test');
const assert = require('node:assert');
const { snapshotFrozen, frozenPrompt } = require('../tools/frozen.js');

const prompts = [
  { id: 'a', text: 'A', answers: [{ entity: 'x', tier: 'tidepool' }, { entity: 'y', tier: 'hadal' }] },
  { id: 'b', text: 'B', answers: [{ entity: 'z', tier: 'hadal' }] },
];
const schedule = { '2026-11-02': ['a', 'b'], '2026-11-03': ['b'], '2026-11-04': ['a'] };

test('every scheduled day up to the cut-off is snapshotted once; later days are not', () => {
  const out = snapshotFrozen(schedule, prompts, {}, '2026-11-03');
  assert.deepStrictEqual(Object.keys(out), ['2026-11-02', '2026-11-03']);
  assert.deepStrictEqual(out['2026-11-02'].a, prompts[0].answers);
  assert.deepStrictEqual(out['2026-11-03'].b, prompts[1].answers);
});

test('a day already frozen is never rewritten, even when the bank changed since', () => {
  const frozen = { '2026-11-02': { a: [{ entity: 'x', tier: 'tidepool' }], b: [{ entity: 'z', tier: 'hadal' }] } };
  const out = snapshotFrozen(schedule, prompts, frozen, '2026-11-04');
  assert.deepStrictEqual(out['2026-11-02'].a, [{ entity: 'x', tier: 'tidepool' }]);
  assert.deepStrictEqual(out['2026-11-04'].a, prompts[0].answers);
});

test('frozenPrompt returns a copy of the prompt with the frozen answers, or the prompt itself when the day is not frozen', () => {
  const frozen = { '2026-11-02': { a: [{ entity: 'x', tier: 'tidepool' }] } };
  const p = frozenPrompt(frozen, '2026-11-02', prompts[0]);
  assert.notStrictEqual(p, prompts[0]);
  assert.deepStrictEqual(p.answers, [{ entity: 'x', tier: 'tidepool' }]);
  assert.strictEqual(p.text, 'A');
  assert.strictEqual(frozenPrompt(frozen, '2026-11-09', prompts[0]), prompts[0]);
  assert.strictEqual(frozenPrompt(null, '2026-11-02', prompts[0]), prompts[0]);
});
