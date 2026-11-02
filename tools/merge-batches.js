#!/usr/bin/env node
/* Merges every data/batches/*.json into data/entities.json and data/prompts.json.
 * - entities with the same id merge: aliases are unioned, the first name/kind/group/fact win
 * - an entity whose canonical name equals another entity's name/alias is reported
 * - inside one prompt, an alias that collides with another entity is dropped from the lower-tier entity (warning)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const dive = require(path.join(__dirname, '..', 'shared', 'dive.js'));

const ROOT = path.join(__dirname, '..');
const seeds = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'prompt-seeds.json'), 'utf8'));
const batchDir = process.env.BATCH_DIR ? path.resolve(process.env.BATCH_DIR) : path.join(ROOT, 'data', 'batches');
const files = fs.readdirSync(batchDir).filter(f => f.endsWith('.json')).sort();
if (!files.length) { console.error('no batch files'); process.exit(1); }

const entities = {};        // id -> entity
const promptAnswers = {};   // promptId -> [{entity, tier}]
const warnings = [];

for (const f of files) {
  const batch = JSON.parse(fs.readFileSync(path.join(batchDir, f), 'utf8'));
  for (const e of batch.entities) {
    if (!entities[e.id]) {
      entities[e.id] = { id: e.id, name: e.name.trim(), aliases: [], kind: e.kind, group: e.group, fact: e.fact.trim() };
    } else {
      const cur = entities[e.id];
      if (cur.kind !== e.kind) warnings.push(f + ': ' + e.id + ' kind differs (' + cur.kind + ' vs ' + e.kind + '), keeping ' + cur.kind);
      if (dive.normalise(cur.name) !== dive.normalise(e.name)) warnings.push(f + ': ' + e.id + ' name differs ("' + cur.name + '" vs "' + e.name + '"), keeping first');
      if (cur.fact !== e.fact.trim()) warnings.push(f + ': ' + e.id + ' has a second fact, keeping first');
    }
    const cur = entities[e.id];
    const have = new Set(cur.aliases.map(dive.normalise));
    have.add(dive.normalise(cur.name));
    for (const a of (e.aliases || [])) {
      const n = dive.normalise(a);
      if (!n || have.has(n)) continue;
      have.add(n);
      cur.aliases.push(a.trim());
    }
    if (dive.normalise(e.name) !== dive.normalise(cur.name) && !have.has(dive.normalise(e.name))) { cur.aliases.push(e.name.trim()); have.add(dive.normalise(e.name)); }
  }
  for (const p of batch.prompts) {
    if (!promptAnswers[p.id]) promptAnswers[p.id] = [];
    for (const a of p.answers) {
      if (!promptAnswers[p.id].some(x => x.entity === a.entity)) promptAnswers[p.id].push({ entity: a.entity, tier: a.tier });
      else warnings.push(f + ': ' + p.id + ' repeats ' + a.entity + ' (already present from another file)');
    }
  }
}

// Cross-entity name collisions (two ids for the same thing)
const nameOwner = new Map();
for (const e of Object.values(entities)) {
  const forms = [e.name].concat(e.aliases).map(dive.normalise);
  for (const n of forms) {
    const owner = nameOwner.get(n);
    if (owner && owner !== e.id) warnings.push('global: "' + n + '" belongs to both ' + owner + ' and ' + e.id);
    else nameOwner.set(n, e.id);
  }
}

// Within-prompt alias collisions: drop the alias from the lower-tier entity
const tierPoints = Object.fromEntries(dive.TIERS.map(t => [t.code, t.points]));
for (const [pid, answers] of Object.entries(promptAnswers)) {
  const formOwner = new Map();
  for (const a of answers.slice().sort((x, y) => tierPoints[y.tier] - tierPoints[x.tier])) {   // higher tier claims first? no: canonical names must win
    const ent = entities[a.entity];
    if (!ent) continue;
    for (const form of dive.pluralForms(dive.normalise(ent.name))) formOwner.set(form, a.entity);
  }
  for (const a of answers) {
    const ent = entities[a.entity];
    if (!ent) continue;
    ent.aliases = ent.aliases.filter(alias => {
      const n = dive.normalise(alias);
      for (const form of dive.pluralForms(n)) {
        const owner = formOwner.get(form);
        if (owner && owner !== a.entity) {
          warnings.push(pid + ': dropped alias "' + alias + '" from ' + a.entity + ' (collides with ' + owner + ')');
          return false;
        }
      }
      for (const form of dive.pluralForms(n)) if (!formOwner.has(form)) formOwner.set(form, a.entity);
      return true;
    });
  }
}

const entityList = Object.values(entities).sort((a, b) => a.id < b.id ? -1 : 1);
const prompts = seeds.map(s => ({ id: s.id, text: s.text, group: s.group, difficulty: s.difficulty, answers: promptAnswers[s.id] || [] }));

fs.writeFileSync(path.join(ROOT, 'data', 'entities.json'), JSON.stringify(entityList, null, 1) + '\n');
fs.writeFileSync(path.join(ROOT, 'data', 'prompts.json'), JSON.stringify(prompts, null, 1) + '\n');

for (const w of warnings) console.log('warn: ' + w);
const missing = prompts.filter(p => p.answers.length === 0).map(p => p.id);
console.log('merged ' + files.length + ' files: ' + entityList.length + ' entities, ' + prompts.filter(p => p.answers.length).length + '/' + prompts.length + ' prompts with answers');
if (missing.length) console.log('prompts still without answers: ' + missing.join(', '));
