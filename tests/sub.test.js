'use strict';
/* ANGLER v3 — the water-column scene's pure parts: camera, descent timing, water colour, zone creatures, the sub's pose. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const dive = require(path.join(__dirname, '..', 'shared', 'dive.js'));
const Sub = require(path.join(__dirname, '..', 'sub.js'));

const PPM = Sub.PX_PER_M;

test('the camera keeps the surface in view at first, then follows the sub, then stops at the floor', () => {
  const viewH = 600;
  assert.strictEqual(Sub.cameraOffset(0, viewH), 0);
  assert.strictEqual(Sub.cameraOffset(100, viewH), 0);                              // a nudge near the surface scrolls nothing
  const far = Sub.cameraOffset(3000, viewH);
  assert.ok(far > 0, 'deep down the column scrolls');
  assert.strictEqual(Sub.subScreenY(3000, viewH), Math.round(viewH * Sub.SUB_FRAC)); // and the sub sits at its anchor
  const bottom = Sub.cameraOffset(dive.CHALLENGER_DEEP_M, viewH);
  assert.strictEqual(bottom, Sub.columnHeight() - viewH, 'at Challenger Deep the floor is the bottom edge');
  assert.ok(Sub.subScreenY(dive.CHALLENGER_DEEP_M, viewH) > Sub.subScreenY(3000, viewH), 'near the floor the sub drops below its anchor');
  assert.ok(Sub.cameraOffset(2000, viewH) < Sub.cameraOffset(2500, viewH), 'monotonic');
});

test('descent timing grows with the drop and is capped; a tide-pool nudge is visibly shorter than a hadal plunge', () => {
  const nudge = Sub.descentMs(dive.depthFor(10));
  const plunge = Sub.descentMs(dive.depthFor(100));
  assert.ok(nudge >= 500 && nudge < plunge, nudge + ' < ' + plunge);
  assert.strictEqual(Sub.descentMs(dive.CHALLENGER_DEEP_M), Sub.DESCENT_MAX_MS);
  assert.strictEqual(Sub.descentMs(0), 0);
  assert.strictEqual(Sub.ease(0), 0);
  assert.strictEqual(Sub.ease(1), 1);
  assert.ok(Sub.ease(0.5) > 0.5, 'ease-out: the first half covers most of the distance');
});

test('water gets darker with depth and the palette never allocates per frame', () => {
  const p = Sub.PALETTE;
  assert.strictEqual(p.length, 256);
  const lum = (s) => { const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(s); return Number(m[1]) + Number(m[2]) + Number(m[3]); };
  assert.ok(lum(Sub.waterColor(0)) > lum(Sub.waterColor(1000)));
  assert.ok(lum(Sub.waterColor(1000)) > lum(Sub.waterColor(6000)));
  assert.strictEqual(Sub.waterColor(0), p[0]);
  assert.strictEqual(Sub.waterColor(99999), p[255]);
  assert.strictEqual(Sub.lampStrength(0) < Sub.lampStrength(3000), true, 'the headlamp matters more as the light fades');
  assert.ok(Sub.lampStrength(10935) <= 1);
});

test('every zone has creatures of its own, with at most three movers at once', () => {
  for (const z of dive.ZONES) {
    const kinds = Sub.creaturesFor(z.code);
    assert.ok(kinds.length >= 2, z.code + ' has creatures');
    for (const k of kinds) assert.ok(Sub.SILHOUETTES[k.kind] || k.art, z.code + ': ' + k.kind + ' is drawable');
  }
  assert.strictEqual(Sub.MAX_MOVERS, 3);
  assert.ok(Sub.creaturesFor('hadal').some(k => /snailfish|amphipod/.test(k.kind + (k.art || ''))));
});

test('the sub tilts nose-down while descending and levels when it stalls or rests', () => {
  assert.strictEqual(Sub.subTilt({ descending: false, progress: 0 }), 0);
  assert.ok(Sub.subTilt({ descending: true, progress: 0.3 }) > 0.1);
  assert.ok(Sub.subTilt({ descending: true, progress: 0.98 }) < Sub.subTilt({ descending: true, progress: 0.3 }), 'levels out at the end');
});

test('drawSub issues canvas commands without touching anything else', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k === 'canvas' ? { width: 300, height: 600 } : (...a) => { calls.push(String(k)); return 0; }), set: () => true });
  Sub.drawSub(ctx, { x: 60, y: 120, scale: 1, tilt: 0.2, t: 1.5, lamp: 0.6, fist: 0, flicker: 0 });
  assert.ok(calls.includes('arc') && calls.includes('fill') && calls.includes('stroke'), 'hull, porthole and beam are drawn');
});

// ---- v4: the descent takes the whole screen and always lasts 2,000–3,000 ms, whatever the drop
test('takeoverMs: every drop sinks for two to three seconds, bigger drops longer', () => {
  assert.strictEqual(Sub.takeoverMs(dive.depthFor(10)), 2000 + Math.round(1000 * dive.depthFor(10) / 3000));
  assert.ok(Sub.takeoverMs(1) >= 2000 && Sub.takeoverMs(1) <= 3000);
  assert.ok(Sub.takeoverMs(dive.depthFor(100)) > Sub.takeoverMs(dive.depthFor(10)), 'a hadal drop sinks longer than a tide-pool one');
  assert.strictEqual(Sub.takeoverMs(dive.CHALLENGER_DEEP_M), 3000);
  assert.strictEqual(Sub.takeoverMs(0), 2000);
  assert.strictEqual(Sub.TAKEOVER_MIN_MS, 2000);
  assert.strictEqual(Sub.TAKEOVER_MAX_MS, 3000);
});
