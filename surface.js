/* ANGLER — the surface: a canvas animation of the top of the sea for the home hero. Slow waves, light rays
 * fanning down, drifting motes. Cheap enough for 60 frames per second on a mid-range phone: one 2D canvas,
 * a handful of paths per frame, device pixel ratio capped at 1.5, gradients built once per resize, no allocations
 * in the loop. If a frame still costs more than its budget (a slow phone, a throttled tab) it drops to 30 frames
 * per second instead of janking. It pauses when the tab is hidden or the canvas leaves the page, and draws a
 * single still frame under prefers-reduced-motion. */
(function (root) {
  'use strict';

  const MAX_DPR = 1.5;
  const FRAME_BUDGET_MS = 6;                 // average draw time above this → every other frame
  const BUDGET_SMOOTHING = 0.1;              // exponential moving average weight for the draw-time estimate
  const WAVES = [                           // amplitude px, wavelength px, speed px/s, y offset px, alpha
    { a: 5, l: 170, v: 26, y: 38, alpha: 0.95, width: 3, color: '#2BD1C6' },
    { a: 7, l: 240, v: -18, y: 50, alpha: 0.45, width: 2, color: '#86D9EC' },
    { a: 4, l: 120, v: 34, y: 62, alpha: 0.25, width: 1.5, color: '#86D9EC' },
  ];
  const RAYS = 6;                            // light shafts
  const RAY_SWAY = 18;                       // px of lateral sway
  const MOTES = 26;                          // drifting particles
  const MOTE_SPEED = 9;                      // px/s upwards
  const SURFACE_FILL_TOP = '#0C2A3A';        // sky above the water line

  function prefersStill() { return root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  // Mounts the animation on a <canvas>. Returns a stop() function.
  function mount(canvas) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return () => {};
    let w = 0, h = 0, dpr = 1, raf = 0, running = true, avgDraw = 0, halfRate = false, tick = 0;
    const rayGradients = [];
    const motes = [];
    const rng = mulberry(7);
    for (let i = 0; i < MOTES; i++) motes.push({ x: rng(), y: rng(), r: 1 + rng() * 2, s: 0.6 + rng() * 0.8, o: 0.15 + rng() * 0.3 });

    function resize() {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(MAX_DPR, root.devicePixelRatio || 1);
      w = Math.max(1, Math.round(rect.width)); h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rayGradients.length = 0;               // the ray gradients only depend on the height: build them here, not per frame
      for (let i = 0; i < RAYS; i++) {
        const g = ctx.createLinearGradient(0, WAVES[0].y, 0, h);
        g.addColorStop(0, 'rgba(234,244,247,0.20)'); g.addColorStop(1, 'rgba(234,244,247,0)');
        rayGradients.push(g);
      }
    }
    function draw(t) {                       // t in seconds
      ctx.clearRect(0, 0, w, h);
      // water: the hero card already has a deep gradient behind; we paint the sky band above the first wave
      ctx.fillStyle = SURFACE_FILL_TOP;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const wv = WAVES[0];
      for (let x = 0; x <= w; x += 6) ctx.lineTo(x, wv.y + Math.sin((x + t * wv.v) / wv.l * Math.PI * 2) * wv.a);
      ctx.lineTo(w, 0); ctx.closePath(); ctx.fill();
      // light rays
      for (let i = 0; i < RAYS; i++) {
        const base = (i + 0.5) * (w / RAYS) + Math.sin(t * 0.25 + i) * RAY_SWAY;
        ctx.fillStyle = rayGradients[i];
        ctx.beginPath();
        ctx.moveTo(base - 14, wv.y); ctx.lineTo(base + 14, wv.y); ctx.lineTo(base + 70 + Math.sin(t * 0.3 + i) * 10, h); ctx.lineTo(base - 60, h); ctx.closePath(); ctx.fill();
      }
      // waves
      for (const wave of WAVES) {
        ctx.beginPath();
        for (let x = -10; x <= w + 10; x += 5) ctx.lineTo(x, wave.y + Math.sin((x + t * wave.v) / wave.l * Math.PI * 2) * wave.a);
        ctx.strokeStyle = wave.color; ctx.globalAlpha = wave.alpha; ctx.lineWidth = wave.width; ctx.lineCap = 'round'; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // motes drifting up and sideways
      ctx.fillStyle = '#EAF4F7';
      for (const m of motes) {
        const y = ((m.y * h - t * MOTE_SPEED * m.s) % h + h) % h;
        const x = (m.x * w + Math.sin(t * 0.5 + m.y * 9) * 6 + w) % w;
        if (y < wv.y + 8) continue;
        ctx.globalAlpha = m.o;
        ctx.beginPath(); ctx.arc(x, y, m.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function frame(now) {
      if (!running) return;
      if (!canvas.isConnected) { stop(); return; }
      tick++;
      if (!halfRate || tick % 2 === 0) {
        const t0 = performance.now();
        draw(now / 1000);
        avgDraw += (performance.now() - t0 - avgDraw) * BUDGET_SMOOTHING;
        halfRate = avgDraw > FRAME_BUDGET_MS;
      }
      raf = root.requestAnimationFrame(frame);
    }
    function onVisibility() {
      if (document.hidden) { if (raf) root.cancelAnimationFrame(raf); raf = 0; }
      else if (running && !raf && !prefersStill()) raf = root.requestAnimationFrame(frame);
    }
    function stop() { running = false; if (raf) root.cancelAnimationFrame(raf); raf = 0; root.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVisibility); }
    resize();
    root.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    if (prefersStill()) { draw(12.5); return stop; }      // one still frame
    raf = root.requestAnimationFrame(frame);
    return stop;
  }
  function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  root.FathomSurface = { mount };
})(window);
