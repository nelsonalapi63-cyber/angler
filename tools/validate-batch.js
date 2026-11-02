#!/usr/bin/env node
/* Validates one answer-bank batch (or the merged data set) against the rules in docs/SPEC.md §5.
 * Usage: node tools/validate-batch.js data/batches/batchA.json [--expect id1,id2,...]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const dive = require(path.join(__dirname, '..', 'shared', 'dive.js'));

const MIN_ANSWERS = 25;
const KINDS = new Set(['creature', 'plant', 'place', 'vessel', 'person']);
const TIER_CODES = new Set(dive.TIERS.map(t => t.code));
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FACT_MIN = 20, FACT_MAX = 240;
const MAX_ALIASES = 14;

function validateBatch(batch, seeds, knownEntities, expectedPromptIds) {
  const errors = [];
  const warnings = [];
  const seedById = Object.fromEntries(seeds.map(s => [s.id, s]));
  const entities = {};
  for (const [id, e] of Object.entries(knownEntities || {})) entities[id] = e;

  if (!batch || !Array.isArray(batch.entities) || !Array.isArray(batch.prompts)) {
    return { ok: false, errors: ['batch must be {entities:[], prompts:[]}'], warnings };
  }

  // ---- entities
  const seenIds = new Set();
  for (const e of batch.entities) {
    const where = 'entity ' + (e && e.id);
    if (!e || typeof e !== 'object') { errors.push('entity is not an object'); continue; }
    if (!SLUG_RE.test(e.id || '')) errors.push(where + ': id must be a slug like great-white-shark');
    if (seenIds.has(e.id)) errors.push(where + ': duplicate id inside batch');
    seenIds.add(e.id);
    if (!e.name || typeof e.name !== 'string') errors.push(where + ': missing name');
    if (!Array.isArray(e.aliases)) errors.push(where + ': aliases must be an array (can be empty)');
    else if (e.aliases.length > MAX_ALIASES) errors.push(where + ': too many aliases (max ' + MAX_ALIASES + ')');
    if (!KINDS.has(e.kind)) errors.push(where + ': kind must be one of ' + Array.from(KINDS).join(', '));
    if (!e.group || typeof e.group !== 'string') errors.push(where + ': missing group');
    const fact = (e.fact || '').trim();
    if (fact.length < FACT_MIN || fact.length > FACT_MAX) errors.push(where + ': fact must be ' + FACT_MIN + '-' + FACT_MAX + ' characters');
    if (/\n/.test(fact)) errors.push(where + ': fact must be one line');
    if (fact && !/[.!?]$/.test(fact)) errors.push(where + ': fact must end with a full stop');
    if (e.name && dive.normalise(e.name) === '') errors.push(where + ': name normalises to nothing');
    entities[e.id] = e;
  }

  // ---- prompts
  const seenPrompts = new Set();
  for (const p of batch.prompts) {
    const where = 'prompt ' + (p && p.id);
    if (!p || !seedById[p.id]) { errors.push(where + ': unknown prompt id (must be in data/prompt-seeds.json)'); continue; }
    if (seenPrompts.has(p.id)) errors.push(where + ': listed twice');
    seenPrompts.add(p.id);
    if (!Array.isArray(p.answers)) { errors.push(where + ': answers must be an array'); continue; }
    if (p.answers.length < MIN_ANSWERS) errors.push(where + ': only ' + p.answers.length + ' answers, need at least ' + MIN_ANSWERS);
    let hadal = 0;
    const tierCounts = {};
    const usedEntities = new Set();
    const formOwner = new Map();   // normalised alias form -> entity id
    const nameOwner = new Map();   // normalised canonical name form -> entity id
    for (const a of p.answers) {
      if (!a || !a.entity || !TIER_CODES.has(a.tier)) { errors.push(where + ': bad answer ' + JSON.stringify(a)); continue; }
      if (a.tier === 'hadal') hadal++;
      tierCounts[a.tier] = (tierCounts[a.tier] || 0) + 1;
      if (usedEntities.has(a.entity)) errors.push(where + ': entity ' + a.entity + ' listed twice');
      usedEntities.add(a.entity);
      const ent = entities[a.entity];
      if (!ent) { errors.push(where + ': answer references unknown entity ' + a.entity); continue; }
      // two entities with the same canonical name in one prompt is an error; a shared alias is only a
      // warning, because the matcher gives it to the canonical owner or the lower-tier entity
      const nameNorm = dive.normalise(ent.name);
      for (const form of dive.pluralForms(nameNorm)) {
        const owner = nameOwner.get(form);
        if (owner && owner !== a.entity) errors.push(where + ': entities ' + a.entity + ' and ' + owner + ' have the same name');
        else nameOwner.set(form, a.entity);
      }
      for (const raw of (ent.aliases || [])) {
        const norm = dive.normalise(raw);
        if (!norm) continue;
        for (const form of dive.pluralForms(norm)) {
          const owner = formOwner.get(form) || nameOwner.get(form);
          if (owner && owner !== a.entity) warnings.push(where + ': alias "' + raw + '" is shared by ' + a.entity + ' and ' + owner);
          else if (!formOwner.has(form)) formOwner.set(form, a.entity);
        }
      }
    }
    if (hadal !== 1) errors.push(where + ': must have exactly one hadal answer, found ' + hadal);
    if ((tierCounts.tidepool || 0) < 2) warnings.push(where + ': fewer than 2 tidepool answers');
    if ((tierCounts.baitball || 0) < 1) warnings.push(where + ': no baitball answer');
    if ((tierCounts.midnight || 0) < 2) warnings.push(where + ': fewer than 2 midnight answers');
  }

  if (expectedPromptIds) {
    for (const id of expectedPromptIds) if (!seenPrompts.has(id)) errors.push('prompt ' + id + ': missing from batch');
  }
  // orphan entities (only meaningful for a single batch)
  const referenced = new Set();
  for (const p of batch.prompts) for (const a of (p.answers || [])) referenced.add(a.entity);
  for (const e of batch.entities) if (!referenced.has(e.id)) warnings.push('entity ' + e.id + ' is not used by any prompt');

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validateBatch, MIN_ANSWERS, KINDS, FACT_MIN, FACT_MAX };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node tools/validate-batch.js <batch.json> [--expect a,b,c]'); process.exit(2); }
  const seeds = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'prompt-seeds.json'), 'utf8'));
  let batch;
  try { batch = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error('JSON does not parse: ' + e.message); process.exit(1); }
  const ex = process.argv.indexOf('--expect');
  const expected = ex > -1 ? process.argv[ex + 1].split(',') : null;
  const res = validateBatch(batch, seeds, {}, expected);
  for (const w of res.warnings) console.log('warn: ' + w);
  for (const e of res.errors) console.log('ERROR: ' + e);
  console.log(res.ok ? 'OK: ' + batch.prompts.length + ' prompts, ' + batch.entities.length + ' entities' : 'FAILED with ' + res.errors.length + ' errors');
  process.exit(res.ok ? 0 : 1);
}
