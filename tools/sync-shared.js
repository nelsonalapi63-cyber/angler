#!/usr/bin/env node
/* Copies the files the Edge Functions need into supabase/functions/_shared so there is ONE source of truth:
 * shared/dive.js, data/prompts.json, data/entities.json. Run before `supabase functions deploy`. */
'use strict';
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'supabase', 'functions', '_shared');
fs.mkdirSync(OUT, { recursive: true });
for (const [src, dst] of [['shared/dive.js', 'dive.js'], ['data/prompts.json', 'prompts.json'], ['data/entities.json', 'entities.json']]) {
  fs.copyFileSync(path.join(ROOT, src), path.join(OUT, dst));
  console.log('copied ' + src + ' -> supabase/functions/_shared/' + dst);
}
