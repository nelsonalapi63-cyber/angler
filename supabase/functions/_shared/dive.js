/* FATHOM — shared dive logic.
 * One source file used by the browser (plain <script>), Node tests (require)
 * and the Supabase Edge Function (import for side effect, read globalThis.FathomDive).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.FathomDive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- parameters
  const PROMPTS_PER_DIVE = 7;
  const SECONDS_PER_PROMPT = 25;
  const CHALLENGER_DEEP_M = 10935;          // bottom of the Mariana Trench, metres
  const TIMEZONE = 'America/New_York';      // the day rolls over at midnight Eastern
  const LAUNCH_DATE = '2026-11-02';         // FATHOM #1
  const FUZZY_SHORT_MAX_LEN = 6;            // inputs this long or shorter allow 1 edit
  const FUZZY_SHORT_DIST = 1;
  const FUZZY_LONG_DIST = 2;                // longer inputs allow 2 edits
  const FUZZY_MIN_LEN = 3;                  // never fuzzy-match tiny inputs
  const CYCLE_SEED_PREFIX = 'fathom-cycle:';
  const FREE_SEED_PREFIX = 'fathom-free:';

  const TIERS = [
    { code: 'tidepool', name: 'Tide Pool', points: 10, emoji: '🐚', digit: 1, blurb: 'the first thing anyone says' },
    { code: 'baitball', name: 'Bait Ball', points: 15, emoji: '🐠', digit: 2, blurb: 'the clever pick everyone crowds into' },
    { code: 'reef',     name: 'Reef',      points: 30, emoji: '🪸', digit: 3, blurb: 'a solid answer past the obvious' },
    { code: 'twilight', name: 'Twilight',  points: 60, emoji: '🦑', digit: 4, blurb: 'uncommon but recognisable' },
    { code: 'midnight', name: 'Midnight',  points: 85, emoji: '🐙', digit: 5, blurb: 'a specialist answer' },
    { code: 'hadal',    name: 'Hadal',     points: 100, emoji: '🔱', digit: 6, blurb: 'the one best answer, hand-picked' },
  ];
  const TIER_BY_CODE = Object.fromEntries(TIERS.map(t => [t.code, t]));
  const TIER_BY_DIGIT = Object.fromEntries(TIERS.map(t => [t.digit, t]));
  const MISS = { code: null, name: 'Miss', points: 0, emoji: '⬛', digit: 0 };
  const MAX_POINTS = PROMPTS_PER_DIVE * TIER_BY_CODE.hadal.points;   // 700
  const METERS_PER_POINT = CHALLENGER_DEEP_M / MAX_POINTS;           // 15.621…

  const ZONES = [
    { code: 'sunlight', name: 'Sunlight zone', from: 0,    to: 200,   fact: 'Almost all of the ocean’s photosynthesis happens in this thin, sunlit top layer.' },
    { code: 'twilight', name: 'Twilight zone', from: 200,  to: 1000,  fact: 'Only faint blue light reaches here, and the lanternfish that live in this layer are among the most abundant vertebrates on Earth.' },
    { code: 'midnight', name: 'Midnight zone', from: 1000, to: 4000,  fact: 'No sunlight reaches this zone at all, so many of the animals here make their own light.' },
    { code: 'abyss',    name: 'Abyssal zone',  from: 4000, to: 6000,  fact: 'The near-freezing abyssal plains down here cover more of the planet than all the land combined.' },
    { code: 'hadal',    name: 'Hadal zone',    from: 6000, to: Infinity, fact: 'Only the ocean trenches reach this deep, and snailfish have been filmed living at 8,336 metres.' },
  ];

  const LANDMARKS = [
    { depth: 200,   label: 'Sunlight zone ends' },
    { depth: 1000,  label: 'Twilight zone ends' },
    { depth: 3800,  label: 'Titanic wreck' },
    { depth: 4000,  label: 'Abyssal zone begins' },
    { depth: 6000,  label: 'Hadal zone begins' },
    { depth: 8336,  label: 'Deepest fish ever filmed' },
    { depth: 10935, label: 'Challenger Deep' },
  ];

  // ---------------------------------------------------------------- text
  const ARTICLE_RE = /^(the|a|an) /;

  function normalise(input) {
    let t = String(input == null ? '' : input);
    t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');   // strip accents
    t = t.toLowerCase();
    t = t.replace(/[’'`´]/g, '');                      // drop apostrophes: "o'neil" -> "oneil"
    t = t.replace(/[^a-z0-9]+/g, ' ').trim().replace(/ +/g, ' ');
    t = t.replace(ARTICLE_RE, '');
    return t;
  }

  // Plural forms of a normalised phrase (we pluralise the bank rather than singularise the input).
  function pluralForms(norm) {
    if (!norm) return [];
    const words = norm.split(' ');
    const last = words[words.length - 1];
    const head = words.slice(0, -1).join(' ');
    const join = (w) => (head ? head + ' ' + w : w);
    const out = new Set([norm]);
    if (/(s|sh|ch|x|z)$/.test(last)) out.add(join(last + 'es'));
    if (/[^aeiou]y$/.test(last)) out.add(join(last.slice(0, -1) + 'ies'));
    if (/fish$/.test(last)) out.add(join(last + 'es'));
    if (!/s$/.test(last)) out.add(join(last + 's'));
    if (/f$/.test(last)) out.add(join(last.slice(0, -1) + 'ves'));     // wolf -> wolves
    if (/fe$/.test(last)) out.add(join(last.slice(0, -2) + 'ves'));
    return Array.from(out);
  }

  // Edit distance where a swapped pair of adjacent letters ("graet") counts as ONE edit
  // (optimal string alignment distance) — the typo model people actually make.
  function levenshtein(a, b) {
    if (a === b) return 0;
    const n = a.length, m = b.length;
    if (!n) return m;
    if (!m) return n;
    const d = [];
    for (let i = 0; i <= n; i++) { d.push(new Array(m + 1)); d[i][0] = i; }
    for (let j = 0; j <= m; j++) d[0][j] = j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[n][m];
  }

  // ---------------------------------------------------------------- matching
  // prompt: {id, answers:[{entity, tier}]}; entitiesById: {id: {name, aliases[]}}
  function buildIndex(prompt, entitiesById) {
    const exact = new Map();
    const list = [];
    for (const a of prompt.answers) {
      const ent = entitiesById[a.entity];
      if (!ent) continue;
      const tier = TIER_BY_CODE[a.tier];
      if (!tier) continue;
      const names = [ent.name].concat(ent.aliases || []);
      for (const raw of names) {
        const norm = normalise(raw);
        if (!norm) continue;
        for (const form of pluralForms(norm)) {
          if (!exact.has(form)) {
            exact.set(form, { entityId: a.entity, tier: tier.code });
            list.push({ form, entityId: a.entity, tier: tier.code });
          }
        }
      }
    }
    return { promptId: prompt.id, exact, list };
  }

  function matchAnswer(typed, index) {
    const norm = normalise(typed);
    const miss = { entityId: null, tier: null, points: 0, via: null, norm };
    if (!norm) return miss;
    const hit = index.exact.get(norm);
    if (hit) return { entityId: hit.entityId, tier: hit.tier, points: TIER_BY_CODE[hit.tier].points, via: 'exact', norm };
    if (norm.length < FUZZY_MIN_LEN) return miss;
    const maxDist = norm.length <= FUZZY_SHORT_MAX_LEN ? FUZZY_SHORT_DIST : FUZZY_LONG_DIST;
    let best = null;
    for (const cand of index.list) {
      if (Math.abs(cand.form.length - norm.length) > maxDist) continue;
      const d = levenshtein(norm, cand.form);
      if (d > maxDist) continue;
      const lenDiff = Math.abs(cand.form.length - norm.length);
      const pts = TIER_BY_CODE[cand.tier].points;
      if (!best || d < best.d || (d === best.d && (lenDiff < best.lenDiff || (lenDiff === best.lenDiff && pts < best.pts)))) {
        best = { cand, d, lenDiff, pts };
      }
    }
    if (!best) return miss;
    return { entityId: best.cand.entityId, tier: best.cand.tier, points: best.pts, via: 'fuzzy', norm, distance: best.d };
  }

  // ---------------------------------------------------------------- depth & zones
  function depthFor(points) { return Math.round(points * METERS_PER_POINT); }
  function zoneFor(depth) { return ZONES.find(z => depth < z.to) || ZONES[ZONES.length - 1]; }
  function tierForCode(code) { return code ? TIER_BY_CODE[code] || MISS : MISS; }
  function tiersToEmoji(codes) { return codes.map(c => tierForCode(c).emoji).join(''); }
  function tiersToDigits(codes) { return codes.map(c => tierForCode(c).digit).join(''); }
  function digitsToTiers(digits) { return String(digits).split('').map(d => (TIER_BY_DIGIT[Number(d)] || MISS).code); }

  // ---------------------------------------------------------------- random
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function seededRng(seedString) {
    let a = fnv1a(String(seedString)) || 1;
    return function () {                      // mulberry32
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(array, rng) {
    const out = array.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }
  function randomSeed(len) {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < (len || 6); i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  // ---------------------------------------------------------------- dates (Eastern)
  function tzParts(date, tz) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz || TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const parts = {};
    for (const p of fmt.formatToParts(date)) if (p.type !== 'literal') parts[p.type] = Number(p.value);
    return parts;
  }
  function dayKey(date, tz) {
    const p = tzParts(date || new Date(), tz);
    return p.year + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');
  }
  function keyToUtc(key) {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }
  function dayIndex(key, launch) { return Math.round((keyToUtc(key) - keyToUtc(launch || LAUNCH_DATE)) / 86400000); }
  function puzzleNumber(key, launch) { return dayIndex(key, launch) + 1; }
  function keyPlusDays(key, n) {
    const t = keyToUtc(key) + n * 86400000;
    const d = new Date(t);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function msUntilNextDay(date, tz) {
    const now = date || new Date();
    const p = tzParts(now, tz);
    const wallNow = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const wallNext = Date.UTC(p.year, p.month - 1, p.day + 1);
    return Math.max(0, wallNext - wallNow);
  }

  // ---------------------------------------------------------------- dive construction
  function sortByDifficulty(ids, promptsById) {
    return ids.slice().sort((a, b) => {
      const da = promptsById[a].difficulty, db = promptsById[b].difficulty;
      return da !== db ? da - db : (a < b ? -1 : a > b ? 1 : 0);
    });
  }
  function byId(prompts) { return Object.fromEntries(prompts.map(p => [p.id, p])); }

  // Pick the first N prompts of distinct groups from an ordered pool. Returns {picked, rest}.
  function pickDistinctGroups(pool, promptsById, n) {
    const picked = [], groups = new Set(), rest = [];
    for (const id of pool) {
      const g = promptsById[id].group;
      if (picked.length < n && !groups.has(g)) { picked.push(id); groups.add(g); }
      else rest.push(id);
    }
    return { picked, rest };
  }

  const scheduleCache = new Map();
  // Replays the schedule deterministically: each cycle shuffles the whole bank, leftovers roll forward.
  function schedule(prompts, uptoIndex) {
    const key = prompts.map(p => p.id).join('|');
    let st = scheduleCache.get(key);
    if (!st) { st = { days: [], pool: [], cycle: 0 }; scheduleCache.set(key, st); }
    const promptsById = byId(prompts);
    const allIds = prompts.map(p => p.id).sort();
    while (st.days.length <= uptoIndex) {
      let { picked, rest } = pickDistinctGroups(st.pool, promptsById, PROMPTS_PER_DIVE);
      if (picked.length < PROMPTS_PER_DIVE) {
        // start a new cycle: leftovers first, then everything else shuffled
        const leftovers = st.pool.slice();
        const inLeft = new Set(leftovers);
        const fresh = shuffle(allIds.filter(id => !inLeft.has(id)), seededRng(CYCLE_SEED_PREFIX + st.cycle));
        st.cycle++;
        st.pool = leftovers.concat(fresh);
        ({ picked, rest } = pickDistinctGroups(st.pool, promptsById, PROMPTS_PER_DIVE));
        if (picked.length < PROMPTS_PER_DIVE) {          // tiny bank: allow group repeats
          picked = st.pool.slice(0, PROMPTS_PER_DIVE);
          rest = st.pool.slice(PROMPTS_PER_DIVE);
        }
      }
      st.pool = rest;
      st.days.push(sortByDifficulty(picked, promptsById));
    }
    return st.days[uptoIndex];
  }

  function dailyPromptIds(key, prompts, launch) {
    const idx = dayIndex(key, launch);
    if (idx < 0) return null;
    return schedule(prompts, idx).slice();
  }

  function freePromptIds(seed, prompts) {
    const promptsById = byId(prompts);
    const ids = shuffle(prompts.map(p => p.id).sort(), seededRng(FREE_SEED_PREFIX + seed));
    let { picked } = pickDistinctGroups(ids, promptsById, PROMPTS_PER_DIVE);
    if (picked.length < PROMPTS_PER_DIVE) picked = ids.slice(0, PROMPTS_PER_DIVE);
    return sortByDifficulty(picked, promptsById);
  }

  function packPromptIds(pack, prompts) {
    const promptsById = byId(prompts);
    return sortByDifficulty(pack.prompts.filter(id => promptsById[id]), promptsById);
  }

  // ---------------------------------------------------------------- challenge links
  const CHALLENGE_RE = /^#\/challenge\/([a-z0-9]{4,12})(?:-(\d{1,5}))?(?:-([0-6]{7}))?\/?$/;
  function makeChallengeHash(seed, depth, tierCodes) {
    let h = '#/challenge/' + seed;
    if (depth != null) h += '-' + Math.max(0, Math.round(depth));
    if (tierCodes && tierCodes.length === PROMPTS_PER_DIVE) h += '-' + tiersToDigits(tierCodes);
    return h;
  }
  function parseChallenge(hash) {
    const m = CHALLENGE_RE.exec(String(hash || '').trim());
    if (!m) return null;
    return { seed: m[1], depth: m[2] ? Number(m[2]) : 0, tiers: m[3] ? digitsToTiers(m[3]) : null };
  }

  // ---------------------------------------------------------------- share text
  function formatMeters(n) { return Math.round(n).toLocaleString('en-US'); }
  function shareText(opts) {
    const bits = ['FATHOM #' + opts.number, formatMeters(opts.depth) + ' m'];
    if (opts.percentile != null) bits.push('top ' + opts.percentile + '%');
    bits.push(tiersToEmoji(opts.tiers));
    let s = bits.join(' · ');
    if (opts.siteUrl) s += '\n' + opts.siteUrl;
    return s;
  }

  // ---------------------------------------------------------------- server-side scoring
  // submission: {promptIds:[7], answers:[{typed, secondsUsed}]}
  function scoreSubmission(submission, prompts, entitiesById) {
    const promptsById = Array.isArray(prompts) ? byId(prompts) : prompts;
    const ids = submission.promptIds || [];
    const results = [];
    let points = 0, secondsUsed = 0;
    for (let i = 0; i < ids.length; i++) {
      const prompt = promptsById[ids[i]];
      const ans = (submission.answers && submission.answers[i]) || { typed: '', secondsUsed: SECONDS_PER_PROMPT };
      if (!prompt) { results.push({ promptId: ids[i], entityId: null, tier: null, points: 0, typed: ans.typed || '' }); continue; }
      const m = matchAnswer(ans.typed || '', buildIndex(prompt, entitiesById));
      points += m.points;
      secondsUsed += Math.min(SECONDS_PER_PROMPT, Math.max(0, Number(ans.secondsUsed) || 0));
      results.push({ promptId: ids[i], typed: ans.typed || '', entityId: m.entityId, tier: m.tier, points: m.points, via: m.via });
    }
    return { points, depth: depthFor(points), secondsUsed, results, tiers: results.map(r => r.tier) };
  }

  return {
    PROMPTS_PER_DIVE, SECONDS_PER_PROMPT, CHALLENGER_DEEP_M, TIMEZONE, LAUNCH_DATE, MAX_POINTS, METERS_PER_POINT,
    TIERS, TIER_BY_CODE, MISS, ZONES, LANDMARKS,
    normalise, pluralForms, levenshtein, buildIndex, matchAnswer,
    depthFor, zoneFor, tierForCode, tiersToEmoji, tiersToDigits, digitsToTiers,
    fnv1a, seededRng, shuffle, randomSeed,
    dayKey, dayIndex, puzzleNumber, keyPlusDays, msUntilNextDay,
    dailyPromptIds, freePromptIds, packPromptIds, sortByDifficulty, byId,
    makeChallengeHash, parseChallenge, shareText, formatMeters, scoreSubmission,
  };
});
