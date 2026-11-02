'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { validateBatch } = require(path.join(__dirname, '..', 'tools', 'validate-batch.js'));

const seeds = [{ id: 'shark-species', text: 'Name a shark species.', group: 'sharks', difficulty: 1 }];

function makeBatch(n, opts = {}) {
  const entities = [];
  const answers = [];
  for (let i = 0; i < n; i++) {
    const id = 'shark-' + i;
    entities.push({ id, name: 'Shark number ' + i, aliases: opts.collide && i === 1 ? ['Shark number 0'] : [], kind: opts.kind || 'creature', group: 'sharks', fact: 'This is a perfectly fine one-sentence fact about shark ' + i + '.' });
    answers.push({ entity: id, tier: i === 0 ? 'hadal' : (i === 1 && opts.twoHadal ? 'hadal' : (i < 4 ? 'tidepool' : i < 6 ? 'baitball' : i < 12 ? 'reef' : i < 18 ? 'twilight' : 'midnight')) });
  }
  return { entities, prompts: [{ id: 'shark-species', answers }] };
}

test('a good batch passes', () => {
  const r = validateBatch(makeBatch(40), seeds, {}, ['shark-species']);
  assert.deepStrictEqual(r.errors, []);
  assert.ok(r.ok);
});

test('39 answers fails and names the prompt; a seed "min" lowers the floor', () => {
  const r = validateBatch(makeBatch(39), seeds, {});
  assert.ok(!r.ok);
  assert.ok(r.errors.some(e => e.includes('shark-species') && e.includes('39')));
  const r2 = validateBatch(makeBatch(30), [{ ...seeds[0], min: 28 }], {});
  assert.ok(r2.ok);
});

test('two hadals fails', () => {
  const r = validateBatch(makeBatch(40, { twoHadal: true }), seeds, {});
  assert.ok(r.errors.some(e => e.includes('exactly one hadal')));
});

test('a shared alias inside a prompt is a warning, a shared canonical name is an error', () => {
  const r = validateBatch(makeBatch(40, { collide: true }), seeds, {});   // entity 1 has alias "Shark number 0" = entity 0's name
  assert.ok(r.ok);
  assert.ok(r.warnings.some(w => w.includes('shared by')));
  const batch = makeBatch(40);
  batch.entities[1].name = 'Shark number 0';
  const r2 = validateBatch(batch, seeds, {});
  assert.ok(r2.errors.some(e => e.includes('same name')));
});

test('bad kind fails', () => {
  const r = validateBatch(makeBatch(40, { kind: 'fish' }), seeds, {});
  assert.ok(r.errors.some(e => e.includes('kind must be')));
});

test('missing expected prompt fails', () => {
  const r = validateBatch(makeBatch(40), seeds, {}, ['shark-species', 'other']);
  assert.ok(r.errors.some(e => e.includes('other') && e.includes('missing')));
});
