'use strict';
/* Parsers for the pages and JSON the bank builder reads (tools/bank/parse.js), run against saved fixtures. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const parse = require('../tools/bank/parse.js');

const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', 'bank', f), 'utf8');

test('fishbase: a summary page yields the facts a bank entry needs', () => {
  const p = parse.fishbasePage(fx('fishbase-bull-shark.html'));
  assert.strictEqual(p.scientific, 'Carcharhinus leucas');
  assert.strictEqual(p.common, 'Bull shark');
  assert.strictEqual(p.family, 'Carcharhinidae');
  assert.strictEqual(p.familyCommon, 'Requiem sharks');
  assert.strictEqual(p.maxLengthCm, 360);
  assert.strictEqual(p.maxWeightKg, 316.5);
  assert.strictEqual(p.maxAgeYears, 32);
  assert.deepStrictEqual(p.depth, { min: 1, max: 164 });
  assert.match(p.environment, /^Marine; freshwater; brackish; reef-associated; amphidromous/);
  assert.ok(p.marine && p.freshwater && p.brackish && p.reef);
  assert.strictEqual(p.migration, 'amphidromous');
  assert.strictEqual(p.climate, 'Subtropical');
  assert.match(p.distribution, /^Cosmopolitan in tropical and subtropical waters/);
  assert.ok(p.distribution.indexOf('(Ref.') === -1, 'reference numbers are stripped');
  assert.strictEqual(p.iucn, 'Vulnerable');
  assert.strictEqual(p.iucnCode, 'VU');
  assert.strictEqual(p.threat, 'Traumatogenic');
  assert.strictEqual(p.uses, 'Fisheries: commercial; gamefish: yes');
  assert.match(p.biology, /^A coastal and freshwater shark inhabiting shallow waters/);
});

test('sealifebase: the same parser reads an invertebrate page', () => {
  const p = parse.fishbasePage(fx('sealifebase-octopus-vulgaris.html'));
  assert.strictEqual(p.scientific, 'Octopus vulgaris');
  assert.strictEqual(p.common, 'Common octopus');
  assert.strictEqual(p.family, 'Octopodidae');
  assert.strictEqual(p.maxLengthCm, 180);
  assert.strictEqual(p.maxWeightKg, 10);
  assert.deepStrictEqual(p.depth, { min: 0, max: 347 });
  assert.strictEqual(p.migration, 'oceanodromous');
  assert.strictEqual(p.distribution, 'Circumglobal in temperate and tropical seas.');
  assert.strictEqual(p.iucnCode, 'LC');
  assert.strictEqual(p.uses, 'Fisheries: commercial');
});

test('fishbase: a page without a species returns null', () => {
  assert.strictEqual(parse.fishbasePage('<html><body>Species not found</body></html>'), null);
});

test('wikipedia raw: redirects are followed by title, short descriptions are read', () => {
  assert.strictEqual(parse.wikiRedirect(fx('wiki-raw-redirect.txt')), 'Bull shark');
  assert.strictEqual(parse.wikiRedirect('{{Short description|Species of shark}}\nThe \'\'\'bull shark\'\'\' is...'), null);
  assert.strictEqual(parse.wikiShortDescription('{{Short description|Species of shark}}\n{{Speciesbox}}'), 'Species of shark');
  assert.strictEqual(parse.wikiShortDescription('no template here'), null);
});

test('wikidata: entity data yields label, description, sitelink count and plain claims', () => {
  const e = parse.wikidataEntity(JSON.parse(fx('wikidata-Q190469.json')));
  assert.strictEqual(e.id, 'Q190469');
  assert.strictEqual(e.label, 'Carcharhinus leucas');
  assert.strictEqual(e.description, 'species of fish');
  assert.strictEqual(e.sitelinks, 59);
  assert.strictEqual(e.enwiki, 'Bull shark');
  assert.strictEqual(e.claim('P225'), 'Carcharhinus leucas');          // taxon name (string)
  assert.strictEqual(e.claim('P31'), 'Q16521');                       // instance of: taxon (item id)
  assert.strictEqual(e.claim('P9999'), null);
});

test('gbif: the vernacular search picks the accepted species whose English name is the query', () => {
  const r = parse.gbifVernacularPick(JSON.parse(fx('gbif-vernacular-bull-shark.json')), 'bull shark');
  assert.ok(r);
  assert.strictEqual(r.scientificName, 'Carcharhinus leucas');
  assert.strictEqual(r.rank, 'SPECIES');
  assert.strictEqual(typeof r.key, 'number');
  assert.strictEqual(parse.gbifVernacularPick({ results: [] }, 'bull shark'), null);
});

test('text helpers: a sourced fact is one line, 20–240 characters, ends with a full stop', () => {
  const f = parse.clampFact('Grows to 360 cm and lives in marine, freshwater and brackish water at 1–164 m; listed as Vulnerable', 240);
  assert.ok(f.length <= 240 && /[.!?]$/.test(f));
  const long = parse.clampFact('A'.repeat(300), 240);
  assert.ok(long.length <= 240 && /\.$/.test(long));
  // a cut never lands inside a word, whether the text is over the limit or just too long to take its full stop
  // when a clause boundary sits past the middle, the cut drops the whole trailing clause instead of ending mid-phrase
  const clauses = 'First clause with some words in it that runs for a while; second clause with more words that also runs on for a while; ' + 'third clause that is long enough to push the whole text well past the two hundred and forty character limit, so that something has to go and the whole clause goes.';
  assert.strictEqual(parse.clampFact(clauses, 240), 'First clause with some words in it that runs for a while; second clause with more words that also runs on for a while.');
  // a word cut backs off past a dangling function word ("…the other being the." never ends a fact)
  const head = Array.from({ length: 60 }, (_, i) => 'w' + i).join(' ').slice(0, 232).replace(/ $/, 'x');   // 232 chars, then "of the" ends exactly at the limit
  const dangling = head + ' of the Spencer Gulf to its west which is larger and deeper.';
  const d = parse.clampFact(dangling, 240);
  assert.ok(d.length <= 240 && !/\b(the|of)\.$/.test(d), d);
  assert.strictEqual(d, head.replace(/[,;:\s]+$/, '') + '.');
  // a comma past the middle beats a bare word cut: the phrase after it is dropped whole
  const ridge = 'The Pacific-Antarctic Ridge is a divergent tectonic plate boundary located on the seafloor of the South Pacific Ocean that runs for thousands of kilometres across the southern ocean floor, separating the Pacific plate from the Antarctic plate.';
  assert.strictEqual(parse.clampFact(ridge, 240), 'The Pacific-Antarctic Ridge is a divergent tectonic plate boundary located on the seafloor of the South Pacific Ocean that runs for thousands of kilometres across the southern ocean floor.');
  for (const n of [239, 240, 241, 260]) {
    const words = Array.from({ length: 80 }, (_, i) => 'word' + i).join(' ').slice(0, n).replace(/ $/, 'x');
    const cut = parse.clampFact(words, 240);
    assert.ok(cut.length <= 240 && /\.$/.test(cut) && !/ \.$/.test(cut), cut);
    const body = cut.slice(0, -1);
    assert.ok(words.startsWith(body) && (words.length === body.length || words[body.length] === ' '), 'cut at a word boundary: ' + cut.slice(-20));
  }
});

test('wikipedia raw: the first sentence of an article survives templates, refs and links', () => {
  const raw = '{{Short description|Strait connecting the Atlantic and the Mediterranean}}\n{{Infobox body of water\n| name = Strait of Gibraltar\n| image = {{multiple image|a=1}}\n}}\n[[File:Gib.jpg|thumb|The strait]]\nThe \'\'\'Strait of Gibraltar\'\'\' ({{lang-es|Estrecho de Gibraltar}})<ref>{{cite web|url=x}}</ref> is a narrow [[strait]] that connects the [[Atlantic Ocean]] to the [[Mediterranean Sea|Mediterranean]] and separates [[Europe]] from [[Africa]]. It is 13&nbsp;km wide.\n';
  assert.strictEqual(parse.wikiFirstSentence(raw), 'The Strait of Gibraltar is a narrow strait that connects the Atlantic Ocean to the Mediterranean and separates Europe from Africa.');
  assert.strictEqual(parse.wikiFirstSentence('{{Only a template}}\n'), null);
  assert.strictEqual(parse.wikiFirstSentence('\'\'\'Blackbeard\'\'\' (c. 1680 – 22 November 1718) was an English pirate who operated around the West Indies. He was born Edward Teach.'), 'Blackbeard (c. 1680 – 22 November 1718) was an English pirate who operated around the West Indies.');
});

test('firstClause cuts on a clause or word boundary, never inside a word', () => {
  const t = 'Eastern Atlantic: from Norway to Mauritania and the Mediterranean Sea; also the Azores';
  const c = parse.firstClause(t, 60);
  assert.ok(c.length <= 60 && t.startsWith(c) && (t.length === c.length || t[c.length] === ' ' || /[;,.]/.test(t[c.length])), c);
  assert.strictEqual(parse.firstClause('A short range', 90), 'A short range');
  assert.strictEqual(parse.firstClause('Northeast Atlantic: northernmost part of the Mid-Atlantic Ridge and from the Faroe Islands to Norway', 76), 'Northeast Atlantic: northernmost part of the Mid-Atlantic Ridge', 'a word cut backs off past a dangling word');
});
