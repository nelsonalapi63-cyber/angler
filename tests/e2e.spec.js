'use strict';
/* ANGLER end-to-end run (spec §8). Usage: node tests/e2e.spec.js
 * First visit → welcome → the untimed tutorial (nothing saved); the daily with scripted inputs (exact + hint, alias,
 * typo, group word, a near-miss fixed by a "did you mean" chip, garbage then skip, hadal); the descent mid-animation;
 * the share text and the share card; badges; a pack; a challenge link in a second browser context; every page and
 * modal; persistence after reload; offline reload; desktop screenshots; and it fails on any console error. */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require('playwright');
const { start } = require('./serve');

const SHOTS = path.join(__dirname, 'screenshots');
const FIXTURES = path.join(__dirname, 'fixtures');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(FIXTURES, { recursive: true });
const TIER_POINTS = { tidepool: 10, baitball: 15, reef: 30, twilight: 60, midnight: 85, hadal: 100 };
const HINT_COST = 0;                 // v3: the one hint per dive is free

const MOCK_INIT = () => { try { localStorage.setItem('angler.mock', '1'); } catch (e) { /* ignore */ } };   // see FLAGS in online.js
const errors = [];
function watch(page, label) {
  page.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); });
  page.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message));
  page.on('requestfailed', r => { if (r.url().startsWith('http://127.0.0.1')) errors.push(label + ' request failed: ' + r.url()); });
}
// axe-core (vendored in tests/vendor/, MPL-2.0) — every checked screen must have zero violations
const AXE_SRC = fs.readFileSync(path.join(__dirname, 'vendor', 'axe.min.js'), 'utf8');
const a11y = [];
const axeReport = { tool: 'axe-core 4.14.0 (tests/vendor/axe.min.js), default rules', screens: [] };
async function axeCheck(page, label) {
  await page.evaluate((src) => { if (!window.axe) { const s = document.createElement('script'); s.textContent = src; document.head.appendChild(s); } }, AXE_SRC);
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))), new Promise(r => setTimeout(r, 1500))]));
  const res = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations', 'passes', 'incomplete'] }));   // every rule, default options
  axeReport.screens.push({ screen: label, url: page.url().replace(/^http:\/\/127\.0\.0\.1:\d+\//, '/'), violations: res.violations.length, rulesPassed: res.passes.length, needsReview: res.incomplete.map(i => i.id) });
  for (const v of res.violations) a11y.push(label + ': ' + v.id + ' [' + v.impact + '] ×' + v.nodes.length + ' — ' + v.help + ' @ ' + v.nodes.slice(0, 3).map(n => n.target.join(' ') + ' (' + (n.failureSummary || '').split('\n').slice(1, 2).join('') + ')').join(' | '));
  console.log('axe ' + label + ': ' + res.violations.length + ' violations' + (res.violations.length ? '\n  ' + a11y.slice(-res.violations.length).join('\n  ') : ''));
}
const bankReady = (page) => page.waitForFunction(() => window.Fathom && window.Fathom.bankLoaded, null, { timeout: 20000 });
async function skipWelcome(page) {
  await page.waitForSelector('.modal');
  assert.ok((await page.textContent('.modal')).includes('Welcome'));
  await page.click('#welcome-skip');
}

// Decide, inside the page, what to type for each of the seven prompts and what must come out.
async function planAnswers(page) {
  return page.evaluate(() => {
    const dive = window.FathomDive, P = window.FATHOM_PROMPTS, E = window.FATHOM_ENTITIES, T = window.FATHOM_TAXA || {};
    const byId = dive.byId(P);
    const ids = JSON.parse(document.body.dataset.promptIds);
    const plan = [];
    const mutate = (name, n) => {         // n substitutions spread through the name, never on spaces
      const chars = name.split('');
      const positions = [];
      for (let i = 0; i < chars.length && positions.length < n; i++) { const pos = Math.floor((i + 1) * chars.length / (n + 1)); if (chars[pos] !== ' ' && !positions.includes(pos)) positions.push(pos); }
      for (const pos of positions) chars[pos] = chars[pos] === 'a' ? 'e' : 'a';
      return chars.join('');
    };
    ids.forEach((pid, i) => {
      const prompt = byId[pid];
      const index = dive.buildIndex(prompt, E, T);
      const ans = (pred) => prompt.answers.filter(a => pred(a, E[a.entity]));
      let item;
      if (i === 0) {                                          // exact canonical name, after taking the hint
        const a = ans((x) => x.tier === 'reef')[0] || prompt.answers[0];
        item = { kind: 'hint+exact', typed: E[a.entity].name, entity: a.entity, tier: a.tier, hint: true };
      } else if (i === 1) {                                   // an alias
        const a = ans((x, e) => e.aliases && e.aliases.length)[0] || prompt.answers[1];
        const alias = (E[a.entity].aliases && E[a.entity].aliases[0]) || E[a.entity].name;
        item = { kind: 'alias', typed: alias, entity: a.entity, tier: a.tier };
      } else if (i === 2) {                                   // one-letter typo that still resolves to the right entity
        const cands = ans((x, e) => e.name.replace(/[^a-z]/gi, '').length >= 8);
        item = null;
        for (const a of cands) {
          const typo = mutate(E[a.entity].name, 1);
          const m = dive.matchAnswer(typo, index);
          if (m.entityId === a.entity && m.via === 'fuzzy') { item = { kind: 'typo', typed: typo, entity: a.entity, tier: a.tier }; break; }
        }
        if (!item) { const a = prompt.answers[2]; item = { kind: 'exact', typed: E[a.entity].name, entity: a.entity, tier: a.tier }; }
      } else if (i === 3) {                                   // a single-word group name such as "mako" (generic entities sit at the low tiers)
        const a = ans((x, e) => (x.tier === 'tidepool' || x.tier === 'baitball') && [e.name].concat(e.aliases || []).some(n => /^[a-z]+$/i.test(n)))[0] || ans((x, e) => [e.name].concat(e.aliases || []).some(n => /^[a-z]+$/i.test(n)))[0];
        if (a) { const w = [E[a.entity].name].concat(E[a.entity].aliases || []).find(n => /^[a-z]+$/i.test(n)); item = { kind: 'group', typed: w, entity: a.entity, tier: a.tier }; }
        else { const b = prompt.answers[3]; item = { kind: 'exact', typed: E[b.entity].name, entity: b.entity, tier: b.tier }; }
      } else if (i === 4) {                                   // three letters off: rejected, but a "did you mean" chip offers the right spelling
        const cands = ans((x, e) => e.name.replace(/[^a-z]/gi, '').length >= 12);
        item = null;
        for (const a of cands) {
          const typo = mutate(E[a.entity].name, 3);
          if (dive.matchAnswer(typo, index).entityId) continue;
          const sug = dive.suggestAnswers(typo, index, E);
          if (sug.length && sug[0].entityId === a.entity) { item = { kind: 'chip', typed: typo, chip: E[a.entity].name, entity: a.entity, tier: a.tier }; break; }
        }
        if (!item) { const a = prompt.answers[4]; item = { kind: 'exact', typed: E[a.entity].name, entity: a.entity, tier: a.tier }; }
      } else if (i === 5) item = { kind: 'garbage+skip', typed: 'xqzv wppl', entity: null, tier: null };
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
    if (hash.startsWith('#daily')) ids = dive.dailyPromptIds(dive.dayKey(new Date()), window.FATHOM_PROMPTS, dive.LAUNCH_DATE, window.FATHOM_SCHEDULE);
    else if (hash.startsWith('#free-')) ids = dive.freePromptIds(hash.slice(6), window.FATHOM_PROMPTS);
    else if (hash.startsWith('#pack-')) ids = dive.packPromptIds(window.FATHOM_PACKS.find(p => p.id === hash.slice(6)), window.FATHOM_PROMPTS);
    else if (hash.startsWith('#challenge-')) ids = dive.freePromptIds(dive.parseChallenge(hash).seed, window.FATHOM_PROMPTS);
    document.body.dataset.promptIds = JSON.stringify(ids);
  });
}

async function playDive(page, plan, opts) {
  const seen = [];
  const total = (opts && opts.total) || 7;
  for (let i = 0; i < total; i++) {
    await page.waitForSelector('#answer:not([disabled])');
    const text = await page.textContent('#question-text');
    seen.push(text);
    if (opts && opts.humanPace) await page.waitForTimeout(1100);        // a real person takes a second or more per prompt
    if (opts && opts.shotAt === i) await page.screenshot({ path: path.join(SHOTS, opts.shotName) });
    const item = plan ? plan[i] : null;
    const typed = item ? item.typed : await page.evaluate(() => { const P = window.FATHOM_PROMPTS, E = window.FATHOM_ENTITIES; const p = P.find(x => x.text === document.querySelector('#question-text').textContent); return E[p.answers[0].entity].name; });
    if (item && item.hint) { await page.click('#hint-btn'); await page.waitForSelector('#hint-text:not(:empty)'); }
    await page.fill('#answer', typed);
    await page.press('#answer', 'Enter');
    if (item && item.kind === 'chip') {
      await page.waitForSelector('#reject:not(:empty)');
      assert.strictEqual(await page.inputValue('#answer'), '', 'a rejected guess clears the box');
      assert.ok(await page.$('#answer:not([disabled])'), 'the prompt stays open after a rejected guess');
      const chip = await page.waitForSelector('.chip-btn');
      assert.strictEqual(await chip.textContent(), item.chip, 'the chip offers the right spelling');
      await chip.click();
    } else if (item && item.kind === 'garbage+skip') {
      await page.waitForSelector('#reject:not(:empty)');
      assert.ok(await page.$('#answer:not([disabled])'), 'garbage does not end the prompt');
      assert.strictEqual(await page.$('.chip-btn'), null, 'nothing like any answer: no chips');
      await page.click('#skip-btn');
    }
    if (opts && opts.descentShotAt === i) { await page.waitForTimeout(900); await page.screenshot({ path: path.join(SHOTS, opts.descentShotName) }); }
    await page.waitForSelector('.tile');
    if (opts && opts.revealShotAt === i) await page.screenshot({ path: path.join(SHOTS, opts.revealShotName) });
    if (opts && opts.onAnswer) await opts.onAnswer(i);
    await page.click('.next-row button');
  }
  await page.waitForSelector('.result-depth');
  return seen;
}

// The dive screen is two columns at every width: the water column on the left, the question and answer box to its right.
async function assertTwoColumns(page, label) {
  const box = await page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
    return { scene: r('#dive-scene'), main: r('.dive-main'), answer: r('#answer'), question: r('#question-text'), vw: innerWidth, vh: innerHeight };
  });
  assert.ok(box.scene.right <= box.main.left + 1, label + ': the scene sits left of the question column');
  assert.ok(box.scene.width >= 96 && box.scene.width <= box.vw * 0.42, label + ': scene width ' + Math.round(box.scene.width) + ' of ' + box.vw);
  assert.ok(box.scene.height >= 300, label + ': the scene is tall (' + Math.round(box.scene.height) + ' px)');
  assert.ok(box.answer.top > box.question.top && box.answer.bottom <= box.vh, label + ': the answer box is under the question and on screen');
  const centre = (box.answer.top + box.answer.bottom) / 2;
  assert.ok(centre > box.vh * 0.3 && centre < box.vh * 0.8, label + ': the answer box sits around the middle of the column (' + Math.round(centre) + ' of ' + box.vh + ')');
}

// Video → GIF with the system ffmpeg (two-pass palette, 8 fps, 320 px wide). Returns false when ffmpeg is missing.
function videoToGif(video, out, fps) {
  const { spawnSync } = require('child_process');
  const have = spawnSync('ffmpeg', ['-version']);
  if (have.error) return false;
  const vf = 'fps=' + fps + ',scale=300:-1:flags=lanczos';
  const pal = out + '.palette.png';
  const a = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', vf + ',palettegen=max_colors=96', pal]);
  if (a.status !== 0) { console.error(String(a.stderr).slice(-400)); return false; }
  const b = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', pal, '-lavfi', vf + ' [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', out]);
  fs.rmSync(pal, { force: true });
  if (b.status !== 0) { console.error(String(b.stderr).slice(-400)); return false; }
  return true;
}

// A cold visitor: lands, sees motion within five seconds, taps the one big Dive button, answers seven questions (one
// skipped) and reaches a result that offers the return hooks. Every answer must change something visible on screen.
async function coldVisitorWalkthrough(browser, srv) {
  const videoDir = path.join(__dirname, 'screenshots', '.video');
  fs.rmSync(videoDir, { recursive: true, force: true }); fs.mkdirSync(videoDir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, recordVideo: { dir: videoDir, size: { width: 390, height: 844 } } });
  await ctx.addInitScript(MOCK_INIT);
  const page = await ctx.newPage();
  watch(page, 'cold visitor');
  const t0 = Date.now();
  await page.goto(srv.url);
  await page.waitForSelector('.modal');
  await page.click('#welcome-skip');
  await page.waitForSelector('.hero-art canvas');
  // motion within five seconds of landing: the hero canvas changes between two frames
  const a = await page.evaluate(() => document.querySelector('.hero-art canvas').toDataURL());
  await page.waitForTimeout(350);
  const b = await page.evaluate(() => document.querySelector('.hero-art canvas').toDataURL());
  assert.ok(a !== b, 'the landing scene moves');
  assert.ok(Date.now() - t0 < 5000, 'motion seen within 5 s of landing (' + (Date.now() - t0) + ' ms)');
  const hero = await page.textContent('.hero');
  assert.ok(/7 questions/.test(hero), 'the hero states today\'s question count');
  assert.strictEqual(await page.$$eval('.hero .btn-primary', b => b.length), 1, 'one big Dive button');
  const above = await page.evaluate(() => { const h = document.querySelector('.how'); return h ? h.getBoundingClientRect().top : 9999; });
  assert.ok(above > 844 * 0.8, '"How it works" is below the fold on a phone (top at ' + Math.round(above) + ')');
  await page.click('.hero .btn-primary');
  await page.waitForSelector('#answer:not([disabled])');
  await bankReady(page);
  const snapshot = async () => page.evaluate(() => document.querySelector('main').innerText + '|' + document.getElementById('dive-scene').dataset.depth + '|' + document.getElementById('dive-scene').dataset.effect);
  let lastDepth = 0;
  for (let i = 0; i < 7; i++) {
    await page.waitForSelector('#answer:not([disabled])');
    await page.waitForTimeout(900);
    const before = await snapshot();
    if (i === 3) { await page.click('#skip-btn'); }
    else {
      const answer = await page.evaluate((k) => { const P = window.FATHOM_PROMPTS, E = window.FATHOM_ENTITIES; const p = P.find(x => x.text === document.querySelector('#question-text').textContent); const pick = p.answers[Math.min(k * 2, p.answers.length - 1)]; return E[pick.entity].name; }, i);
      await page.fill('#answer', answer); await page.press('#answer', 'Enter');
    }
    await page.waitForSelector('.tile');
    await page.waitForTimeout(700);
    const after = await snapshot();
    assert.notStrictEqual(after, before, 'answer ' + (i + 1) + ' changed what is on screen');
    const depth = Number(await page.getAttribute('#dive-scene', 'data-depth'));
    if (i === 3) assert.strictEqual(depth, lastDepth, 'a skip does not sink the sub');
    else await page.waitForFunction((d) => Number(document.getElementById('dive-scene').dataset.depth) > d, lastDepth, { timeout: 6000 });
    lastDepth = Number(await page.getAttribute('#dive-scene', 'data-depth'));
    await page.waitForTimeout(600);
    await page.click('.next-row button');
  }
  await page.waitForSelector('.result-depth');
  await page.waitForTimeout(1600);
  const hooks = await page.evaluate(() => ({ countdown: !!document.querySelector('#countdown'), streak: /\d-day streak/.test(document.querySelector('.hooks').textContent), challenge: !!document.querySelector('#challenge-btn'), recap: /recap/i.test(document.querySelector('.hooks').textContent) }));
  assert.deepStrictEqual(hooks, { countdown: true, streak: true, challenge: true, recap: true }, 'the result offers the return hooks: ' + JSON.stringify(hooks));
  assert.ok(/#\d+ — the daily ocean dive/.test(await page.title()), 'the puzzle number is in the title: ' + await page.title());
  const video = page.video();
  await ctx.close();                                     // the video file is complete once the context closes
  const gif = path.join(__dirname, 'screenshots', 'dive.gif');
  const webm = await video.path();
  if (videoToGif(webm, gif, 6)) console.log('dive.gif: ' + Math.round(fs.statSync(gif).size / 1024) + ' KB from ' + Math.round(fs.statSync(webm).size / 1024) + ' KB of video'); else console.log('dive.gif skipped (ffmpeg not available); video kept in tests/screenshots/.video');
  fs.rmSync(videoDir, { recursive: true, force: true });
}

(async () => {
  const srv = await start();
  const browser = await chromium.launch();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await mobile.addInitScript(MOCK_INIT);           // demo mode: the test run never talks to the live Supabase project
  const page = await mobile.newPage();
  watch(page, 'mobile');

  // ---- first visit: welcome → tutorial (three untimed prompts, nothing saved)
  await page.goto(srv.url + '#home');
  await page.waitForSelector('.modal');
  assert.ok((await page.textContent('.modal')).includes('Welcome'));
  await page.screenshot({ path: path.join(SHOTS, 'welcome-mobile.png') });
  await page.click('#welcome-tutorial');
  await page.waitForSelector('#answer:not([disabled])');
  assert.ok((await page.textContent('main')).includes('Tutorial 1/3'));
  assert.ok((await page.textContent('main')).includes('No timer'));
  await page.fill('#answer', 'great white'); await page.press('#answer', 'Enter');
  await page.waitForSelector('.tile'); await page.click('.next-row button');
  await page.waitForSelector('#answer:not([disabled])');
  await page.fill('#answer', 'zzzzz whale'); await page.press('#answer', 'Enter');          // rejected: the prompt stays open
  await page.waitForSelector('#reject:not(:empty)');
  await page.click('#hint-btn');
  await page.waitForSelector('#hint-text:not(:empty)');
  assert.strictEqual((await page.textContent('#hint-btn')).trim(), 'Hint used');
  await page.fill('#answer', 'humpbak whale'); await page.press('#answer', 'Enter');       // a letter off still counts
  await page.waitForSelector('.tile');
  assert.ok((await page.textContent('.tile')).includes('2 tries'));
  await page.click('.next-row button');
  await page.waitForSelector('#answer:not([disabled])');
  assert.ok(await page.$('#hint-btn[disabled]'), 'one hint per dive: the box is spent on the next question too');
  assert.strictEqual((await page.textContent('#hint-btn')).trim(), 'Hint used');
  assert.ok(!/\bprompt\b/i.test(await page.textContent('main')), 'players never read the word "prompt"');
  await page.click('#skip-btn');
  await page.waitForSelector('.tile');
  assert.ok((await page.textContent('.tile')).includes('Skipped'));
  await page.click('.next-row button');
  await page.waitForSelector('.result-depth');
  assert.ok((await page.textContent('main')).includes('Tutorial complete'));
  const afterTutorial = await page.evaluate(() => { const S = window.FathomStorage; return { daily: Object.keys(S.allDailyResults()).length, logbook: Object.keys(S.logbook()).length, played: Object.keys(S.playedPrompts()).length, badges: Object.keys(S.get('badges', {})).length }; });
  assert.deepStrictEqual(afterTutorial, { daily: 0, logbook: 0, played: 0, badges: 0 }, 'the tutorial saves nothing');
  await page.goto(srv.url + '#home');
  await page.waitForSelector('main a[href="#daily"]');
  await page.screenshot({ path: path.join(SHOTS, 'home-mobile.png'), fullPage: true });
  await bankReady(page);
  await axeCheck(page, 'home');

  // ---- daily dive with scripted inputs
  await page.click('main a[href="#daily"]');
  await page.waitForSelector('#answer');
  await axeCheck(page, 'dive');
  await assertTwoColumns(page, 'phone');
  await exposePromptIds(page);
  const plan = await planAnswers(page);
  console.log('daily plan:', plan.map(p => p.kind + ':' + JSON.stringify(p.typed)).join(' | '));
  const depthsSeen = [];
  await playDive(page, plan, { shotAt: 0, shotName: 'dive-mobile.png', revealShotAt: 2, revealShotName: 'dive-reveal-mobile.png', descentShotAt: 6, descentShotName: 'hadal-moment.png', humanPace: true, onAnswer: async (i) => {
    // the submarine is the single depth display: it sinks on an accepted answer and stalls on a skip
    const item = plan[i];
    if (item.kind === 'garbage+skip') {
      assert.strictEqual(await page.getAttribute('#dive-scene', 'data-effect'), 'stall', 'a skip makes the sub stall');
    } else {
      // the sub is still sinking when the tile lands; wait for it to settle before reading the depth
      await page.waitForFunction((n) => { const d = document.getElementById('dive-scene').dataset; return Number(d.depth) > n && d.effect !== 'descend'; }, depthsSeen.length ? depthsSeen[depthsSeen.length - 1] : -1, { timeout: 8000 });
    }
    depthsSeen.push(Number(await page.getAttribute('#dive-scene', 'data-depth')));
    if (i === 0) {
      assert.ok((await page.textContent('#radio')).length > 0 && (await page.textContent('#radio')).length < 60, 'the pilot radios a short line: ' + await page.textContent('#radio'));
      assert.ok(/said that|anyone says|clever pick|solid answer|uncommon|specialist|one best/i.test(await page.textContent('.rarity')), 'the rarity line: ' + await page.textContent('.rarity'));
    }
  } });
  assert.ok(depthsSeen[6] > depthsSeen[0] && depthsSeen[5] === depthsSeen[4], 'depth grows on accepts and holds on the skip: ' + depthsSeen.join(','));
  await page.screenshot({ path: path.join(SHOTS, 'result-mobile.png'), fullPage: true });
  await page.waitForSelector('.curve-card .curve');
  await (await page.$('.curve-card')).screenshot({ path: path.join(SHOTS, 'result-curve.png') });
  assert.ok(/You beat \d+% of divers today/.test(await page.textContent('.curve-card')), 'the curve card says what share of divers you beat');
  assert.ok(/Ranked #\d+ of [\d,]+ worldwide/.test(await page.textContent('.curve-card')), 'and your rank in the world');
  assert.ok(/You beat \d+%/.test(await page.textContent('#standing')), 'the verdict repeats the standing');
  assert.ok(await page.$('#result-scene canvas'), 'the sub rests on the result screen');
  // the curve exists for every crowd size: alone, early, and with a crowd (the chart is a pure function of the data)
  const curveStates = await page.evaluate(() => {
    const C = window.FathomCharts;
    window.FathomGame.drawStanding({ total: 1, rank: 1 });
    const alone = document.getElementById('standing').textContent;
    return { alone, empty: /class="curve[^"]*empty/.test(C.bellCurve({ bins: [], total: 0, playerDepth: 1200 })), early: /class="curve early/.test(C.bellCurve({ bins: [2, 5, 9, 4, 1], total: 3, playerDepth: 1200, early: true, beat: 50, rank: 2 })) };
  });
  assert.ok(/first diver today — #1 of 1/.test(curveStates.alone), 'alone: ' + curveStates.alone);
  assert.ok(curveStates.empty && curveStates.early, 'empty and early curve variants render');
  await axeCheck(page, 'result');
  // every mode offers a challenge; a daily one encodes the day so the friend plays the same seven
  assert.ok(await page.$('#challenge-btn'), 'challenge button on the daily result');
  await page.click('#challenge-btn'); await page.waitForSelector('.toast');
  const dailyLink = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(/#challenge-d\d{8}-\d+-[0-6]{7}$/.test(dailyLink), 'daily challenge link carries the day seed: ' + dailyLink);
  // one-tap report sheet: four kinds, a note, saved locally in demo mode
  await page.click('button.link-btn:text-is("Report an answer or tier") >> nth=0');
  await page.waitForSelector('.modal .report-kinds');
  assert.strictEqual(await page.$$eval('.modal input[name="report-kind"]', r => r.length), 4, 'four report kinds');
  await page.check('#rk-wrong_fact');
  await page.fill('.modal .report-note', 'e2e note');
  await axeCheck(page, 'report sheet');
  await page.click('.modal button:text-is("Send report")');
  await page.waitForSelector('.toast');
  const pendingReports = await page.evaluate(() => window.FathomStorage.get('reportsPending', []));
  assert.strictEqual(pendingReports.length, 1); assert.strictEqual(pendingReports[0].kind, 'wrong_fact'); assert.strictEqual(pendingReports[0].note, 'e2e note');

  const result = await page.evaluate(() => {
    const S = window.FathomStorage, dive = window.FathomDive;
    return S.getDailyResult(dive.dayKey(new Date()));
  });
  assert.strictEqual(result.results.length, 7);
  plan.forEach((p, i) => {
    const r = result.results[i];
    if (p.entity) { assert.strictEqual(r.entityId, p.entity, 'prompt ' + i + ' (' + p.kind + ') should match ' + p.entity + ' got ' + r.entityId); assert.strictEqual(r.tier, p.tier); }
    else assert.strictEqual(r.entityId, null, 'prompt ' + i + ' should miss');
    if (p.hint) assert.strictEqual(r.hint, true, 'hint recorded');
    if (p.kind === 'chip') assert.strictEqual(r.attempts, 2, 'the chip counts as the second try');
    if (p.kind === 'garbage+skip') { assert.strictEqual(r.skipped, true); assert.strictEqual(r.attempts, 1); }
  });
  const expectedPoints = plan.reduce((n, p) => n + (p.tier ? Math.max(0, TIER_POINTS[p.tier] - (p.hint ? HINT_COST : 0)) : 0), 0);
  assert.strictEqual(result.points, expectedPoints, 'points add up, hint cost included');
  assert.strictEqual(result.depth, Math.round(expectedPoints * 10935 / 700), 'depth = points × 15.62');
  assert.strictEqual(result.hints, 1);
  const shownDepth = (await page.textContent('.result-depth')).replace(/[^0-9]/g, '');
  assert.strictEqual(Number(shownDepth), result.depth);
  assert.ok(await page.$('.curve'), 'bell curve rendered (mock mode)');
  assert.ok((await page.textContent('body')).includes('demo data'));
  assert.ok((await page.textContent('main')).includes('What others answered today'));
  assert.ok((await page.textContent('main')).includes('New badge'), 'first dive unlocks badges');
  await page.click('button:has-text("Share results")');
  await page.waitForSelector('.toast');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(/^ANGLER #\d+ · [\d,]+ m · .{7,}$/u.test(clip.split('\n')[0]) && !/beat \d+%|#\d+ of/.test(clip), 'share text carries no demo standing: ' + clip);
  await page.click('button:has-text("Share as image")');
  await page.waitForSelector('img.share-card');
  await page.waitForFunction(() => { const i = document.querySelector('img.share-card'); return i && i.complete && i.naturalWidth > 0; });
  await page.waitForTimeout(400);                                    // let the modal's entrance animation finish
  await page.screenshot({ path: path.join(SHOTS, 'share-card-mobile.png') });
  await page.keyboard.press('Escape');
  assert.ok(result.secondsUsed >= 7, 'recorded dive took a plausible time: ' + result.secondsUsed + ' s');
  // stats modal opened from the result screen shows its own live countdown and the badge wall
  await page.click('#btn-stats');
  await page.waitForSelector('#countdown-modal');
  await page.waitForFunction(() => /\d\d:\d\d:\d\d/.test(document.getElementById('countdown-modal').textContent));
  assert.ok(await page.$('.modal .badge-wall'), 'badge wall in My ANGLER');
  assert.ok(await page.$('.modal .heatmap .hm-cell.today[class*="z-"]'), 'calendar heatmap marks today as played');
  assert.ok(/freeze/i.test(await page.textContent('.modal')), 'streak freeze line in My ANGLER');
  await page.screenshot({ path: path.join(SHOTS, 'my-angler-mobile.png') });
  await axeCheck(page, 'my angler');
  await page.keyboard.press('Escape');
  fs.writeFileSync(path.join(FIXTURES, 'recorded-dive.json'), JSON.stringify({ day: result.dayKey, promptIds: result.promptIds, answers: result.results.map(r => ({ typed: r.typed, secondsUsed: r.secondsUsed, hint: !!r.hint })), depth: result.depth, points: result.points, tiers: result.tiers }, null, 2));

  // ---- daily is now locked to the result; countdown shows; the home page shows the result and a countdown
  await page.goto(srv.url + '#daily');
  await page.waitForSelector('#countdown');
  await page.waitForFunction(() => /\d\d:\d\d:\d\d/.test(document.getElementById('countdown').textContent));
  await page.goto(srv.url + '#home');
  await page.waitForSelector('#home-countdown');
  await page.waitForFunction(() => /\d\d:\d\d:\d\d/.test(document.getElementById('home-countdown').textContent));
  assert.ok((await page.textContent('main')).includes('Today you reached'));

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
  await axeCheck(page, 'logbook');
  for (const tab of ['plant', 'place', 'person', 'vessel', 'other']) { await page.goto(srv.url + '#logbook-' + tab); await page.waitForSelector('.tabs'); }
  await page.goto(srv.url + '#logbook-badges');
  await page.waitForSelector('.badge-wall');
  const lit = await page.$$eval('.badge-wall .badge-item.on', els => els.length);
  assert.ok(lit >= 2, 'badge wall shows the earned badges, got ' + lit);
  await page.screenshot({ path: path.join(SHOTS, 'badges-mobile.png'), fullPage: true });

  // ---- leaderboard tabs (mock)
  for (const tab of ['today', 'tide', 'alltime', 'friends']) {
    await page.goto(srv.url + '#leaderboard-' + tab);
    await page.waitForSelector('.tabs');
    assert.ok((await page.textContent('main')).includes('demo'), 'demo badge on ' + tab);
  }
  await page.goto(srv.url + '#leaderboard');
  await page.waitForSelector('.lb-rank');
  await page.screenshot({ path: path.join(SHOTS, 'leaderboard-mobile.png') });
  await axeCheck(page, 'leaderboard');
  await page.goto(srv.url + '#leaderboard-friends'); await page.waitForSelector('.tabs');
  await page.waitForSelector('main .curve', { timeout: 10000 });
  assert.ok((await page.textContent('main')).includes('demo'), 'friends-only curve is labelled demo');
  await page.screenshot({ path: path.join(SHOTS, 'friends-mobile.png'), fullPage: true });

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
  await page.goto(srv.url + '#packs'); await page.waitForSelector('.list');
  await page.waitForSelector('a[href^="#pack-community-"]', { timeout: 10000 });
  assert.ok(await page.$('.pack-builder'), 'suggest-a-pack form on the packs page');
  await page.click('a[href^="#pack-community-"] >> nth=0');
  await page.waitForSelector('#answer');
  assert.ok((await page.textContent('main')).includes('Question 1 of 7'), 'a community pack starts a seven-question dive');

  // ---- free dive → challenge link → second context plays the identical seven (no hint button in a challenge)
  await page.goto(srv.url + '#free');
  await page.waitForSelector('#answer');
  assert.ok(await page.$('#hint-btn'), 'hint button in a free dive');
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'answer');   // the prompt focuses its box shortly after rendering
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('h'); await page.waitForSelector('#hint-text:not(:empty)');
  assert.strictEqual((await page.textContent('#hint-btn')).trim(), 'Hint used', 'H uses the hint when not typing');
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'answer', 'the hint hands focus back to the answer box');
  await page.evaluate(() => document.activeElement.blur()); await page.waitForTimeout(80);
  await page.keyboard.press('s'); await page.waitForSelector('.tile.tile-miss');
  assert.ok((await page.textContent('.tile')).includes('Skipped'), 'S skips when not typing, tile: ' + await page.textContent('.tile') + ' | input: ' + await page.inputValue('#answer') + ' | active: ' + await page.evaluate(() => document.activeElement.tagName));
  await page.click('.next-row button'); await page.waitForSelector('#answer:not([disabled])');
  await page.focus('#answer'); await page.keyboard.type('s');          // typing in the box is never a shortcut
  assert.strictEqual(await page.inputValue('#answer'), 's');
  await page.goto(srv.url + '#free'); await page.waitForSelector('#answer');
  const seen1 = await playDive(page, null, {});
  await page.click('text=Challenge a friend');
  await page.waitForSelector('.toast');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(/#challenge-[a-z0-9]+-\d+-[0-6]{7}$/.test(link), 'challenge link: ' + link);
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx2.addInitScript(MOCK_INIT);
  const page2 = await ctx2.newPage();
  watch(page2, 'challenge');
  await page2.goto(link);
  await skipWelcome(page2);
  await page2.waitForSelector('#answer');
  assert.ok((await page2.textContent('main')).includes('Beat'));
  assert.strictEqual(await page2.$('#hint-btn'), null, 'hints are off in challenges');
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
  assert.strictEqual(await page.textContent('#question-text'), seen1[0], 'legacy link serves the same first prompt');

  // ---- daily resume: a rejected guess and a hint survive a reload (fresh context, second day is not needed: use progress directly)
  // (covered by unit tests of saveProgress shape; here: the timer keeps running after a rejected guess)
  await page.goto(srv.url + '#free');
  await page.waitForSelector('#answer');
  await page.fill('#answer', 'nothing at all'); await page.press('#answer', 'Enter');
  await page.waitForSelector('#reject:not(:empty)');
  const t1 = Number(await page.textContent('.timer .num'));
  await page.waitForTimeout(1600);
  const t2 = Number(await page.textContent('.timer .num'));
  assert.ok(t2 < t1, 'the timer keeps running after a rejected guess (' + t1 + ' → ' + t2 + ')');
  await page.click('#skip-btn'); await page.waitForSelector('.tile');

  // ---- archive, faq, settings (tutorial replay link), help, 404, legal pages
  await page.goto(srv.url + '#archive'); await page.waitForSelector('main h1');
  await page.goto(srv.url + '#archive-2020-01-01'); await page.waitForSelector('main h1');
  await page.goto(srv.url + '#faq'); await page.waitForSelector('#contact');
  await page.goto(srv.url + '#nope'); await page.waitForSelector('main .empty .mascot');
  await page.click('#btn-help'); await page.waitForSelector('.modal'); await page.keyboard.press('Escape');
  await page.click('#btn-settings'); await page.waitForSelector('.modal');
  assert.ok(await page.$('#settings-tutorial'), 'tutorial can be replayed from Settings');
  assert.ok(await page.$('.modal details.shortcuts'), 'keyboard shortcuts listed in Settings');
  assert.ok(/Daily reminder/.test(await page.textContent('.modal')), 'reminder time in Settings');
  await axeCheck(page, 'settings');
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
  await page.click('#settings-tutorial');
  await page.waitForSelector('#answer');
  assert.ok((await page.textContent('main')).includes('Tutorial 1/3'));
  await page.goto(srv.url + '#home'); await page.waitForSelector('main');
  await page.click('#btn-menu'); await page.waitForSelector('#menu:not([hidden])'); await page.click('#scrim');
  for (const legal of ['privacy.html', 'terms.html', 'refunds.html']) { const r = await page.goto(srv.url + legal); assert.strictEqual(r.status(), 200); await page.waitForSelector('h1'); }

  // ---- offline: service worker serves the site and a free dive still plays
  await page.goto(srv.url + '#home');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 }).catch(() => {});
  await page.reload();
  await page.waitForSelector('main');
  await page.mouse.click(5, 400);                       // the first touch warms the full bank through the service worker, which caches it
  await bankReady(page);
  await page.waitForTimeout(300);                       // let the cache.put calls land
  await mobile.setOffline(true);
  await page.reload();
  await page.waitForSelector('main a[href="#free"]', { timeout: 15000 });
  await page.click('main a[href="#free"]');
  await page.waitForSelector('#answer', { timeout: 15000 });
  await mobile.setOffline(false);

  // ---- admin.html: owner dashboard renders on demo data (online layer off), guesses drill-down, accept a report, export
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await actx.addInitScript(MOCK_INIT);
  const apage = await actx.newPage();
  watch(apage, 'admin');
  await apage.goto(srv.url + 'admin.html');
  await apage.waitForSelector('main h1');
  assert.ok((await apage.textContent('main h1')).includes('ANGLER admin'));
  assert.strictEqual(await apage.$$eval('main section.card', s => s.length), 4, 'funnel, cohorts, prompts, reports');
  await apage.screenshot({ path: path.join(SHOTS, 'admin.png'), fullPage: true });
  await apage.click('main section.card button:text-is("Guesses")');
  await apage.waitForSelector('main h3');
  assert.ok((await apage.textContent('main h3')).includes('Most-typed rejected guesses'));
  const newBefore = await apage.$$eval('.status-new', s => s.length);
  await apage.click('.status-new ~ .row button:text-is("Accept")');
  await apage.waitForFunction((n) => document.querySelectorAll('.status-new').length === n - 1, newBefore);
  const [download] = await Promise.all([apage.waitForEvent('download'), apage.click('button:text-is("Export accepted → inbox.json")')]);
  const inbox = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.ok(Array.isArray(inbox.review) && inbox.review.length >= 1 && Array.isArray(inbox.aliasAdd), 'export is an apply-patch skeleton with a review list');
  await axeCheck(apage, 'admin');
  await apage.context().close();

  // ---- desktop
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await desktop.addInitScript(MOCK_INIT);
  const dpage = await desktop.newPage();
  watch(dpage, 'desktop');
  await dpage.goto(srv.url + '#home');
  await skipWelcome(dpage);
  await dpage.screenshot({ path: path.join(SHOTS, 'home-desktop.png') });
  await bankReady(dpage);
  await dpage.goto(srv.url + '#free');
  await dpage.waitForSelector('#answer');
  await assertTwoColumns(dpage, 'desktop');
  await dpage.fill('#answer', 'nothing at all'); await dpage.press('#answer', 'Enter'); await dpage.waitForSelector('#reject:not(:empty)');
  await dpage.screenshot({ path: path.join(SHOTS, 'dive-desktop.png') });
  await dpage.click('#skip-btn'); await dpage.waitForSelector('.tile');
  await desktop.close();

  // ---- reduced motion: the sub jumps to its new depth (with a short fade) and nothing keeps moving
  const calm = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await calm.addInitScript(MOCK_INIT);
  const cpage = await calm.newPage();
  watch(cpage, 'reduced motion');
  await cpage.goto(srv.url + '#free'); await skipWelcome(cpage); await cpage.waitForSelector('#answer:not([disabled])');
  const calmAnswer = await cpage.evaluate(() => { const P = window.FATHOM_PROMPTS, E = window.FATHOM_ENTITIES; const p = P.find(x => x.text === document.querySelector('#question-text').textContent); return E[p.answers[0].entity].name; });
  await cpage.fill('#answer', calmAnswer); await cpage.press('#answer', 'Enter');
  await cpage.waitForFunction(() => Number(document.getElementById('dive-scene').dataset.depth) > 0, null, { timeout: 1500 });
  await cpage.waitForTimeout(900);
  const f1 = await cpage.evaluate(() => document.querySelector('#dive-scene canvas').toDataURL());
  await cpage.waitForTimeout(400);
  const f2 = await cpage.evaluate(() => document.querySelector('#dive-scene canvas').toDataURL());
  assert.strictEqual(f1, f2, 'under reduced motion the water column is still once the sub has settled');
  await calm.close();

  // ---- the engagement walk-through: a cold visitor, landing to finished dive, recorded as tests/screenshots/dive.gif
  await coldVisitorWalkthrough(browser, srv);

  await browser.close();
  srv.close();
  const realErrors = errors.filter(e => !/favicon/.test(e));
  if (realErrors.length) { console.error('CONSOLE ERRORS:\n' + realErrors.join('\n')); process.exit(1); }
  fs.mkdirSync(path.join(__dirname, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'reports', 'axe-report.json'), JSON.stringify(Object.assign({ date: new Date().toISOString().slice(0, 10) }, axeReport), null, 2));
  if (a11y.length) { console.error('AXE VIOLATIONS:\n' + a11y.join('\n')); process.exit(1); }
  console.log('e2e OK — zero console errors, zero axe violations, screenshots in tests/screenshots/, axe report in tests/reports/axe-report.json');
})().catch(e => { console.error(e); process.exit(1); });
