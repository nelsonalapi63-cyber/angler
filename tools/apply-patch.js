#!/usr/bin/env node
/* Applies a review patch (data/patches/*.json) to data/entities.json and data/prompts.json, then validates.
 * Patch shape: { facts:{id:fact}, removeFromPrompt:[{prompt,entity}], retier:[{prompt,entity,tier}],
 *                aliasAdd:[{entity,alias}], aliasRemove:[{entity,alias}], rename:{oldId:newId} }
 * Usage: node tools/apply-patch.js data/patches/review.json */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const dive = require(path.join(ROOT, 'shared', 'dive.js'));
const { validateData } = require('./validate-data.js');

const file = process.argv[2];
if (!file) { console.error('usage: node tools/apply-patch.js <patch.json>'); process.exit(2); }
const patch = JSON.parse(fs.readFileSync(file, 'utf8'));
const entities = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'entities.json'), 'utf8'));
const prompts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'prompts.json'), 'utf8'));
const byId = Object.fromEntries(entities.map(e => [e.id, e]));
const promptById = Object.fromEntries(prompts.map(p => [p.id, p]));
const log = [];
const TIERS = new Set(dive.TIERS.map(t => t.code));

for (const [id, fact] of Object.entries(patch.facts || {})) {
  if (!byId[id]) { log.push('skip fact: unknown entity ' + id); continue; }
  const f = String(fact).trim();
  if (f.length < 20 || f.length > 240 || !/[.!?]$/.test(f)) { log.push('skip fact: bad length/ending for ' + id); continue; }
  byId[id].fact = f; log.push('fact: ' + id);
}
for (const r of patch.removeFromPrompt || []) {
  const p = promptById[r.prompt];
  if (!p) { log.push('skip remove: unknown prompt ' + r.prompt); continue; }
  const before = p.answers.length;
  const wasHadal = p.answers.some(a => a.entity === r.entity && a.tier === 'hadal');
  const next = p.answers.filter(a => a.entity !== r.entity);
  if (next.length < 25) { log.push('skip remove: ' + r.prompt + ' would drop below 25 (' + r.entity + ')'); continue; }
  if (wasHadal && !(patch.retier || []).some(x => x.prompt === r.prompt && x.tier === 'hadal')) { log.push('skip remove: ' + r.prompt + ' would lose its hadal (' + r.entity + ')'); continue; }
  p.answers = next;
  if (next.length !== before) log.push('removed ' + r.entity + ' from ' + r.prompt + (r.reason ? ' (' + r.reason + ')' : ''));
}
for (const r of patch.retier || []) {
  const p = promptById[r.prompt];
  if (!p || !TIERS.has(r.tier)) { log.push('skip retier: bad prompt/tier ' + JSON.stringify(r)); continue; }
  const a = p.answers.find(x => x.entity === r.entity);
  if (!a) { log.push('skip retier: ' + r.entity + ' not in ' + r.prompt); continue; }
  if (r.tier === 'hadal') for (const other of p.answers) if (other.tier === 'hadal' && other.entity !== r.entity) other.tier = 'midnight';
  a.tier = r.tier; log.push('retier ' + r.entity + ' in ' + r.prompt + ' -> ' + r.tier);
}
for (const r of patch.aliasAdd || []) {
  const e = byId[r.entity];
  if (!e) { log.push('skip aliasAdd: unknown ' + r.entity); continue; }
  if (!e.aliases.some(x => dive.normalise(x) === dive.normalise(r.alias)) && dive.normalise(e.name) !== dive.normalise(r.alias)) { e.aliases.push(r.alias); log.push('alias + ' + r.alias + ' -> ' + r.entity); }
}
for (const r of patch.aliasRemove || []) {
  const e = byId[r.entity];
  if (!e) continue;
  const n = e.aliases.length;
  e.aliases = e.aliases.filter(x => dive.normalise(x) !== dive.normalise(r.alias));
  if (e.aliases.length !== n) log.push('alias - ' + r.alias + ' from ' + r.entity);
}
for (const [fromId, intoId] of Object.entries(patch.merge || {})) {   // same thing under two names → one entity
  const a = byId[fromId], b = byId[intoId];
  if (!a || !b) { log.push('skip merge ' + fromId + ' -> ' + intoId); continue; }
  const have = new Set(b.aliases.map(dive.normalise)); have.add(dive.normalise(b.name));
  for (const alias of [a.name].concat(a.aliases)) { const n = dive.normalise(alias); if (n && !have.has(n)) { b.aliases.push(alias); have.add(n); } }
  for (const p of prompts) {
    const hasInto = p.answers.some(x => x.entity === intoId);
    p.answers = p.answers.filter(x => !(x.entity === fromId && hasInto));
    for (const x of p.answers) if (x.entity === fromId) x.entity = intoId;
  }
  delete byId[fromId];
  log.push('merged ' + fromId + ' into ' + intoId);
}
for (const [oldId, newId] of Object.entries(patch.rename || {})) {
  if (!byId[oldId] || byId[newId]) { log.push('skip rename ' + oldId); continue; }
  byId[oldId].id = newId; byId[newId] = byId[oldId]; delete byId[oldId];
  for (const p of prompts) for (const a of p.answers) if (a.entity === oldId) a.entity = newId;
  log.push('rename ' + oldId + ' -> ' + newId);
}
for (const p of prompts) {
  const hadals = p.answers.filter(a => a.tier === 'hadal');
  if (hadals.length !== 1) log.push('WARNING ' + p.id + ' now has ' + hadals.length + ' hadal answers');
}
fs.writeFileSync(path.join(ROOT, 'data', 'entities.json'), JSON.stringify(Object.values(byId).sort((a, b) => a.id < b.id ? -1 : 1), null, 1) + '\n');
fs.writeFileSync(path.join(ROOT, 'data', 'prompts.json'), JSON.stringify(prompts, null, 1) + '\n');
log.forEach(l => console.log(l));
const res = validateData({});
for (const e of res.errors) console.log('ERROR: ' + e);
console.log((res.ok ? 'OK' : 'FAILED') + ' after patch: ' + JSON.stringify(res.counts));
process.exit(res.ok ? 0 : 1);
