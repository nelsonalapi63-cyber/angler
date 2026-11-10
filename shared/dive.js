/* ANGLER — shared dive logic.
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
  const BRAND = 'ANGLER';                   // the game's name — change here and in index.html/manifest/legal pages
  const TAGLINE = 'Seven ocean questions. The rarer your answer, the deeper you dive.';
  const LAUNCH_DATE = '2026-11-02';         // ANGLER #1
  const FUZZY_BANDS = [[4, 6, 1], [7, 11, 2], [12, Infinity, 3]];   // [min letters, max letters, edits allowed] of the typed input
  const FUZZY_MIN_LETTERS = 4;              // never fuzzy-match inputs under four letters
  const SUGGEST_MIN_LEN = 5;                // "did you mean" needs at least this much typed
  const SUGGEST_EXTRA_DIST = 2;             // …and an answer within this many edits beyond what is accepted outright
  const SUGGEST_MAX = 2;                    // never more than two spelling chips
  const AMBIGUOUS_MAX = 3;                  // …but every answer a short form could mean is offered (up to this many)
  const TAXON_TIER = 'midnight';            // a species found only on a reference list scores here
  const HINT_COST = 0;                      // the hint is free (one per dive, enforced by the game)
  const HINT_TIERS = ['twilight', 'midnight', 'hadal'];   // a hint points at a rarer answer
  // Generic group words: optional at the end of a typed answer when the bank name does not carry one ("tuna fish"
  // → Tuna) and optional in the bank name when the player leaves it out ("hammerhead" → Hammerhead shark). A group
  // word glued into a name (starfish, clownfish) stays required, though the spaced form ("star fish") is accepted.
  const GROUP_WORDS = ['fish', 'shark', 'whale', 'dolphin', 'porpoise', 'seal', 'turtle', 'crab', 'lobster', 'shrimp', 'squid', 'octopus', 'ray', 'eel', 'jellyfish', 'jelly', 'bird', 'coral', 'sponge', 'snail', 'clam', 'oyster', 'mussel', 'worm', 'star'];
  const GROUP_CORE_MIN_LETTERS = 4;         // what is left after the group word must be at least this long to count
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
    t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');   // strip accents (combining marks U+0300–U+036F)
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

  // ---- group words
  const GROUP_FORMS = new Map();            // 'sharks' -> 'shark' (every plural of every group word)
  for (const g of GROUP_WORDS) for (const f of pluralForms(g)) GROUP_FORMS.set(f, g);
  const GROUP_BY_LENGTH = GROUP_WORDS.slice().sort((a, b) => b.length - a.length);   // longest suffix first: "jellyfish" before "fish"
  const letterCount = (norm) => norm.replace(/ /g, '').length;
  // "hammerhead shark" -> { core: 'hammerhead', group: 'shark' }; "green sea turtle" -> { core: 'green', group: 'sea turtle' }; else null
  function splitGroup(norm) {
    const words = norm.split(' ');
    if (words.length < 2 || !GROUP_FORMS.has(words[words.length - 1])) return null;
    let n = words.length - 1;
    let group = GROUP_FORMS.get(words[n]);
    if (n >= 2 && words[n - 1] === 'sea') { n--; group = 'sea ' + group; }
    const core = words.slice(0, n).join(' ');
    return { core, group };
  }
  // a core must be substantial and must not itself be a group word ("whale shark" does not answer to "whale")
  const coreOk = (core) => !!core && letterCount(core) >= GROUP_CORE_MIN_LETTERS && !GROUP_FORMS.has(core);
  // "tunafish" -> "tuna fish", "moonjellyfish" -> "moon jellyfish"; null when the last word is not glued to a group word
  function deglue(norm) {
    const words = norm.split(' ');
    const last = words[words.length - 1];
    for (const g of GROUP_BY_LENGTH) {
      for (const suffix of pluralForms(g)) {
        if (last.length > suffix.length + 2 && last.endsWith(suffix)) {
          const prefix = last.slice(0, -suffix.length);
          if (prefix.length < 3) continue;
          return words.slice(0, -1).concat([prefix, suffix]).join(' ');
        }
      }
    }
    return null;
  }
  // every form a typed answer may stand for once group words are treated as optional, most literal first
  function groupForms(norm) {
    const out = [];
    const s = splitGroup(norm);
    if (s && coreOk(s.core)) out.push(s.core);
    const d = deglue(norm);
    if (d) {
      out.push(d);
      const s2 = splitGroup(d);
      if (s2 && coreOk(s2.core)) out.push(s2.core);
    }
    return out;
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
  // Precedence when two entities in one prompt share a spelling: a canonical name always beats an alias,
  // and between aliases the lower-tier (more generic) entity wins — "mako" goes to the generic mako shark,
  // not to the shortfin mako listed higher up.
  // taxa: { groupName: ['Common name', ...] } — a reference list of real species; prompt.taxon names the group and
  // prompt.taxonFilter (a regex source) limits it (letter prompts). Names already on the prompt are not duplicated.
  // Group-word variants come last and never displace a real spelling: "hammerhead" is registered for "Hammerhead
  // shark" only if no answer is called "hammerhead"; and a short form two answers would both claim ("blue" for Blue
  // shark and Blue whale) is kept in index.ambiguous so the game can offer both instead of guessing.
  function buildIndex(prompt, entitiesById, taxa) {
    const exact = new Map();
    const list = [];
    const variants = new Map();         // short form -> claim, or null once two answers have claimed it
    const bases = [];                   // every real spelling, to derive variants from
    const claim = (form, entityId, tierCode, display, kind) => {
      if (exact.has(form)) return;
      exact.set(form, { entityId, tier: tierCode, name: display, kind: kind || 'name' });
      list.push({ form, entityId, tier: tierCode, name: display, kind: kind || 'name' });
    };
    const base = (norm, entityId, tierCode, display, kind) => {
      if (!norm) return;
      for (const form of pluralForms(norm)) claim(form, entityId, tierCode, display, kind);
      const owner = exact.get(norm);
      if (owner && owner.entityId === entityId) bases.push({ norm, entityId, tier: tierCode, name: display });   // a spelling already owned by another answer (a reference-list duplicate of a hand-listed name) derives no variants
    };
    const answers = prompt.answers.filter(a => entitiesById[a.entity] && TIER_BY_CODE[a.tier]);
    for (const a of answers) base(normalise(entitiesById[a.entity].name), a.entity, a.tier, undefined, 'name');
    const byTier = answers.slice().sort((x, y) => TIER_BY_CODE[x.tier].points - TIER_BY_CODE[y.tier].points);
    for (const a of byTier) {
      for (const raw of (entitiesById[a.entity].aliases || [])) base(normalise(raw), a.entity, a.tier, undefined, 'alias');
    }
    const taxonNames = taxa && prompt.taxon ? taxonGroups(prompt.taxon).flatMap(g => taxa[g] || []) : [];
    if (taxonNames.length) {
      const filter = prompt.taxonFilter ? new RegExp(prompt.taxonFilter, 'i') : null;
      for (const raw of taxonNames) {
        const norm = normalise(raw);
        if (!norm || (filter && !filter.test(norm))) continue;
        base(norm, 'taxon:' + norm.replace(/ /g, '-'), TAXON_TIER, raw, 'taxon');
      }
    }
    const variant = (form, b) => {
      if (exact.has(form)) return;                                   // a real spelling always wins
      const cur = variants.get(form);
      if (cur === undefined) variants.set(form, [b]);
      else if (cur && !cur.some(x => x.entityId === b.entityId)) cur.push(b);
    };
    for (const b of bases) {
      const s = splitGroup(b.norm);
      if (s && coreOk(s.core)) for (const form of pluralForms(s.core)) variant(form, b);       // "hammerhead shark" -> hammerhead(s)
      const d = deglue(b.norm);
      if (d) for (const form of pluralForms(d)) variant(form, b);                               // "starfish" -> star fish(es)
    }
    const ambiguous = new Map();
    for (const [form, claims] of variants) {
      if (claims.length === 1) claim(form, claims[0].entityId, claims[0].tier, claims[0].name, 'variant');
      else ambiguous.set(form, claims.slice().sort((x, y) => TIER_BY_CODE[x.tier].points - TIER_BY_CODE[y.tier].points).map(c => ({ entityId: c.entityId, tier: c.tier, name: c.name || (entitiesById[c.entityId] ? entitiesById[c.entityId].name : form) })));
    }
    return { promptId: prompt.id, exact, list, ambiguous, taxon: prompt.taxon || null };
  }
  function isTaxonId(id) { return typeof id === 'string' && id.indexOf('taxon:') === 0; }
  // "sharks|rays" names a union of reference lists
  function taxonGroups(taxon) { return String(taxon || '').split('|').map(g => g.trim()).filter(Boolean); }
  const TAXON_FACTS = {
    fish: 'A real fish species from our reference list.', sharks: 'A real shark species from our reference list.',
    rays: 'A real ray or skate species from our reference list.', cetaceans: 'A real whale, dolphin or porpoise species from our reference list.',
    pinnipeds: 'A real seal or sea lion species from our reference list.', 'sea-reptiles': 'A real marine reptile species from our reference list.',
    seabirds: 'A real seabird species from our reference list.', cephalopods: 'A real cephalopod species from our reference list.',
    crustaceans: 'A real crustacean species from our reference list.', jellies: 'A real jellyfish or related species from our reference list.',
    molluscs: 'A real mollusc species from our reference list.', nudibranchs: 'A real sea slug species from our reference list.',
    echinoderms: 'A real echinoderm species from our reference list.', 'corals-anemones': 'A real coral, anemone or hydroid species from our reference list.',
    seaweeds: 'A real seaweed or coastal plant species from our reference list.', 'deep-sea': 'A real deep-sea species from our reference list.',
    'freshwater-fish': 'A real freshwater fish species from our reference list.', 'sea-creatures': 'A real marine species from our reference list.',
  };
  function taxonFact(taxon) {
    const groups = taxonGroups(taxon);
    return (groups.length === 1 && TAXON_FACTS[groups[0]]) || 'A real species from our reference lists.';
  }

  // How many edits a typed answer may be from a real spelling: by the letters typed (spaces do not count).
  function fuzzyBudget(norm) {
    const n = letterCount(norm);
    if (n < FUZZY_MIN_LETTERS) return 0;
    for (const [lo, hi, edits] of FUZZY_BANDS) if (n >= lo && n <= hi) return edits;
    return 0;
  }
  const VARIANT_RANK = { name: 0, alias: 1, taxon: 2, variant: 3 };
  function matchAnswer(typed, index) {
    const norm = normalise(typed);
    const miss = { entityId: null, tier: null, points: 0, via: null, norm };
    if (!norm) return miss;
    const found = (hit, via) => ({ entityId: hit.entityId, tier: hit.tier, points: TIER_BY_CODE[hit.tier].points, via, norm, name: hit.name || null });
    const hit = index.exact.get(norm);
    if (hit) return found(hit, hit.kind === 'variant' ? 'group' : 'exact');
    const ambiguous = index.ambiguous || new Map();
    if (ambiguous.has(norm)) return Object.assign(miss, { ambiguous: ambiguous.get(norm) });
    for (const form of groupForms(norm)) {                 // "tuna fish" -> tuna, "tunafish" -> tuna fish -> tuna
      const h = index.exact.get(form);
      if (h) return found(h, 'group');
      if (ambiguous.has(form)) return Object.assign(miss, { ambiguous: ambiguous.get(form) });
    }
    const maxDist = fuzzyBudget(norm);
    if (!maxDist) return miss;
    let best = null;
    for (const cand of index.list) {
      if (Math.abs(cand.form.length - norm.length) > maxDist) continue;
      const d = levenshtein(norm, cand.form);
      if (d > maxDist) continue;
      const lenDiff = Math.abs(cand.form.length - norm.length);
      const rank = VARIANT_RANK[cand.kind] || 0;
      const pts = TIER_BY_CODE[cand.tier].points;
      if (!best || d < best.d || (d === best.d && (lenDiff < best.lenDiff || (lenDiff === best.lenDiff && (rank < best.rank || (rank === best.rank && pts < best.pts)))))) {
        best = { cand, d, lenDiff, rank, pts };
      }
    }
    if (!best) return miss;
    return { entityId: best.cand.entityId, tier: best.cand.tier, points: best.pts, via: 'fuzzy', norm, distance: best.d, name: best.cand.name || null };
  }

  // "Did you mean": spelling help for a rejected guess. Returns up to SUGGEST_MAX candidates — never from fewer than
  // SUGGEST_MIN_LEN typed characters, never for input that is nothing like any answer. A candidate is an answer whose
  // spelling is 3–4 edits away, or the same words in another order, or missing exactly one word of a longer answer.
  function suggestAnswers(typed, index, entitiesById) {
    const norm = normalise(typed);
    const display = (cand) => {
      if (cand.name) return cand.name;
      const e = entitiesById && entitiesById[cand.entityId];
      return e ? e.name : cand.form;
    };
    // a short form that fits several answers: offer every one of them, most common first
    const ambiguous = index.ambiguous || new Map();
    for (const form of [norm].concat(groupForms(norm))) {
      if (ambiguous.has(form)) return ambiguous.get(form).slice(0, AMBIGUOUS_MAX).map(c => ({ name: display(c), entityId: c.entityId, tier: c.tier }));
    }
    if (norm.length < SUGGEST_MIN_LEN) return [];
    const typedWords = norm.split(' ');
    const seen = new Set();
    const out = [];
    const maxSuggest = fuzzyBudget(norm) + SUGGEST_EXTRA_DIST;
    const scored = [];
    for (const cand of index.list) {
      if (cand.form === norm || cand.kind === 'variant') continue;
      const words = cand.form.split(' ');
      let score = null;
      const lenDiff = Math.abs(cand.form.length - norm.length);
      if (lenDiff <= maxSuggest) {
        const d = levenshtein(norm, cand.form);
        if (d > 0 && d <= maxSuggest && d < norm.length / 2) score = d;
      }
      if (score == null && words.length > 1 && words.length === typedWords.length && words.slice().sort().join(' ') === typedWords.slice().sort().join(' ')) score = 0.5;
      if (score == null && words.length === typedWords.length + 1 && typedWords.every(w => words.includes(w))) score = 0.75;
      if (score != null) scored.push({ cand, score });
    }
    scored.sort((a, b) => a.score - b.score || TIER_BY_CODE[a.cand.tier].points - TIER_BY_CODE[b.cand.tier].points);
    for (const { cand } of scored) {
      const key = cand.entityId;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: display(cand), entityId: cand.entityId, tier: cand.tier });
      if (out.length >= SUGGEST_MAX) break;
    }
    return out;
  }

  // A hint points at one rarer answer the player has not given: returns its first letter and word shape.
  function pickHint(prompt, entitiesById, alreadyEntityIds, rng) {
    const pool = prompt.answers.filter(a => HINT_TIERS.includes(a.tier) && entitiesById[a.entity] && !(alreadyEntityIds || []).includes(a.entity));
    if (!pool.length) return null;
    const r = rng || Math.random;
    const a = pool[Math.floor(r() * pool.length)];
    const name = entitiesById[a.entity].name;
    const shape = name.split(' ').map((w, i) => (i === 0 ? w[0] + '_'.repeat(Math.max(0, w.length - 1)) : '_'.repeat(w.length))).join(' ');
    return { entityId: a.entity, tier: a.tier, firstLetter: name[0].toUpperCase(), shape, letters: name.replace(/[^a-z]/gi, '').length };
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
  // The UTC instant at which the next day begins in the zone (DST-safe: the offset is re-read at the target).
  function nextMidnightUtc(date, tz) {
    const now = date || new Date();
    const next = keyPlusDays(dayKey(now, tz), 1);
    let guess = keyToUtc(next);
    for (let i = 0; i < 3; i++) {
      const p = tzParts(new Date(guess), tz);
      const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
      guess = keyToUtc(next) - (wall - guess);
    }
    return guess;
  }
  function msUntilNextDay(date, tz) {
    const now = date || new Date();
    return Math.max(0, nextMidnightUtc(now, tz) - now.getTime());
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

  // ---- the daily schedule
  // Past and present days are frozen in data/schedule.json (shipped as window.FATHOM_SCHEDULE and imported by the
  // server), so adding prompts never changes a day anyone has played. Days beyond the frozen horizon are generated
  // on the fly with the same rule: prefer the least recently scheduled prompts (never-scheduled first), break ties
  // with a per-day seeded shuffle, keep the seven groups distinct, then order by difficulty.
  function pickDay(key, prompts, promptsById, lastUsed) {
    const rng = seededRng('fathom-day:' + key);
    const order = shuffle(prompts.map(p => p.id).sort(), rng);
    order.sort((a, b) => {
      const la = lastUsed[a] == null ? -1 : lastUsed[a], lb = lastUsed[b] == null ? -1 : lastUsed[b];
      return la - lb;                                          // stable: ties keep the shuffled order
    });
    let { picked } = pickDistinctGroups(order, promptsById, PROMPTS_PER_DIVE);
    if (picked.length < PROMPTS_PER_DIVE) picked = order.slice(0, PROMPTS_PER_DIVE);
    return sortByDifficulty(picked, promptsById);
  }
  // Returns a new schedule object: days before `fromKey` copied from `existing`, days from `fromKey` to `toKey` generated.
  function buildSchedule(prompts, existing, fromKey, toKey) {
    const promptsById = byId(prompts);
    const out = {};
    const lastUsed = {};
    const keys = Object.keys(existing || {}).sort();
    let idx = 0;
    for (const k of keys) {
      if (k >= fromKey) break;
      out[k] = existing[k].slice();
      for (const id of out[k]) lastUsed[id] = idx;
      idx++;
    }
    for (let k = fromKey; k <= toKey; k = keyPlusDays(k, 1)) {
      out[k] = pickDay(k, prompts, promptsById, lastUsed);
      for (const id of out[k]) lastUsed[id] = idx;
      idx++;
    }
    return out;
  }
  const extendCache = new Map();
  function dailyPromptIds(key, prompts, launch, schedule) {
    const idx = dayIndex(key, launch);
    if (idx < 0) return null;
    const sched = schedule || (typeof globalThis !== 'undefined' && globalThis.FATHOM_SCHEDULE) || null;
    if (sched && sched[key]) return sched[key].slice();
    // beyond the frozen horizon (or no schedule shipped): extend deterministically from what we have
    const cacheKey = prompts.map(p => p.id).join('|') + '#' + (sched ? Object.keys(sched).length : 0);
    let ext = extendCache.get(cacheKey);
    if (!ext || !ext[key]) {
      const known = Object.keys(sched || {}).sort();
      const from = known.length ? keyPlusDays(known[known.length - 1], 1) : (launch || LAUNCH_DATE);
      ext = buildSchedule(prompts, sched || {}, from, key > from ? key : from);
      extendCache.set(cacheKey, ext);
    }
    return ext[key] ? ext[key].slice() : null;
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
  // seeds: a free-dive seed (4–12 chars), 'd' + YYYYMMDD for a daily/archive day, 'k' + pack index for a themed pack
  const CHALLENGE_RE = /^#\/?challenge[-\/]([a-z0-9]{2,12})(?:-(\d{1,5}))?(?:-([0-6]{7}))?\/?$/;
  const DAY_SEED_RE = /^d(\d{4})(\d{2})(\d{2})$/;
  const PACK_SEED_RE = /^k(\d{1,2})$/;
  function makeChallengeHash(seed, depth, tierCodes) {
    let h = '#challenge-' + seed;
    if (depth != null) h += '-' + Math.max(0, Math.round(depth));
    if (tierCodes && tierCodes.length === PROMPTS_PER_DIVE) h += '-' + tiersToDigits(tierCodes);
    return h;
  }
  function parseChallenge(hash) {
    const m = CHALLENGE_RE.exec(String(hash || '').trim().toLowerCase());
    if (!m) return null;
    const seed = m[1];
    const day = DAY_SEED_RE.exec(seed);
    const pack = PACK_SEED_RE.exec(seed);
    const kind = day ? 'day' : pack ? 'pack' : 'free';
    if (kind === 'free' && seed.length < 4) return null;
    return { seed, kind, dayKey: day ? day[1] + '-' + day[2] + '-' + day[3] : null, packIndex: pack ? Number(pack[1]) : null, depth: m[2] ? Number(m[2]) : 0, tiers: m[3] ? digitsToTiers(m[3]) : null };
  }
  // The seed that reproduces a finished dive's prompt set, for "Challenge a friend" in every mode.
  function challengeSeedFor(record, packs) {
    if (record.mode === 'daily' || record.mode === 'archive') return record.dayKey ? 'd' + record.dayKey.replace(/-/g, '') : null;
    if (record.mode === 'pack') { const i = (packs || []).findIndex(p => p.id === record.packId); return i >= 0 ? 'k' + i : null; }
    return record.seed || null;
  }
  // The prompt ids a challenge seed stands for (null when the day is outside the schedule or the pack is unknown).
  function challengePromptIds(parsed, prompts, packs, schedule) {
    if (!parsed) return null;
    if (parsed.kind === 'day') return dailyPromptIds(parsed.dayKey, prompts, LAUNCH_DATE, schedule);
    if (parsed.kind === 'pack') { const pack = (packs || [])[parsed.packIndex]; return pack ? packPromptIds(pack, prompts) : null; }
    return freePromptIds(parsed.seed, prompts);
  }

  // ---------------------------------------------------------------- share text
  function formatMeters(n) { return Math.round(n).toLocaleString('en-US'); }
  // opts: { number | label, depth, tiers, beat?, rank?, total?, siteUrl? } — beat/rank/total only once the server has answered
  function shareText(opts) {
    const bits = [opts.label ? BRAND + ' ' + opts.label : BRAND + ' #' + opts.number, formatMeters(opts.depth) + ' m'];
    if (opts.beat != null) bits.push('beat ' + opts.beat + '%');
    if (opts.rank != null && opts.total != null) bits.push('#' + opts.rank + ' of ' + opts.total);
    bits.push(tiersToEmoji(opts.tiers));
    let s = bits.join(' · ');
    if (opts.siteUrl) s += '\n' + opts.siteUrl;
    return s;
  }
  // "You beat X% of divers today": the share of the OTHER divers who did not reach your depth. null until someone else dives.
  function beatPercent(c) {
    const total = Number(c && c.total) || 0;
    if (total < 2 || c.atOrAbove == null) return null;
    const below = Math.max(0, total - Number(c.atOrAbove));
    return Math.round(100 * below / (total - 1));
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
  // Server-side scoring with hints and multiple guesses: each answer is {typed, secondsUsed, hint?:boolean}; taxa optional.
  function scoreSubmissionFull(submission, prompts, entitiesById, taxa) {
    const promptsById = Array.isArray(prompts) ? byId(prompts) : prompts;
    const ids = submission.promptIds || [];
    const results = [];
    let points = 0, secondsUsed = 0;
    for (let i = 0; i < ids.length; i++) {
      const prompt = promptsById[ids[i]];
      const ans = (submission.answers && submission.answers[i]) || { typed: '', secondsUsed: SECONDS_PER_PROMPT };
      if (!prompt) { results.push({ promptId: ids[i], entityId: null, tier: null, points: 0, typed: ans.typed || '' }); continue; }
      const m = matchAnswer(ans.typed || '', buildIndex(prompt, entitiesById, taxa));
      const earned = Math.max(0, m.points - (ans.hint ? HINT_COST : 0));
      points += earned;
      secondsUsed += Math.min(SECONDS_PER_PROMPT, Math.max(0, Number(ans.secondsUsed) || 0));
      results.push({ promptId: ids[i], typed: ans.typed || '', entityId: m.entityId, tier: m.tier, points: earned, via: m.via, hint: !!ans.hint });
    }
    return { points, depth: depthFor(points), secondsUsed, results, tiers: results.map(r => r.tier) };
  }

  return {
    BRAND, TAGLINE, PROMPTS_PER_DIVE, SECONDS_PER_PROMPT, CHALLENGER_DEEP_M, TIMEZONE, LAUNCH_DATE, MAX_POINTS, METERS_PER_POINT,
    TIERS, TIER_BY_CODE, MISS, ZONES, LANDMARKS,
    SUGGEST_MIN_LEN, SUGGEST_EXTRA_DIST, SUGGEST_MAX, AMBIGUOUS_MAX, TAXON_TIER, HINT_COST, HINT_TIERS, GROUP_WORDS, FUZZY_BANDS, FUZZY_MIN_LETTERS,
    normalise, pluralForms, levenshtein, buildIndex, matchAnswer, suggestAnswers, pickHint, isTaxonId, taxonGroups, taxonFact, scoreSubmissionFull,
    splitGroup, deglue, groupForms, fuzzyBudget, beatPercent,
    depthFor, zoneFor, tierForCode, tiersToEmoji, tiersToDigits, digitsToTiers,
    fnv1a, seededRng, shuffle, randomSeed,
    dayKey, dayIndex, puzzleNumber, keyPlusDays, msUntilNextDay, nextMidnightUtc,
    dailyPromptIds, buildSchedule, pickDay, freePromptIds, packPromptIds, sortByDifficulty, byId,
    makeChallengeHash, parseChallenge, challengeSeedFor, challengePromptIds, shareText, formatMeters, scoreSubmission,
  };
});
