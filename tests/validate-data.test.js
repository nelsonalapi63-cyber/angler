'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { validateData, LIVE_MIN_ANSWERS, LIVE_MIN_PROMPTS, TIER_FLOORS } = require(path.join(__dirname, '..', 'tools', 'validate-data.js'));

// A bank of `n` live questions, each with `answers` sourced answers (ids never collide across questions).
function bank(n, answers, opts = {}) {
  const entities = [], prompts = [], seeds = [];
  const tiers = ['hadal', 'midnight', 'midnight', 'midnight', 'twilight', 'twilight', 'twilight', 'twilight', 'twilight', 'twilight', 'twilight', 'twilight', 'reef', 'reef', 'reef', 'reef', 'reef', 'reef', 'reef', 'reef', 'reef', 'reef', 'reef', 'reef', 'baitball', 'baitball', 'baitball', 'baitball', 'baitball', 'baitball', 'baitball', 'baitball', 'tidepool', 'tidepool', 'tidepool', 'tidepool', 'tidepool'];
  for (let q = 0; q < n; q++) {
    const id = 'q' + q;
    seeds.push({ id, text: 'Question ' + q + '?', group: 'g' + q, difficulty: 1 });
    const list = [];
    for (let i = 0; i < answers; i++) {
      const eid = id + '-e' + i;
      const e = { id: eid, name: 'Answer ' + q + ' ' + i, aliases: [], kind: 'creature', group: 'fish', fact: 'A perfectly fine sourced fact about answer ' + i + ' of question ' + q + '.', source: 'FishBase summary page for Genus species' };
      if (opts.unsourced && opts.unsourced(q, i)) delete e.source;
      entities.push(e);
      list.push({ entity: eid, tier: tiers[i] || 'midnight' });
    }
    prompts.push({ id, text: 'Question ' + q + '?', group: 'g' + q, difficulty: 1, answers: list });
  }
  return { entities, prompts, seeds, packs: [], legacy: opts.legacy || [] };
}
const errorsOf = (r) => r.errors.join('\n');

test('v4 floors: 211 live questions with 75 sourced answers each pass', () => {
  const r = validateData({ data: bank(LIVE_MIN_PROMPTS, LIVE_MIN_ANSWERS) });
  assert.deepStrictEqual(r.errors, [], errorsOf(r));
  assert.strictEqual(LIVE_MIN_ANSWERS, 75);
  assert.strictEqual(LIVE_MIN_PROMPTS, 211);
  assert.deepStrictEqual(TIER_FLOORS, { hadal: 1, midnight: 3, twilight: 8, reef: 12, baitball: 8, tidepool: 5 });
});

test('a live question under 75 answers fails; a retired one is left alone', () => {
  const d = bank(LIVE_MIN_PROMPTS + 1, LIVE_MIN_ANSWERS);
  d.prompts[3].answers.length = 74;
  const r = validateData({ data: d });
  assert.ok(r.errors.some(e => /q3.*74 answers.*75/.test(e)), errorsOf(r));
  d.prompts[3].retired = true;
  const r2 = validateData({ data: d });
  assert.deepStrictEqual(r2.errors, [], errorsOf(r2));
});

test('an answer without a source fails unless the entity is on the legacy list', () => {
  const d = bank(LIVE_MIN_PROMPTS, LIVE_MIN_ANSWERS, { unsourced: (q, i) => q === 0 && i === 5 });
  const r = validateData({ data: d });
  assert.ok(r.errors.some(e => /q0-e5.*source/.test(e)), errorsOf(r));
  d.legacy = ['q0-e5'];
  const r2 = validateData({ data: d });
  assert.deepStrictEqual(r2.errors, [], errorsOf(r2));
  assert.ok(r2.warnings.some(w => /1 legacy answer/.test(w)));
});

test('fewer than 211 live questions fails; a tier floor miss fails', () => {
  const r = validateData({ data: bank(LIVE_MIN_PROMPTS - 1, LIVE_MIN_ANSWERS) });
  assert.ok(r.errors.some(e => /210 live questions.*211/.test(e)), errorsOf(r));
  const d = bank(LIVE_MIN_PROMPTS, LIVE_MIN_ANSWERS);
  for (const a of d.prompts[0].answers) if (a.tier === 'tidepool') a.tier = 'midnight';
  const r2 = validateData({ data: d });
  assert.ok(r2.errors.some(e => /q0.*tidepool.*5/.test(e)), errorsOf(r2));
});

test('--partial turns the v4 floors into warnings', () => {
  const d = bank(10, 50, { unsourced: (q, i) => i === 0 });
  const r = validateData({ data: d, allowPartial: true });
  assert.deepStrictEqual(r.errors, [], errorsOf(r));
  assert.ok(r.warnings.length > 0);
});
