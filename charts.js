/* FATHOM — SVG charts: the depth gauge, the daily bell curve and the zone distribution bars.
 * Pure functions returning markup strings (plus one updater for the live gauge). */
(function (root) {
  'use strict';

  const GAUGE_W = 150, GAUGE_H = 400, GAUGE_TOP = 22, GAUGE_BOTTOM = 12, RAIL_X = 18;
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
  const GAUGE_COMPACT_W = 44;      // viewBox width on narrow screens: just the rail, no landmark labels
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
    for (const lm of dive.LANDMARKS) {
      const y = depthToY(lm.depth);
      const passed = d >= lm.depth ? ' lm-passed' : '';
      out += '<g class="lm' + passed + '" data-depth="' + lm.depth + '">';
      out += '<line x1="' + (RAIL_X - 7) + '" y1="' + y.toFixed(1) + '" x2="' + (RAIL_X + 7) + '" y2="' + y.toFixed(1) + '" stroke="currentColor" stroke-width="1.5" opacity=".7"/>';
      out += '<text class="lm-label" x="' + (RAIL_X + 14) + '" y="' + (y + 3.5).toFixed(1) + '">' + esc(fmt(lm.depth)) + ' ' + esc(lm.label) + '</text>';
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
    for (const t of [0, 2000, 4000, 6000, 8000]) {
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
      out += '<div>' + esc(z.name.replace(' zone', '')) + '</div>';
      out += '<div class="bar' + (z.code === highlightZone ? ' hot' : '') + '"><i style="width:' + Math.max(w, n ? 4 : 0) + '%"></i></div>';
      out += '<div><b>' + n + '</b></div>';
    }
    return out + '</div>';
  }

  root.FathomCharts = { gaugeSvg, updateGauge, bellCurve, distributionBars, CURVE_BIN_M };
})(typeof window !== 'undefined' ? window : globalThis);
