'use strict';
/* The bank builder's HTTP layer (tools/bank/fetch.js): cached on disk, throttled per host, retried on 429/5xx. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeClient } = require('../tools/bank/fetch.js');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'bank-cache-')); }

test('a fetched page is cached on disk and never fetched twice', async () => {
  let calls = 0;
  const client = makeClient({ cacheDir: tmpDir(), fetch: async () => { calls++; return { status: 200, text: async () => 'hello' }; }, minIntervalMs: {} });
  assert.strictEqual(await client.get('https://example.org/a'), 'hello');
  assert.strictEqual(await client.get('https://example.org/a'), 'hello');
  assert.strictEqual(calls, 1);
  const again = makeClient({ cacheDir: client.cacheDir, fetch: async () => { throw new Error('must not fetch'); }, minIntervalMs: {} });
  assert.strictEqual(await again.get('https://example.org/a'), 'hello');
});

test('a 404 is remembered as null without refetching', async () => {
  let calls = 0;
  const client = makeClient({ cacheDir: tmpDir(), fetch: async () => { calls++; return { status: 404, text: async () => 'nope' }; }, minIntervalMs: {} });
  assert.strictEqual(await client.get('https://example.org/missing'), null);
  assert.strictEqual(await client.get('https://example.org/missing'), null);
  assert.strictEqual(calls, 1);
});

test('requests to one host are spaced by its minimum interval; hosts do not wait for each other', async () => {
  const times = {};
  const client = makeClient({ cacheDir: tmpDir(), minIntervalMs: { 'a.test': 60, 'b.test': 60 }, fetch: async (url) => { const h = new URL(url).host; (times[h] = times[h] || []).push(Date.now()); return { status: 200, text: async () => 'x' }; } });
  const t0 = Date.now();
  await Promise.all([client.get('https://a.test/1'), client.get('https://a.test/2'), client.get('https://b.test/1'), client.get('https://b.test/2')]);
  assert.ok(times['a.test'][1] - times['a.test'][0] >= 55, 'second request to a.test waited');
  assert.ok(times['b.test'][1] - times['b.test'][0] >= 55, 'second request to b.test waited');
  assert.ok(Date.now() - t0 < 200, 'the two hosts ran in parallel');
});

test('a 429 is retried after a pause and the retry is what gets cached', async () => {
  let calls = 0;
  const client = makeClient({ cacheDir: tmpDir(), minIntervalMs: {}, retryDelaysMs: [10, 10], fetch: async () => { calls++; return calls === 1 ? { status: 429, text: async () => '' } : { status: 200, text: async () => 'later' }; } });
  assert.strictEqual(await client.get('https://example.org/busy'), 'later');
  assert.strictEqual(calls, 2);
});

test('a 302 to Wikidata is reported as the redirect target', async () => {
  const client = makeClient({ cacheDir: tmpDir(), minIntervalMs: {}, fetch: async () => ({ status: 302, headers: { get: (k) => k === 'location' ? '//www.wikidata.org/wiki/Q190469' : null }, text: async () => '' }) });
  assert.strictEqual(await client.get('https://www.wikidata.org/wiki/Special:ItemByTitle/enwiki/Bull_shark', { redirect: 'manual' }), '@redirect //www.wikidata.org/wiki/Q190469');
});
