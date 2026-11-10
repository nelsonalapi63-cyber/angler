#!/usr/bin/env node
'use strict';
/* Two repairs on data/entities.json after a tools/bank/build.js run, both offline (cache only):
 *  1. hand-written (pre-v4) entities get their own fact back and lose any `source` an earlier build gave them —
 *     the page-derived fact replaced prose nobody asked to lose, and a source is only honest for the fact it produced
 *     (needs tools/bank/backup/entities.json, the pre-v4 snapshot; skipped when it is absent);
 *  2. v4 facts that were cut inside a word by the old clampFact (…"on the IUCN ." / "Red Lis.") are rebuilt from the
 *     cached record with the same speciesFact / thingFact the builder uses, now cutting on a word boundary.
 *   node tools/bank/refresh-facts.js [--dry] */
const fs = require('fs');
const path = require('path');
const { readRec } = require('./resolve.js');
const { speciesFact, thingFact } = require('./build.js');
const { Q, REPLACE } = require('./questions.js');

const ROOT = path.join(__dirname, '..', '..');
const DRY = process.argv.includes('--dry');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const entities = read('entities.json');
const prompts = read('prompts.json');
const backupPath = path.join(__dirname, 'backup', 'entities.json');
const backup = fs.existsSync(backupPath) ? new Map(JSON.parse(fs.readFileSync(backupPath, 'utf8')).map(e => [e.id, e])) : null;
// the marks of a fact cut short: a lone full stop, the full width, a dangling function word, or a status clause without its end
const parse = require('./parse.js');
const suspect = (f) => / \.$/.test(f) || f.length >= 239 || parse.DANGLING.test(f.replace(/\.$/, '')) || (/listed as/.test(f) && !/Red List\.$/.test(f));
const configFor = (promptId) => Q[promptId] || REPLACE.find(r => r.id === promptId) || null;

let restored = 0, refreshed = 0, stuck = 0;
if (backup) {
  for (const e of entities) {
    const b = backup.get(e.id);
    if (!b || !e.source) continue;
    e.fact = b.fact; delete e.source; restored++;
  }
}
// a list item "Title|Display" is cached under its title; map displays back to titles so such records can be found
const listTitles = new Map();
for (const f of fs.readdirSync(path.join(__dirname, 'lists'))) {
  if (!f.endsWith('.json')) continue;
  for (const item of JSON.parse(fs.readFileSync(path.join(__dirname, 'lists', f), 'utf8'))) { const [title, display] = String(item).split('|'); if (display) listTitles.set(display, title); }
}
const usedBy = {};
for (const p of prompts) for (const a of p.answers) (usedBy[a.entity] = usedBy[a.entity] || []).push(p.id);
for (const e of entities) {
  if (!e.source || !suspect(e.fact)) continue;
  const isSpecies = /summary page for/.test(e.source);           // a FishBase / SeaLifeBase fact; anything else came from a Wikipedia article
  let fact = null;
  if (isSpecies) {
    const rec = readRec('sp', e.name) || (e.aliases || []).map(a => readRec('sp', a)).find(Boolean);
    if (rec && rec.fb) {
      const res = Object.assign({}, rec, { name: e.name });
      for (const pid of usedBy[e.id] || []) { const cfg = configFor(pid); const re = cfg && cfg.fb && cfg.fb._re; if (re) { fact = speciesFact(res, re); if (fact) break; } }
      if (!fact) fact = speciesFact(res, null);
    }
  } else {
    const title = (/^Wikipedia: (.+) \(CC BY-SA 4\.0\)$/.exec(e.source) || [])[1];
    const rec = readRec('th', e.name) || (title ? readRec('th', title) : null) || (listTitles.has(e.name) ? readRec('th', listTitles.get(e.name)) : null) || (e.aliases || []).map(a => readRec('th', a)).find(Boolean);
    if (rec) fact = thingFact(rec);
  }
  if (fact && fact !== e.fact) { e.fact = fact; refreshed++; } else stuck++;
}
if (!DRY) fs.writeFileSync(path.join(ROOT, 'data', 'entities.json'), JSON.stringify(entities, null, 1) + '\n');
console.log((DRY ? '[dry] ' : '') + 'restored ' + restored + ' hand-written facts' + (backup ? '' : ' (no backup: skipped)') + '; rebuilt ' + refreshed + ' cut facts' + (stuck ? '; ' + stuck + ' still suspect (no cached record)' : ''));
