'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { collisions } = require(path.join(__dirname, '..', 'tools', 'check-leniency.js'));

test('check-leniency reports a name that resolves to a different answer of the same question', () => {
  const entities = [
    { id: 'blue-shark', name: 'Blue shark', aliases: [] },
    { id: 'blue', name: 'Blue', aliases: ['blue shark'] },        // an alias that steals another answer's name
    { id: 'cod', name: 'Cod', aliases: ['codfish'] },
  ];
  const prompts = [{ id: 'q', text: 'Name a fish.', answers: [{ entity: 'blue-shark', tier: 'tidepool' }, { entity: 'blue', tier: 'reef' }, { entity: 'cod', tier: 'hadal' }] }];
  const r = collisions(prompts, entities, {});
  assert.strictEqual(r.names.length, 0, 'a canonical name always beats an alias, so no name collision');
  assert.strictEqual(r.aliases.length, 1);
  assert.strictEqual(r.aliases[0].typed, 'blue shark');
  assert.strictEqual(r.aliases[0].own, 'blue');
  assert.strictEqual(r.aliases[0].got, 'blue-shark');
  assert.strictEqual(r.checked, 3);
});

test('check-leniency lists the short forms two answers of one question would both claim', () => {
  const entities = [
    { id: 'cod', name: 'Cod', aliases: [] },
    { id: 'blue-shark', name: 'Blue shark', aliases: [] },
    { id: 'blue-whale', name: 'Blue whale', aliases: [] },          // "blue" could mean either
  ];
  const prompts = [{ id: 'q', text: 'Name a sea creature.', answers: [{ entity: 'cod', tier: 'tidepool' }, { entity: 'blue-shark', tier: 'reef' }, { entity: 'blue-whale', tier: 'hadal' }] }];
  const r = collisions(prompts, entities, {});
  assert.strictEqual(r.names.length, 0, 'both real spellings still resolve to themselves');
  assert.deepStrictEqual(r.ambiguous.map(a => a.form).sort(), ['blue', 'blues']);
  assert.deepStrictEqual(r.ambiguous[0].answers.sort(), ['blue-shark', 'blue-whale']);
});
