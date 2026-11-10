#!/usr/bin/env node
'use strict';
/* Audits the answers a tools/bank/build.js run added and removes the two kinds that slipped past earlier builds:
 *  1. an answer outside the question's reference group — a question built from a specific list (sharks, rays,
 *     cetaceans…) may only carry answers that list knows by name or scientific name ("Bowfin", alias "dogfish", is
 *     not an Atlantic shark);
 *  2. a duplicate — the same species (scientific name) or the same Wikipedia article as another answer on the same
 *     question ("Maneater" for the great white shark). The hand-written answer stays; the added one goes.
 * A v4 entity nothing references afterwards is dropped from data/entities.json. Questions that fall under 75 are
 * topped up again by the next build. Needs tools/bank/backup/prompts.json (the pre-v4 bank) to tell added answers
 * from hand-written ones; without it, every sourced answer counts as added.
 *   node tools/bank/audit.js [--dry] */
const fs = require('fs');
const path = require('path');
const dive = require('../../shared/dive.js');
const { Q, REPLACE } = require('./questions.js');

const ROOT = path.join(__dirname, '..', '..');
const DRY = process.argv.includes('--dry');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const entities = read('entities.json');
const prompts = read('prompts.json');
const taxa = read('taxa.json');
const byId = Object.fromEntries(entities.map(e => [e.id, e]));
const backupPath = path.join(__dirname, 'backup', 'prompts.json');
const backup = fs.existsSync(backupPath) ? Object.fromEntries(JSON.parse(fs.readFileSync(backupPath, 'utf8')).map(p => [p.id, new Set(p.answers.map(a => a.entity))])) : null;
const BROAD = ['fish', 'freshwater-fish', 'deep-sea', 'sea-creatures'];
const BINOMIAL = /^[A-Z][a-z]+ [a-z]+$/;
const norm = dive.normalise;

const listedCache = new Map();
function listed(groups) {
  const key = groups.join('|');
  if (!listedCache.has(key)) { const set = new Set(); for (const g of groups) for (const n of (taxa[g] || [])) set.add(norm(n)); listedCache.set(key, set); }
  return listedCache.get(key);
}
const added = (p, a) => backup ? !(backup[p.id] && backup[p.id].has(a.entity)) : !!(byId[a.entity] && byId[a.entity].source);
function sciOf(e) {
  const m = /summary page for ([A-Z][a-z]+ [a-z]+)/.exec(e.source || '');
  if (m) return norm(m[1]);
  const b = (e.aliases || []).find(a => BINOMIAL.test(a));
  return b ? norm(b) : null;
}
function titleOf(e) { const m = /^Wikipedia: (.+) \(CC BY-SA 4\.0\)$/.exec(e.source || ''); return m ? norm(m[1]) : null; }
function keysOf(e) {
  const keys = new Set([norm(e.name)].concat((e.aliases || []).map(norm)));
  const sci = sciOf(e); if (sci) keys.add(sci);
  const title = titleOf(e); if (title) keys.add(title);
  return keys;
}

const report = { outOfGroup: [], duplicates: [], under: [] };
for (const p of prompts) {
  const cfg = Q[p.id] || REPLACE.find(r => r.id === p.id) || null;
  const groups = cfg && cfg.groups && !cfg.list ? cfg.groups : null;
  const strict = groups && !groups.some(g => BROAD.includes(g)) ? listed(groups) : null;
  const keep = [];
  const seen = [];                                                  // keys of answers kept so far, hand-written first
  const ordered = p.answers.map((a, i) => ({ a, i, added: added(p, a) })).sort((x, y) => (x.added - y.added) || (x.i - y.i));
  const removed = new Set();
  for (const { a, added: isAdded } of ordered) {
    const e = byId[a.entity];
    if (!e) { keep.push(a); continue; }
    if (isAdded && strict && !strict.has(norm(e.name)) && !(e.aliases || []).some(x => strict.has(norm(x)))) { removed.add(a.entity); report.outOfGroup.push(p.id + ': ' + e.name); continue; }
    const keys = keysOf(e);
    const dupKeys = [sciOf(e), titleOf(e)].filter(Boolean);
    if (isAdded && dupKeys.some(k => seen.some(s => s.has(k)))) { removed.add(a.entity); report.duplicates.push(p.id + ': ' + e.name); continue; }
    if (isAdded && seen.some(s => [...keys].some(k => k && s.has(k) && (BINOMIAL.test(k) || k === norm(e.name))))) { removed.add(a.entity); report.duplicates.push(p.id + ': ' + e.name); continue; }
    seen.push(keys);
    keep.push(a);
  }
  if (removed.size) p.answers = p.answers.filter(a => !removed.has(a.entity));
  if (!p.retired && p.answers.length < 75) report.under.push(p.id + ' (' + p.answers.length + ')');
}
const referenced = new Set();
for (const p of prompts) for (const a of p.answers) referenced.add(a.entity);
const before = entities.length;
const kept = entities.filter(e => referenced.has(e.id) || !e.source);
if (!DRY) {
  fs.writeFileSync(path.join(ROOT, 'data', 'prompts.json'), JSON.stringify(prompts, null, 1) + '\n');
  fs.writeFileSync(path.join(ROOT, 'data', 'entities.json'), JSON.stringify(kept, null, 1) + '\n');
}
console.log((DRY ? '[dry] ' : '') + 'out of group: ' + report.outOfGroup.length + '; duplicates: ' + report.duplicates.length + '; entities dropped: ' + (before - kept.length) + '; questions now under 75: ' + report.under.length);
for (const line of report.outOfGroup.slice(0, 40)) console.log('  group  ' + line);
for (const line of report.duplicates.slice(0, 40)) console.log('  dup    ' + line);
if (report.under.length) console.log('  under: ' + report.under.join(', '));
