#!/usr/bin/env node
/* Merges the reference lists in data/taxa/<group>.json into data/taxa.json (the safety net for species prompts).
 * Each list is an array of common names. Names are de-duplicated on their normalised form, very short names are
 * dropped, and the output is sorted so diffs stay readable. Usage: node tools/merge-taxa.js */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const dive = require(path.join(ROOT, 'shared', 'dive.js'));
const MIN_LEN = 4;                       // "Aba" is a real fish, but three-letter names collide with typos of everything
const dir = path.join(ROOT, 'data', 'taxa');
const out = {};
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const group = f.slice(0, -5);
  const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const list = Array.isArray(raw) ? raw : (raw.names || []);
  const seen = new Set();
  const kept = [];
  for (const name of list) {
    const norm = dive.normalise(name);
    if (!norm || norm.length < MIN_LEN || seen.has(norm)) continue;
    seen.add(norm);
    kept.push(String(name).trim());
  }
  kept.sort((a, b) => a.localeCompare(b));
  out[group] = kept;
  console.log(group.padEnd(14), list.length + ' -> ' + kept.length);
}
fs.writeFileSync(path.join(ROOT, 'data', 'taxa.json'), JSON.stringify(out, null, 0).replace(/\],"/g, '],\n"') + '\n');
console.log('wrote data/taxa.json (' + Object.keys(out).length + ' groups, ' + Math.round(fs.statSync(path.join(ROOT, 'data', 'taxa.json')).size / 1024) + ' KB)');
