'use strict';
/* ANGLER v4 — autocorrect that says so: the matcher reports what it corrected and whether it accepted it. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const dive = require(path.join(__dirname, '..', 'shared', 'dive.js'));

const ents = {
  'humpback-whale': { id: 'humpback-whale', name: 'Humpback whale', aliases: [] },
  'scalloped-hammerhead': { id: 'scalloped-hammerhead', name: 'Scalloped hammerhead', aliases: ['Sphyrna lewini'] },
  'great-hammerhead': { id: 'great-hammerhead', name: 'Great hammerhead', aliases: [] },
  'bull-shark': { id: 'bull-shark', name: 'Bull shark', aliases: ['Zambezi shark'] },
  'blue-shark': { id: 'blue-shark', name: 'Blue shark', aliases: [] },
  'blue-whale': { id: 'blue-whale', name: 'Blue whale', aliases: [] },
  'sowerbys-beaked-whale': { id: 'sowerbys-beaked-whale', name: "Sowerby's beaked whale", aliases: [] },
  'cod': { id: 'cod', name: 'Cod', aliases: [] },
};
const prompt = { id: 'p', answers: Object.keys(ents).map((id, i) => ({ entity: id, tier: ['tidepool', 'baitball', 'reef', 'twilight', 'midnight', 'reef', 'midnight', 'hadal'][i] })) };
const index = dive.buildIndex(prompt, ents);
const hit = (typed) => dive.matchAnswer(typed, index, ents);

test('inside the typo budget the answer is accepted and the correction says what was fixed', () => {
  const m = hit('humpbak whale');
  assert.strictEqual(m.entityId, 'humpback-whale');
  assert.strictEqual(m.via, 'fuzzy');
  assert.deepStrictEqual(m.correction, { from: 'humpbak whale', to: 'Humpback whale', accepted: true });
});

test('an exact answer carries no correction', () => {
  assert.strictEqual(hit('Humpback whale').correction, undefined);
  assert.strictEqual(hit('humpback').correction, undefined);           // group leniency is not a spelling fix
});

test('the corrected spelling is the real one, apostrophes and all', () => {
  const m = hit('sowerbys beaked whale');
  assert.strictEqual(m.entityId, 'sowerbys-beaked-whale');
  assert.strictEqual(m.correction, undefined);                           // normalisation, not a typo: no correction shown
  const typo = hit('sowerbys beaked whael');
  assert.strictEqual(typo.entityId, 'sowerbys-beaked-whale');
  assert.strictEqual(typo.correction.to, "Sowerby's beaked whale");
});

test('a corrected alias shows the alias spelling, not the canonical name', () => {
  const m = hit('zambezi shrak');
  assert.strictEqual(m.entityId, 'bull-shark');
  assert.strictEqual(m.correction.to, 'Zambezi shark');
});

test('outside the budget but within suggestion range: not accepted, the box asks', () => {
  const m = hit('scalopd hamrhead');                                     // 14 letters, 4 edits: over the 3-edit budget
  assert.strictEqual(m.entityId, null);
  assert.deepStrictEqual(m.correction, { from: 'scalopd hamrhead', to: 'Scalloped hammerhead', accepted: false, options: [{ name: 'Scalloped hammerhead', entityId: 'scalloped-hammerhead' }] });
});

test('two candidates give two options with the same wording', () => {
  const m = hit('hammerhead');
  assert.strictEqual(m.entityId, null);
  assert.strictEqual(m.correction.accepted, false);
  assert.deepStrictEqual(m.correction.options.map(o => o.name), ['Scalloped hammerhead', 'Great hammerhead']);   // the more common tier first
  assert.strictEqual(m.correction.to, 'Scalloped hammerhead');
});

test('an ambiguous short form keeps the "could mean" chips and is not a spelling correction', () => {
  const m = hit('blue');
  assert.strictEqual(m.entityId, null);
  assert.ok(m.ambiguous && m.ambiguous.length === 2);
  assert.strictEqual(m.correction, undefined);
});

test('never fuzzy under four letters, and nothing like any answer gets no correction', () => {
  assert.strictEqual(hit('cdo').correction, undefined);
  assert.strictEqual(hit('zzzzzzzzzz').correction, undefined);
});

test('the server scores the corrected spelling the same way', () => {
  const prompts = [Object.assign({ text: 'q' }, prompt)];
  const r = dive.scoreSubmissionFull({ promptIds: ['p'], answers: [{ typed: 'humpbak whale', secondsUsed: 3 }] }, prompts, ents, {});
  assert.strictEqual(r.results[0].entityId, 'humpback-whale');
});
