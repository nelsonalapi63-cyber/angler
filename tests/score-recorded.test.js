'use strict';
// The server re-scores what the browser typed. This checks that the shared scorer, fed the dive the e2e run
// recorded (tests/fixtures/recorded-dive.json), returns exactly the depth the browser showed.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const dive = require(path.join(__dirname, '..', 'shared', 'dive.js'));

const fixture = path.join(__dirname, 'fixtures', 'recorded-dive.json');

test('server-side scoring matches the browser for a recorded dive', { skip: !fs.existsSync(fixture) && 'run tests/e2e.spec.js first to record a dive' }, () => {
  const rec = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const prompts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'prompts.json'), 'utf8'));
  const entities = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'entities.json'), 'utf8'));
  const byId = Object.fromEntries(entities.map(e => [e.id, e]));
  const schedule = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'schedule.json'), 'utf8'));
  const taxaFile = path.join(__dirname, '..', 'data', 'taxa.json');
  const taxa = fs.existsSync(taxaFile) ? JSON.parse(fs.readFileSync(taxaFile, 'utf8')) : {};
  // the day's prompt set must be reproducible from the date and the frozen schedule (what submit-dive checks)
  if (rec.day >= dive.LAUNCH_DATE) assert.deepStrictEqual(dive.dailyPromptIds(rec.day, prompts, dive.LAUNCH_DATE, schedule), rec.promptIds);
  // answers carry hint flags; the server deducts the hint cost exactly as the browser did
  const scored = dive.scoreSubmissionFull({ promptIds: rec.promptIds, answers: rec.answers }, prompts, byId, taxa);
  assert.strictEqual(scored.points, rec.points);
  assert.strictEqual(scored.depth, rec.depth);
  assert.deepStrictEqual(scored.tiers, rec.tiers);
});
