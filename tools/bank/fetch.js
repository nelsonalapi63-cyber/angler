'use strict';
/* The bank builder's HTTP layer. Every page is cached on disk (tools/bank/cache/, not committed) so a re-run costs
 * nothing, requests to one host are spaced out (be a polite guest on FishBase and Wikimedia), 429/5xx are retried
 * with growing pauses, and a 404 is remembered as null. Sources on top: GBIF, FishBase, SeaLifeBase, Wikipedia (raw
 * wikitext), Wikidata (entity data + title lookup). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const parse = require('./parse.js');

const UA = 'ANGLER-bank/1.0 (daily ocean trivia answer bank; github.com/nelsonalapi63-cyber/angler)';
const DEFAULT_MIN_INTERVAL = { 'www.fishbase.se': 300, 'www.sealifebase.se': 300, 'api.gbif.org': 80, 'en.wikipedia.org': 200, 'www.wikidata.org': 200 };
const DEFAULT_RETRY = [2000, 8000, 30000];
const GBIF_BACKBONE = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c';

function makeClient(opts) {
  opts = opts || {};
  const cacheDir = opts.cacheDir || path.join(__dirname, 'cache');
  const doFetch = opts.fetch || ((url, init) => fetch(url, init));
  const minInterval = opts.minIntervalMs || DEFAULT_MIN_INTERVAL;
  const retryDelays = opts.retryDelaysMs || DEFAULT_RETRY;
  const timeoutMs = opts.timeoutMs || 25000;
  const lanes = new Map();          // host -> promise chain (one request at a time per host, spaced)
  const lastAt = new Map();
  const stats = { hits: 0, fetched: 0, failed: 0 };
  fs.mkdirSync(cacheDir, { recursive: true });

  function cachePath(url) {
    const host = new URL(url).host.replace(/[^a-z0-9.-]/gi, '_');
    const dir = path.join(cacheDir, host);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, crypto.createHash('sha1').update(url).digest('hex') + '.txt');
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function lane(host, fn) {
    const prev = lanes.get(host) || Promise.resolve();
    const next = prev.catch(() => {}).then(async () => {
      const gap = (minInterval[host] || 0) - (Date.now() - (lastAt.get(host) || 0));
      if (gap > 0) await sleep(gap);
      lastAt.set(host, Date.now());
      return fn();
    });
    lanes.set(host, next);
    return next;
  }
  async function fetchOnce(url, init) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try { return await doFetch(url, Object.assign({ headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctl ? ctl.signal : undefined }, init || {})); }
    finally { if (timer) clearTimeout(timer); }
  }
  // Returns the body text, null for 404/410, or '@redirect <location>' for a 3xx when redirect: 'manual'.
  async function get(url, init) {
    const file = cachePath(url);
    if (fs.existsSync(file)) {
      stats.hits++;
      const body = fs.readFileSync(file, 'utf8');
      return body === '@404' ? null : body;
    }
    const host = new URL(url).host;
    return lane(host, async () => {
      let lastErr = null;
      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        try {
          const res = await fetchOnce(url, init);
          if (res.status === 404 || res.status === 410) { fs.writeFileSync(file, '@404'); stats.fetched++; return null; }
          if (res.status >= 300 && res.status < 400) {
            const loc = res.headers && res.headers.get ? res.headers.get('location') : null;
            const body = '@redirect ' + (loc || '');
            fs.writeFileSync(file, body); stats.fetched++; return body;
          }
          if (res.status === 429 || res.status >= 500) { lastErr = new Error('HTTP ' + res.status + ' ' + url); }
          else if (res.status !== 200) { lastErr = new Error('HTTP ' + res.status + ' ' + url); break; }
          else {
            const body = await res.text();
            fs.writeFileSync(file, body); stats.fetched++;
            return body;
          }
        } catch (e) { lastErr = e; }
        if (attempt < retryDelays.length) await sleep(retryDelays[attempt]);
      }
      stats.failed++;
      throw lastErr || new Error('fetch failed ' + url);
    });
  }
  async function getJson(url) { const t = await get(url); return t == null ? null : JSON.parse(t); }

  // ---- GBIF
  async function gbifVernacular(name) {
    const url = 'https://api.gbif.org/v1/species/search?q=' + encodeURIComponent(name) + '&qField=VERNACULAR&datasetKey=' + GBIF_BACKBONE + '&limit=8';
    const json = await getJson(url);
    return json ? parse.gbifVernacularPick(json, name) : null;
  }
  async function gbifMatch(scientific) {
    const json = await getJson('https://api.gbif.org/v1/species/match?name=' + encodeURIComponent(scientific));
    if (!json || !json.usageKey || json.matchType === 'NONE') return null;
    return { key: json.acceptedUsageKey || json.usageKey, scientificName: json.canonicalName || json.scientificName, rank: json.rank, family: json.family || null, order: json.order || null, class: json.class || null, kingdom: json.kingdom || null, status: json.status || null };
  }
  async function gbifOccurrences(key) {
    const t = await get('https://api.gbif.org/v1/occurrence/count?taxonKey=' + key);
    return t == null ? 0 : Number(t) || 0;
  }
  async function gbifVernacularNames(key) {
    const json = await getJson('https://api.gbif.org/v1/species/' + key + '/vernacularNames?limit=100');
    if (!json) return [];
    const out = [];
    for (const v of json.results || []) if (v.language === 'eng' && v.vernacularName) { const n = String(v.vernacularName).trim(); if (!out.some(x => x.toLowerCase() === n.toLowerCase())) out.push(n); }
    return out;
  }

  // ---- FishBase / SeaLifeBase (same page layout)
  const sciSlug = (sci) => String(sci).trim().replace(/\s+/g, '-');
  async function fishbase(sci) { const h = await get('https://www.fishbase.se/summary/' + encodeURIComponent(sciSlug(sci)) + '.html'); return h ? parse.fishbasePage(h) : null; }
  async function sealifebase(sci) { const h = await get('https://www.sealifebase.se/summary/' + encodeURIComponent(sciSlug(sci)) + '.html'); return h ? parse.fishbasePage(h) : null; }

  // ---- Wikipedia / Wikidata
  const wikiTitle = (t) => String(t).trim().replace(/ /g, '_');
  async function wikiRaw(title) { return get('https://en.wikipedia.org/w/index.php?title=' + encodeURIComponent(wikiTitle(title)) + '&action=raw'); }
  // Follows up to three redirects; returns { title, raw } or null when there is no such page.
  async function wikiPage(title) {
    let t = String(title).trim();
    for (let i = 0; i < 4; i++) {
      const raw = await wikiRaw(t);
      if (raw == null) return null;
      const r = parse.wikiRedirect(raw);
      if (!r) return { title: t.replace(/_/g, ' '), raw };
      t = r;
    }
    return null;
  }
  async function wikidataIdForTitle(title) {
    const body = await get('https://www.wikidata.org/wiki/Special:ItemByTitle/enwiki/' + encodeURIComponent(wikiTitle(title)), { redirect: 'manual' });
    if (!body) return null;
    const m = body.match(/\/wiki\/(Q\d+)/);
    return m ? m[1] : null;
  }
  async function wikidata(q) { const json = await getJson('https://www.wikidata.org/wiki/Special:EntityData/' + q + '.json'); return json ? parse.wikidataEntity(json) : null; }

  return { cacheDir, stats, get, getJson, gbifVernacular, gbifMatch, gbifOccurrences, gbifVernacularNames, fishbase, sealifebase, wikiRaw, wikiPage, wikidataIdForTitle, wikidata };
}

module.exports = { makeClient, UA, GBIF_BACKBONE };
