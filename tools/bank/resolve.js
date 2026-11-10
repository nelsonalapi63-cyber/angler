'use strict';
/* Turns a candidate name into a verified record with sourced facts.
 *   resolveSpecies(client, name)  -> { name, sci, gbifKey, cls, family, occ, fb, src, wd, wiki } or null
 *   resolveThing(client, title)   -> { name, title, wd, wiki } or null          (places, people, ships, dishes…)
 * Every record is cached as JSON under tools/bank/cache/records/ so a re-run of the builder costs no network. */
const fs = require('fs');
const path = require('path');
const parse = require('./parse.js');
const { FISH_CLASSES } = require('./questions.js');

const REC_DIR = path.join(__dirname, 'cache', 'records');
fs.mkdirSync(REC_DIR, { recursive: true });
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`´]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);   // "Nierstrasz's coral" -> nierstraszs-coral
function recPath(kind, name) { return path.join(REC_DIR, kind + '-' + slug(name) + '.json'); }
function readRec(kind, name) { const p = recPath(kind, name); if (!fs.existsSync(p)) return undefined; return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeRec(kind, name, rec) { fs.writeFileSync(recPath(kind, name), JSON.stringify(rec)); return rec; }

// The binomial a Wikipedia species article is about: {{Speciesbox | taxon = Genus species}} or the first italic binomial.
function binomialFromWiki(raw) {
  const t = String(raw);
  let m = t.match(/\|\s*taxon\s*=\s*([A-Z][a-z]+ [a-z]+(?: [a-z]+)?)/);
  if (m) return m[1];
  m = t.match(/\|\s*genus\s*=\s*([A-Z][a-z]+)\s*\|\s*species\s*=\s*([a-z]+)/);
  if (m) return m[1] + ' ' + m[2];
  m = t.match(/\|\s*binomial\s*=\s*([A-Z][a-z]+ [a-z]+)/);
  if (m) return m[1];
  m = t.match(/'''''([A-Z][a-z]+ [a-z]+)'''''/);
  if (m) return m[1];
  return null;
}
function isFishClass(cls) { return !!cls && FISH_CLASSES.includes(cls); }

async function wikidataFor(client, title) {
  if (!title) return null;
  try {
    const q = await client.wikidataIdForTitle(title);
    if (!q) return null;
    const e = await client.wikidata(q);
    if (!e) return null;
    return { q: e.id, label: e.label, description: e.description, sitelinks: e.sitelinks, enwiki: e.enwiki, claims: { instanceOf: e.claimAll('P31'), taxonName: e.claim('P225'), iucn: e.claim('P141'), country: e.claimAll('P17'), length: e.claim('P2043'), depth: e.claim('P4511'), area: e.claim('P2046'), inception: e.claim('P571'), born: e.claim('P569'), died: e.claim('P570'), pointInTime: e.claim('P585'), coords: e.claim('P625') } };
  } catch (e) { return null; }
}
async function wikiFor(client, title) {
  if (!title) return null;
  try {
    const page = await client.wikiPage(title);
    if (!page) return null;
    return { title: page.title, short: parse.wikiShortDescription(page.raw), first: parse.wikiFirstSentence(page.raw), binomial: binomialFromWiki(page.raw), disambiguation: /\{\{\s*(disambiguation|dab|disambig|hndis|geodis|set index)/i.test(page.raw) };
  } catch (e) { return null; }
}

async function resolveSpecies(client, name) {
  const cached = readRec('sp', name);
  if (cached !== undefined) return cached;
  let rec = null;
  try {
    let g = await client.gbifVernacular(name);
    let wiki = null;
    if (!g) {                                  // no vernacular match: maybe Wikipedia knows the binomial
      wiki = await wikiFor(client, name);
      if (wiki && wiki.binomial && !wiki.disambiguation) g = await client.gbifMatch(wiki.binomial);
    }
    if (g && g.rank === 'SPECIES') {
      let fish = isFishClass(g.class) || !g.class;          // GBIF leaves the class blank for some fish: try FishBase first
      let fb = fish ? await client.fishbase(g.scientificName) : await client.sealifebase(g.scientificName);
      let src = fish ? 'FishBase' : 'SeaLifeBase';
      if (!fb) { fb = fish ? await client.sealifebase(g.scientificName) : await client.fishbase(g.scientificName); src = fish ? 'SeaLifeBase' : 'FishBase'; }
      if (!fb) src = null;
      if (!g.class) fish = src === 'FishBase';
      const occ = await client.gbifOccurrences(g.key);
      if (!wiki) wiki = await wikiFor(client, name);
      if (!wiki || wiki.disambiguation) { const w2 = await wikiFor(client, g.scientificName); if (w2 && !w2.disambiguation) wiki = w2; }
      const wd = await wikidataFor(client, wiki && !wiki.disambiguation ? wiki.title : g.scientificName);
      rec = { name, sci: g.scientificName, gbifKey: g.key, cls: g.class || null, order: g.order || null, family: g.family || (fb && fb.family) || null, fish, occ, fb, src, wd, wiki: wiki && !wiki.disambiguation ? wiki : null };
    }
  } catch (e) { rec = null; if (process.env.BANK_DEBUG) console.error('resolveSpecies', name, e.message); }
  return writeRec('sp', name, rec);
}

async function resolveThing(client, title) {
  const cached = readRec('th', title);
  if (cached !== undefined) return cached;
  let rec = null;
  try {
    const wiki = await wikiFor(client, title);
    if (wiki && !wiki.disambiguation) {
      const wd = await wikidataFor(client, wiki.title);
      rec = { name: title, title: wiki.title, wiki, wd };
    }
  } catch (e) { rec = null; if (process.env.BANK_DEBUG) console.error('resolveThing', title, e.message); }
  return writeRec('th', title, rec);
}

module.exports = { resolveSpecies, resolveThing, binomialFromWiki, slug, readRec };
