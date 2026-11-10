'use strict';
const test = require('node:test');
const assert = require('node:assert');
const build = require('../tools/bank/build.js');

// A species page with nothing usable on it (no size, no habitat, no range, no IUCN status, no biology text).
const bare = { name: "Nierstrasz's coral", sci: 'Psammocora nierstraszi', src: 'SeaLifeBase', fish: false, fb: { common: null, marine: false, brackish: false, freshwater: false, reef: false, depth: null, distribution: null, iucn: null, iucnCode: null, biology: null, maxLengthCm: null, maxWeightKg: null }, wiki: null, wd: null };

test('speciesFact is null when the page gives nothing to say', () => {
  assert.strictEqual(build.speciesFact(bare, null), null);
});

test('makeEntity never adds an entity without a fact', () => {
  const before = build.entities.length;
  const e = build.makeEntity({ rec: bare, display: "Nierstrasz's coral", fame: 0 }, { fb: () => true }, true, 'coral-species');
  assert.strictEqual(e, null);
  assert.strictEqual(build.entities.length, before, 'no orphan entity is pushed');
  assert.ok(!build.entities.some(x => x.fact == null), 'no entity in the bank lacks a fact');
});

test('makeEntity never rewrites a hand-written entity, even when a page has a fact for it', () => {
  const legacy = build.entities.find(e => !e.source && e.fact);
  if (!legacy) return;                                       // every entity is sourced: nothing to protect
  const fact = legacy.fact, aliases = legacy.aliases.slice();
  const rich = { name: legacy.name, sci: 'Genus species', src: 'FishBase', fish: true, fb: { common: legacy.name, marine: true, maxLengthCm: 120, depth: { max: 50 }, distribution: 'Everywhere', iucn: 'Least Concern', iucnCode: 'LC', biology: 'Lives in the sea.' }, wiki: null, wd: null };
  const e = build.makeEntity({ rec: rich, existing: legacy, display: legacy.name, fame: 99 }, { fb: () => true }, true, 'x');
  assert.strictEqual(e, legacy);
  assert.strictEqual(e.fact, fact);
  assert.deepStrictEqual(e.aliases, aliases);
  assert.strictEqual(e.source, undefined, 'the hand-written fact is not what the page says, so no source is claimed for it');
});

test('speciesFact drops whole clauses rather than cutting one short (the range goes first, the IUCN status stays)', () => {
  const rec = { name: 'Longname wrasse of the far eastern islands and atolls', fb: { maxLengthCm: 45, maxWeightKg: 2.2, marine: true, brackish: false, freshwater: false, reef: true, depth: { min: 1, max: 60 }, distribution: 'Indo-Pacific: Red Sea and East Africa to the Line and Tuamoto islands, north to the Ryukyu Islands, south to New Caledonia and Rapa; Eastern Pacific: Panama; also recorded from the Mediterranean through the Suez Canal where it is now established along the Levantine coast', iucn: 'Least Concern', iucnCode: 'LC', biology: null } };
  const f = require('../tools/bank/build.js').speciesFact(rec, null);
  assert.ok(f.length <= 240, f);
  assert.ok(/on the IUCN Red List\.$/.test(f), 'the status clause is whole: ' + f);
  assert.ok(!/range:/.test(f), 'the overlong range clause is dropped, not cut: ' + f);
  assert.ok(/grows to 45 cm and 2\.2 kg; lives in marine water around reefs down to 60 m; listed/.test(f), f);
});

test('thingFact never ends on a dangling word: an overlong or broken first sentence gives way to the description', () => {
  const { thingFact } = require('../tools/bank/build.js');
  const broken = { title: 'USNS Bowditch (T-AGS 62)', wiki: { first: 'USNS Bowditch (T-AGS 62) is a', short: 'Oceanographic survey ship of the United States Navy' }, wd: { description: 'oceanographic survey ship of the United States Navy' } };
  assert.strictEqual(thingFact(broken), 'USNS Bowditch (T-AGS 62) is an oceanographic survey ship of the United States Navy.');
  const head = 'The Strait of Tartary or Tatar Strait is a strait in the Pacific Ocean dividing the Russian island of Sakhalin from mainland Asia and connecting the Sea of Okhotsk on the north with the Sea of Japan on the south through narrow waters'.slice(0, 232);
  const long = { title: 'Tatar Strait', wiki: { first: head + ' of the great northern seas and the ice.' }, wd: { description: 'strait between Sakhalin and mainland Asia' } };
  const f = thingFact(long);
  assert.ok(f.length <= 240 && !/\b(the|of|with|and|a|an|to)\.$/.test(f), f);
});

test('a hand-list candidate with rawRe must mention it in the whole article, not just the first sentence', () => {
  const { passes } = require('../tools/bank/build.js');
  const cfg = { list: 'invasive', rawRe: /invasive|introduced species/i, kind: 'creature' };
  const rec = { name: 'Round goby', title: 'Round goby', wiki: { first: 'The round goby is a euryhaline bottom-dwelling species of fish.', short: 'Species of fish' }, wd: { description: 'species of fish' } };
  assert.strictEqual(passes(Object.assign({}, rec, { _raw: 'The round goby is a fish. ... It has become an invasive species in the Great Lakes.' }), cfg, false), true);
  assert.strictEqual(passes(Object.assign({}, rec, { _raw: 'The round goby is a fish that lives in the Black Sea.' }), cfg, false), false);
  assert.strictEqual(passes(rec, cfg, false), false, 'no article text, no verification');
});

test('an existing entity is only a candidate for a specific group when the reference list has it (a bowfin is not an Atlantic shark)', () => {
  const { entityNames } = require('../tools/bank/build.js');
  const sharks = entityNames(['sharks'], /shark|dogfish/i);
  assert.ok(sharks.includes('Great white shark'), 'a real shark is a candidate');
  assert.ok(!sharks.includes('Bowfin'), 'an alias ("dogfish") on a freshwater fish does not make it a shark');
  const broad = entityNames(['fish', 'freshwater-fish'], /bowfin/i);
  assert.ok(broad.includes('Bowfin'), 'broad fish groups accept any fish');
});

test('a candidate that is the same species or article as an answer already on the question is a duplicate, not a new answer', () => {
  const { duplicateOf } = require('../tools/bank/build.js');
  const prompt = { id: 'shark-species', answers: [{ entity: 'great-white-shark', tier: 'tidepool' }] };
  assert.ok(duplicateOf(prompt, { sci: 'Carcharodon carcharias' }, 'Maneater'), 'same scientific name as an existing answer');
  assert.ok(duplicateOf(prompt, { sci: 'Something else', wiki: { title: 'Great white shark' } }, 'White pointer'), 'same Wikipedia article as an existing answer');
  assert.ok(duplicateOf(prompt, { title: 'Great white shark', wiki: { title: 'Great white shark' } }, 'White pointer'), 'a hand-list thing resolving to the same article');
  assert.strictEqual(duplicateOf(prompt, { sci: 'Isurus oxyrinchus', wiki: { title: 'Shortfin mako shark' } }, 'Shortfin mako'), false);
});

test('a species candidate may also be verified by its Wikipedia article (rawRe) when the FishBase page is silent', () => {
  const { passes } = require('../tools/bank/build.js');
  const cfg = { fb: (f) => !!(f && f.biology && /kelp/i.test(f.biology)), rawRe: /kelp forest|kelp bed/i, fish: true };
  const rec = { name: 'Kelp greenling', sci: 'Hexagrammos decagrammus', fish: true, fb: { biology: 'Found over rocky bottoms.' }, wiki: { title: 'Kelp greenling', first: 'The kelp greenling is a fish.' } };
  assert.strictEqual(passes(rec, cfg, true), false, 'neither page mentions kelp');
  assert.strictEqual(passes(Object.assign({}, rec, { _raw: 'The kelp greenling lives in kelp forests off California.' }), cfg, true), true, 'the article does');
  assert.strictEqual(passes(Object.assign({}, rec, { fb: { biology: 'Inhabits kelp beds.' } }), cfg, true), true, 'FishBase still counts on its own');
});

test('enforceFloors demotes the least famous answers when the rarer tiers are short (a question of famous seabirds)', () => {
  const { enforceFloors, FLOORS } = require('../tools/bank/build.js');
  const answers = [{ entity: 'h', tier: 'hadal' }];
  const fame = { h: 1 };
  for (let i = 0; i < 74; i++) { answers.push({ entity: 'e' + i, tier: i < 5 ? 'tidepool' : i < 13 ? 'baitball' : 'reef' }); fame['e' + i] = 100 - i; }
  const prompt = { id: 'gulls', answers };
  enforceFloors(prompt, fame);
  const count = (t) => prompt.answers.filter(a => a.tier === t).length;
  for (const [t, min] of Object.entries(FLOORS)) assert.ok(count(t) >= min, t + ': ' + count(t) + ' < ' + min);
  assert.strictEqual(count('hadal'), 1);
  const midnight = prompt.answers.filter(a => a.tier === 'midnight').map(a => fame[a.entity]);
  assert.ok(Math.max(...midnight) <= Math.min(...prompt.answers.filter(a => a.tier === 'reef').map(a => fame[a.entity])), 'the demoted ones are the least famous');
});
