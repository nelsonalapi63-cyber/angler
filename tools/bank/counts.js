#!/usr/bin/env node
'use strict';
/* The before/after answer-count table of the v4 bank build, as Markdown (stdout) — "before" is the pre-v4 snapshot
 * in tools/bank/backup/prompts.json when it exists, else the `before` of the last tools/bank/report.json.
 *   node tools/bank/counts.js > docs/BANK-V4-COUNTS.md */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const prompts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'prompts.json'), 'utf8'));
const entities = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'entities.json'), 'utf8'));
const backupPath = path.join(__dirname, 'backup', 'prompts.json');
const reportPath = path.join(__dirname, 'report.json');
const before = {};
if (fs.existsSync(backupPath)) for (const p of JSON.parse(fs.readFileSync(backupPath, 'utf8'))) before[p.id] = p.answers.length;
else if (fs.existsSync(reportPath)) for (const q of JSON.parse(fs.readFileSync(reportPath, 'utf8')).questions || []) before[q.id] = q.before;

const live = prompts.filter(p => !p.retired);
const retired = prompts.filter(p => p.retired);
const fresh = live.filter(p => before[p.id] == null);
const sourced = new Set(entities.filter(e => e.source).map(e => e.id));
const answersLive = live.reduce((n, p) => n + p.answers.length, 0);
const answersBefore = Object.values(before).reduce((n, c) => n + c, 0);
const sourcedAnswers = live.reduce((n, p) => n + p.answers.filter(a => sourced.has(a.entity)).length, 0);
const min = Math.min(...live.map(p => p.answers.length));
const row = (p) => '| ' + p.id + ' | ' + (before[p.id] == null ? '— (new)' : before[p.id]) + ' | ' + p.answers.length + (p.retired ? ' | retired' : ' | live') + ' |';

const out = [];
out.push('# ANGLER v4 — answer counts before and after the bank build');
out.push('');
out.push('Floor: every live question carries at least 75 hand-curated answers, each a real entity with one fact; answers added in v4 carry a `source`. A question that could not reach 75 is retired (never scheduled or dealt again; its answers stay for the archive and the days it was played on).');
out.push('');
out.push('| | Before (v3) | After (v4) |');
out.push('|---|---|---|');
out.push('| Live questions | ' + Object.keys(before).length + ' | ' + live.length + ' |');
out.push('| Answers on live questions | ' + answersBefore + ' | ' + answersLive + ' |');
out.push('| Smallest live question | ' + Math.min(...Object.values(before)) + ' | ' + min + ' |');
out.push('| Answers with a source | 0 | ' + sourcedAnswers + ' |');
out.push('| Entities | ' + (fs.existsSync(path.join(__dirname, 'backup', 'entities.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'backup', 'entities.json'), 'utf8')).length : '?') + ' | ' + entities.length + ' |');
out.push('| Retired questions | 0 | ' + retired.length + ' |');
out.push('| New questions | — | ' + fresh.length + ' |');
out.push('');
out.push('## Every question');
out.push('');
out.push('| Question | Before | After | |');
out.push('|---|---|---|---|');
for (const p of prompts.slice().sort((a, b) => a.id.localeCompare(b.id))) out.push(row(p));
out.push('');
out.push('Retired: ' + (retired.map(p => p.id).join(', ') || 'none') + '.');
out.push('');
out.push('New: ' + (fresh.map(p => p.id).join(', ') || 'none') + '.');
process.stdout.write(out.join('\n') + '\n');
