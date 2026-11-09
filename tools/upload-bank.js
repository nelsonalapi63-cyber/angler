#!/usr/bin/env node
/* Uploads the answer bank to the `bank` table in Supabase, where the Edge Functions score dives with it:
 *   prompts  ← data/prompts.json       entities ← data/entities.json
 *   schedule ← data/schedule.json      taxa     ← data/taxa.json        version ← data/version.json
 * One row per key, through the bank-upload Edge Function, so the server always scores with the bank the players see.
 *
 * Usage: SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=... BANK_TOKEN=... node tools/upload-bank.js
 * BANK_TOKEN is the `bank_token` row of public.cron_settings (set once, in SETUP.md §2); it can write the bank and
 * nothing else. The deploy workflow runs this after every build when the three secrets exist. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const TOKEN = process.env.BANK_TOKEN;
const FILES = { prompts: 'data/prompts.json', entities: 'data/entities.json', schedule: 'data/schedule.json', taxa: 'data/taxa.json', version: 'data/version.json' };
const ORDER = ['taxa', 'entities', 'prompts', 'schedule', 'version'];   // version last: the functions re-read everything when it changes

async function put(key, data) {
  const res = await fetch(URL + '/functions/v1/bank-upload', {
    method: 'POST',
    headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'X-Bank-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, data }),
  });
  if (!res.ok) throw new Error(key + ': HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300));
}

(async () => {
  if (!URL || !ANON || !TOKEN) { console.error('set SUPABASE_URL, SUPABASE_ANON_KEY and BANK_TOKEN'); process.exit(2); }
  for (const key of ORDER) {
    const file = path.join(ROOT, FILES[key]);
    await put(key, JSON.parse(fs.readFileSync(file, 'utf8')));
    console.log('uploaded ' + key + ' (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
  }
  console.log('bank is up to date: version ' + JSON.parse(fs.readFileSync(path.join(ROOT, FILES.version), 'utf8')).version);
})().catch((e) => { console.error(e.message); process.exit(1); });
