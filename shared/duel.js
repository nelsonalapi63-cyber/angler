/* ANGLER Duel — the rules of a duel room as a pure reducer: reduce(state, event) → state.
 * One copy of this file runs in the browser (the room screen and pass-and-play), the Supabase Edge Function
 * `duel` (tools/sync-shared.js copies it there) and the unit tests. Nothing in here touches the network or a clock:
 * every event carries its own time `t` (ms), and the server decides pops with its clock before it emits `pop`.
 *
 * A room holds 2 to 8 players (2 is the 1v1). A round is one question, never repeated in the match. The puffer
 * starts with the host in round 1, then with the player after the one it popped on. An accepted, not-yet-said
 * answer passes it to the next living player; the hidden fuse (10–30 s, drawn at round start) keeps counting as
 * it passes, and a pass with under 8 s left resets it to 8 s. A pop costs the holder one of two lives and ends the
 * round; at zero lives a player is out and watches. Last one floating wins. Rarity shows but never decides. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dive.js'));
  else root.FathomDuel = factory(root.FathomDive);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (dive) {
  'use strict';
  const MAX_PLAYERS = 8;
  const MIN_PLAYERS = 2;
  const LIVES = 2;
  const FUSE_MIN_MS = 10000;
  const FUSE_MAX_MS = 30000;
  const PASS_FLOOR_MS = 8000;
  const MIN_ANSWERS = 75;                      // only questions with this many answers are dealt
  const FEED_MAX = 40;
  const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';     // no I or O: never mistaken for digits
  const RUDE = /^(ARSE|ANUS|BUTT|CUNT|COCK|CRAP|DAMN|DICK|DUMB|FUCK|HELL|JERK|KUNT|NAZI|PISS|POOP|PRIK|SHIT|SLUT|SUCK|TITS|TWAT|WANK)$/;
  const TIER_EMOJI = (code) => (dive && dive.TIER_BY_CODE && dive.TIER_BY_CODE[code] ? dive.TIER_BY_CODE[code].emoji : '');
  const TIER_NAME = (code) => (dive && dive.TIER_BY_CODE && dive.TIER_BY_CODE[code] ? dive.TIER_BY_CODE[code].name : code);
  const TIER_POINTS = (code) => (dive && dive.TIER_BY_CODE && dive.TIER_BY_CODE[code] ? dive.TIER_BY_CODE[code].points : 0);
  const depthFor = (points) => (dive && dive.depthFor ? dive.depthFor(points) : points * 10);

  function makeCode(rng) {
    const r = rng || Math.random;
    for (let tries = 0; tries < 50; tries++) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_LETTERS[Math.floor(r() * CODE_LETTERS.length)];
      if (!RUDE.test(c)) return c;
    }
    return 'KRIL';
  }
  function drawFuse(rng) { const r = rng || Math.random; return Math.round(FUSE_MIN_MS + r() * (FUSE_MAX_MS - FUSE_MIN_MS)); }

  function initial(o) {
    o = o || {};
    return { code: o.code || makeCode(), hostId: o.hostId || null, status: 'lobby', lives: LIVES, match: 1, createdAt: o.t || 0, players: [], round: null, rounds: [], used: [], feed: [], winnerId: null, seq: 0 };
  }
  const copy = (s) => JSON.parse(JSON.stringify(s));
  const alivePlayers = (s) => s.players.filter(p => p.alive);
  function nextAlive(s, fromId) {
    const order = s.players.map(p => p.id);
    const start = order.indexOf(fromId);
    for (let k = 1; k <= order.length; k++) {
      const p = s.players[(start + k) % order.length];
      if (p.alive) return p.id;
    }
    return null;
  }
  function feed(s, t, type, text, extra) {
    s.feed.push(Object.assign({ t, type, text }, extra || {}));
    if (s.feed.length > FEED_MAX) s.feed.splice(0, s.feed.length - FEED_MAX);
  }
  const nameOf = (s, id) => { const p = s.players.find(x => x.id === id); return p ? p.name : id; };
  function alreadySaid(s, entityId) {
    if (!s.round) return null;
    const a = s.round.said.find(x => x.entityId === entityId);
    return a ? { by: a.by, name: a.name, byName: nameOf(s, a.by), tier: a.tier } : null;
  }
  function newRound(s, t, promptId, fuseMs, holder) {
    const n = s.rounds.length + 1;
    s.round = { n, promptId, holder, startedAt: t, fuseMs, deadline: t + fuseMs, said: [], passes: 0, poppedId: null };
    if (!s.used.includes(promptId)) s.used.push(promptId);
    feed(s, t, 'round', 'Round ' + n + ' · ' + nameOf(s, holder) + ' holds the puffer');
  }
  function finish(s, t, winnerId) {
    s.status = 'finished';
    s.winnerId = winnerId || null;
    if (s.round) { s.rounds.push(s.round); s.round = null; }
    feed(s, t, 'end', winnerId ? nameOf(s, winnerId) + ' is the last one floating' : 'The duel is over');
  }
  function checkWinner(s, t) {
    const alive = alivePlayers(s);
    if (alive.length <= 1 && s.status === 'playing') finish(s, t, alive.length ? alive[0].id : null);
  }

  // The reducer. Returns the same object when an event does not apply, so callers can test identity.
  function reduce(state, ev) {
    if (!state || !ev || !ev.type) return state;
    const t = Number(ev.t) || 0;
    switch (ev.type) {
      case 'join': {
        if (state.status !== 'lobby') return state;
        if (state.players.length >= MAX_PLAYERS) return state;
        if (!ev.playerId || state.players.some(p => p.id === ev.playerId)) return state;
        const s = copy(state); s.seq++;
        s.players.push({ id: ev.playerId, name: String(ev.name || 'Diver').slice(0, 20), userId: ev.userId || null, lives: s.lives, alive: true, joinedAt: t, points: 0, depthM: 0, deepest: null, streak: 0, bestStreak: 0, answers: [], pops: 0 });
        if (!s.hostId) s.hostId = ev.playerId;
        feed(s, t, 'join', s.players[s.players.length - 1].name + ' joined');
        return s;
      }
      case 'leave': {
        const p = state.players.find(x => x.id === ev.playerId);
        if (!p) return state;
        const s = copy(state); s.seq++;
        if (s.status === 'lobby') {
          s.players = s.players.filter(x => x.id !== ev.playerId);
          if (s.hostId === ev.playerId) s.hostId = s.players.length ? s.players[0].id : null;
          feed(s, t, 'leave', p.name + ' left');
          return s;
        }
        const me = s.players.find(x => x.id === ev.playerId);
        me.alive = false; me.left = true;
        feed(s, t, 'leave', me.name + ' left the duel');
        if (s.round && s.round.holder === ev.playerId) {
          const to = nextAlive(s, ev.playerId);
          if (to) { s.round.holder = to; s.round.deadline = Math.max(s.round.deadline, t + PASS_FLOOR_MS); }
        }
        if (s.hostId === ev.playerId) { const h = alivePlayers(s)[0]; if (h) s.hostId = h.id; }
        checkWinner(s, t);
        return s;
      }
      case 'start': {
        if (state.status !== 'lobby' || state.players.length < MIN_PLAYERS || !ev.promptId) return state;
        const s = copy(state); s.seq++;
        s.status = 'playing';
        for (const p of s.players) { p.lives = s.lives; p.alive = true; }
        const holder = s.players.some(p => p.id === s.hostId) ? s.hostId : s.players[0].id;
        newRound(s, t, ev.promptId, Number(ev.fuseMs) || FUSE_MIN_MS, holder);
        return s;
      }
      case 'answer': {
        if (state.status !== 'playing' || !state.round) return state;
        if (ev.round != null && ev.round !== state.round.n) return state;
        if (state.round.holder !== ev.playerId || !ev.entityId) return state;
        if (state.round.said.some(a => a.entityId === ev.entityId)) return state;
        const s = copy(state); s.seq++;
        const p = s.players.find(x => x.id === ev.playerId);
        const tier = ev.tier || 'midnight';
        s.round.said.push({ entityId: ev.entityId, name: ev.name || ev.entityId, tier, by: ev.playerId, t });
        p.answers.push({ entityId: ev.entityId, name: ev.name || ev.entityId, tier, round: s.round.n, t });
        p.points += TIER_POINTS(tier);
        p.depthM = depthFor(p.points);
        if (!p.deepest || TIER_POINTS(tier) > TIER_POINTS(p.deepest)) p.deepest = tier;
        p.streak += 1; if (p.streak > p.bestStreak) p.bestStreak = p.streak;
        s.round.passes += 1;
        feed(s, t, 'answer', p.name + ' passed · ' + (ev.name || ev.entityId) + ' ' + TIER_EMOJI(tier), { playerId: p.id, entityId: ev.entityId, tier });
        return s;
      }
      case 'pass': {
        if (state.status !== 'playing' || !state.round) return state;
        const s = copy(state); s.seq++;
        const to = nextAlive(s, s.round.holder);
        if (!to || to === s.round.holder) return state;
        s.round.holder = to;
        s.round.deadline = Math.max(s.round.deadline, t + PASS_FLOOR_MS);
        return s;
      }
      case 'pop': {
        if (state.status !== 'playing' || !state.round) return state;
        if (ev.round != null && ev.round !== state.round.n) return state;
        const s = copy(state); s.seq++;
        const p = s.players.find(x => x.id === s.round.holder);
        if (!p) return state;
        p.lives = Math.max(0, p.lives - 1);
        p.pops += 1;
        p.streak = 0;
        if (p.lives === 0) p.alive = false;
        s.round.poppedId = p.id;
        s.round.endedAt = t;
        feed(s, t, 'pop', 'Pop! ' + p.name + (p.lives === 0 ? ' is out' : ' loses a tank'), { playerId: p.id, lives: p.lives });
        s.rounds.push(s.round);
        s.round = null;
        checkWinner(s, t);
        return s;
      }
      case 'next_round': {
        if (state.status !== 'playing' || state.round || !ev.promptId) return state;
        const s = copy(state); s.seq++;
        const last = s.rounds[s.rounds.length - 1];
        const holder = last && last.poppedId ? nextAlive(s, last.poppedId) : (alivePlayers(s)[0] || {}).id;
        if (!holder) return state;
        newRound(s, t, ev.promptId, Number(ev.fuseMs) || FUSE_MIN_MS, holder);
        return s;
      }
      case 'end': {
        if (state.status === 'finished') return state;
        const s = copy(state); s.seq++;
        finish(s, t, ev.winnerId || (alivePlayers(s).length === 1 ? alivePlayers(s)[0].id : null));
        return s;
      }
      case 'rematch': {
        if (state.status !== 'finished') return state;
        const s = copy(state); s.seq++;
        s.status = 'lobby'; s.match += 1; s.round = null; s.rounds = []; s.winnerId = null; s.feed = [];
        s.players = s.players.filter(p => !p.left);
        for (const p of s.players) { p.lives = s.lives; p.alive = true; p.points = 0; p.depthM = 0; p.deepest = null; p.streak = 0; p.bestStreak = 0; p.answers = []; p.pops = 0; }
        feed(s, t, 'rematch', 'Rematch — same room, new questions');
        return s;
      }
      default: return state;
    }
  }

  // What players may see: never the fuse or the deadline (the puffer's swelling is the only clock they get).
  function publicState(s) {
    const pub = copy(s);
    if (pub.round) { delete pub.round.deadline; delete pub.round.fuseMs; }
    for (const r of pub.rounds) { delete r.deadline; delete r.fuseMs; }
    return pub;
  }
  function summary(s) {
    let deepest = null;
    for (const p of s.players) for (const a of p.answers) if (!deepest || TIER_POINTS(a.tier) > TIER_POINTS(deepest.tier)) deepest = { tier: a.tier, name: a.name, playerId: p.id, playerName: p.name };
    const longest = s.players.reduce((best, p) => (!best || p.bestStreak > best.bestStreak ? p : best), null);
    return {
      winnerId: s.winnerId, winnerName: s.winnerId ? nameOf(s, s.winnerId) : null, rounds: s.rounds.length,
      players: s.players.map(p => ({ id: p.id, name: p.name, lives: p.lives, alive: p.alive, answers: p.answers.slice(), deepest: p.deepest, bestStreak: p.bestStreak, depthM: p.depthM, pops: p.pops })),
      deepest, longestStreak: longest ? { playerId: longest.id, playerName: longest.name, streak: longest.bestStreak } : null,
    };
  }
  function shareLine(s) {
    const sum = summary(s);
    const w = s.players.find(p => p.id === s.winnerId);
    const others = s.players.filter(p => p.id !== s.winnerId).sort((a, b) => b.lives - a.lives);
    const score = w ? w.lives + '–' + (others.length ? others[0].lives : 0) : null;
    const deep = sum.deepest ? ' · deepest answer ' + TIER_NAME(sum.deepest.tier) + ' ' + TIER_EMOJI(sum.deepest.tier) : '';
    return (dive && dive.BRAND ? dive.BRAND : 'ANGLER') + ' Duel' + (score ? ' · won ' + score : '') + deep + '\n' + (dive && dive.SITE_URL ? dive.SITE_URL : '');
  }
  // Questions a room may deal: live, with enough answers, not yet used in this match.
  function dealable(prompts, used) { return prompts.filter(p => !p.retired && p.answers && p.answers.length >= MIN_ANSWERS && !(used || []).includes(p.id)); }
  function pickPrompt(prompts, used, rng) {
    const pool = dealable(prompts, used);
    if (!pool.length) return null;
    return pool[Math.floor((rng || Math.random)() * pool.length)].id;
  }

  return { MAX_PLAYERS, MIN_PLAYERS, LIVES, FUSE_MIN_MS, FUSE_MAX_MS, PASS_FLOOR_MS, MIN_ANSWERS, initial, reduce, publicState, summary, shareLine, alreadySaid, nextAlive, makeCode, drawFuse, dealable, pickPrompt };
});
