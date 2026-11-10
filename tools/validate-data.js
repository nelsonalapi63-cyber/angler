#!/usr/bin/env node
/* Validates the merged data set (data/entities.json + data/prompts.json + data/packs.json).
 * v4 adds the bank floors: every live (not retired) question carries at least LIVE_MIN_ANSWERS answers and the tier
 * floors, every answer's entity carries a `source` (pre-v4 entities listed in data/legacy-entities.json are exempt
 * and only counted), and the bank never drops below LIVE_MIN_PROMPTS live questions. --partial turns those into
 * warnings while the bank is being built. */
'use strict';
const fs = require('fs');
const path = require('path');
const { validateBatch } = require('./validate-batch.js');

const ROOT = path.join(__dirname, '..');
const LIVE_MIN_ANSWERS = 75;
const LIVE_MIN_PROMPTS = 211;
const TIER_FLOORS = { hadal: 1, midnight: 3, twilight: 8, reef: 12, baitball: 8, tidepool: 5 };
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const readOptional = (f) => (fs.existsSync(path.join(ROOT, 'data', f)) ? read(f) : []);

// opts.data may carry { seeds, entities, prompts, packs, legacy } directly (tests); otherwise data/ is read.
function validateData({ allowPartial, data } = {}) {
  const seeds = data ? data.seeds : read('prompt-seeds.json');
  const entities = data ? data.entities : read('entities.json');
  const prompts = data ? data.prompts : read('prompts.json');
  const packs = data ? data.packs : read('packs.json');
  const legacy = new Set(data ? (data.legacy || []) : readOptional('legacy-entities.json'));
  const filled = prompts.filter(p => p.answers && p.answers.length);
  const expected = allowPartial ? filled.map(p => p.id) : seeds.map(s => s.id);
  const res = validateBatch({ entities, prompts: filled }, seeds, {}, expected);
  if (allowPartial) {       // while the bank is still being topped up, a short answer list is a warning, not a stop
    const short = res.errors.filter(e => / only \d+ answers, need at least \d+$/.test(e));
    res.errors = res.errors.filter(e => !short.includes(e));
    res.warnings.push(...short);
  }
  const soft = allowPartial ? res.warnings : res.errors;
  const promptIds = new Set(filled.map(p => p.id));
  for (const pack of packs) {
    if (pack.prompts.length !== 7) res.errors.push('pack ' + pack.id + ': needs 7 prompts');
    for (const id of pack.prompts) if (!promptIds.has(id)) soft.push('pack ' + pack.id + ': prompt ' + id + ' has no answers yet');
  }
  // ---- v4 floors (live questions only: a retired question keeps its answers for the archive and is never dealt)
  const byId = Object.fromEntries(entities.map(e => [e.id, e]));
  const live = filled.filter(p => !p.retired);
  let legacyCount = 0;
  const unsourced = [];
  for (const p of live) {
    const where = 'prompt ' + p.id;
    if (p.answers.length < LIVE_MIN_ANSWERS) soft.push(where + ': only ' + p.answers.length + ' answers, a live question needs at least ' + LIVE_MIN_ANSWERS);
    const counts = {};
    for (const a of p.answers) {
      counts[a.tier] = (counts[a.tier] || 0) + 1;
      const e = byId[a.entity];
      if (!e) continue;
      if (!e.source) { if (legacy.has(e.id)) legacyCount++; else unsourced.push(where + ': answer ' + e.id + ' has no source'); }
    }
    for (const [tier, min] of Object.entries(TIER_FLOORS)) if ((counts[tier] || 0) < min) soft.push(where + ': ' + (counts[tier] || 0) + ' ' + tier + ' answers, the floor is ' + min);
  }
  soft.push(...unsourced);
  if (legacyCount) res.warnings.push(legacyCount + ' legacy answer' + (legacyCount === 1 ? '' : 's') + ' without a source (pre-v4 entities on data/legacy-entities.json)');
  if (live.length < LIVE_MIN_PROMPTS) soft.push('only ' + live.length + ' live questions; the bank never drops below ' + LIVE_MIN_PROMPTS);
  res.ok = res.errors.length === 0;
  res.counts = { entities: entities.length, prompts: filled.length, live: live.length, answers: filled.reduce((n, p) => n + p.answers.length, 0), legacyUnsourced: legacyCount };
  return res;
}

module.exports = { validateData, LIVE_MIN_ANSWERS, LIVE_MIN_PROMPTS, TIER_FLOORS };

if (require.main === module) {
  const res = validateData({ allowPartial: process.argv.includes('--partial') });
  for (const w of res.warnings) console.log('warn: ' + w);
  for (const e of res.errors) console.log('ERROR: ' + e);
  console.log((res.ok ? 'OK' : 'FAILED') + ': ' + JSON.stringify(res.counts));
  process.exitCode = res.ok ? 0 : 1;     // not process.exit(): a piped stdout would lose the last line
}
