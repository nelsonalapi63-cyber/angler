'use strict';
/* Parsers for what the bank builder reads: FishBase / SeaLifeBase summary pages (same layout), Wikipedia raw
 * wikitext, Wikidata entity data and GBIF vernacular searches. Pure functions, tested on saved fixtures. */

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&deg;': '°', '&ndash;': '–', '&mdash;': '—', '&eacute;': 'é', '&uuml;': 'ü', '&ouml;': 'ö', '&auml;': 'ä', '&ntilde;': 'ñ', '&ccedil;': 'ç', '&aacute;': 'á', '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú', '&egrave;': 'è', '&agrave;': 'à' };
function unescapeHtml(s) {
  return String(s).replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] || ' ');
}
function toText(html) {
  return unescapeHtml(String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function stripRefs(s) {
  return String(s || '').replace(/\s*\(Ref\.[^)]*\)/g, '').replace(/\s*\(Refs?\.?\s*[\d ,]*\)/g, '').replace(/\s+([,;.])/g, '$1').replace(/\s+/g, ' ').trim();
}
const IUCN = { 'Least Concern': 'LC', 'Near Threatened': 'NT', 'Vulnerable': 'VU', 'Endangered': 'EN', 'Critically Endangered': 'CR', 'Extinct in the Wild': 'EW', 'Extinct': 'EX', 'Data Deficient': 'DD', 'Not Evaluated': 'NE', 'Lower Risk/least concern': 'LC', 'Lower Risk/near threatened': 'NT', 'Lower Risk/conservation dependent': 'LC' };

// A FishBase or SeaLifeBase species summary page. Returns null when the page is not a species page.
function fishbasePage(html) {
  const title = (String(html).match(/<title>([^<]*)<\/title>/i) || [])[1];
  if (!title || !/^\s*[A-Z][a-z]+ [a-z]+/.test(unescapeHtml(title))) return null;
  const t = toText(html);
  const head = unescapeHtml(title).replace(/\s+/g, ' ').trim();
  const hm = head.match(/^([A-Z][a-z]+(?: \([A-Z][a-z]+\))? [a-z]+(?: [a-z]+)?)\s*,\s*([^:]*?)\s*(?::|$)/);
  const scientific = hm ? hm[1].trim() : head.split(',')[0].trim();
  const common = hm && hm[2] ? hm[2].trim() : null;
  const out = { scientific, common: common || null, family: null, familyCommon: null, maxLengthCm: null, maxWeightKg: null, maxAgeYears: null, depth: null, environment: null, marine: false, freshwater: false, brackish: false, reef: false, migration: null, climate: null, distribution: null, iucn: null, iucnCode: null, threat: null, uses: null, biology: null };
  const fam = t.match(/> ([A-Z][a-z]+idae) \(([^)]+)\)/) || t.match(/\| ([A-Z][a-z]+idae) Environment:/);
  if (fam) { out.family = fam[1]; out.familyCommon = fam[2] || null; }
  const env = t.match(/distribution range Ecology (.+?) Distribution /);
  if (env) {
    const e = stripRefs(env[1]);
    out.environment = e;
    const low = e.toLowerCase();
    out.marine = /\bmarine\b/.test(low); out.freshwater = /\bfreshwater\b/.test(low); out.brackish = /\bbrackish\b/.test(low); out.reef = /reef-associated/.test(low);
    const mig = low.match(/\b(amphidromous|anadromous|catadromous|oceanodromous|potamodromous|diadromous|non-migratory)\b/);
    out.migration = mig ? mig[1] : null;
    const d = e.match(/depth range (\d+) - (\d+) m/);
    if (d) out.depth = { min: Number(d[1]), max: Number(d[2]) };
    else { const d1 = e.match(/depth range (\d+) - \? m/) || e.match(/depth range \? - (\d+) m/); if (d1) out.depth = e.indexOf('depth range ?') > -1 ? { min: null, max: Number(d1[1]) } : { min: Number(d1[1]), max: null }; }
    const cl = e.match(/\b(Tropical|Subtropical|Temperate|Boreal|Polar|Deep-water)\b/);
    out.climate = cl ? cl[1] : null;
  }
  const dist = t.match(/Distribution Territories(?: \| [A-Za-z ]+?)* ([A-Z].+?) (?:\/\/ )*(?:-->\s*)?(?:Length at first maturity|Size \/ Weight \/ Age|Countries \||Short description|Life cycle)/);
  if (dist) { const d = stripRefs(dist[1]).replace(/ \/\/.*$/, '').trim(); out.distribution = d || null; }
  const len = t.match(/Max length : ([\d.]+) (cm|mm|m) [A-Z]{2,3}/);
  if (len) out.maxLengthCm = len[2] === 'cm' ? Number(len[1]) : len[2] === 'm' ? Number(len[1]) * 100 : Number(len[1]) / 10;
  const w = t.match(/max\. published weight: ([\d.]+) (kg|g)/);
  if (w) out.maxWeightKg = w[2] === 'kg' ? Number(w[1]) : Number(w[1]) / 1000;
  const age = t.match(/max\. reported age: ([\d.]+) years/);
  if (age) out.maxAgeYears = Number(age[1]);
  const iu = t.match(/IUCN Red List Status.{0,80}?(Least Concern|Near Threatened|Vulnerable|Endangered|Critically Endangered|Extinct in the Wild|Extinct|Data Deficient|Not Evaluated|Lower Risk\/[a-z ]+) \((?:LC|NT|VU|EN|CR|EW|EX|DD|NE|LR\/[a-z]+)\)/);
  if (iu) { out.iucn = iu[1]; out.iucnCode = IUCN[iu[1]] || null; }
  const th = t.match(/Threat to humans (Harmless|Venomous|Poisonous to eat|Traumatogenic|Reports of ciguatera poisoning|Potential pest|Other)/);
  if (th) out.threat = th[1];
  const us = t.match(/Human uses ((?:Fisheries|Aquarium|Aquaculture|Gamefish|Bait)[^|]*?)(?: FAO | More information| Tools | Trophic| Food items|$)/i);
  if (us) out.uses = stripRefs(us[1]).replace(/\s*$/, '');
  const bio = t.match(/Glossary \(e\.g\. epibenthic\) (.+?) (?:IUCN Red List Status|Life cycle and mating behavior|Main reference)/);
  if (bio) { const b = stripRefs(bio[1]).replace(/^(?:Maximum (?:common )?(?:depth|length)[^.]*\. )+/, '').trim(); out.biology = b || null; }
  return out;
}

function wikiRedirect(raw) {
  const m = String(raw).match(/^\s*#REDIRECT\s*\[\[([^\]|#]+)/i);
  return m ? m[1].trim() : null;
}
function wikiShortDescription(raw) {
  const m = String(raw).match(/\{\{\s*[Ss]hort description\s*\|\s*([^}|]+)/);
  return m ? m[1].trim() : null;
}

// Strips {{templates}} (nested), <ref>s, [[links]], files and markup from wikitext and returns its first sentence.
function wikiPlain(raw) {
  let s = String(raw);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  // a few templates carry text worth keeping
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dateT = (m, y, mo, d) => (d ? Number(d) + ' ' : '') + (mo ? (MONTHS[Number(mo) - 1] || '') + ' ' : '') + y;
  s = s.replace(/\{\{\s*(?:snd|spaced ndash|spaced en dash|ndash|en dash|spnd)\s*\}\}/gi, ' – ').replace(/\{\{\s*nbsp\s*\}\}/gi, ' ');
  s = s.replace(/\{\{\s*(?:birth date|birth date and age|birth-date|bda|death date|death date and age|death-date|dda)\s*\|\s*(?:df=\w+\s*\|\s*|mf=\w+\s*\|\s*)?(\d{3,4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})[^}]*\}\}/gi, dateT);
  s = s.replace(/\{\{\s*(?:circa|c\.)\s*\|(?:[^}|]*=[^}|]*\|)*\s*([\d][^}|]*)[^}]*\}\}/gi, 'c. $1').replace(/\{\{\s*(?:circa|c\.)\s*\}\}/gi, 'c.');
  s = s.replace(/\{\{\s*(?:lang|transliteration|transl|nihongo)\s*\|[^|}]*\|([^|}]*)[^}]*\}\}/gi, '$1');
  s = s.replace(/\{\{\s*convert\s*\|\s*([\d.,]+)\s*\|\s*([a-z°]+)[^}]*\}\}/gi, '$1 $2');
  // nested templates
  let out = '', depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith('{{', i)) { depth++; i++; continue; }
    if (s.startsWith('}}', i) && depth > 0) { depth--; i++; if (depth === 0) out += ' '; continue; }
    if (depth === 0) out += s[i];
  }
  s = out;
  s = s.replace(/\[\[(?:File|Image|Category):[^\]]*(?:\[\[[^\]]*\]\][^\]]*)*\]\]/gi, '');
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]]*)\]\]/g, '$1');
  s = s.replace(/\[https?:[^\s\]]*\s*([^\]]*)\]/g, '$1');
  s = s.replace(/'{2,5}/g, '');
  s = s.replace(/<[^>]+>/g, '');
  s = unescapeHtml(s).replace(/&nbsp;/g, ' ');
  // tidy what template removal left inside parentheses: "(or Thatch;)" -> "(or Thatch)", "(; from)" -> ""
  s = s.replace(/\(([^()\n]*)\)/g, (m, inner) => {
    const parts = inner.split(/\s*;\s*/).map(p => p.replace(/\s*[–-]\s*$/, '').replace(/^[,\s]+|[,\s]+$/g, '')).filter(p => p && !/=/.test(p) && !/^(or|from|also|and|see|listen|approximately or|about or|ALA|IPA)$/i.test(p));
    return parts.length ? '(' + parts.join('; ') + ')' : '';
  });
  return s.replace(/[ \t]+/g, ' ').replace(/ ([,.;:])/g, '$1');
}
function wikiFirstSentence(raw) {
  const text = wikiPlain(raw);
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !/^[|!{}=*#:;\[]/.test(l) && !/^(thumb|right|left)\|/.test(l));
  for (const line of lines) {
    const clean = line.replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(').trim();
    if (!/^[A-Z"“'(]/.test(clean) || clean.length < 25 || /^(It|This|They|He|She|These|There|Its|His|Her|Their)\b/.test(clean)) continue;
    const m = clean.match(/^.+?[.!?](?=\s+[A-Z"“(]|\s*$)/);
    const sentence = m ? m[0].trim() : clean;
    if (!/\b(is|was|are|were|refers|has|have|lies|lived|lie)\b/.test(sentence)) continue;
    return sentence;
  }
  return null;
}

function wikidataEntity(json) {
  const id = Object.keys((json && json.entities) || {})[0];
  if (!id) return null;
  const e = json.entities[id];
  const claims = e.claims || {};
  const claim = (p) => {
    const c = claims[p] && claims[p][0] && claims[p][0].mainsnak && claims[p][0].mainsnak.datavalue;
    if (!c) return null;
    const v = c.value;
    if (c.type === 'string') return v;
    if (c.type === 'wikibase-entityid') return v.id;
    if (c.type === 'quantity') return Number(v.amount);
    if (c.type === 'time') return v.time;
    if (c.type === 'monolingualtext') return v.text;
    if (c.type === 'globecoordinate') return { lat: v.latitude, lon: v.longitude };
    return null;
  };
  const claimAll = (p) => (claims[p] || []).map(s => s.mainsnak && s.mainsnak.datavalue && s.mainsnak.datavalue.value).filter(v => v != null).map(v => (v && v.id) || (v && v.amount != null ? Number(v.amount) : v));
  return {
    id,
    label: e.labels && e.labels.en ? e.labels.en.value : null,
    description: e.descriptions && e.descriptions.en ? e.descriptions.en.value : null,
    sitelinks: Object.keys(e.sitelinks || {}).length,
    enwiki: e.sitelinks && e.sitelinks.enwiki ? e.sitelinks.enwiki.title : null,
    aliases: ((e.aliases && e.aliases.en) || []).map(a => a.value),
    claim, claimAll,
  };
}

// The accepted SPECIES result whose English vernacular names include the query (case-insensitive), else null.
function gbifVernacularPick(json, query) {
  const q = String(query).trim().toLowerCase();
  const results = (json && json.results) || [];
  const eng = (r) => (r.vernacularNames || []).filter(v => !v.language || v.language === 'eng').map(v => String(v.vernacularName).trim().toLowerCase());
  let pick = results.find(r => r.rank === 'SPECIES' && r.taxonomicStatus === 'ACCEPTED' && eng(r).includes(q));
  if (!pick) pick = results.find(r => r.rank === 'SPECIES' && eng(r).includes(q));
  if (!pick) return null;
  return { key: pick.key, scientificName: pick.canonicalName || pick.scientificName, rank: pick.rank, family: pick.family || null, order: pick.order || null, class: pick.class || null, kingdom: pick.kingdom || null };
}

// Function words a fact must not end on after a cut ("…the other being the." reads as broken).
const DANGLING = /\b(of|the|in|and|to|that|which|a|an|for|with|by|on|at|from|as|or|its|their|is|are|was|were|has|have|be|been|not|but|than|into|onto|between|among|through|during|also|very|so|such|both|either|neither|each|every|any|some|who|whose|whom|being|whereas|although|because|if|unless|until|since|nor|yet)$/i;
// One line of at most `max` characters ending in a full stop; a cut lands on a clause or word boundary, never inside a
// word and never after a dangling function word.
function clampFact(s, max) {
  let f = String(s || '').replace(/\s+/g, ' ').trim();
  const ends = /[.!?]$/.test(f);
  if (f.length > max || (!ends && f.length > max - 1)) {
    f = f.slice(0, max - 1);
    const clause = Math.max(f.lastIndexOf('; '), f.lastIndexOf('. '));   // a whole trailing clause goes before a phrase is cut short
    const comma = f.lastIndexOf(', ');
    const word = f.lastIndexOf(' ');
    let cut = clause > max * 0.4 ? clause : comma > max * 0.5 ? comma : word > max * 0.5 ? word : -1;
    if (cut > 0) f = f.slice(0, cut);
    f = backOff(f, max * 0.4);
  }
  if (!/[.!?]$/.test(f)) f += '.';
  return f;
}
// Trims trailing punctuation, then backs off a word at a time while the text ends on a dangling function word.
function backOff(f, floor) {
  f = f.replace(/[,;:\s]+$/, '');
  for (let guard = 0; guard < 6 && DANGLING.test(f); guard++) {
    const cut = f.lastIndexOf(' ');
    if (cut <= floor) break;
    f = f.slice(0, cut).replace(/[,;:\s]+$/, '');
  }
  return f;
}
// The first clause of a longer text that fits in `max` characters: cut on "; ", ", " or ". ", else on a word boundary.
function firstClause(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t.replace(/[.;,]$/, '');
  const cut = Math.max(t.lastIndexOf('; ', max), t.lastIndexOf(', ', max), t.lastIndexOf('. ', max));
  const sp = t.lastIndexOf(' ', max);
  return backOff(cut > 30 ? t.slice(0, cut) : sp > 30 ? t.slice(0, sp) : t.slice(0, max), 30);
}

module.exports = { toText, stripRefs, unescapeHtml, fishbasePage, wikiRedirect, wikiShortDescription, wikiPlain, wikiFirstSentence, wikidataEntity, gbifVernacularPick, clampFact, firstClause, DANGLING, IUCN };
