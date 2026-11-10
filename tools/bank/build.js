#!/usr/bin/env node
'use strict';
/* Tops every live question up to MIN_ANSWERS sourced answers (ANGLER v4, section 3).
 *   node tools/bank/build.js [--only id,id] [--dry] [--need N] [--concurrency N]
 * Reads tools/bank/questions.js for where each question's candidates come from, resolves candidates through
 * tools/bank/resolve.js (GBIF, FishBase, SeaLifeBase, Wikipedia, Wikidata — all cached), builds entities with a
 * `source`, tiers new answers by fame (Wikipedia sitelinks) under the question's existing famous answers, enforces
 * the tier floors, retires questions that cannot reach the floor and adds the replacement questions. Writes
 * data/prompts.json, data/entities.json, data/prompt-seeds.json and tools/bank/report.json. */
const fs = require('fs');
const path = require('path');
const dive = require('../../shared/dive.js');
const { makeClient } = require('./fetch.js');
const parse = require('./parse.js');
const { resolveSpecies, resolveThing, slug } = require('./resolve.js');
const { Q, REPLACE, ALL_ANIMAL_GROUPS } = require('./questions.js');

const ROOT = path.join(__dirname, '..', '..');
const MIN_ANSWERS = 75;
const FLOORS = { hadal: 1, midnight: 3, twilight: 8, reef: 12, baitball: 8, tidepool: 5 };
const TIER_ORDER = ['tidepool', 'baitball', 'reef', 'twilight', 'midnight'];
const FAME = [['tidepool', 70], ['baitball', 45], ['reef', 28], ['twilight', 16]];   // sitelinks -> tier (else midnight)
const NEW_MAX_TIER = 'reef';                 // a new answer never enters the two "everyone says it" tiers unless a floor needs it
const SLACK = 12;                            // verified candidates beyond the need, so the most famous can be chosen
const CANDIDATE_CAP = 600;                   // reference-list names tried per question at most (the existing bank is retried free)
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
const ONLY = arg('--only', '') ? arg('--only').split(',') : null;
const DRY = args.includes('--dry');
const NEED = Number(arg('--need', MIN_ANSWERS));
const CONC = Number(arg('--concurrency', 6));
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

const entities = read('entities.json');
const prompts = read('prompts.json');
const seeds = read('prompt-seeds.json');
const taxa = read('taxa.json');
const byId = Object.fromEntries(entities.map(e => [e.id, e]));
const byNorm = new Map();                    // normalised canonical name -> entity (for reuse)
for (const e of entities) byNorm.set(dive.normalise(e.name), e);
const client = makeClient();
const report = { started: new Date().toISOString(), questions: [], retired: [], added: [] };
const created = new Set();                   // ids made in this run (a collision drop may leave one unreferenced)
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function rng(seed) { const r = dive.seededRng(seed); return () => r(); }
function shuffled(arr, seed) { return dive.shuffle(arr.slice(), rng(seed)); }
function tierFor(sitelinks) { for (const [t, min] of FAME) if ((sitelinks || 0) >= min) return t; return 'midnight'; }
function capTier(t) { return TIER_ORDER.indexOf(t) < TIER_ORDER.indexOf(NEW_MAX_TIER) ? NEW_MAX_TIER : t; }
function fmtLen(cm) { return cm >= 100 ? (Math.round(cm / 10) / 10).toString().replace(/\.0$/, '') + ' m' : (Math.round(cm * 10) / 10) + ' cm'; }
const firstClause = parse.firstClause;
function sentenceMatching(text, re) { for (const s of String(text || '').split(/(?<=\.)\s+/)) if (re.test(s) && s.length >= 25) return s.trim(); return null; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// One true, specific, sourced fact for a species from its FishBase / SeaLifeBase page.
function speciesFact(rec, factRe) {
  const f = rec.fb;
  const name = rec.name;
  if (factRe && f && f.biology) {
    const s = sentenceMatching(f.biology, factRe);
    if (s) return parse.clampFact(/^(it|this|they|the|a|an)\b/i.test(s) ? name + ': ' + s.charAt(0).toLowerCase() + s.slice(1) : s, 240);
  }
  const bits = [];
  if (f.maxLengthCm) bits.push('grows to ' + fmtLen(f.maxLengthCm) + (f.maxWeightKg >= 1 ? ' and ' + (Math.round(f.maxWeightKg * 10) / 10) + ' kg' : ''));
  const where = [f.marine ? 'marine' : null, f.brackish ? 'brackish' : null, f.freshwater ? 'fresh' : null].filter(Boolean);
  if (where.length) bits.push('lives in ' + where.join(', ').replace(/, ([^,]*)$/, ' and $1') + ' water' + (f.reef ? ' around reefs' : '') + (f.depth && f.depth.max != null ? ' down to ' + f.depth.max + ' m' : ''));
  else if (f.depth && f.depth.max != null) bits.push('lives down to ' + f.depth.max + ' m');
  if (f.distribution) { const c = firstClause(f.distribution, 90); bits.push('range: ' + c); }
  if (f.iucn && f.iucnCode && !['NE', 'DD'].includes(f.iucnCode)) bits.push('listed as ' + f.iucn + ' on the IUCN Red List');
  if (!bits.length && f.biology) return parse.clampFact(f.biology, 240);
  if (!bits.length) return null;
  const assemble = () => name + ' ' + bits.join('; ');
  if (assemble().length > 239) { const i = bits.findIndex(b => b.startsWith('range: ')); if (i >= 0) bits.splice(i, 1); }   // whole clauses go, the long range first, the status last
  while (bits.length > 1 && assemble().length > 239) bits.pop();
  return parse.clampFact(assemble(), 240);
}
function speciesAliases(rec, existingNorms) {
  const out = [];
  const add = (a) => { const n = dive.normalise(a); if (n && n !== dive.normalise(rec.name) && !out.some(x => dive.normalise(x) === n) && !existingNorms.has(n)) out.push(a); };
  if (rec.sci) add(rec.sci);
  if (rec.fb && rec.fb.common && /^[A-Za-z' -]+$/.test(rec.fb.common)) add(rec.fb.common);
  if (rec.wiki && rec.wiki.title && /^[A-Za-z' -]+$/.test(rec.wiki.title) && !/^[A-Z][a-z]+ [a-z]+$/.test(rec.wiki.title)) add(rec.wiki.title);
  return out.slice(0, 4);
}
function thingFact(rec) {
  const first = rec.wiki && rec.wiki.first;
  const desc = (rec.wd && rec.wd.description) || (rec.wiki && rec.wiki.short) || null;
  const fromDesc = desc ? parse.clampFact(rec.title + ' is ' + (/^(a|an|the)\b/i.test(desc) ? '' : /^[aeiou]/i.test(desc) ? 'an ' : 'a ') + desc, 240) : null;
  if (first && first.length >= 30) {
    const f = parse.clampFact(first, 240);
    if (!parse.DANGLING.test(f.replace(/\.$/, '')) && f.length >= 30) return f;   // a sentence that had to be cut short gives way to the description
    if (fromDesc) return fromDesc;
    return f;
  }
  return fromDesc;
}
function thingAliases(rec, display) {
  const out = [];
  const n0 = dive.normalise(display);
  const add = (a) => { const n = dive.normalise(a); if (n && n !== n0 && !out.some(x => dive.normalise(x) === n)) out.push(a); };
  if (rec.title !== display) add(rec.title.replace(/\s*\([^)]*\)\s*$/, ''));
  for (const a of ((rec.wd && rec.wd.aliases) || []).slice(0, 3)) add(a);
  return out.slice(0, 4);
}
function descText(rec) { return [(rec.wd && rec.wd.description) || '', (rec.wiki && rec.wiki.short) || '', (rec.wiki && rec.wiki.first) || ''].join(' | '); }
const seedsById = Object.fromEntries(seeds.map(s => [s.id, s]));

// ---------------------------------------------------------------- candidates
function taxonNames(groups, filter) {
  const out = [];
  for (const g of groups) for (const n of (taxa[g] || [])) if (!filter || filter.test(dive.normalise(n)) || filter.test(n)) out.push(n);
  return out;
}
// Reference-list groups that take any creature; the others (sharks, rays, cetaceans…) only take an existing entity
// whose name or scientific name is on their list — a bowfin with the alias "dogfish" is not a shark.
const BROAD_GROUPS = ['fish', 'freshwater-fish', 'deep-sea', 'sea-creatures'];
const listedCache = new Map();
function listedNames(groups) {
  const key = groups.join('|');
  if (!listedCache.has(key)) { const set = new Set(); for (const g of groups) for (const n of (taxa[g] || [])) set.add(dive.normalise(n)); listedCache.set(key, set); }
  return listedCache.get(key);
}
function entityNames(groups, re) {
  const out = [];
  const strict = groups && groups.length && !groups.some(g => BROAD_GROUPS.includes(g));
  const listed = strict ? listedNames(groups) : null;
  for (const e of entities) {
    if (e.kind !== 'creature' && e.kind !== 'plant') continue;
    if (re && !re.test(e.name)) continue;                                   // the name itself, never an alias
    if (listed && !listed.has(dive.normalise(e.name)) && !(e.aliases || []).some(a => listed.has(dive.normalise(a)))) continue;
    out.push(e.name);
  }
  return out;
}
function loadList(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, 'lists', name + '.json'), 'utf8')); }
function candidatesFor(prompt, cfg) {
  const seen = new Set();
  const out = [];
  const push = (raw, display) => { const n = dive.normalise(display || raw); if (!n || seen.has(n)) return; seen.add(n); out.push({ raw, display: display || raw }); };
  if (cfg.list) {
    const excl = new Set((cfg.exclude || []).map(x => x.split('|')[0]));
    for (const item of loadList(cfg.list)) { const [title, display] = String(item).split('|'); if (excl.has(title)) continue; push(title, display || title.replace(/\s*\([^)]*\)\s*$/, '')); }
    return out;
  }
  if (cfg.extraList) for (const item of loadList(cfg.extraList)) { const [title, display] = String(item).split('|'); push(title, display || title); }   // hand-picked species first
  const filter = cfg.taxonFilter ? new RegExp(cfg.taxonFilter, 'i') : prompt.taxonFilter ? new RegExp(prompt.taxonFilter, 'i') : null;
  const re = cfg.nameRe || null;
  // reference-list names first (shuffled, so the alphabet does not decide), then existing entities (a cheap, well-known pool)
  let pool = [];
  if (cfg.pool === 'taxon' || cfg.taxon || prompt.taxon) pool = pool.concat(taxonNames(dive.taxonGroups(cfg.taxon || prompt.taxon), filter));
  if (cfg.groups && re) pool = pool.concat(taxonNames(cfg.groups, re));
  if (cfg.corpus) {
    const ents = entityNames(cfg.groups, re || null);
    for (const n of ents) push(n);                     // existing entities are famous by construction: they come first
  }
  if (cfg.groups && re) for (const n of entityNames(cfg.groups, re)) push(n);
  // existing entities are cached after the first run and cost nothing to retry, so they never crowd out the
  // reference-list names: the cap bounds the list names only (the network cost of a question)
  const fromCorpus = out.length;
  const uniq = Array.from(new Set(pool));
  for (const n of shuffled(uniq, 'bank:' + prompt.id)) { if (out.length >= fromCorpus + CANDIDATE_CAP) break; push(n); }
  return out;
}

// ---------------------------------------------------------------- verification
function passes(rec, cfg, isSpecies) {
  if (!rec) return false;
  if (isSpecies) {
    if (cfg.fish && !rec.fish) return false;
    const byArticle = !!(cfg.rawRe && rec._raw && cfg.rawRe.test(rec._raw));     // the Wikipedia article (loaded by topUp) as a second witness
    if (cfg.fb && !cfg.fb(rec.fb) && !byArticle) return false;
    if (!rec.fb && !cfg.fb && !(rec.wiki && rec.wiki.first)) return false;   // no page anywhere: no sourced fact
    if (!rec.fb && byArticle && !(rec.wiki && rec.wiki.first)) return false;
    return true;
  }
  const d = descText(rec);
  if (cfg.descRe && !cfg.descRe.test(d)) return false;
  if (cfg.rawRe && !(rec._raw && cfg.rawRe.test(rec._raw))) return false;   // the whole article (loaded by topUp), not just its first sentence
  if (cfg.exRe && cfg.exRe.test((rec.wd && rec.wd.description) || '') ) return false;
  if (cfg.exRe && cfg.exRe.test((rec.wiki && rec.wiki.short) || '')) return false;
  return !!thingFact(rec);
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------------------------------------------------------------- one question
// The same species (scientific name) or the same Wikipedia article as an answer already on the question is the
// same answer under another name ("Maneater" for the great white shark), never a second one.
const BINOMIAL = /^[A-Z][a-z]+ [a-z]+$/;
function duplicateOf(prompt, rec, display) {
  if (!rec) return false;
  const sci = rec.sci ? dive.normalise(rec.sci) : null;
  const title = rec.wiki && rec.wiki.title ? dive.normalise(rec.wiki.title) : rec.title ? dive.normalise(rec.title) : null;
  const src = rec.source ? dive.normalise(rec.source) : null;
  for (const a of prompt.answers) {
    const e = byId[a.entity];
    if (!e) continue;
    const forms = [e.name].concat(e.aliases || []).map(dive.normalise);
    if (sci && forms.includes(sci)) return true;
    if (title && forms.includes(title)) return true;
    if (sci && e.source && dive.normalise(e.source).includes(sci)) return true;
    if (src && src === dive.normalise(e.source || '')) return true;
  }
  return false;
}
async function topUp(prompt, cfg) {
  const isSpecies = !cfg.list;
  const index = dive.buildIndex(prompt, byId, taxa);
  const have = prompt.answers.length;
  const need = Math.max(0, NEED - have);
  const existingNorms = new Set();
  for (const a of prompt.answers) { const e = byId[a.entity]; if (!e) continue; existingNorms.add(dive.normalise(e.name)); for (const al of e.aliases || []) existingNorms.add(dive.normalise(al)); }
  const covered = (name) => { const m = dive.matchAnswer(name, index); return !!(m.entityId && !dive.isTaxonId(m.entityId)) || existingNorms.has(dive.normalise(name)); };
  const cands = candidatesFor(prompt, cfg).filter(c => !covered(c.display));
  log(prompt.id + ': ' + have + ' answers, need ' + need + ', ' + cands.length + ' candidates');
  const accepted = [];
  const acceptedNorms = new Set();
  let tried = 0;
  for (let start = 0; start < cands.length && accepted.length < need + SLACK; start += CONC * 4) {
    const batch = cands.slice(start, start + CONC * 4);
    const recs = await mapLimit(batch, CONC, (c) => isSpecies ? resolveSpecies(client, c.raw) : resolveThing(client, c.raw));
    if (cfg.rawRe) await mapLimit(recs, CONC, async (rec) => {
      const title = rec && (rec.title || (rec.wiki && rec.wiki.title));
      if (!title || rec._raw != null) return;
      try { const page = await client.wikiPage(title); rec._raw = (page && page.raw) || ''; } catch (e) { rec._raw = ''; }
    });
    for (let i = 0; i < batch.length; i++) {
      tried++;
      const rec = recs[i];
      if (!passes(rec, cfg, isSpecies)) continue;
      const display = isSpecies ? batch[i].display : batch[i].display;
      const norm = dive.normalise(display);
      if (acceptedNorms.has(norm) || existingNorms.has(norm)) continue;
      // a second candidate resolving to the same species (synonymous common names) is the same answer
      if (isSpecies && rec.sci && accepted.some(a => a.rec.sci === rec.sci)) continue;
      if (!isSpecies && accepted.some(a => a.rec.title === rec.title)) continue;
      const existing = byNorm.get(norm);
      if (existing && prompt.answers.some(a => a.entity === existing.id)) continue;
      if (duplicateOf(prompt, rec, display)) continue;
      if (isSpecies && rec.wiki && rec.wiki.title && accepted.some(a => a.rec.wiki && a.rec.wiki.title === rec.wiki.title)) continue;   // two vernaculars, one article
      acceptedNorms.add(norm);
      accepted.push({ display, rec, fame: (rec.wd && rec.wd.sitelinks) || 0, occ: rec.occ || 0, existing: existing || null });
    }
  }
  accepted.sort((a, b) => b.fame - a.fame || b.occ - a.occ);
  log(prompt.id + ': ' + accepted.length + ' verified of ' + tried + ' tried');
  return { have, need, accepted, tried };
}

function makeEntity(a, cfg, isSpecies, promptId) {
  const rec = a.rec;
  const factRe = isSpecies && cfg.fb && cfg.fb._re ? cfg.fb._re : null;
  const fact = isSpecies ? (rec.fb ? speciesFact(rec, factRe) : parse.clampFact(rec.wiki.first, 240)) : thingFact(rec);
  const source = isSpecies ? (rec.fb ? rec.src + ' summary page for ' + rec.sci + (rec.fb.iucnCode ? ' (IUCN status via ' + rec.src + ')' : '') : 'Wikipedia: ' + rec.wiki.title + ' (CC BY-SA 4.0)') : (rec.wiki && rec.wiki.first && rec.wiki.first.length >= 30 ? 'Wikipedia: ' + rec.wiki.title + ' (CC BY-SA 4.0)' : 'Wikidata ' + (rec.wd && rec.wd.q));
  if (a.existing) return a.existing;                                 // a hand-written entity keeps its own fact and aliases
  if (!fact) return null;                                            // no fact, no answer: never an orphan entity
  let id = slug(a.display);
  created.add(id);
  if (byId[id]) { let n = 2; while (byId[id + '-' + n]) n++; id = id + '-' + n; }
  const e = {
    id, name: a.display, aliases: isSpecies ? speciesAliases(rec, new Set()) : thingAliases(rec, a.display),
    kind: cfg.kind || (isSpecies ? 'creature' : 'other'), group: cfg.group || (isSpecies ? (rec.fish ? 'fish' : 'sea-creatures') : 'other'), fact, source,
  };
  entities.push(e); byId[id] = e; byNorm.set(dive.normalise(e.name), e);
  return e;
}

// Tier floors: promote the most famous answers from the tier below until every floor is met.
function enforceFloors(prompt, fameById) {
  const count = (t) => prompt.answers.filter(a => a.tier === t).length;
  const fame = (a) => fameById[a.entity] || 0;
  // the common tiers fill up from below with the most famous answers…
  for (let i = 0; i < TIER_ORDER.length - 1; i++) {
    const t = TIER_ORDER[i], below = TIER_ORDER[i + 1];
    let guard = 0;
    while (count(t) < FLOORS[t] && guard++ < 100) {
      const pool = prompt.answers.filter(a => a.tier === below).sort((x, y) => fame(y) - fame(x));
      if (!pool.length) { // promote from any lower tier
        const lower = prompt.answers.filter(a => TIER_ORDER.indexOf(a.tier) > i + 1 && a.tier !== 'hadal').sort((x, y) => fame(y) - fame(x));
        if (!lower.length) break;
        lower[0].tier = t; continue;
      }
      pool[0].tier = t;
    }
  }
  // …and the rare tiers fill up from above with the least famous ones (a question of famous seabirds still needs
  // Midnight and Twilight answers), taking from the nearest tier that has more than its own floor
  for (let i = TIER_ORDER.length - 1; i >= 1; i--) {
    const t = TIER_ORDER[i];
    let guard = 0;
    while (count(t) < FLOORS[t] && guard++ < 100) {
      let moved = false;
      for (let j = i - 1; j >= 0 && !moved; j--) {
        const from = TIER_ORDER[j];
        if (count(from) <= FLOORS[from]) continue;
        const idx = (a) => prompt.answers.indexOf(a);
        const pool = prompt.answers.filter(a => a.tier === from).sort((x, y) => fame(x) - fame(y) || idx(y) - idx(x));   // unknown fame: the list runs famous to obscure
        pool[0].tier = t; moved = true;
      }
      if (!moved) break;
    }
  }
}
// no two answers may own the same normalised name; the matcher must give every answer its own name
function dropCollisions(prompt) {
  for (let pass = 0; pass < 5; pass++) {
    const index = dive.buildIndex(prompt, byId, taxa);
    const bad = new Set();
    for (const a of prompt.answers) { const e = byId[a.entity]; if (!e) continue; const m = dive.matchAnswer(e.name, index); if (m.entityId !== e.id) bad.add(a.entity); }
    if (!bad.size) return;
    // keep the original answers; drop the added ones that collide (added answers are at the end)
    const keep = prompt.answers.filter((a, i) => !bad.has(a.entity) || i < (prompt._originalCount || 0));
    if (keep.length === prompt.answers.length) { prompt.answers = prompt.answers.filter(a => !bad.has(a.entity) || a.tier === 'hadal'); } else prompt.answers = keep;
  }
}

async function run() {
  const live = [];
  for (const p of prompts) {
    const cfg = Q[p.id] || (p.taxon ? { pool: 'taxon' } : null);
    if (!cfg) { log('no config for ' + p.id + ' — skipped'); continue; }
    if (cfg.retire) { if (!p.retired) { p.retired = true; if (seedsById[p.id]) seedsById[p.id].retired = true; } report.retired.push({ id: p.id, answers: p.answers.length }); continue; }
    live.push([p, cfg]);
  }
  // replacement questions
  for (const r of REPLACE) {
    if (prompts.some(p => p.id === r.id)) continue;
    const seed = { id: r.id, text: r.text, group: r.group, difficulty: r.difficulty };
    if (r.taxon) seed.taxon = r.taxon;
    if (r.taxonFilter) seed.taxonFilter = r.taxonFilter;
    seeds.push(seed); seedsById[r.id] = seed;
    const p = { id: r.id, text: r.text, group: r.group, difficulty: r.difficulty, answers: [] };
    if (r.taxon) p.taxon = r.taxon;
    if (r.taxonFilter) p.taxonFilter = r.taxonFilter;
    prompts.push(p);
    report.added.push(r.id);
  }
  for (const r of REPLACE) { const p = prompts.find(x => x.id === r.id); if (p && !live.some(([q]) => q.id === p.id)) live.push([p, Object.assign({ pool: r.taxon ? 'taxon' : undefined }, r)]); }

  for (const [p, cfg] of live) {
    if (ONLY && !ONLY.includes(p.id)) continue;
    if (p.answers.length >= NEED && !p._fresh) {
      const fame = {};
      enforceFloors(p, fame);
      report.questions.push({ id: p.id, before: p.answers.length, after: p.answers.length, added: 0, retired: false });
      continue;
    }
    p._originalCount = p.answers.length;
    const { have, need, accepted } = await topUp(p, cfg);
    const isSpecies = !cfg.list;
    const fameById = {};
    const hadHadal = p.answers.some(a => a.tier === 'hadal');
    let nextCand = 0;
    const addUntilFull = () => {                   // most famous first, until the floor is met or the verified candidates run out
      while (nextCand < accepted.length && p.answers.length < NEED) {
        const a = accepted[nextCand++];
        const e = makeEntity(a, cfg, isSpecies, p.id);
        if (!e || !e.fact) continue;
        fameById[e.id] = a.fame;
        p.answers.push({ entity: e.id, tier: capTier(tierFor(a.fame)) });
      }
    };
    addUntilFull();
    if (!hadHadal && p.answers.length) {           // a brand-new question: its Hadal is the least famous verified answer with a page
      const least = p.answers.slice().sort((x, y) => (fameById[x.entity] || 0) - (fameById[y.entity] || 0))[0];
      least.tier = 'hadal';
    }
    dropCollisions(p);
    for (let k = 0; k < 4 && p.answers.length < NEED && nextCand < accepted.length; k++) { addUntilFull(); dropCollisions(p); }   // a collision drop is refilled from the slack
    enforceFloors(p, fameById);
    const after = p.answers.length;
    const retired = after < NEED;
    p.retired = retired; if (seedsById[p.id]) { if (retired) seedsById[p.id].retired = true; else delete seedsById[p.id].retired; }
    if (!retired) delete p.retired;
    if (retired) report.retired.push({ id: p.id, answers: after, reason: 'only ' + accepted.length + ' verified candidates' });
    report.questions.push({ id: p.id, before: have, after, added: after - have, retired });
    log(p.id + ': ' + have + ' -> ' + after + (retired ? '  RETIRED (could not reach ' + NEED + ')' : ''));
    delete p._originalCount;
    if (!DRY) save();
  }
  report.finished = new Date().toISOString();
  report.fetch = client.stats;
  fs.writeFileSync(path.join(__dirname, 'report.json'), JSON.stringify(report, null, 1));
  if (!DRY) save();
  log('done: ' + report.questions.length + ' questions, ' + report.retired.length + ' retired, ' + report.added.length + ' added; entities ' + entities.length);
}
function save() {
  for (const p of prompts) delete p._fresh;
  const referenced = new Set();
  for (const p of prompts) for (const a of p.answers) referenced.add(a.entity);
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    if (created.has(e.id) && !referenced.has(e.id)) { entities.splice(i, 1); delete byId[e.id]; byNorm.delete(dive.normalise(e.name)); created.delete(e.id); }
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'prompts.json'), JSON.stringify(prompts, null, 1) + '\n');
  fs.writeFileSync(path.join(ROOT, 'data', 'entities.json'), JSON.stringify(entities, null, 1) + '\n');
  fs.writeFileSync(path.join(ROOT, 'data', 'prompt-seeds.json'), JSON.stringify(seeds, null, 1) + '\n');
}
module.exports = { speciesFact, thingFact, makeEntity, passes, entityNames, duplicateOf, enforceFloors, entities, MIN_ANSWERS, FLOORS };
if (require.main === module) run().catch(e => { console.error(e); process.exit(1); });
