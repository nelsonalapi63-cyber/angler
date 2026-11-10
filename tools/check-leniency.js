#!/usr/bin/env node
/* ANGLER — leniency collision report. Applies the matcher in shared/dive.js to every answer of every question and
 * reports:
 *   names      every entity NAME that resolves to a DIFFERENT entity than its own — must be zero before shipping
 *   aliases    aliases that resolve elsewhere (a shared alias goes to the more generic answer by design; listed for review)
 *   ambiguous  short forms two answers of one question would both claim (the game offers both as "did you mean")
 *   guesses    the 50 most common rejected guesses from the admin RPC, when the project is reachable
 * Usage: node tools/check-leniency.js [--report tests/reports/leniency-report.txt]
 * The admin part needs SUPABASE_URL, SUPABASE_ANON_KEY and ADMIN_JWT (a signed-in admin's access token; Settings →
 * copy from localStorage key fathom.v1.session) in the environment; without them it is skipped with a note.
 * Exit code 1 when a name collision exists. */
'use strict';
const fs = require('fs');
const path = require('path');
const dive = require(path.join(__dirname, '..', 'shared', 'dive.js'));

const ROOT = path.join(__dirname, '..');
const TOP_GUESSES = 50;

// prompts: data/prompts.json shape; entities: array; taxa: { group: [names] }
function collisions(prompts, entities, taxa) {
  const byId = Object.fromEntries(entities.map(e => [e.id, e]));
  const names = [], aliases = [], ambiguous = [];
  let checked = 0;
  for (const p of prompts) {
    if (!p.answers || !p.answers.length) continue;
    const index = dive.buildIndex(p, byId, taxa);
    for (const a of p.answers) {
      const e = byId[a.entity];
      if (!e) continue;
      checked++;
      const m = dive.matchAnswer(e.name, index);
      if (m.entityId !== e.id) names.push({ prompt: p.id, typed: e.name, own: e.id, got: m.entityId, via: m.via });
      for (const al of e.aliases || []) {
        const am = dive.matchAnswer(al, index);
        if (am.entityId !== e.id) aliases.push({ prompt: p.id, typed: al, own: e.id, got: am.entityId, via: am.via });
      }
    }
    for (const [form, claims] of index.ambiguous || []) ambiguous.push({ prompt: p.id, form, answers: claims.map(c => c.entityId) });
  }
  return { checked, names, aliases, ambiguous };
}

async function rejectedGuesses(prompts) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY, jwt = process.env.ADMIN_JWT;
  if (!url || !key || !jwt) return { skipped: 'set SUPABASE_URL, SUPABASE_ANON_KEY and ADMIN_JWT to include the rejected guesses' };
  const all = [];
  for (const p of prompts) {
    const res = await fetch(url + '/rest/v1/rpc/admin_rejected_guesses', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_prompt: p.id, p_days: 30 }) });
    if (!res.ok) return { skipped: 'admin_rejected_guesses returned HTTP ' + res.status + ' (is ADMIN_JWT an admin session?)' };
    const rows = await res.json();
    for (const r of rows || []) all.push({ prompt: p.id, guess: r.guess, n: Number(r.n) });
  }
  all.sort((a, b) => b.n - a.n || a.guess.localeCompare(b.guess));
  // what the new matcher would now do with each of them
  const byId = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'entities.json'), 'utf8')).map(e => [e.id, e]));
  const taxa = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'taxa.json'), 'utf8'));
  const promptsById = dive.byId(prompts);
  return { rows: all.slice(0, TOP_GUESSES).map(r => { const m = dive.matchAnswer(r.guess, dive.buildIndex(promptsById[r.prompt], byId, taxa)); return Object.assign(r, { now: m.entityId ? m.entityId + ' (' + m.via + ')' : m.ambiguous ? 'ambiguous: ' + m.ambiguous.map(a => a.entityId).join(', ') : 'still rejected' }); }) };
}

function format(r, guesses, meta) {
  const lines = [];
  lines.push('ANGLER leniency collision report — ' + new Date().toISOString().slice(0, 10));
  lines.push('rules: optional group words (' + dive.GROUP_WORDS.join(', ') + '); spaced glued names; unambiguous only; typos ' + dive.FUZZY_BANDS.map(b => b[2] + ' edit' + (b[2] > 1 ? 's' : '') + ' for ' + b[0] + (b[1] === Infinity ? '+' : '–' + b[1]) + ' letters').join(', ') + '; never under ' + dive.FUZZY_MIN_LETTERS + ' letters');
  lines.push('checked ' + r.checked + ' answers across ' + meta.prompts + ' questions (' + meta.entities + ' entities, ' + meta.taxa + ' reference names)');
  lines.push('');
  lines.push('NAME COLLISIONS (must be zero): ' + r.names.length);
  for (const n of r.names) lines.push('  ' + n.prompt + ': "' + n.typed + '" (' + n.own + ') → ' + n.got + ' via ' + n.via);
  lines.push('');
  lines.push('ALIAS COLLISIONS (shared aliases go to the more generic answer by design; review): ' + r.aliases.length);
  for (const n of r.aliases.slice(0, 80)) lines.push('  ' + n.prompt + ': "' + n.typed + '" (' + n.own + ') → ' + n.got + ' via ' + n.via);
  if (r.aliases.length > 80) lines.push('  … ' + (r.aliases.length - 80) + ' more');
  lines.push('');
  lines.push('AMBIGUOUS SHORT FORMS (offered as "did you mean" chips): ' + r.ambiguous.length);
  for (const a of r.ambiguous.slice(0, 80)) lines.push('  ' + a.prompt + ': "' + a.form + '" → ' + a.answers.join(' | '));
  if (r.ambiguous.length > 80) lines.push('  … ' + (r.ambiguous.length - 80) + ' more');
  lines.push('');
  if (guesses.skipped) lines.push('REJECTED GUESSES: skipped — ' + guesses.skipped);
  else {
    lines.push('TOP ' + TOP_GUESSES + ' REJECTED GUESSES (last 30 days) and what the new matcher does with them:');
    for (const g of guesses.rows) lines.push('  ' + String(g.n).padStart(5) + '  ' + g.prompt + ': "' + g.guess + '" → ' + g.now);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const prompts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'prompts.json'), 'utf8')).filter(p => p.answers && p.answers.length);
  const entities = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'entities.json'), 'utf8'));
  const taxa = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'taxa.json'), 'utf8'));
  const t0 = Date.now();
  const r = collisions(prompts, entities, taxa);
  const guesses = await rejectedGuesses(prompts);
  const text = format(r, guesses, { prompts: prompts.length, entities: entities.length, taxa: Object.values(taxa).reduce((n, l) => n + l.length, 0) });
  const i = process.argv.indexOf('--report');
  const out = i > -1 && process.argv[i + 1] ? process.argv[i + 1] : path.join('tests', 'reports', 'leniency-report.txt');
  fs.mkdirSync(path.dirname(path.join(ROOT, out)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, out), text);
  process.stdout.write(text.split('\n').slice(0, 6).join('\n') + '\n… full report in ' + out + ' (' + (Date.now() - t0) + ' ms)\n');
  if (r.names.length) { console.error('FAIL: ' + r.names.length + ' name collision(s)'); process.exit(1); }
}

module.exports = { collisions, rejectedGuesses, format };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
