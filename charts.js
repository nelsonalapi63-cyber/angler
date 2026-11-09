/* ANGLER — SVG charts: the depth gauge, the daily bell curve and the zone distribution bars.
 * Pure functions returning markup strings (plus one updater for the live gauge). */
(function (root) {
  'use strict';

  const GAUGE_W = 150, GAUGE_H = 400, GAUGE_TOP = 22, GAUGE_BOTTOM = 12, RAIL_X = 18;
  const LABEL_MIN_GAP = 12;          // minimum vertical distance between landmark labels
  const CURVE_W = 480, CURVE_H = 170, CURVE_PAD = { top: 26, right: 10, bottom: 30, left: 10 };
  const CURVE_BIN_M = 250;          // metres per histogram bin (must match the server RPC)
  const CURVE_SMOOTH_SIGMA = 1.4;   // in bins
  const MAX_DEPTH = () => root.FathomDive.CHALLENGER_DEEP_M;

  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => root.FathomDive.formatMeters(n);

  function depthToY(depth) {
    const span = GAUGE_H - GAUGE_TOP - GAUGE_BOTTOM;
    return GAUGE_TOP + Math.min(1, Math.max(0, depth / MAX_DEPTH())) * span;
  }

  // ---------------------------------------------------------------- gauge
  const GAUGE_COMPACT_W = 96;      // viewBox width on narrow screens: the rail plus short landmark labels
  const COMPACT_LABELS = { 200: 'Sunlight ends', 1000: 'Twilight ends', 3800: 'Titanic', 4000: 'Abyss begins', 6000: 'Hadal begins', 8336: 'Deepest fish', 10935: 'Challenger Deep' };
  const CURVE_TICKS_M = [0, 2000, 4000, 6000, 8000];
  function gaugeSvg(depth, compact) {
    const dive = root.FathomDive;
    const d = Math.max(0, depth || 0);
    const w = compact ? GAUGE_COMPACT_W : GAUGE_W;
    let out = '<svg class="gauge' + (compact ? ' compact' : '') + '" viewBox="0 0 ' + w + ' ' + GAUGE_H + '" role="img" aria-label="Depth gauge: ' + fmt(d) + ' metres" preserveAspectRatio="xMinYMin meet">';
    // zone bands
    const zoneFill = { sunlight: '#2BD1C6', twilight: '#4C9BE8', midnight: '#3C5BD9', abyss: '#2B3F9E', hadal: '#1B1F5A' };
    for (const z of dive.ZONES) {
      const y1 = depthToY(z.from), y2 = depthToY(Math.min(z.to, MAX_DEPTH()));
      out += '<rect class="zone-band" x="' + (RAIL_X - 10) + '" y="' + y1.toFixed(1) + '" width="20" height="' + (y2 - y1).toFixed(1) + '" fill="' + zoneFill[z.code] + '"/>';
    }
    out += '<line class="rail" x1="' + RAIL_X + '" y1="' + GAUGE_TOP + '" x2="' + RAIL_X + '" y2="' + (GAUGE_H - GAUGE_BOTTOM) + '"/>';
    out += '<rect class="fill" x="' + (RAIL_X - 3) + '" y="' + GAUGE_TOP + '" width="6" height="' + (depthToY(d) - GAUGE_TOP).toFixed(1) + '" rx="3"/>';
    let lastLabelY = -Infinity;
    for (const lm of dive.LANDMARKS) {
      const y = depthToY(lm.depth);
      const labelY = Math.max(y, lastLabelY + LABEL_MIN_GAP);     // keep close landmarks (3,800 / 4,000) readable
      lastLabelY = labelY;
      const passed = d >= lm.depth ? ' lm-passed' : '';
      out += '<g class="lm' + passed + '" data-depth="' + lm.depth + '">';
      out += '<line x1="' + (RAIL_X - 7) + '" y1="' + y.toFixed(1) + '" x2="' + (RAIL_X + 7) + '" y2="' + y.toFixed(1) + '" stroke="currentColor" stroke-width="1.5" opacity=".7"/>';
      const label = compact ? (COMPACT_LABELS[lm.depth] || lm.label) : fmt(lm.depth) + ' ' + lm.label;
      out += '<text class="lm-label" x="' + (RAIL_X + 12) + '" y="' + (labelY + 3.5).toFixed(1) + '">' + esc(label) + '</text>';
      out += '</g>';
    }
    out += '<circle class="marker" cx="' + RAIL_X + '" cy="' + depthToY(d).toFixed(1) + '" r="7"/>';
    out += '<text class="depth-num" x="' + (compact ? 2 : RAIL_X - 14) + '" y="12">' + esc(fmt(d)) + ' m</text>';
    out += '</svg>';
    return out;
  }

  function updateGauge(svg, depth) {
    if (!svg) return;
    const d = Math.max(0, depth || 0);
    const y = depthToY(d);
    const marker = svg.querySelector('.marker');
    const fill = svg.querySelector('.fill');
    const num = svg.querySelector('.depth-num');
    if (marker) marker.setAttribute('cy', y.toFixed(1));
    if (fill) fill.setAttribute('height', (y - GAUGE_TOP).toFixed(1));
    if (num) num.textContent = fmt(d) + ' m';
    svg.setAttribute('aria-label', 'Depth gauge: ' + fmt(d) + ' metres');
    svg.querySelectorAll('.lm').forEach(g => {
      g.classList.toggle('lm-passed', d >= Number(g.getAttribute('data-depth')));
    });
  }

  // The descent: the marker slides and the number counts up over `ms` (ease-out, so the last metres settle slowly).
  // onFrame(depth) runs every frame with the depth shown so far. Returns a cancel function that jumps to the end.
  function animateGauge(svg, fromDepth, toDepth, ms, onFrame) {
    const from = Math.max(0, fromDepth || 0), to = Math.max(0, toDepth || 0);
    const raf = root.requestAnimationFrame ? root.requestAnimationFrame.bind(root) : (fn) => setTimeout(() => fn(performance.now()), 16);
    let done = false, handle = null;
    const finish = () => { if (done) return; done = true; updateGauge(svg, to); if (onFrame) onFrame(to); };
    if (!ms || ms < 50 || from === to) { finish(); return () => {}; }
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      if (done) return;
      const t = Math.min(1, (now - start) / ms);
      const d = Math.round(from + (to - from) * ease(t));
      updateGauge(svg, d);
      if (onFrame) onFrame(d);
      if (t < 1) handle = raf(step); else done = true;
    };
    handle = raf(step);
    return () => { if (!done) { if (root.cancelAnimationFrame && handle != null) root.cancelAnimationFrame(handle); finish(); } };
  }

  // ---------------------------------------------------------------- bell curve
  // data: { bins: [counts per 250 m bin from 0], total, median, playerDepth, percentile, demo }
  function bellCurve(data) {
    const dive = root.FathomDive;
    const max = MAX_DEPTH();
    const nBins = Math.ceil(max / CURVE_BIN_M);
    const bins = new Array(nBins).fill(0);
    for (let i = 0; i < Math.min(nBins, (data.bins || []).length); i++) bins[i] = data.bins[i] || 0;
    // gaussian smoothing
    const sm = new Array(nBins).fill(0);
    const k = Math.ceil(CURVE_SMOOTH_SIGMA * 3);
    for (let i = 0; i < nBins; i++) {
      let s = 0, w = 0;
      for (let j = -k; j <= k; j++) {
        const idx = i + j;
        if (idx < 0 || idx >= nBins) continue;
        const g = Math.exp(-(j * j) / (2 * CURVE_SMOOTH_SIGMA * CURVE_SMOOTH_SIGMA));
        s += bins[idx] * g; w += g;
      }
      sm[i] = w ? s / w : 0;
    }
    const peak = Math.max(1, ...sm);
    const x = (depth) => CURVE_PAD.left + (depth / max) * (CURVE_W - CURVE_PAD.left - CURVE_PAD.right);
    const y = (v) => CURVE_H - CURVE_PAD.bottom - (v / peak) * (CURVE_H - CURVE_PAD.top - CURVE_PAD.bottom);
    const base = CURVE_H - CURVE_PAD.bottom;

    let path = '';
    for (let i = 0; i < nBins; i++) {
      const cx = x((i + 0.5) * CURVE_BIN_M);
      path += (i ? ' L' : 'M') + cx.toFixed(1) + ' ' + y(sm[i]).toFixed(1);
    }
    const area = 'M' + x(0).toFixed(1) + ' ' + base + ' ' + path.replace(/^M/, 'L') + ' L' + x(nBins * CURVE_BIN_M).toFixed(1) + ' ' + base + ' Z';

    let out = '<svg class="curve" viewBox="0 0 ' + CURVE_W + ' ' + CURVE_H + '" role="img" aria-label="Today\'s depth distribution">';
    const zoneFill = { sunlight: '#2BD1C6', twilight: '#4C9BE8', midnight: '#3C5BD9', abyss: '#2B3F9E', hadal: '#1B1F5A' };
    for (const z of dive.ZONES) {
      const x1 = x(z.from), x2 = x(Math.min(z.to, max));
      out += '<rect class="zone" x="' + x1.toFixed(1) + '" y="' + CURVE_PAD.top + '" width="' + (x2 - x1).toFixed(1) + '" height="' + (base - CURVE_PAD.top) + '" fill="' + zoneFill[z.code] + '"/>';
    }
    out += '<path class="area" d="' + area + '"/>';
    out += '<path class="line" d="' + path + '"/>';
    // hover hit-rects with native tooltips
    for (let i = 0; i < nBins; i++) {
      const x1 = x(i * CURVE_BIN_M), x2 = x(Math.min(max, (i + 1) * CURVE_BIN_M));
      const label = fmt(i * CURVE_BIN_M) + '–' + fmt(Math.min(max, (i + 1) * CURVE_BIN_M)) + ' m: ' + (bins[i] || 0) + (bins[i] === 1 ? ' diver' : ' divers');
      out += '<rect x="' + x1.toFixed(1) + '" y="' + CURVE_PAD.top + '" width="' + (x2 - x1).toFixed(1) + '" height="' + (base - CURVE_PAD.top) + '" fill="transparent"><title>' + esc(label) + '</title></rect>';
    }
    // axis labels
    for (const t of CURVE_TICKS_M) {
      out += '<text x="' + x(t).toFixed(1) + '" y="' + (base + 16) + '" text-anchor="' + (t === 0 ? 'start' : 'middle') + '">' + fmt(t) + '</text>';
    }
    out += '<text x="' + x(max).toFixed(1) + '" y="' + (base + 16) + '" text-anchor="end">' + fmt(max) + ' m</text>';
    if (data.median != null) {
      out += '<line x1="' + x(data.median).toFixed(1) + '" y1="' + CURVE_PAD.top + '" x2="' + x(data.median).toFixed(1) + '" y2="' + base + '" stroke="currentColor" stroke-dasharray="3 4" opacity=".5"/>';
    }
    if (data.playerDepth != null) {
      const px = x(data.playerDepth);
      const anchor = px > CURVE_W * 0.7 ? 'end' : 'start';
      const dx = anchor === 'end' ? -6 : 6;
      out += '<line class="you" x1="' + px.toFixed(1) + '" y1="' + (CURVE_PAD.top - 4) + '" x2="' + px.toFixed(1) + '" y2="' + base + '"/>';
      out += '<text class="you-label" x="' + (px + dx).toFixed(1) + '" y="' + (CURVE_PAD.top - 8) + '" text-anchor="' + anchor + '">You · ' + fmt(data.playerDepth) + ' m</text>';
    }
    out += '</svg>';
    return out;
  }

  // ---------------------------------------------------------------- zone distribution bars (stats modal)
  function distributionBars(counts, highlightZone) {
    const dive = root.FathomDive;
    const max = Math.max(1, ...dive.ZONES.map(z => counts[z.code] || 0));
    let out = '<div class="dist" role="table" aria-label="Depth distribution by zone">';
    for (const z of dive.ZONES) {
      const n = counts[z.code] || 0;
      const w = Math.round((n / max) * 100);
      out += '<div role="row" class="dist-row">';
      out += '<div role="rowheader">' + esc(z.name.replace(' zone', '')) + '</div>';
      out += '<div role="cell" class="bar' + (z.code === highlightZone ? ' hot' : '') + '" aria-label="' + n + ' dives"><i style="width:' + Math.max(w, n ? 4 : 0) + '%"></i></div>';
      out += '<div role="cell"><b>' + n + '</b></div>';
      out += '</div>';
    }
    return out + '</div>';
  }

  root.FathomCharts = { gaugeSvg, updateGauge, animateGauge, bellCurve, distributionBars, CURVE_BIN_M };
})(typeof window !== 'undefined' ? window : globalThis);
