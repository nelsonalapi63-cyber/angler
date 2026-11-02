#!/usr/bin/env node
/* Writes a synthetic batch (every seed prompt × 26 made-up entities) to a temp dir for UI smoke tests.
 * Usage: node tools/make-dev-data.js /tmp/devbatches   — then BATCH_DIR=/tmp/devbatches node tools/merge-batches.js */
'use strict';
const fs = require('fs'); const path = require('path');
const seeds = require('../data/prompt-seeds.json');
const out = process.argv[2] || '/tmp/devbatches';
fs.mkdirSync(out, { recursive: true });
const tiers = ['tidepool','tidepool','tidepool','baitball','baitball','reef','reef','reef','reef','reef','reef','twilight','twilight','twilight','twilight','twilight','twilight','midnight','midnight','midnight','midnight','midnight','hadal','reef','twilight','midnight'];
const entities = []; const prompts = [];
for (const s of seeds) {
  const answers = [];
  tiers.forEach((t, i) => {
    const id = s.id + '-e' + i;
    entities.push({ id, name: 'Dev ' + s.id.replace(/-/g, ' ') + ' ' + i, aliases: i === 0 ? ['alias ' + s.id] : [], kind: 'creature', group: s.group, fact: 'A synthetic fact about dev entity ' + i + ' for ' + s.id + ', used only for interface smoke tests.' });
    answers.push({ entity: id, tier: t });
  });
  prompts.push({ id: s.id, answers });
}
fs.writeFileSync(path.join(out, 'dev.json'), JSON.stringify({ entities, prompts }));
console.log('wrote ' + path.join(out, 'dev.json'));
