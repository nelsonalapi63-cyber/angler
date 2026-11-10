'use strict';
/* ANGLER v4 Duel — the pure reducer in shared/duel.js: reduce(state, event) → state. Same code in the browser,
 * the pass-and-play driver and the Edge Function. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const duel = require(path.join(__dirname, '..', 'shared', 'duel.js'));
const { reduce, initial } = duel;

const T0 = 1_000_000;
function lobby(n) {
  let s = initial({ code: 'KRIL', hostId: 'p1', t: T0 });
  for (let i = 1; i <= n; i++) s = reduce(s, { type: 'join', playerId: 'p' + i, name: ['', 'Nish', 'Maya', 'Omar', 'Lee', 'Ana', 'Bo', 'Cy', 'Di', 'Ed'][i], t: T0 + i });
  return s;
}
function started(n) { return reduce(lobby(n), { type: 'start', t: T0 + 100, promptId: 'shark-species', fuseMs: 20000 }); }
const ans = (s, pid, entity, tier, t) => reduce(s, { type: 'answer', playerId: pid, entityId: entity, name: entity, tier, t });

test('a room holds 2 to 8 players in join order; the ninth is refused and so is a duplicate', () => {
  let s = lobby(8);
  assert.strictEqual(s.players.length, 8);
  assert.deepStrictEqual(s.players.map(p => p.id), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
  const nine = reduce(s, { type: 'join', playerId: 'p9', name: 'Zed', t: T0 + 50 });
  assert.strictEqual(nine.players.length, 8);
  assert.strictEqual(reduce(s, { type: 'join', playerId: 'p3', name: 'Omar again', t: T0 + 51 }).players.length, 8);
  assert.strictEqual(s.status, 'lobby');
  assert.strictEqual(duel.MAX_PLAYERS, 8);
  assert.strictEqual(duel.LIVES, 2);
});

test('everyone starts with two lives; the host cannot start alone', () => {
  const one = reduce(lobby(1), { type: 'start', t: T0 + 100, promptId: 'q', fuseMs: 15000 });
  assert.strictEqual(one.status, 'lobby');
  const s = started(2);
  assert.strictEqual(s.status, 'playing');
  assert.deepStrictEqual(s.players.map(p => p.lives), [2, 2]);
  assert.strictEqual(s.round.n, 1);
  assert.strictEqual(s.round.holder, 'p1', 'the puffer starts with the host in round 1');
  assert.strictEqual(s.round.deadline, T0 + 100 + 20000, 'the hidden fuse is drawn at round start');
  assert.deepStrictEqual(s.used, ['shark-species'], 'a question is never repeated in the match');
});

test('an accepted answer passes the puffer to the next living player; a repeat or a non-holder is ignored', () => {
  let s = started(3);
  s = ans(s, 'p1', 'great-white-shark', 'tidepool', T0 + 1000);
  s = reduce(s, { type: 'pass', t: T0 + 1000 });
  assert.strictEqual(s.round.holder, 'p2');
  assert.deepStrictEqual(s.round.said.map(a => a.entityId), ['great-white-shark']);
  const repeat = ans(s, 'p2', 'great-white-shark', 'tidepool', T0 + 2000);
  assert.strictEqual(repeat, s, 'a repeated answer changes nothing in the reducer (the caller refuses it)');
  const wrongTurn = ans(s, 'p3', 'tiger-shark', 'tidepool', T0 + 2000);
  assert.strictEqual(wrongTurn, s, 'only the holder can answer');
  assert.strictEqual(duel.alreadySaid(s, 'great-white-shark').by, 'p1');
  assert.strictEqual(duel.alreadySaid(s, 'tiger-shark'), null);
  assert.ok(s.feed[s.feed.length - 1].text.startsWith('Nish passed · great-white-shark'), s.feed[s.feed.length - 1].text);
});

test('the fuse keeps counting as the puffer passes; a pass with under 8 s left resets it to 8 s', () => {
  let s = started(2);                                   // deadline T0+20100
  s = ans(s, 'p1', 'a', 'reef', T0 + 5000);
  s = reduce(s, { type: 'pass', t: T0 + 5000 });
  assert.strictEqual(s.round.deadline, T0 + 20100, 'plenty of time left: the clock keeps running');
  s = ans(s, 'p2', 'b', 'reef', T0 + 15000);
  s = reduce(s, { type: 'pass', t: T0 + 15000 });          // 5.1 s left → 8 s
  assert.strictEqual(s.round.deadline, T0 + 15000 + 8000);
  assert.strictEqual(duel.PASS_FLOOR_MS, 8000);
});

test('a pop costs the holder a life and ends the round; the next round starts with the player after the popped one', () => {
  let s = started(3);
  s = ans(s, 'p1', 'a', 'reef', T0 + 1000); s = reduce(s, { type: 'pass', t: T0 + 1000 });   // p2 holds
  s = reduce(s, { type: 'pop', t: T0 + 20200 });
  assert.strictEqual(s.players[1].lives, 1);
  assert.strictEqual(s.round, null, 'the round is over');
  assert.strictEqual(s.rounds.length, 1);
  assert.strictEqual(s.rounds[0].poppedId, 'p2');
  assert.strictEqual(s.status, 'playing');
  s = reduce(s, { type: 'next_round', t: T0 + 21000, promptId: 'whale-species', fuseMs: 12000 });
  assert.strictEqual(s.round.n, 2);
  assert.strictEqual(s.round.holder, 'p3', 'the puffer starts with the player after the popped one');
  assert.strictEqual(s.round.deadline, T0 + 21000 + 12000);
  assert.deepStrictEqual(s.used, ['shark-species', 'whale-species']);
});

test('a pop on the wrong round or when nobody holds is ignored; a stale answer for an old round is ignored', () => {
  let s = started(2);
  const popped = reduce(s, { type: 'pop', t: T0 + 20200 });
  const again = reduce(popped, { type: 'pop', t: T0 + 20300 });
  assert.strictEqual(again, popped);
  const stale = reduce(popped, { type: 'answer', playerId: 'p1', entityId: 'z', name: 'z', tier: 'reef', t: T0 + 20400, round: 1 });
  assert.strictEqual(stale, popped);
});

test('zero lives means out and watching; the last one floating wins', () => {
  let s = started(2);
  s = reduce(s, { type: 'pop', t: T0 + 20200 });                                          // p1 → 1 life
  s = reduce(s, { type: 'next_round', t: T0 + 21000, promptId: 'q2', fuseMs: 10000 });   // p2 holds
  s = ans(s, 'p2', 'a', 'reef', T0 + 22000); s = reduce(s, { type: 'pass', t: T0 + 22000 });   // p1 holds
  s = reduce(s, { type: 'pop', t: T0 + 31100 });                                          // p1 → 0: out
  assert.strictEqual(s.players[0].lives, 0);
  assert.strictEqual(s.players[0].alive, false);
  assert.strictEqual(s.status, 'finished');
  assert.strictEqual(s.winnerId, 'p2');
  assert.strictEqual(duel.shareLine(s).split('\n')[0], 'ANGLER Duel · won 2–0 · deepest answer Reef 🪸');
});

test('a player who leaves while holding the puffer passes it on with the 8-second floor; leaving the lobby just removes them', () => {
  let s = started(3);
  s = reduce(s, { type: 'leave', playerId: 'p1', t: T0 + 15000 });
  assert.strictEqual(s.players.find(p => p.id === 'p1').alive, false);
  assert.strictEqual(s.round.holder, 'p2');
  assert.strictEqual(s.round.deadline, T0 + 15000 + 8000);
  const l = reduce(lobby(3), { type: 'leave', playerId: 'p2', t: T0 + 10 });
  assert.deepStrictEqual(l.players.map(p => p.id), ['p1', 'p3']);
  // the last one standing after everyone else leaves wins
  const two = reduce(started(2), { type: 'leave', playerId: 'p2', t: T0 + 500 });
  assert.strictEqual(two.status, 'finished');
  assert.strictEqual(two.winnerId, 'p1');
});

test('rarity shows but does not decide: each answer sinks that player on the shared rail and the summary lists it', () => {
  let s = started(2);
  s = ans(s, 'p1', 'pocket-shark', 'hadal', T0 + 1000); s = reduce(s, { type: 'pass', t: T0 + 1000 });
  s = ans(s, 'p2', 'tiger-shark', 'tidepool', T0 + 2000); s = reduce(s, { type: 'pass', t: T0 + 2000 });
  assert.ok(s.players[0].depthM > s.players[1].depthM);
  assert.strictEqual(s.players[0].deepest, 'hadal');
  assert.strictEqual(s.players[1].deepest, 'tidepool');
  s = reduce(s, { type: 'pop', t: T0 + 20200 });                                          // p1 pops with the deeper sub
  assert.strictEqual(s.players[0].lives, 1, 'depth does not protect from a pop');
  const sum = duel.summary(s);
  assert.deepStrictEqual(sum.players.map(p => p.answers.length), [1, 1]);
  assert.strictEqual(sum.deepest.tier, 'hadal');
  assert.strictEqual(sum.deepest.playerId, 'p1');
  assert.strictEqual(sum.players[0].bestStreak, 1);
});

test('rematch keeps the room and players, resets lives and rounds, and never repeats a question already used', () => {
  let s = started(2);
  s = reduce(s, { type: 'pop', t: T0 + 20200 });
  s = reduce(s, { type: 'next_round', t: T0 + 21000, promptId: 'q2', fuseMs: 10000 });
  s = reduce(s, { type: 'end', t: T0 + 22000, winnerId: 'p2' });
  assert.strictEqual(s.status, 'finished');
  const r = reduce(s, { type: 'rematch', t: T0 + 30000 });
  assert.strictEqual(r.status, 'lobby');
  assert.strictEqual(r.code, 'KRIL');
  assert.deepStrictEqual(r.players.map(p => [p.id, p.lives, p.alive]), [['p1', 2, true], ['p2', 2, true]]);
  assert.deepStrictEqual(r.rounds, []);
  assert.deepStrictEqual(r.used, ['shark-species', 'q2']);
  assert.strictEqual(r.match, 2);
});

test('publicState hides the fuse and the deadline from players', () => {
  const s = started(2);
  const pub = duel.publicState(s);
  assert.strictEqual(pub.round.deadline, undefined);
  assert.strictEqual(pub.round.fuseMs, undefined);
  assert.strictEqual(pub.round.startedAt, s.round.startedAt);
  assert.strictEqual(s.round.deadline, T0 + 20100, 'the original is untouched');
});

test('the room code is four letters, unambiguous and never rude', () => {
  for (let i = 0; i < 200; i++) {
    const c = duel.makeCode(() => Math.random());
    assert.ok(/^[A-Z]{4}$/.test(c) && !/[IO]/.test(c), c);
  }
});
