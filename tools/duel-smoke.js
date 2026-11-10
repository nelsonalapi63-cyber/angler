#!/usr/bin/env node
'use strict';
/* ANGLER — live smoke test of the `duel` Edge Function.
 * Plays a two-player room end to end against the deployed function: create → join → start → wrong turn refused →
 * non-answer refused → answer accepted (puffer passes) → repeat refused ("Already said") → the server clock pops the
 * puffer → the next round deals to the player after the popped one → leave (the other player wins) → rematch.
 * Nothing here is mocked, so it needs the project URL and anon key:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=... node tools/duel-smoke.js
 * The same run backs the env-gated test in tests/online.test.js. Answers come from data/prompts.json, so the local
 * bank must know the question the server dealt (it always does: prompt ids are stable and retired questions keep
 * their answers). Exit code 1 on any failure.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const POLL_MS = 1000;
const POP_WAIT_MS = 45000;      // a fuse is 10–30 s and a pass never leaves under 8 s

async function run(opts) {
  const url = (opts.url || '').replace(/\/$/, '');
  const key = opts.key;
  const log = opts.log || console.log;
  const failures = [];
  let steps = 0;
  const check = (cond, what) => { steps++; if (cond) log('  ok   ' + what); else { failures.push(what); log('  FAIL ' + what); } return !!cond; };
  const fn = url + '/functions/v1/duel';
  async function call(body) {
    const res = await fetch(fn, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch (e) { data = { error: 'not json (' + res.status + ')' }; }
    return Object.assign({ status: res.status }, data);
  }
  const prompts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'prompts.json'), 'utf8'));
  const entities = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'entities.json'), 'utf8'));
  const entitiesById = Object.fromEntries(entities.map(e => [e.id, e]));
  const promptsById = Object.fromEntries(prompts.map(p => [p.id, p]));
  const namesFor = (promptId) => {
    const p = promptsById[promptId];
    if (!p) return [];
    return p.answers.map(a => entitiesById[a.entity] && entitiesById[a.entity].name).filter(Boolean);
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const t0 = Date.now();

  log('duel smoke against ' + fn);
  // 1. create
  const a = await call({ action: 'create', name: 'Nish', deviceId: 'smoke-a' });
  if (!check(a.status === 200 && a.roomId && /^[A-Z]{4}$/.test(a.code) && a.token && a.playerId, 'create → room ' + (a.code || a.error))) return done();
  check(a.state && a.state.status === 'lobby' && a.state.players.length === 1 && a.state.hostId === a.playerId, 'lobby has the host');
  // 2. join by code
  const b = await call({ action: 'join', name: 'Guest', code: a.code.toLowerCase(), deviceId: 'smoke-b' });
  if (!check(b.status === 200 && b.roomId === a.roomId && b.token && b.playerId !== a.playerId, 'join by code (case-insensitive) → 2 players')) return done();
  check(b.state.players.length === 2 && b.state.players[1].name === 'Guest', 'join order is turn order');
  const bad = await call({ action: 'join', name: 'Third', code: 'ZZZZ' });
  check(bad.status === 404, 'unknown code is refused (404)');
  // 3. only the host starts
  const notHost = await call({ action: 'start', roomId: a.roomId, token: b.token });
  check(notHost.status === 403, 'a guest cannot start (403)');
  const noTok = await call({ action: 'start', roomId: a.roomId, token: 'nope' });
  check(noTok.status === 403, 'a bad token is refused (403)');
  const s = await call({ action: 'start', roomId: a.roomId, token: a.token });
  if (!check(s.status === 200 && s.state.status === 'playing' && s.state.round && s.state.round.n === 1, 'host starts → round 1 (' + (s.error || s.state.round.promptId) + ')')) return done();
  check(s.state.round.holder === a.playerId, 'the host holds the puffer first');
  check(s.state.round.deadline === undefined && s.state.round.fuseMs === undefined, 'the fuse is hidden from the public state');
  const promptId = s.state.round.promptId;
  const names = namesFor(promptId);
  check(names.length >= 75, 'the dealt question has 75+ answers locally (' + names.length + ')');
  // 4. wrong turn, non-answer
  const wrongTurn = await call({ action: 'answer', roomId: a.roomId, token: b.token, typed: names[0] || 'x' });
  check(wrongTurn.accepted === false && wrongTurn.reason === 'not_your_turn', 'answering out of turn is refused');
  const nonsense = await call({ action: 'answer', roomId: a.roomId, token: a.token, typed: 'zzzz nothing' });
  check(nonsense.accepted === false && nonsense.reason === 'not_accepted', 'a non-answer is refused');
  // 5. a real answer passes the puffer
  let first = null;
  for (const n of names.slice(0, 8)) {
    const r = await call({ action: 'answer', roomId: a.roomId, token: a.token, typed: n });
    if (r.accepted) { first = Object.assign({ typed: n }, r); break; }
  }
  if (!check(first && first.state.round.holder === b.playerId, 'an accepted answer passes the puffer to the guest' + (first ? ' (' + first.typed + ' · ' + first.tier + ')' : ''))) return done();
  check(first.state.round.said.length === 1 && first.state.players[0].answers.length === 1, 'the answer is recorded for the host');
  // 6. a repeat is refused
  const repeat = await call({ action: 'answer', roomId: a.roomId, token: b.token, typed: first.typed });
  check(repeat.accepted === false && repeat.reason === 'already_said' && repeat.byName === 'Nish', 'a repeat is refused: Already said — ' + repeat.name + ' (' + repeat.byName + ')');
  let second = null;
  for (const n of names.slice(8, 16)) {
    const r = await call({ action: 'answer', roomId: a.roomId, token: b.token, typed: n });
    if (r.accepted) { second = Object.assign({ typed: n }, r); break; }
  }
  check(second && second.state.round.holder === a.playerId, 'the guest answers and the puffer comes back');
  // 7. the server clock pops the puffer on whoever holds it
  log('  …waiting for the hidden fuse (10–30 s)');
  let popped = null;
  const popStart = Date.now();
  while (Date.now() - popStart < POP_WAIT_MS) {
    await sleep(POLL_MS);
    const t = await call({ action: 'tick', roomId: a.roomId });
    if (t.state && (t.state.rounds.length >= 1 || t.state.status === 'finished')) { popped = t.state; break; }
  }
  if (!check(popped && popped.rounds.length === 1 && popped.rounds[0].poppedId, 'the puffer pops after the fuse (' + Math.round((Date.now() - popStart) / 1000) + ' s)')) return done();
  const victim = popped.players.find(p => p.id === popped.rounds[0].poppedId);
  check(victim && victim.lives === 1, 'the popped player loses one life (' + victim.name + ' → ' + victim.lives + ')');
  check(popped.players.filter(p => p.id !== victim.id).every(p => p.lives === 2), 'nobody else loses a life');
  // 8. the next round deals after the pause, starting with the player after the popped one
  let next = popped.round ? popped : null;
  for (let i = 0; i < 8 && !next; i++) {
    await sleep(POLL_MS);
    const t = await call({ action: 'tick', roomId: a.roomId });
    if (t.state && t.state.round) next = t.state;
  }
  if (check(next && next.round && next.round.n === 2, 'round 2 is dealt after the pop pause')) {
    check(next.round.promptId !== promptId, 'round 2 is a different question');
    const order = next.players.map(p => p.id);
    const expect = order[(order.indexOf(victim.id) + 1) % order.length];
    check(next.round.holder === expect, 'round 2 starts with the player after the popped one');
  }
  // 9. leaving a two-player duel hands the win to the other player
  const left = await call({ action: 'leave', roomId: a.roomId, token: b.token });
  check(left.status === 200 && left.state.status === 'finished' && left.state.winnerId === a.playerId, 'the guest leaves → the host is the last one floating');
  // 10. rematch
  const rm = await call({ action: 'rematch', roomId: a.roomId, token: a.token });
  check(rm.status === 200 && rm.state.status === 'lobby' && rm.state.match === 2 && rm.state.players.length === 1, 'rematch → lobby, match 2, the leaver is gone');
  check(rm.state.players[0].lives === 2 && rm.state.players[0].answers.length === 0, 'rematch resets lives and answers');
  // 11. what Realtime readers see: the public row carries no fuse
  const st = await call({ action: 'state', roomId: a.roomId });
  check(st.status === 200 && st.state && !('deadline' in (st.state.round || {})), 'state is readable without a token and hides the fuse');
  return done();

  function done() {
    const ok = failures.length === 0;
    log((ok ? 'duel smoke passed' : 'duel smoke FAILED (' + failures.length + ')') + ' · ' + steps + ' checks · ' + Math.round((Date.now() - t0) / 1000) + ' s');
    return { ok, failures, steps };
  }
}

module.exports = { run };

if (require.main === module) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) { console.error('set SUPABASE_URL and SUPABASE_ANON_KEY'); process.exit(2); }
  run({ url, key }).then(r => process.exit(r.ok ? 0 : 1), e => { console.error(e); process.exit(1); });
}
