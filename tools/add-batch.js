#!/usr/bin/env node
/* Adds a batch file INTO the live bank (data/entities.json + data/prompts.json) without rebuilding from scratch:
 * - new entities are appended; an entity id that already exists keeps its stored fact/name/kind and only gains aliases
 * - prompt answers are unioned (an entity already on the prompt keeps its stored tier)
 * - new prompts must exist in data/prompt-seeds.json
 * Usage: node tools/add-batch.js data/batches/topup-A.json [more.json ...]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const dive = require(path.join(__dirname, '..', 'shared', 'dive.js'));
const { validateData } = require('./validate-data.js');
const ROOT = path.join(__dirname, '..');
const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node tools/add-batch.js <batch.json> ...'); process.exit(2); }
const seeds = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'prompt-seeds.json'), 'utf8'));
const seedById = Object.fromEntries(seeds.map(s => [s.id, s]));
const entities = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'entities.json'), 'utf8'));
const prompts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'prompts.json'), 'utf8'));
const byId = Object.fromEntries(entities.map(e => [e.id, e]));
const promptById = Object.fromEntries(prompts.map(p => [p.id, p]));
let added = 0, aliased = 0, answersAdded = 0, promptsAdded = 0;
for (const f of files) {
  const batch = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const e of batch.entities) {
    if (!byId[e.id]) { byId[e.id] = { id: e.id, name: e.name.trim(), aliases: [], kind: e.kind, group: e.group, fact: e.fact.trim() }; entities.push(byId[e.id]); added++; }
    const cur = byId[e.id];
    const have = new Set(cur.aliases.map(dive.normalise)); have.add(dive.normalise(cur.name));
    for (const a of (e.aliases || []).concat(dive.normalise(e.name) !== dive.normalise(cur.name) ? [e.name] : [])) {
      const n = dive.normalise(a); if (!n || have.has(n)) continue; have.add(n); cur.aliases.push(a.trim()); aliased++;
    }
  }
  for (const p of batch.prompts) {
    if (!seedById[p.id]) { console.log('skip unknown prompt ' + p.id); continue; }
    let target = promptById[p.id];
    if (!target) { const s = seedById[p.id]; target = { id: s.id, text: s.text, group: s.group, difficulty: s.difficulty, answers: [] }; prompts.push(target); promptById[p.id] = target; promptsAdded++; }
    const hasHadal = target.answers.some(a => a.tier === 'hadal');
    for (const a of p.answers) {
      if (!byId[a.entity]) { console.log('skip ' + p.id + ': unknown entity ' + a.entity); continue; }
      if (target.answers.some(x => x.entity === a.entity)) continue;
      const tier = (a.tier === 'hadal' && hasHadal) ? 'midnight' : a.tier;    // the stored hadal stays the hadal
      target.answers.push({ entity: a.entity, tier }); answersAdded++;
    }
  }
}
// seed text/taxon/min updates flow into prompts.json
for (const p of prompts) { const s = seedById[p.id]; if (s) { p.text = s.text; p.group = s.group; p.difficulty = s.difficulty; if (s.taxon) p.taxon = s.taxon; if (s.taxonFilter) p.taxonFilter = s.taxonFilter; } }
const order = seeds.map(s => s.id);
prompts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
fs.writeFileSync(path.join(ROOT, 'data', 'entities.json'), JSON.stringify(entities.sort((a, b) => a.id < b.id ? -1 : 1), null, 1) + '\n');
fs.writeFileSync(path.join(ROOT, 'data', 'prompts.json'), JSON.stringify(prompts, null, 1) + '\n');
console.log('added ' + added + ' entities, ' + aliased + ' aliases, ' + answersAdded + ' answers, ' + promptsAdded + ' prompts');
const res = validateData({ allowPartial: true });
for (const e of res.errors) console.log('ERROR: ' + e);
console.log((res.ok ? 'OK' : 'FAILED') + ': ' + JSON.stringify(res.counts));
