'use strict';
/* ANGLER v3 — lenient matching: optional group words, spaced glued names, unambiguous-only, typo bands. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const dive = require(path.join(__dirname, '..', 'shared', 'dive.js'));

const ents = {
  'tuna': { id: 'tuna', name: 'Tuna', aliases: [] },
  'orca': { id: 'orca', name: 'Orca', aliases: ['killer whale'] },
  'leatherback': { id: 'leatherback', name: 'Leatherback', aliases: [] },
  'hammerhead-shark': { id: 'hammerhead-shark', name: 'Hammerhead shark', aliases: [] },
  'great-hammerhead': { id: 'great-hammerhead', name: 'Great hammerhead', aliases: [] },
  'tiger-shark': { id: 'tiger-shark', name: 'Tiger shark', aliases: [] },
  'sand-tiger-shark': { id: 'sand-tiger-shark', name: 'Sand tiger shark', aliases: [] },
  'clownfish': { id: 'clownfish', name: 'Clownfish', aliases: [] },
  'starfish': { id: 'starfish', name: 'Starfish', aliases: ['sea star'] },
  'lionfish': { id: 'lionfish', name: 'Lionfish', aliases: [] },
  'whale-shark': { id: 'whale-shark', name: 'Whale shark', aliases: [] },
  'cod': { id: 'cod', name: 'Cod', aliases: [] },
  'humpback-whale': { id: 'humpback-whale', name: 'Humpback whale', aliases: [] },
  'scalloped-hammerhead': { id: 'scalloped-hammerhead', name: 'Scalloped hammerhead', aliases: [] },
};
const prompt = { id: 'p', answers: Object.keys(ents).map((id, i) => ({ entity: id, tier: ['tidepool', 'baitball', 'reef', 'twilight', 'midnight', 'hadal'][i % 6] })) };
const index = dive.buildIndex(prompt, ents);
const hit = (typed) => dive.matchAnswer(typed, index);

test('a trailing group word the bank name does not carry is optional: tuna fish → Tuna', () => {
  assert.strictEqual(hit('tuna fish').entityId, 'tuna');
  assert.strictEqual(hit('tuna fish').via, 'group');
  assert.strictEqual(hit('tunafish').entityId, 'tuna');
  assert.strictEqual(hit('orca whale').entityId, 'orca');
  assert.strictEqual(hit('leatherback turtle').entityId, 'leatherback');
  assert.strictEqual(hit('leatherback sea turtle').entityId, 'leatherback');
  assert.strictEqual(hit('tuna').via, 'exact');
});

test('a group word the bank name carries is optional when typed: hammerhead → Hammerhead shark', () => {
  assert.strictEqual(hit('hammerhead').entityId, 'hammerhead-shark');
  assert.strictEqual(hit('hammerhead').via, 'group');
  assert.strictEqual(hit('tiger').entityId, 'tiger-shark');
  assert.strictEqual(hit('sand tiger').entityId, 'sand-tiger-shark');
  assert.strictEqual(hit('hammerheads').entityId, 'hammerhead-shark');          // plurals of the short form too
});

test('a group word that is part of the name stays required, but the spaced form counts', () => {
  assert.strictEqual(hit('clown').entityId, null);
  assert.strictEqual(hit('star').entityId, null);
  assert.strictEqual(hit('lion').entityId, null);
  assert.strictEqual(hit('clown fish').entityId, 'clownfish');
  assert.strictEqual(hit('star fish').entityId, 'starfish');
  assert.strictEqual(hit('lion fish').entityId, 'lionfish');
  assert.strictEqual(hit('clownfish').via, 'exact');
});

test('a group word on its own, or a core shorter than four letters, never resolves', () => {
  assert.strictEqual(hit('whale').entityId, null);          // "whale shark" minus its group word is itself a group word
  assert.strictEqual(hit('shark').entityId, null);
  assert.strictEqual(hit('sea').entityId, null);            // "sea star" minus "star" is too short to mean anything
  assert.strictEqual(hit('fish').entityId, null);
});

test('a strip or add that fits two answers is rejected and both are offered as "did you mean"', () => {
  const two = {
    'blue-shark': { id: 'blue-shark', name: 'Blue shark', aliases: [] },
    'blue-whale': { id: 'blue-whale', name: 'Blue whale', aliases: [] },
    'cod': { id: 'cod', name: 'Cod', aliases: [] },
  };
  const p = { id: 'two', answers: [{ entity: 'blue-shark', tier: 'reef' }, { entity: 'blue-whale', tier: 'twilight' }, { entity: 'cod', tier: 'hadal' }] };
  const idx = dive.buildIndex(p, two);
  const m = dive.matchAnswer('blue', idx);
  assert.strictEqual(m.entityId, null);
  assert.deepStrictEqual(m.ambiguous.map(a => a.name).sort(), ['Blue shark', 'Blue whale']);
  assert.deepStrictEqual(dive.matchAnswer('blue fish', idx).ambiguous.map(a => a.name).sort(), ['Blue shark', 'Blue whale']);
  assert.deepStrictEqual(dive.suggestAnswers('blue', idx, two).map(s => s.name), ['Blue shark', 'Blue whale']);   // lower tier first
  assert.strictEqual(dive.matchAnswer('blue shark', idx).entityId, 'blue-shark');                                 // the full name still works
});

test('a canonical name or alias always beats a group-word variant of another answer', () => {
  const ents2 = {
    'hammerhead': { id: 'hammerhead', name: 'Hammerhead', aliases: [] },
    'hammerhead-shark': { id: 'hammerhead-shark', name: 'Hammerhead shark', aliases: [] },
    'mako': { id: 'mako', name: 'Shortfin mako', aliases: ['mako'] },
    'mako-shark': { id: 'mako-shark', name: 'Mako shark', aliases: [] },
  };
  const p = { id: 'prec', answers: [{ entity: 'hammerhead-shark', tier: 'tidepool' }, { entity: 'hammerhead', tier: 'reef' }, { entity: 'mako-shark', tier: 'tidepool' }, { entity: 'mako', tier: 'twilight' }] };
  const idx = dive.buildIndex(p, ents2);
  assert.strictEqual(dive.matchAnswer('hammerhead', idx).entityId, 'hammerhead');
  assert.strictEqual(dive.matchAnswer('mako', idx).entityId, 'mako');
  assert.strictEqual(dive.matchAnswer('mako shark', idx).entityId, 'mako-shark');
});

test('typos: 1 edit for 4–6 letters, 2 for 7–11, 3 for 12 or more, never under 4 letters', () => {
  assert.strictEqual(hit('tunq').entityId, 'tuna');                       // 4 letters, 1 edit
  assert.strictEqual(hit('tnqa').entityId, null);                         // 4 letters, 2 edits
  assert.strictEqual(hit('humpbak whle').entityId, 'humpback-whale');     // 11 letters typed, 2 edits
  assert.strictEqual(hit('humpbk whle').entityId, null);                  // 10 letters typed, 3 edits
  assert.strictEqual(hit('scaloped hamerhed').entityId, 'scalloped-hammerhead');   // 16 letters, 3 edits
  assert.strictEqual(hit('scalopd hamrhed').entityId, null);              // 14 letters, 4 edits → not accepted (a chip instead)
  assert.strictEqual(hit('cdo').entityId, null);                          // 3 letters: never fuzzy
  assert.strictEqual(hit('cod').entityId, 'cod');
  assert.strictEqual(hit('cods').entityId, 'cod');
  assert.strictEqual(dive.matchAnswer('scalopd hamrhed', index).entityId, null);
  assert.deepStrictEqual(dive.suggestAnswers('scalopd hamrhed', index, ents).map(s => s.name), ['Scalloped hammerhead']);
});

test('the server scores typed answers with the same leniency', () => {
  const r = dive.scoreSubmissionFull({ promptIds: ['p'], answers: [{ typed: 'hammerhead', secondsUsed: 5 }] }, [prompt], ents);
  assert.strictEqual(r.results[0].entityId, 'hammerhead-shark');
  assert.strictEqual(r.results[0].via, 'group');
});

test('the hint is free: HINT_COST is zero and a hinted answer keeps its points', () => {
  assert.strictEqual(dive.HINT_COST, 0);
  const r = dive.scoreSubmissionFull({ promptIds: ['p'], answers: [{ typed: 'cod', secondsUsed: 5, hint: true }] }, [prompt], ents);
  assert.strictEqual(r.points, dive.TIER_BY_CODE[prompt.answers.find(a => a.entity === 'cod').tier].points);
});

test('share text carries "beat X% · #r of n" once the server has answered, and never a bare percentile', () => {
  const tiers = ['tidepool', 'reef', 'twilight', null, 'midnight', 'hadal', 'baitball'];
  assert.strictEqual(dive.shareText({ number: 12, depth: 4210, beat: 83, rank: 12, total: 71, tiers }), 'ANGLER #12 · 4,210 m · beat 83% · #12 of 71 · 🐚🪸🦑⬛🐙🔱🐠');
  assert.strictEqual(dive.shareText({ number: 12, depth: 4210, rank: 1, total: 1, tiers }), 'ANGLER #12 · 4,210 m · #1 of 1 · 🐚🪸🦑⬛🐙🔱🐠');
  assert.strictEqual(dive.shareText({ number: 12, depth: 4210, tiers }), 'ANGLER #12 · 4,210 m · 🐚🪸🦑⬛🐙🔱🐠');
});

test('beatPercent: share of the other divers you out-dived', () => {
  assert.strictEqual(dive.beatPercent({ total: 1, atOrAbove: 1 }), null);          // nobody else yet
  assert.strictEqual(dive.beatPercent({ total: 2, atOrAbove: 1 }), 100);
  assert.strictEqual(dive.beatPercent({ total: 10, atOrAbove: 3 }), 78);          // 7 of the other 9
  assert.strictEqual(dive.beatPercent({ total: 10, atOrAbove: 10 }), 0);
  assert.strictEqual(dive.beatPercent({ total: 0 }), null);
});
