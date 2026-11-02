#!/usr/bin/env node
/* Renders the FATHOM icon (an inline SVG: two waves on deep water) to PNG at 192, 512, a maskable 512,
 * and a 1200×630 Open Graph image, using the pre-installed headless Chromium. */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'icons');
const BG = '#0F4C5C', ACCENT = '#2BD1C6', INK = '#EAF4F7';

function iconSvg(size, maskable) {
  const r = maskable ? 0 : Math.round(size * 0.22);
  const pad = maskable ? size * 0.12 : 0;
  const s = size - pad * 2;
  const wave = (y, op) => '<path d="M' + (pad + s * 0.18) + ' ' + (pad + s * y) + 'c' + s * 0.09 + ' 0 ' + s * 0.09 + ' ' + s * 0.09 + ' ' + s * 0.18 + ' ' + s * 0.09 + 's' + s * 0.09 + ' -' + s * 0.09 + ' ' + s * 0.18 + ' -' + s * 0.09 + ' ' + s * 0.09 + ' ' + s * 0.09 + ' ' + s * 0.18 + ' ' + s * 0.09 + '" fill="none" stroke="' + ACCENT + '" stroke-width="' + (s * 0.075) + '" stroke-linecap="round" opacity="' + op + '"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<rect width="' + size + '" height="' + size + '" rx="' + r + '" fill="' + BG + '"/>' +
    wave(0.34, 1) + wave(0.60, 0.55) + '</svg>';
}
function ogSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0F4C5C"/><stop offset="1" stop-color="#02060D"/></linearGradient></defs>' +
    '<rect width="1200" height="630" fill="url(#g)"/>' +
    '<text x="600" y="300" text-anchor="middle" font-family="Avenir Next, Segoe UI, Helvetica, Arial, sans-serif" font-size="150" font-weight="800" letter-spacing="40" fill="' + INK + '">FATHOM</text>' +
    '<text x="600" y="380" text-anchor="middle" font-family="Avenir Next, Segoe UI, Helvetica, Arial, sans-serif" font-size="36" fill="' + ACCENT + '">the daily ocean dive</text>' +
    '<text x="600" y="450" text-anchor="middle" font-family="Avenir Next, Segoe UI, Helvetica, Arial, sans-serif" font-size="28" fill="' + INK + '" opacity=".8">Seven questions. The rarer your answer, the deeper you sink.</text>' +
    '</svg>';
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const jobs = [
    ['icon-192.png', iconSvg(192, false), 192, 192],
    ['icon-512.png', iconSvg(512, false), 512, 512],
    ['icon-512-maskable.png', iconSvg(512, true), 512, 512],
    ['og.png', ogSvg(), 1200, 630],
  ];
  for (const [name, svg, w, h] of jobs) {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent('<html><body style="margin:0;background:transparent">' + svg + '</body></html>');
    await page.screenshot({ path: path.join(OUT, name), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
    console.log('wrote icons/' + name);
  }
  await browser.close();
})();
