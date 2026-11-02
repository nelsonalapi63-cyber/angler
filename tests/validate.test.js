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
  const r = validateBatch(makeBatch(25), seeds, {}, ['shark-species']);
  assert.deepStrictEqual(r.errors, []);
  assert.ok(r.ok);
});

test('24 answers fails and names the prompt', () => {
  const r = validateBatch(makeBatch(24), seeds, {});
  assert.ok(!r.ok);
  assert.ok(r.errors.some(e => e.includes('shark-species') && e.includes('24')));
});

test('two hadals fails', () => {
  const r = validateBatch(makeBatch(25, { twoHadal: true }), seeds, {});
  assert.ok(r.errors.some(e => e.includes('exactly one hadal')));
});

test('alias collision inside a prompt fails', () => {
  const r = validateBatch(makeBatch(25, { collide: true }), seeds, {});
  assert.ok(r.errors.some(e => e.includes('collides')));
});

test('bad kind fails', () => {
  const r = validateBatch(makeBatch(25, { kind: 'fish' }), seeds, {});
  assert.ok(r.errors.some(e => e.includes('kind must be')));
});

test('missing expected prompt fails', () => {
  const r = validateBatch(makeBatch(25), seeds, {}, ['shark-species', 'other']);
  assert.ok(r.errors.some(e => e.includes('other') && e.includes('missing')));
});
