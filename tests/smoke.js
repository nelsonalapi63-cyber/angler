'use strict';
// Quick visual smoke test: home, one dive with scripted inputs, result. Writes screenshots to tests/screenshots/.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { start } = require('./serve');

(async () => {
  const srv = await start();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  const shots = path.join(__dirname, 'screenshots');
  fs.mkdirSync(shots, { recursive: true });

  await page.goto(srv.url + '#home');
  await page.waitForSelector('.modal');          // how-to on first visit
  await page.screenshot({ path: path.join(shots, 'smoke-howto.png') });
  await page.click('#howto-go');
  await page.screenshot({ path: path.join(shots, 'smoke-home.png') });

  await page.click('main a[href="#daily"]');
  await page.waitForSelector('#answer');
  const data = await page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll('.progress-dots span')).length;
    return { prompt: document.querySelector('#prompt-text').textContent, ids };
  });
  console.log('first prompt:', data.prompt);
  await page.screenshot({ path: path.join(shots, 'smoke-dive-1.png') });
  // answer with a real accepted name pulled from the page data
  for (let i = 0; i < 7; i++) {
    const answer = await page.evaluate((i) => {
      const P = window.FATHOM_PROMPTS, E = window.FATHOM_ENTITIES;
      const text = document.querySelector('#prompt-text').textContent;
      const prompt = P.find(p => p.text === text);
      const pick = prompt.answers[Math.min(i * 3, prompt.answers.length - 1)];
      return i === 4 ? 'zzzz nothing' : E[pick.entity].name;
    }, i);
    await page.fill('#answer', answer);
    await page.press('#answer', 'Enter');
    await page.waitForSelector('.tile');
    if (i === 1) await page.screenshot({ path: path.join(shots, 'smoke-dive-reveal.png') });
    await page.click('.next-row button');
    if (i < 6) await page.waitForSelector('#answer:not([disabled])');
  }
  await page.waitForSelector('.result-depth');
  await page.screenshot({ path: path.join(shots, 'smoke-result.png'), fullPage: true });
  const depth = await page.textContent('.result-depth');
  console.log('result depth:', depth);
  await page.click('#btn-stats');
  await page.waitForSelector('.modal');
  await page.screenshot({ path: path.join(shots, 'smoke-stats.png') });
  await page.keyboard.press('Escape');
  await page.goto(srv.url + '#leaderboard');
  await page.waitForSelector('.tabs');
  await page.screenshot({ path: path.join(shots, 'smoke-leaderboard.png'), fullPage: true });
  await page.goto(srv.url + '#logbook');
  await page.waitForSelector('.tabs');
  await page.screenshot({ path: path.join(shots, 'smoke-logbook.png'), fullPage: true });
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
  srv.close();
})().catch(e => { console.error(e); process.exit(1); });
