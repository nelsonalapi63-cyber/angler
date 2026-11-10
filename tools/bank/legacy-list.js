#!/usr/bin/env node
'use strict';
/* Rebuilds data/legacy-entities.json: the pre-v4, hand-written entities that still have no `source` and are used by
 * a live question. tools/validate-data.js exempts exactly these from the "every answer has a source" rule and counts
 * them, so the list can only shrink: a v4 entity is never created without a source (tools/bank/build.js), and a
 * legacy entity drops off the list as soon as a build gives it one. Run after tools/bank/build.js, before validating. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const entities = read('entities.json');
const prompts = read('prompts.json');
const referenced = new Set();
for (const p of prompts) if (!p.retired) for (const a of p.answers) referenced.add(a.entity);
const before = fs.existsSync(path.join(ROOT, 'data', 'legacy-entities.json')) ? read('legacy-entities.json') : null;
const backupPath = path.join(__dirname, 'backup', 'entities.json');
const preV4 = fs.existsSync(backupPath) ? new Set(JSON.parse(fs.readFileSync(backupPath, 'utf8')).map(e => e.id)) : null;   // the pre-v4 snapshot, when it is around
const legacy = entities.filter(e => !e.source && referenced.has(e.id)).map(e => e.id).sort();
// an unsourced entity is legacy only if it predates v4: with the snapshot that is checked directly, without it the
// list may only lose ids (a v4 entity is never created without a source)
const grew = preV4 ? legacy.filter(id => !preV4.has(id)) : before ? legacy.filter(id => !before.includes(id)) : [];
if (grew.length) { console.error('unsourced entities that are not pre-v4 (the builder must give every new answer a source): ' + grew.join(', ')); process.exitCode = 1; }
else {
  fs.writeFileSync(path.join(ROOT, 'data', 'legacy-entities.json'), JSON.stringify(legacy) + '\n');
  console.log('legacy entities without a source: ' + legacy.length + (before ? ' (was ' + before.length + ')' : ''));
}
