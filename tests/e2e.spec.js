'use strict';
/* FATHOM end-to-end run (spec §8). Usage: node tests/e2e.spec.js
 * Plays the daily with scripted inputs (exact, alias, typo, group word, garbage, empty, hadal), a pack, a challenge
 * link in a second browser context, opens every page and modal, checks persistence after reload, offline reload,
 * records the daily dive for the server-scoring test, screenshots mobile and desktop, and fails on any console error. */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require('playwright');
const { start } = require('./serve');

const SHOTS = path.join(__dirname, 'screenshots');
const FIXTURES = path.join(__dirname, 'fixtures');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(FIXTURES, { recursive: true });

const errors = [];
function watch(page, label) {
  page.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); });
  page.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message));
  page.on('requestfailed', r => { if (r.url().startsWith('http://127.0.0.1')) errors.push(label + ' request failed: ' + r.url()); });
}

// Decide, inside the page, what to type for each of the seven prompts and what must come out.
async function planAnswers(page) {
  return page.evaluate(() => {
    const dive = window.FathomDive, P = window.FATHOM_PROMPTS, E = window.FATHOM_ENTITIES;
    const byId = dive.byId(P);
    const ids = JSON.parse(document.body.dataset.promptIds);
    const plan = [];
    ids.forEach((pid, i) => {
      const prompt = byId[pid];
      const index = dive.buildIndex(prompt, E);
      const ans = (pred) => prompt.answers.filter(a => pred(a, E[a.entity]));
      let item;
      if (i === 0) {                                          // exact canonical name
        const a = ans((x) => x.tier === 'reef')[0] || prompt.answers[0];
        item = { kind: 'exact', typed: E[a.entity].name, entity: a.entity, tier: a.tier };
      } else if (i === 1) {                                   // an alias
        const a = ans((x, e) => e.aliases && e.aliases.length)[0] || prompt.answers[1];
        const alias = (E[a.entity].aliases && E[a.entity].aliases[0]) || E[a.entity].name;
        item = { kind: 'alias', typed: alias, entity: a.entity, tier: a.tier };
      } else if (i === 2) {                                   // one-letter typo that still resolves to the right entity
        const cands = ans((x, e) => e.name.replace(/[^a-z]/gi, '').length >= 8);
        item = null;
        for (const a of cands) {
          const name = E[a.entity].name;
          const pos = Math.floor(name.length / 2);
          const typo = name.slice(0, pos) + (name[pos] === 'a' ? 'e' : 'a') + name.slice(pos + 1);
          const m = dive.matchAnswer(typo, index);
          if (m.entityId === a.entity && m.via === 'fuzzy') { item = { kind: 'typo', typed: typo, entity: a.entity, tier: a.tier }; break; }
        }
        if (!item) { const a = prompt.answers[2]; item = { kind: 'exact', typed: E[a.entity].name, entity: a.entity, tier: a.tier }; }
      } else if (i === 3) {                                   // a single-word group name such as "mako" (generic entities sit at the low tiers)
        const a = ans((x, e) => (x.tier === 'tidepool' || x.tier === 'baitball') && [e.name].concat(e.aliases || []).some(n => /^[a-z]+$/i.test(n)))[0] || ans((x, e) => [e.name].concat(e.aliases || []).some(n => /^[a-z]+$/i.test(n)))[0];
        if (a) { const w = [E[a.entity].name].concat(E[a.entity].aliases || []).find(n => /^[a-z]+$/i.test(n)); item = { kind: 'group', typed: w, entity: a.entity, tier: a.tier }; }
        else { const b = prompt.answers[3]; item = { kind: 'exact', typed: E[b.entity].name, entity: b.entity, tier: b.tier }; }
      } else if (i === 4) item = { kind: 'garbage', typed: 'xqzv wppl', entity: null, tier: null };
      else if (i === 5) item = { kind: 'empty', typed: '', entity: null, tier: null };
      else { const a = ans((x) => x.tier === 'hadal')[0]; item = { kind: 'hadal', typed: E[a.entity].name, entity: a.entity, tier: 'hadal' }; }
      plan.push(Object.assign({ promptId: pid, text: prompt.text }, item));
    });
    return plan;
  });
}

async function exposePromptIds(page) {
  await page.evaluate(() => {
    // the live dive state is private; read the ids from the result of the same deterministic construction
    const dive = window.FathomDive;
    const hash = location.hash;
    let ids;
    if (hash.startsWith('#daily')) ids = dive.dailyPromptIds(dive.dayKey(new Date()), window.FATHOM_PROMPTS, dive.LAUNCH_DATE);
    else if (hash.startsWith('#free-')) ids = dive.freePromptIds(hash.slice(6), window.FATHOM_PROMPTS);
    else if (hash.startsWith('#pack-')) ids = dive.packPromptIds(window.FATHOM_PACKS.find(p => p.id === hash.slice(6)), window.FATHOM_PROMPTS);
    else if (hash.startsWith('#challenge-')) ids = dive.freePromptIds(dive.parseChallenge(hash).seed, window.FATHOM_PROMPTS);
    document.body.dataset.promptIds = JSON.stringify(ids);
  });
}

async function playDive(page, plan, opts) {
  const seen = [];
  for (let i = 0; i < 7; i++) {
    await page.waitForSelector('#answer:not([disabled])');
    const text = await page.textContent('#prompt-text');
    seen.push(text);
    if (opts && opts.humanPace) await page.waitForTimeout(1100);        // a real person takes a second or more per prompt
    if (opts && opts.shotAt === i) await page.screenshot({ path: path.join(SHOTS, opts.shotName) });
    const typed = plan ? plan[i].typed : await page.evaluate(() => { const P = window.FATHOM_PROMPTS, E = window.FATHOM_ENTITIES; const p = P.find(x => x.text === document.querySelector('#prompt-text').textContent); return E[p.answers[0].entity].name; });
    await page.fill('#answer', typed);
    await page.press('#answer', 'Enter');
    await page.waitForSelector('.tile');
    if (opts && opts.revealShotAt === i) await page.screenshot({ path: path.join(SHOTS, opts.revealShotName) });
    await page.click('.next-row button');
  }
  await page.waitForSelector('.result-depth');
  return seen;
}

(async () => {
  const srv = await start();
  const browser = await chromium.launch();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await mobile.newPage();
  watch(page, 'mobile');

  // ---- first visit: how-to modal, home
  await page.goto(srv.url + '#home');
  await page.waitForSelector('.modal');
  assert.ok((await page.textContent('.modal')).includes('How to play'));
  await page.click('#howto-go');
  await page.waitForSelector('main a[href="#daily"]');
  await page.screenshot({ path: path.join(SHOTS, 'home-mobile.png') });

  // ---- daily dive with scripted inputs
  await page.click('main a[href="#daily"]');
  await page.waitForSelector('#answer');
  await exposePromptIds(page);
  const plan = await planAnswers(page);
  console.log('daily plan:', plan.map(p => p.kind + ':' + JSON.stringify(p.typed)).join(' | '));
  await playDive(page, plan, { shotAt: 0, shotName: 'dive-mobile.png', revealShotAt: 2, revealShotName: 'dive-reveal-mobile.png', humanPace: true });
  await page.screenshot({ path: path.join(SHOTS, 'result-mobile.png'), fullPage: true });

  const result = await page.evaluate(() => {
    const S = window.FathomStorage, dive = window.FathomDive;
    return S.getDailyResult(dive.dayKey(new Date()));
  });
  assert.strictEqual(result.results.length, 7);
  plan.forEach((p, i) => {
    const r = result.results[i];
    if (p.entity) { assert.strictEqual(r.entityId, p.entity, 'prompt ' + i + ' (' + p.kind + ') should match ' + p.entity + ' got ' + r.entityId); assert.strictEqual(r.tier, p.tier); }
    else assert.strictEqual(r.entityId, null, 'prompt ' + i + ' should miss');
  });
  const expectedPoints = plan.reduce((n, p) => n + (p.tier ? window_tier(p.tier) : 0), 0);
  function window_tier(code) { return { tidepool: 10, baitball: 15, reef: 30, twilight: 60, midnight: 85, hadal: 100 }[code]; }
  assert.strictEqual(result.points, expectedPoints, 'points add up');
  assert.strictEqual(result.depth, Math.round(expectedPoints * 10935 / 700), 'depth = points × 15.62');
  const shownDepth = (await page.textContent('.result-depth')).replace(/[^0-9]/g, '');
  assert.strictEqual(Number(shownDepth), result.depth);
  assert.ok(await page.$('.curve'), 'bell curve rendered (mock mode)');
  assert.ok((await page.textContent('body')).includes('demo data'));
  await page.click('text=Share');
  await page.waitForSelector('.toast');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(/^FATHOM #\d+ · [\d,]+ m · .{7,}$/u.test(clip.split('\n')[0]) && !/top \d+%/.test(clip), 'share text carries no demo percentile: ' + clip);
  assert.ok(result.secondsUsed >= 7, 'recorded dive took a plausible time: ' + result.secondsUsed + ' s');
  // stats modal opened from the result screen shows its own live countdown
  await page.click('#btn-stats');
  await page.waitForSelector('#countdown-modal');
  await page.waitForFunction(() => /\d\d:\d\d:\d\d/.test(document.getElementById('countdown-modal').textContent));
  await page.keyboard.press('Escape');
  fs.writeFileSync(path.join(FIXTURES, 'recorded-dive.json'), JSON.stringify({ day: result.dayKey, promptIds: result.promptIds, answers: result.results.map(r => ({ typed: r.typed, secondsUsed: r.secondsUsed })), depth: result.depth, points: result.points, tiers: result.tiers }, null, 2));

  // ---- daily is now locked to the result; countdown shows
  await page.goto(srv.url + '#daily');
  await page.waitForSelector('#countdown');
  await page.waitForFunction(() => /\d\d:\d\d:\d\d/.test(document.getElementById('countdown').textContent));

  // ---- stats modal, logbook persisted after reload
  await page.reload();
  await page.waitForSelector('main');
  await page.click('#btn-stats');
  await page.waitForSelector('.modal');
  const statsText = await page.textContent('.modal');
  assert.ok(/1\s*Dives played/.test(statsText.replace(/\n/g, ' ')), 'stats show 1 dive played');
  await page.keyboard.press('Escape');
  await page.goto(srv.url + '#logbook');
  await page.waitForSelector('.tabs');
  const logged = await page.evaluate(() => Object.keys(window.FathomStorage.logbook()).length);
  assert.ok(logged >= 4, 'logbook has the accepted answers, got ' + logged);
  await page.screenshot({ path: path.join(SHOTS, 'logbook-mobile.png') });
  for (const tab of ['plant', 'place', 'person', 'vessel']) { await page.goto(srv.url + '#logbook-' + tab); await page.waitForSelector('.tabs'); }

  // ---- leaderboard tabs (mock)
  for (const tab of ['today', 'tide', 'alltime', 'friends']) {
    await page.goto(srv.url + '#leaderboard-' + tab);
    await page.waitForSelector('.tabs');
    assert.ok((await page.textContent('main')).includes('demo'), 'demo badge on ' + tab);
  }
  await page.goto(srv.url + '#leaderboard');
  await page.waitForSelector('.lb-rank');
  await page.screenshot({ path: path.join(SHOTS, 'leaderboard-mobile.png') });

  // ---- packs: free pack plays, locked pack opens the unlock modal
  await page.goto(srv.url + '#packs');
  await page.waitForSelector('.list');
  await page.click('a[href="#pack-deep-sea"]');
  await page.waitForSelector('.modal');
  assert.ok((await page.textContent('.modal')).includes('Coming soon'));
  await page.keyboard.press('Escape');
  await page.goto(srv.url + '#pack-sharks');
  await page.waitForSelector('#answer');
  await playDive(page, null, {});
  assert.ok((await page.textContent('main')).includes('Sharks'));

  // ---- free dive → challenge link → second context plays the identical seven
  await page.goto(srv.url + '#free');
  await page.waitForSelector('#answer');
  const seen1 = await playDive(page, null, {});
  await page.click('text=Challenge a friend');
  await page.waitForSelector('.toast');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(/#challenge-[a-z0-9]+-\d+-[0-6]{7}$/.test(link), 'challenge link: ' + link);
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page2 = await ctx2.newPage();
  watch(page2, 'challenge');
  await page2.goto(link);
  await page2.waitForSelector('.modal'); await page2.click('#howto-go');
  await page2.waitForSelector('#answer');
  assert.ok((await page2.textContent('main')).includes('Beat'));
  const seen2 = await playDive(page2, null, {});
  assert.deepStrictEqual(seen2, seen1, 'challenge serves the same prompts in the same order');
  assert.ok((await page2.textContent('main')).includes('Send your score back'));
  await ctx2.close();

  // ---- menu drawer works (links clickable above the scrim) and the spec's #/challenge/SEED form routes
  await page.goto(srv.url + '#home'); await page.waitForSelector('main');
  const stray = await page.evaluate(() => { const m = document.querySelector('.modal'); return m ? m.textContent.slice(0, 160) : null; });
  assert.strictEqual(stray, null, 'no modal should be open on the home page, found: ' + stray);
  await page.click('#btn-menu'); await page.waitForSelector('#menu:not([hidden])');
  await page.click('#menu a[href="#logbook"]');
  await page.waitForSelector('.tabs');
  assert.ok((await page.textContent('main h1')).includes('Logbook'));
  const legacySeed = link.match(/#challenge-([a-z0-9]+)-/)[1];
  await page.goto(srv.url + '#/challenge/' + legacySeed.toUpperCase() + '-4210');
  await page.waitForSelector('#answer');
  assert.ok((await page.textContent('main')).includes('Beat 4,210 m'), 'legacy challenge link (upper-case seed) starts the challenge');
  assert.strictEqual(await page.textContent('#prompt-text'), seen1[0], 'legacy link serves the same first prompt');

  // ---- archive, faq, settings, help, 404, legal pages
  await page.goto(srv.url + '#archive'); await page.waitForSelector('main h1');
  await page.goto(srv.url + '#archive-2020-01-01'); await page.waitForSelector('main h1');
  await page.goto(srv.url + '#faq'); await page.waitForSelector('#contact');
  await page.goto(srv.url + '#nope'); await page.waitForSelector('main h2');
  await page.click('#btn-help'); await page.waitForSelector('.modal'); await page.keyboard.press('Escape');
  await page.click('#btn-settings'); await page.waitForSelector('.modal');
  await page.selectOption('.modal select', 'light');
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await page.selectOption('.modal select', 'dark');
  await page.click('.modal .toggle >> nth=0');          // high contrast on
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.contrast), 'true');
  await page.click('.modal .toggle >> nth=0');
  await page.click('.modal button:has-text("Reset")');  // Reset → Cancel keeps Settings open
  await page.waitForSelector('.modal-wrap.confirm');
  await page.click('.modal-wrap.confirm button:has-text("Cancel")');
  assert.ok(await page.$('.modal'), 'settings modal still open after cancelling the reset');
  await page.keyboard.press('Escape');
  await page.click('#btn-menu'); await page.waitForSelector('#menu:not([hidden])'); await page.click('#scrim');
  for (const legal of ['privacy.html', 'terms.html', 'refunds.html']) { const r = await page.goto(srv.url + legal); assert.strictEqual(r.status(), 200); await page.waitForSelector('h1'); }

  // ---- offline: service worker serves the site and a free dive still plays
  await page.goto(srv.url + '#home');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 }).catch(() => {});
  await page.reload();
  await page.waitForSelector('main');
  await mobile.setOffline(true);
  await page.reload();
  await page.waitForSelector('main a[href="#free"]', { timeout: 15000 });
  await page.click('main a[href="#free"]');
  await page.waitForSelector('#answer');
  await mobile.setOffline(false);

  // ---- desktop
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dpage = await desktop.newPage();
  watch(dpage, 'desktop');
  await dpage.goto(srv.url + '#home');
  await dpage.waitForSelector('.modal'); await dpage.click('#howto-go');
  await dpage.screenshot({ path: path.join(SHOTS, 'home-desktop.png') });
  await dpage.goto(srv.url + '#free');
  await dpage.waitForSelector('#answer');
  await dpage.fill('#answer', 'nothing at all'); await dpage.press('#answer', 'Enter'); await dpage.waitForSelector('.tile');
  await dpage.screenshot({ path: path.join(SHOTS, 'dive-desktop.png') });
  await desktop.close();

  await browser.close();
  srv.close();
  const realErrors = errors.filter(e => !/favicon/.test(e));
  if (realErrors.length) { console.error('CONSOLE ERRORS:\n' + realErrors.join('\n')); process.exit(1); }
  console.log('e2e OK — zero console errors, screenshots in tests/screenshots/, fixture in tests/fixtures/recorded-dive.json');
})().catch(e => { console.error(e); process.exit(1); });
