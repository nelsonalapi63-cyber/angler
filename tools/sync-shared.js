#!/usr/bin/env node
/* Copies shared/dive.js next to every Edge Function that scores or describes dives, so there is ONE copy of the
 * rules in the repository and each function folder is self-contained for `supabase functions deploy` (and for the
 * Supabase MCP deploy, which uploads a folder's files by name). The answer bank itself is not copied any more:
 * tools/upload-bank.js puts it in the `bank` table, where the functions read it. Run before every deploy. */
'use strict';
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const FUNCTIONS = ['submit-dive', 'send-reminders', 'weekly-recap', 'duel'];
for (const fn of FUNCTIONS) {
  const dst = path.join(ROOT, 'supabase', 'functions', fn, 'dive.js');
  fs.copyFileSync(path.join(ROOT, 'shared', 'dive.js'), dst);
  console.log('copied shared/dive.js -> supabase/functions/' + fn + '/dive.js');
}
// the duel rules travel with the duel function
fs.copyFileSync(path.join(ROOT, 'shared', 'duel.js'), path.join(ROOT, 'supabase', 'functions', 'duel', 'duel.js'));
console.log('copied shared/duel.js -> supabase/functions/duel/duel.js');
const legacy = path.join(ROOT, 'supabase', 'functions', '_shared');
if (fs.existsSync(legacy)) { fs.rmSync(legacy, { recursive: true, force: true }); console.log('removed supabase/functions/_shared (the bank lives in the database now)'); }
