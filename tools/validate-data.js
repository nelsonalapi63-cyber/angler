#!/usr/bin/env node
/* Validates the merged data set (data/entities.json + data/prompts.json + data/packs.json). */
'use strict';
const fs = require('fs');
const path = require('path');
const { validateBatch } = require('./validate-batch.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

function validateData({ allowPartial } = {}) {
  const seeds = read('prompt-seeds.json');
  const entities = read('entities.json');
  const prompts = read('prompts.json');
  const packs = read('packs.json');
  const filled = prompts.filter(p => p.answers && p.answers.length);
  const expected = allowPartial ? filled.map(p => p.id) : seeds.map(s => s.id);
  const res = validateBatch({ entities, prompts: filled }, seeds, {}, expected);
  const promptIds = new Set(filled.map(p => p.id));
  for (const pack of packs) {
    if (pack.prompts.length !== 7) res.errors.push('pack ' + pack.id + ': needs 7 prompts');
    for (const id of pack.prompts) if (!promptIds.has(id)) (allowPartial ? res.warnings : res.errors).push('pack ' + pack.id + ': prompt ' + id + ' has no answers yet');
  }
  if (!allowPartial && filled.length < 120) res.errors.push('only ' + filled.length + ' prompts have answers; need at least 120');
  res.ok = res.errors.length === 0;
  res.counts = { entities: entities.length, prompts: filled.length, answers: filled.reduce((n, p) => n + p.answers.length, 0) };
  return res;
}

module.exports = { validateData };

if (require.main === module) {
  const res = validateData({ allowPartial: process.argv.includes('--partial') });
  for (const w of res.warnings) console.log('warn: ' + w);
  for (const e of res.errors) console.log('ERROR: ' + e);
  console.log((res.ok ? 'OK' : 'FAILED') + ': ' + JSON.stringify(res.counts));
  process.exit(res.ok ? 0 : 1);
}
