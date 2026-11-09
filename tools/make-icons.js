#!/usr/bin/env node
/* Renders the ANGLER icon set from the mascot (the same anglerfish app.js draws): PNG at 192, 512, a maskable 512,
 * a 1200×630 Open Graph image, and icons/favicon.svg — using the pre-installed headless Chromium.
 * Also run by build.js --og to write the per-day Open Graph images (icons/og/<day>.png) for the next 30 days.
 * Usage: node tools/make-icons.js            (icons + generic OG)
 *        node tools/make-icons.js --og-days  (per-day OG images only) */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const dive = require('../shared/dive.js');

const OUT = path.join(__dirname, '..', 'icons');
const OG_DAYS = 30;
const BG_TOP = '#0F4C5C', BG_BOTTOM = '#02060D', ACCENT = '#2BD1C6', INK = '#EAF4F7', MUTED = '#A3BCC8';
const FONT = "Outfit, Inter, Helvetica, Arial, sans-serif";   // no quotes inside: it goes into an SVG attribute

// the mascot as a standalone <svg> string at full glow — regenerated from app.js so the two never drift
function mascotMarkup() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const m = src.match(/function mascotSvg\(size, opts\) \{[\s\S]*?\n  \}\n/);
  if (!m) throw new Error('mascotSvg not found in app.js');
  fs.writeFileSync(path.join(__dirname, 'mascot.js'), '/* GENERATED from app.js mascotSvg by tools/make-icons.js — do not edit; the source of truth is app.js */\n\'use strict\';\nmodule.exports = (' + m[0].replace(/^  /gm, '') + ');\n');
  const fn = new Function('return (' + m[0].replace(/^  /gm, '') + ')')();
  return fn;
}
const mascot = mascotMarkup();
// inner <g> of the mascot (strip the outer svg) so it can be placed inside other drawings
function mascotGroup(glow, x, y, scale) {
  const svg = mascot(256, { glow });
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  return '<g transform="translate(' + x + ' ' + y + ') scale(' + scale + ')">' + inner + '</g>';
}

function iconSvg(size, maskable) {
  const r = maskable ? 0 : Math.round(size * 0.22);
  const pad = maskable ? size * 0.14 : size * 0.06;
  const s = size - pad * 2;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + BG_TOP + '"/><stop offset="1" stop-color="#071D33"/></linearGradient></defs>' +
    '<rect width="' + size + '" height="' + size + '" rx="' + r + '" fill="url(#g)"/>' +
    mascotGroup(1, pad, pad + s * 0.04, s / 256) + '</svg>';
}
function faviconSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="' + BG_TOP + '"/>' + mascotGroup(1, 2, 4, 60 / 256) + '</svg>';
}
const tagLines = dive.TAGLINE.split(/(?<=\.)\s+/);      // one sentence per line
function ogSvg(opts) {
  const title = opts && opts.title ? opts.title : dive.BRAND;
  const sub = opts && opts.sub ? opts.sub : 'the daily ocean dive';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + BG_TOP + '"/><stop offset="1" stop-color="' + BG_BOTTOM + '"/></linearGradient>' +
    '<linearGradient id="ray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + INK + '" stop-opacity=".16"/><stop offset="1" stop-color="' + INK + '" stop-opacity="0"/></linearGradient></defs>' +
    '<rect width="1200" height="630" fill="url(#g)"/>' +
    '<g fill="url(#ray)"><polygon points="140,0 220,0 420,630 200,630"/><polygon points="520,0 580,0 760,630 560,630"/><polygon points="880,0 960,0 1200,560 1200,630 1120,630"/></g>' +
    mascotGroup(1, 50, 150, 1.3) +
    '<text x="440" y="290" font-family="' + FONT + '" font-size="104" font-weight="800" letter-spacing="12" fill="' + INK + '">' + title + '</text>' +
    '<text x="444" y="352" font-family="' + FONT + '" font-size="38" font-weight="600" fill="' + ACCENT + '">' + sub + '</text>' +
    tagLines.map((t, i) => '<text x="444" y="' + (420 + i * 40) + '" font-family="' + FONT + '" font-size="29" fill="' + MUTED + '">' + t + '</text>').join('') +
    '</svg>';
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ogDaysOnly = process.argv.includes('--og-days');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // the self-hosted fonts, inlined as data URIs so the headless page needs no file access
  const fontDir = path.join(__dirname, '..', 'fonts');
  const face = (family, file) => fs.existsSync(path.join(fontDir, file)) ? '@font-face{font-family:"' + family + '";font-weight:100 900;src:url(data:font/woff2;base64,' + fs.readFileSync(path.join(fontDir, file)).toString('base64') + ') format("woff2")}' : '';
  const fontCss = '<style>' + face('Outfit', 'outfit-latin-wght.woff2') + face('Inter', 'inter-latin-wght.woff2') + '</style>';
  const jobs = [];
  if (!ogDaysOnly) {
    fs.writeFileSync(path.join(OUT, 'favicon.svg'), faviconSvg() + '\n');
    console.log('wrote icons/favicon.svg');
    jobs.push(['icon-192.png', iconSvg(192, false), 192, 192], ['icon-512.png', iconSvg(512, false), 512, 512], ['icon-512-maskable.png', iconSvg(512, true), 512, 512], ['og.png', ogSvg(), 1200, 630]);
  }
  // per-day Open Graph images: ANGLER #N · date (the daily workflow refreshes them; index.html points at today's)
  fs.mkdirSync(path.join(OUT, 'og'), { recursive: true });
  const today = dive.dayKey(new Date());
  for (let i = 0; i < OG_DAYS; i++) {
    const k = dive.keyPlusDays(today, i);
    if (k < dive.LAUNCH_DATE) continue;
    const [y, m, d] = k.split('-').map(Number);
    const nice = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    jobs.push([path.join('og', k + '.png'), ogSvg({ title: dive.BRAND + ' #' + dive.puzzleNumber(k), sub: nice }), 1200, 630]);
  }
  // prune per-day images older than today
  for (const f of fs.readdirSync(path.join(OUT, 'og'))) if (f.endsWith('.png') && f.slice(0, 10) < today) fs.unlinkSync(path.join(OUT, 'og', f));
  for (const [name, svg, w, h] of jobs) {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent('<html><head>' + fontCss + '</head><body style="margin:0;background:transparent">' + svg + '</body></html>');
    await page.evaluate(() => Promise.all([document.fonts.load('800 40px Outfit'), document.fonts.load('400 20px Inter')]).catch(() => null));   // SVG text does not trigger the lazy load
    await page.screenshot({ path: path.join(OUT, name), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  }
  console.log('wrote ' + jobs.length + ' images (' + (ogDaysOnly ? 'per-day OG only' : 'icons, OG, ' + (jobs.length - 4) + ' per-day OG') + ')');
  await browser.close();
})();
