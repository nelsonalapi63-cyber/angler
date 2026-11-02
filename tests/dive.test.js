'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const dive = require(path.join(__dirname, '..', 'shared', 'dive.js'));

const entities = {
  'great-white-shark': { id: 'great-white-shark', name: 'Great white shark', aliases: ['white shark', 'great white', 'Carcharodon carcharias'] },
  'blue-shark': { id: 'blue-shark', name: 'Blue shark', aliases: ['Prionace glauca'] },
  'blue-whale': { id: 'blue-whale', name: 'Blue whale', aliases: [] },
  'mako-shark': { id: 'mako-shark', name: 'Mako shark', aliases: ['mako', 'shortfin mako'] },
  'wolffish': { id: 'wolffish', name: 'Wolffish', aliases: ['wolf fish', 'sea wolf'] },
  'cod': { id: 'cod', name: 'Cod', aliases: ['Atlantic cod'] },
  'goby': { id: 'goby', name: 'Goby', aliases: [] },
};
const prompt = { id: 'p1', answers: [
  { entity: 'great-white-shark', tier: 'tidepool' },
  { entity: 'blue-shark', tier: 'reef' },
  { entity: 'blue-whale', tier: 'twilight' },
  { entity: 'mako-shark', tier: 'baitball' },
  { entity: 'wolffish', tier: 'midnight' },
  { entity: 'cod', tier: 'hadal' },
  { entity: 'goby', tier: 'reef' },
] };
const index = dive.buildIndex(prompt, entities);

test('normalise strips punctuation, articles, accents and spacing', () => {
  assert.strictEqual(dive.normalise('  The  Great White Shark! '), 'great white shark');
  assert.strictEqual(dive.normalise("O'Neil's Ray"), 'oneils ray');
  assert.strictEqual(dive.normalise('Galápagos'), 'galapagos');
  assert.strictEqual(dive.normalise('a mako'), 'mako');
  assert.strictEqual(dive.normalise(''), '');
});

test('exact matches include plurals and aliases', () => {
  assert.strictEqual(dive.matchAnswer('great white sharks', index).entityId, 'great-white-shark');
  assert.strictEqual(dive.matchAnswer('White Shark', index).entityId, 'great-white-shark');
  assert.strictEqual(dive.matchAnswer('wolf fishes', index).entityId, 'wolffish');
  assert.strictEqual(dive.matchAnswer('gobies', index).entityId, 'goby');
  assert.strictEqual(dive.matchAnswer('the blue whale', index).via, 'exact');
});

test('fuzzy: one edit for short words, two for long, nearest wins', () => {
  const m = dive.matchAnswer('makp', index);          // 4 letters, 1 edit from mako
  assert.strictEqual(m.entityId, 'mako-shark');
  assert.strictEqual(m.via, 'fuzzy');
  assert.strictEqual(dive.matchAnswer('mkap', index).entityId, null);   // 2 edits on a short word → miss
  assert.strictEqual(dive.matchAnswer('graet white shrak', index).entityId, 'great-white-shark'); // 2 edits on long input
  // Review focus 2: 'blue shar' is 1 edit from 'blue shark' and 2 from 'blue whale' → shark wins
  assert.strictEqual(dive.matchAnswer('blue shar', index).entityId, 'blue-shark');
  assert.strictEqual(dive.matchAnswer('cd', index).entityId, null);     // below FUZZY_MIN_LEN
  assert.strictEqual(dive.matchAnswer('', index).entityId, null);
});

test('points, depth and zones', () => {
  assert.strictEqual(dive.depthFor(700), 10935);
  assert.strictEqual(dive.depthFor(0), 0);
  assert.strictEqual(dive.depthFor(10), 156);
  assert.strictEqual(dive.zoneFor(0).code, 'sunlight');
  assert.strictEqual(dive.zoneFor(199).code, 'sunlight');
  assert.strictEqual(dive.zoneFor(200).code, 'twilight');
  assert.strictEqual(dive.zoneFor(4000).code, 'abyss');
  assert.strictEqual(dive.zoneFor(10935).code, 'hadal');
  assert.strictEqual(dive.TIERS.map(t => t.points).join(','), '10,15,30,60,85,100');
});

function fakePrompts(n) {
  const groups = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: 'p' + String(i).padStart(3, '0'), group: groups[i % groups.length], difficulty: (i % 5) + 1, answers: [] });
  return out;
}

test('daily schedule is deterministic, distinct groups, ascending difficulty, no repeats within a cycle', () => {
  const prompts = fakePrompts(120);
  const launch = '2026-11-02';
  const seen = new Set();
  let prev = null;
  for (let d = 0; d < 17; d++) {          // 17 days × 7 = 119 < 120 → no repeats allowed
    const key = dive.keyPlusDays(launch, d);
    const ids = dive.dailyPromptIds(key, prompts, launch);
    assert.strictEqual(ids.length, 7, 'seven prompts on day ' + d);
    const groups = new Set(ids.map(id => prompts.find(p => p.id === id).group));
    assert.strictEqual(groups.size, 7, 'distinct groups on day ' + d);
    const diffs = ids.map(id => prompts.find(p => p.id === id).difficulty);
    for (let i = 1; i < diffs.length; i++) assert.ok(diffs[i] >= diffs[i - 1], 'ascending difficulty on day ' + d);
    for (const id of ids) { assert.ok(!seen.has(id), 'repeat ' + id + ' on day ' + d); seen.add(id); }
    assert.notDeepStrictEqual(ids, prev);
    prev = ids;
  }
  // deterministic across calls and across fresh schedule state
  assert.deepStrictEqual(dive.dailyPromptIds('2026-11-10', prompts, launch), dive.dailyPromptIds('2026-11-10', prompts.slice(), launch));
  assert.strictEqual(dive.dailyPromptIds('2026-11-01', prompts, launch), null);   // before launch
});

test('free and pack construction', () => {
  const prompts = fakePrompts(60);
  const a = dive.freePromptIds('abc123', prompts);
  const b = dive.freePromptIds('abc123', prompts);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(new Set(a.map(id => prompts.find(p => p.id === id).group)).size, 7);
  const pack = { prompts: ['p004', 'p000', 'p009', 'p001', 'p002', 'p003', 'p005'] };
  const ids = dive.packPromptIds(pack, prompts);
  assert.strictEqual(ids.length, 7);
  assert.strictEqual(ids[0], 'p000');     // difficulty 1
});

test('day keys, puzzle numbers and countdown use America/New_York', () => {
  // 2026-11-03T03:30Z is still 2026-11-02 22:30 in New York (EST, UTC-5)
  assert.strictEqual(dive.dayKey(new Date('2026-11-03T03:30:00Z')), '2026-11-02');
  assert.strictEqual(dive.dayKey(new Date('2026-11-03T05:00:00Z')), '2026-11-03');
  assert.strictEqual(dive.puzzleNumber('2026-11-02'), 1);
  assert.strictEqual(dive.puzzleNumber('2026-11-12'), 11);
  const ms = dive.msUntilNextDay(new Date('2026-11-03T03:30:00Z'));
  assert.strictEqual(ms, 90 * 60 * 1000);
});

test('challenge hashes round-trip and reject garbage', () => {
  const h = dive.makeChallengeHash('k7p2qz', 4210, ['tidepool', 'reef', 'twilight', null, 'midnight', 'hadal', 'baitball']);
  assert.strictEqual(h, '#challenge-k7p2qz-4210-1340562');
  const parsed = dive.parseChallenge(h);
  assert.deepStrictEqual(parsed, { seed: 'k7p2qz', depth: 4210, tiers: ['tidepool', 'reef', 'twilight', null, 'midnight', 'hadal', 'baitball'] });
  assert.deepStrictEqual(dive.parseChallenge('#challenge-k7p2qz'), { seed: 'k7p2qz', depth: 0, tiers: null });
  assert.deepStrictEqual(dive.parseChallenge('#/challenge/k7p2qz-10'), { seed: 'k7p2qz', depth: 10, tiers: null });
  assert.strictEqual(dive.parseChallenge('#challenge-'), null);
  assert.strictEqual(dive.parseChallenge('#challenge-!!!-abc'), null);
  assert.strictEqual(dive.parseChallenge('#challenge-k7p2qz-4210-99'), null);
  assert.strictEqual(dive.parseChallenge(undefined), null);
});

test('share text', () => {
  const s = dive.shareText({ number: 12, depth: 4210, percentile: 18, tiers: ['tidepool', 'reef', 'twilight', null, 'midnight', 'hadal', 'baitball'] });
  assert.strictEqual(s, 'FATHOM #12 · 4,210 m · top 18% · 🐚🪸🦑⬛🐙🔱🐠');
  const t = dive.shareText({ number: 1, depth: 0, percentile: null, tiers: [null, null, null, null, null, null, null], siteUrl: 'https://x.y' });
  assert.strictEqual(t, 'FATHOM #1 · 0 m · ⬛⬛⬛⬛⬛⬛⬛\nhttps://x.y');
});

test('scoreSubmission re-scores typed answers', () => {
  const prompts = [prompt, { ...prompt, id: 'p2' }];
  const sub = { promptIds: ['p1', 'p2'], answers: [{ typed: 'cod', secondsUsed: 4.2 }, { typed: 'nothing here', secondsUsed: 25 }] };
  const r = dive.scoreSubmission(sub, prompts, entities);
  assert.strictEqual(r.points, 100);
  assert.strictEqual(r.depth, dive.depthFor(100));
  assert.deepStrictEqual(r.tiers, ['hadal', null]);
  assert.strictEqual(r.secondsUsed, 29.2);
});

test('shared spellings: canonical name beats alias, lower tier beats higher tier', () => {
  const ents = {
    'mako-shark': { id: 'mako-shark', name: 'Mako shark', aliases: ['mako'] },
    'shortfin-mako': { id: 'shortfin-mako', name: 'Shortfin mako', aliases: ['mako', 'shortfin mako shark'] },
    'manta-ray': { id: 'manta-ray', name: 'Manta ray', aliases: ['manta', 'giant manta ray'] },
    'giant-manta-ray': { id: 'giant-manta-ray', name: 'Giant manta ray', aliases: ['giant manta'] },
  };
  const p = { id: 'x', answers: [{ entity: 'shortfin-mako', tier: 'twilight' }, { entity: 'mako-shark', tier: 'baitball' }, { entity: 'giant-manta-ray', tier: 'reef' }, { entity: 'manta-ray', tier: 'tidepool' }] };
  const idx = dive.buildIndex(p, ents);
  assert.strictEqual(dive.matchAnswer('mako', idx).entityId, 'mako-shark');                 // generic wins the shared alias
  assert.strictEqual(dive.matchAnswer('shortfin mako', idx).entityId, 'shortfin-mako');
  assert.strictEqual(dive.matchAnswer('giant manta ray', idx).entityId, 'giant-manta-ray'); // canonical beats the generic's alias
  assert.strictEqual(dive.matchAnswer('manta', idx).entityId, 'manta-ray');
});
