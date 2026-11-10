/* ANGLER — the water column: a canvas strip from the surface to Challenger Deep with a small submarine (and a
 * visible pilot) at the player's depth. After every accepted answer the sub sinks the distance it earned: the column
 * scrolls past, the water darkens, the headlamp brightens, landmarks pop in as they are crossed, bubbles trail from
 * the stern. A miss makes it stall (a shudder, bubbles only); a timeout makes the lamp flicker; a Hadal answer
 * plunges with speed lines, a flash and a fist in the porthole. Creatures of the current zone drift through, never
 * more than three at once. Same discipline as surface.js: one 2D canvas, device pixel ratio capped, pools instead of
 * allocations in the loop, half rate when a frame overruns, paused when the tab is hidden, and under
 * prefers-reduced-motion the sub jumps to its new depth with a short crossfade instead of moving.
 * The pure parts (camera, timing, palette, creature lists) are exported for the Node tests. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.FathomSub = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // ---------------------------------------------------------------- parameters
  const MAX_M = 10935;                       // Challenger Deep (dive.CHALLENGER_DEEP_M)
  const PX_PER_M = 0.35;                     // the column's scale: a Tide Pool answer (156 m) is a 55 px nudge, a Hadal one (1,562 m) a 547 px plunge
  const SUB_FRAC = 0.38;                     // the sub sits this far down the strip once the camera follows it
  const SURFACE_PAD = 56;                    // sky and waves above depth 0
  const FLOOR_PAD = 120;                     // seabed below Challenger Deep
  const DESCENT_BASE_MS = 700, DESCENT_MS_PER_100M = 90, DESCENT_MAX_MS = 2600;
  const MAX_DPR = 1.5;
  const FRAME_BUDGET_MS = 6, BUDGET_SMOOTHING = 0.1;
  const BAND_PX = 36;                        // the water is painted in horizontal bands from a precomputed palette (no gradients per frame)
  const WATER_STOPS = [[0, '#1C8AA0'], [200, '#0F4C5C'], [1000, '#0B3A52'], [4000, '#071D33'], [6000, '#040F1E'], [MAX_M, '#02060D']];
  const SKY = '#0C2A3A';
  const INK = '#EAF4F7', DARK = '#0C2A3A', HULL = '#FFD24A', GLASS = '#86D9EC', ACCENT = '#2BD1C6', GLOW = '#B49BFF', GOLD = '#FFD24A';
  const BUBBLES = 28, SPECKS = 56, MAX_MOVERS = 3;
  const SHUDDER_MS = 520, FLICKER_MS = 900, FLASH_MS = 420, FIST_MS = 1400, SPEED_MS = 900, POP_MS = 1900, FADE_MS = 380;
  const LANDMARK_LABELS = { 200: 'Sunlight zone ends', 1000: 'Twilight zone ends', 3800: 'Titanic wreck', 4000: 'Abyss begins', 6000: 'Hadal zone begins', 8336: 'Deepest fish ever filmed', 10935: 'Challenger Deep' };
  const LANDMARK_SHORT = { 200: 'Sunlight ends', 1000: 'Twilight ends', 3800: 'Titanic', 4000: 'Abyss begins', 6000: 'Hadal begins', 8336: 'Deepest fish', 10935: 'Challenger Deep' };
  const NARROW_W = 160;                      // under this width the strip uses the short landmark names
  const ZONE_NAMES = { sunlight: 'Sunlight', twilight: 'Twilight', midnight: 'Midnight', abyss: 'Abyss', hadal: 'Hadal' };
  const ZONE_BOUNDS = [['sunlight', 0, 200], ['twilight', 200, 1000], ['midnight', 1000, 4000], ['abyss', 4000, 6000], ['hadal', 6000, MAX_M]];
  const ZONE_FILL = { sunlight: '#2BD1C6', twilight: '#4C9BE8', midnight: '#3C5BD9', abyss: '#2B3F9E', hadal: '#1B1F5A' };
  const FONT = '"Outfit", "Inter", "Segoe UI", Helvetica, Arial, sans-serif';
  // creatures of each zone: a drawn silhouette, or one of the game's own illustrations (data/illustrations/<id>.svg)
  const CREATURES = {
    sunlight: [{ kind: 'school' }, { kind: 'fish', art: 'flying-fish' }, { kind: 'turtle', art: 'hawksbill-turtle' }, { kind: 'fish', art: 'whitetip-reef-shark' }, { kind: 'fish', art: 'masked-butterflyfish' }, { kind: 'fish', art: 'hourglass-dolphin' }],
    twilight: [{ kind: 'lantern' }, { kind: 'jelly' }, { kind: 'squid', art: 'hawaiian-bobtail-squid' }, { kind: 'fish', art: 'bristlemouth' }, { kind: 'fish', art: 'snipe-eel' }, { kind: 'jelly', art: 'sea-walnut' }],
    midnight: [{ kind: 'angler' }, { kind: 'jelly' }, { kind: 'squid', art: 'vampire-squid' }, { kind: 'jelly', art: 'deepstaria' }, { kind: 'fish', art: 'ninja-lanternshark' }, { kind: 'fish', art: 'frilled-shark' }],
    abyss: [{ kind: 'tripod' }, { kind: 'amphipod' }, { kind: 'fish', art: 'sea-pig' }, { kind: 'fish', art: 'pancake-batfish' }, { kind: 'fish', art: 'bony-eared-assfish' }, { kind: 'jelly', art: 'headless-chicken-monster' }],
    hadal: [{ kind: 'snailfish' }, { kind: 'amphipod' }, { kind: 'fish', art: 'mariana-snailfish' }, { kind: 'amphipod', art: 'hirondellea-gigas' }, { kind: 'amphipod', art: 'eurythenes-plasticus' }, { kind: 'fish', art: 'abyssobrotula' }],
  };

  // ---------------------------------------------------------------- pure parts
  function columnHeight() { return Math.round(SURFACE_PAD + MAX_M * PX_PER_M + FLOOR_PAD); }
  function cameraOffset(depth, viewH) {
    const subCol = SURFACE_PAD + Math.max(0, depth) * PX_PER_M;
    const maxOff = Math.max(0, columnHeight() - viewH);
    return Math.round(Math.min(maxOff, Math.max(0, subCol - viewH * SUB_FRAC)));
  }
  function subScreenY(depth, viewH) { return Math.round(SURFACE_PAD + Math.max(0, depth) * PX_PER_M - cameraOffset(depth, viewH)); }
  function descentMs(dropM) { return dropM > 0 ? Math.round(Math.min(DESCENT_MAX_MS, DESCENT_BASE_MS + DESCENT_MS_PER_100M * dropM / 100)) : 0; }
  // v4: when the descent takes the whole screen it always lasts 2–3 s, whatever the drop (a tide-pool nudge is still a scene)
  const TAKEOVER_MIN_MS = 2000, TAKEOVER_MAX_MS = 3000, TAKEOVER_FULL_DROP_M = 3000;
  function takeoverMs(dropM) { return Math.round(TAKEOVER_MIN_MS + (TAKEOVER_MAX_MS - TAKEOVER_MIN_MS) * Math.min(1, Math.max(0, dropM) / TAKEOVER_FULL_DROP_M)); }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mixStops(depth) {
    let a = WATER_STOPS[0], b = WATER_STOPS[WATER_STOPS.length - 1];
    for (let i = 0; i < WATER_STOPS.length - 1; i++) if (depth >= WATER_STOPS[i][0] && depth <= WATER_STOPS[i + 1][0]) { a = WATER_STOPS[i]; b = WATER_STOPS[i + 1]; break; }
    const f = b[0] === a[0] ? 0 : (depth - a[0]) / (b[0] - a[0]);
    const ca = hexToRgb(a[1]), cb = hexToRgb(b[1]);
    return 'rgb(' + ca.map((v, i) => Math.round(v + (cb[i] - v) * f)).join(',') + ')';
  }
  const PALETTE = [];
  for (let i = 0; i < 256; i++) PALETTE.push(mixStops(MAX_M * i / 255));
  function waterColor(depth) { return PALETTE[Math.max(0, Math.min(255, Math.round(255 * depth / MAX_M)))]; }
  function lampStrength(depth) { return 0.08 + 0.92 * Math.min(1, Math.max(0, depth) / 6000); }
  function zoneCodeAt(depth) { for (const z of ZONE_BOUNDS) if (depth < z[2]) return z[0]; return 'hadal'; }
  function creaturesFor(zoneCode) { return CREATURES[zoneCode] || CREATURES.sunlight; }
  function subTilt(s) { return s.descending ? 0.28 * Math.sin(Math.PI * Math.min(1, Math.max(0, s.progress))) : 0; }
  function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function prefersStill() { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

  // ---------------------------------------------------------------- the submarine
  // o: { x, y, scale, tilt (radians, nose down), t (seconds), lamp 0..1, fist 0..1, flicker 0..1, spin (propeller speed) }
  function drawSub(ctx, o) {
    const s = o.scale || 1;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.tilt || 0);
    ctx.scale(s, s);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // headlamp beam (drawn first so the hull sits on top)
    const lamp = (o.lamp == null ? 0.5 : o.lamp) * (o.flicker ? (Math.sin(o.t * 53) > -0.2 ? 1 : 0.15) : 1);
    if (lamp > 0.02) {
      ctx.globalAlpha = 0.38 * lamp;
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.moveTo(44, -3); ctx.lineTo(190, -64); ctx.lineTo(210, 70); ctx.lineTo(44, 5); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.18 * lamp;
      ctx.beginPath(); ctx.moveTo(44, -3); ctx.lineTo(260, -120); ctx.lineTo(290, 130); ctx.lineTo(44, 5); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // tail fins and rudder
    ctx.fillStyle = DARK;
    ctx.beginPath(); ctx.moveTo(-36, -6); ctx.lineTo(-58, -22); ctx.lineTo(-50, -2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-36, 6); ctx.lineTo(-58, 22); ctx.lineTo(-50, 2); ctx.closePath(); ctx.fill();
    // propeller
    ctx.save();
    ctx.translate(-50, 0);
    ctx.rotate((o.t || 0) * (o.spin == null ? 6 : o.spin));
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, 9); ctx.moveTo(-5, -4); ctx.lineTo(5, 4); ctx.stroke();
    ctx.restore();
    // hull
    ctx.fillStyle = HULL; ctx.strokeStyle = DARK; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-30, -14); ctx.lineTo(28, -14); ctx.quadraticCurveTo(46, -14, 46, 0); ctx.quadraticCurveTo(46, 14, 28, 14); ctx.lineTo(-30, 14); ctx.quadraticCurveTo(-46, 14, -46, 0); ctx.quadraticCurveTo(-46, -14, -30, -14); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // a darker keel line and three rivets
    ctx.strokeStyle = DARK; ctx.lineWidth = 2; ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.moveTo(-34, 7); ctx.lineTo(34, 7); ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = DARK;
    ctx.beginPath(); ctx.arc(-22, -6, 1.6, 0, Math.PI * 2); ctx.arc(-12, -6, 1.6, 0, Math.PI * 2); ctx.arc(-2, -6, 1.6, 0, Math.PI * 2); ctx.fill();
    // conning tower and periscope
    ctx.fillStyle = HULL; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-10, -13); ctx.lineTo(-8, -27); ctx.quadraticCurveTo(-8, -30, -5, -30); ctx.lineTo(11, -30); ctx.quadraticCurveTo(14, -30, 14, -27); ctx.lineTo(16, -13); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = DARK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(4, -30); ctx.lineTo(4, -40); ctx.lineTo(12, -40); ctx.stroke();
    // porthole with the pilot
    ctx.fillStyle = GLASS; ctx.strokeStyle = DARK; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(14, 0, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.arc(14, 0, 8.5, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = DARK;
    ctx.beginPath(); ctx.arc(14, -1.5, 3.6, 0, Math.PI * 2); ctx.fill();                      // head
    ctx.beginPath(); ctx.moveTo(7, 10); ctx.quadraticCurveTo(14, 1, 21, 10); ctx.closePath(); ctx.fill();   // shoulders
    if (o.fist) {                                                                              // a fist pumped above the shoulder
      const lift = 6 * Math.min(1, o.fist);
      ctx.beginPath(); ctx.moveTo(19, 7); ctx.lineTo(21, 2 - lift); ctx.lineWidth = 2.2; ctx.strokeStyle = DARK; ctx.stroke();
      ctx.beginPath(); ctx.arc(21, 1 - lift, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = INK; ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.arc(10.5, -4, 2.2, 0, Math.PI * 2); ctx.fill();                       // a glint on the glass
    ctx.globalAlpha = 1;
    // the lamp itself
    ctx.fillStyle = lamp > 0.02 ? INK : GLASS; ctx.strokeStyle = DARK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(44, 0, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- silhouettes (one colour, drawn facing the way they swim)
  const SILHOUETTES = {
    school(ctx, m) {
      ctx.fillStyle = GLASS;
      for (let i = 0; i < 3; i++) {
        const dx = i * 14 - 14, dy = (i % 2) * 7 - 3;
        ctx.beginPath(); ctx.ellipse(dx, dy, 7, 3.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(dx - 6, dy); ctx.lineTo(dx - 11, dy - 3.5); ctx.lineTo(dx - 11, dy + 3.5); ctx.closePath(); ctx.fill();
      }
    },
    fish(ctx, m) {
      ctx.fillStyle = GLASS;
      ctx.beginPath(); ctx.ellipse(0, 0, 14, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-20, -6); ctx.lineTo(-20, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = DARK; ctx.beginPath(); ctx.arc(8, -1.5, 1.4, 0, Math.PI * 2); ctx.fill();
    },
    lantern(ctx, m) {
      ctx.fillStyle = '#4C6E8A';
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-18, -5); ctx.lineTo(-18, 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = GOLD;
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-8 + i * 4, 3, 0.9 + 0.5 * Math.sin(m.t * 5 + i), 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(8, -1, 1.6, 0, Math.PI * 2); ctx.fill();
    },
    jelly(ctx, m) {
      const pulse = 1 + 0.08 * Math.sin(m.t * 2.2 + m.phase);
      ctx.fillStyle = m.deep ? GLOW : '#CFE8F0';
      ctx.globalAlpha *= 0.75;
      ctx.beginPath(); ctx.ellipse(0, 0, 11 * pulse, 9, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = m.deep ? GLOW : '#CFE8F0'; ctx.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) { const x = -7 + i * 4.6; ctx.beginPath(); ctx.moveTo(x, 0); ctx.quadraticCurveTo(x + 3 * Math.sin(m.t * 3 + i), 10, x - 2 * Math.sin(m.t * 2 + i), 20); ctx.stroke(); }
    },
    squid(ctx, m) {
      ctx.fillStyle = GLOW;
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-2, -5); ctx.lineTo(-2, 5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-4, 0, 7, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = GLOW; ctx.lineWidth = 1.4;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-9, -3 + i * 2); ctx.lineTo(-22 - 3 * Math.sin(m.t * 4 + i), -5 + i * 3.4); ctx.stroke(); }
    },
    tripod(ctx, m) {
      ctx.strokeStyle = '#8AA7B8'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-6, 2); ctx.lineTo(-18, 26); ctx.moveTo(8, 2); ctx.lineTo(18, 26); ctx.moveTo(-10, -2); ctx.lineTo(-22, -16); ctx.stroke();
      ctx.fillStyle = '#8AA7B8';
      ctx.beginPath(); ctx.ellipse(0, 0, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-16, -4); ctx.lineTo(-16, 4); ctx.closePath(); ctx.fill();
    },
    snailfish(ctx, m) {
      ctx.fillStyle = '#F2C9D4';
      ctx.beginPath(); ctx.ellipse(6, 0, 8, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.quadraticCurveTo(-14, -2 + 3 * Math.sin(m.t * 3), -22, 1 + 2 * Math.sin(m.t * 3)); ctx.quadraticCurveTo(-14, 4, 0, 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = DARK; ctx.beginPath(); ctx.arc(10, -1.5, 1.2, 0, Math.PI * 2); ctx.fill();
    },
    amphipod(ctx, m) {
      ctx.fillStyle = '#D9C7A0';
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 4, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#D9C7A0'; ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) { const x = -6 + i * 3; ctx.beginPath(); ctx.moveTo(x, 3); ctx.lineTo(x - 1 + 2 * Math.sin(m.t * 9 + i), 8); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(8, -2); ctx.lineTo(14, -6); ctx.moveTo(8, -1); ctx.lineTo(15, -2); ctx.stroke();
    },
    turtle(ctx, m) {
      ctx.fillStyle = '#5FB38E';
      ctx.beginPath(); ctx.ellipse(0, 0, 12, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(14, -1, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-4, -9, 6, 2.5, 0.5 + 0.3 * Math.sin(m.t * 3), 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-4, 9, 6, 2.5, -0.5 - 0.3 * Math.sin(m.t * 3), 0, Math.PI * 2); ctx.fill();
    },
    angler(ctx, m) {
      // a cameo of the mascot: a glowing lure, a round body, needle teeth
      ctx.fillStyle = GOLD; ctx.globalAlpha *= 0.9;
      ctx.beginPath(); ctx.arc(16, -12, 4 + Math.sin(m.t * 4), 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = DARK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(4, -8); ctx.quadraticCurveTo(12, -16, 16, -12); ctx.stroke();
      ctx.fillStyle = '#3C6AE0'; ctx.beginPath(); ctx.ellipse(0, 0, 14, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = DARK; ctx.beginPath(); ctx.moveTo(14, -3); ctx.lineTo(6, 5); ctx.lineTo(14, 6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(8, -1); ctx.lineTo(9, 3); ctx.moveTo(11, 0); ctx.lineTo(12, 4); ctx.stroke();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(3, -4, 2, 0, Math.PI * 2); ctx.fill();
    },
  };

  // ---------------------------------------------------------------- the scene
  const artCache = {};
  function artImage(id) {
    if (!artCache[id] && typeof Image === 'function') {
      const img = new Image();
      img.decoding = 'async';
      img.src = 'data/illustrations/' + id + '.svg';
      artCache[id] = img;
    }
    return artCache[id] || null;
  }

  // Mounts the scene in a container. opts: { mode: 'dive'|'rest', depth, onLandmark(lm), onFrame(depth) }
  function mount(container, opts) {
    opts = opts || {};
    const doc = container.ownerDocument;
    const canvas = doc.createElement('canvas');
    canvas.className = 'sub-canvas';
    canvas.setAttribute('role', 'img');
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d', { alpha: false });
    const still = prefersStill();
    const rng = mulberry(11);
    const st = {
      mode: opts.mode || 'dive', depth: Math.max(0, opts.depth || 0), shown: Math.max(0, opts.depth || 0),
      w: 0, h: 0, dpr: 1, raf: 0, running: true, avgDraw: 0, halfRate: false, tick: 0, lastNow: 0,
      tween: null, fade: null, effects: { shudder: 0, flicker: 0, flash: 0, fist: 0, speed: 0 }, pop: null, passed: new Set(),
      bubbles: [], specks: [], movers: [], zone: null, fistHold: false,
    };
    for (let i = 0; i < BUBBLES; i++) st.bubbles.push({ alive: false, x: 0, y: 0, r: 2, vy: 0, vx: 0, born: 0, life: 0 });
    for (let i = 0; i < SPECKS; i++) st.specks.push({ col: SURFACE_PAD + (1000 + rng() * (MAX_M - 1000)) * PX_PER_M, fx: rng(), r: 0.6 + rng() * 1.3, phase: rng() * 6.3, hue: rng() < 0.5 ? ACCENT : GLOW });
    for (let i = 0; i < MAX_MOVERS; i++) st.movers.push({ alive: false, kind: 'fish', art: null, x: 0, col: 0, vx: 0, scale: 1, phase: rng() * 6.3, deep: false, flip: false });
    for (const lm of Object.keys(LANDMARK_LABELS)) if (Number(lm) <= st.depth) st.passed.add(Number(lm));
    if (!ctx) return { el: canvas, descendTo: () => 0, stall() {}, flicker() {}, celebrate() {}, setDepth() {}, rest() {}, destroy() {}, getDepth: () => st.depth };

    function resize() {
      const rect = container.getBoundingClientRect();
      st.dpr = Math.min(MAX_DPR, root.devicePixelRatio || 1);
      st.w = Math.max(1, Math.round(rect.width)); st.h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(st.w * st.dpr); canvas.height = Math.round(st.h * st.dpr);
      canvas.style.width = st.w + 'px'; canvas.style.height = st.h + 'px';
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      invalidate();
    }
    function label() {
      const z = zoneCodeAt(st.depth);
      canvas.setAttribute('aria-label', (st.mode === 'rest' ? 'Submarine resting at ' : 'Submarine at ') + fmt(st.depth) + ' metres, ' + ZONE_NAMES[z] + ' zone');
      container.dataset.depth = String(Math.round(st.depth));
      container.dataset.zone = z;
    }
    // x, y are screen coordinates; bubbles live in column coordinates so they rise through the water, not with the camera
    function spawnBubble(now, x, y, big) {
      const off = cameraOffset(st.shown, st.h);
      for (const b of st.bubbles) {
        if (b.alive) continue;
        b.alive = true; b.x = x + (rng() - 0.5) * 10; b.y = y + off; b.r = (big ? 2.5 : 1.2) + rng() * (big ? 3.5 : 2.2); b.vy = -(26 + rng() * 40); b.vx = (rng() - 0.5) * 12; b.born = now; b.life = 1400 + rng() * 1600;
        return;
      }
    }
    function burst(now, x, y, n) { for (let i = 0; i < n; i++) spawnBubble(now, x + (rng() - 0.5) * 30, y + (rng() - 0.5) * 20, true); }
    function spawnMover(m, zone, now) {
      const list = creaturesFor(zone);
      const pick = list[Math.floor(rng() * list.length)];
      m.alive = true; m.kind = pick.kind; m.art = pick.art || null; m.deep = zone !== 'sunlight';
      m.flip = rng() < 0.5;
      m.vx = (6 + rng() * 14) * (m.flip ? -1 : 1) * (pick.kind === 'jelly' || pick.kind === 'tripod' ? 0.35 : 1);
      m.scale = 0.7 + rng() * 0.6;
      m.x = m.flip ? st.w + 40 : -40;
      const off = cameraOffset(st.shown, st.h);
      m.col = off + 24 + rng() * Math.max(40, st.h - 60);
      m.phase = rng() * 6.3; m.born = now;
      if (m.art) artImage(m.art);
    }
    function invalidate() { if (!st.raf && st.running) st.raf = root.requestAnimationFrame(frame); }

    // ---- drawing
    function draw(now) {
      const t = now / 1000;
      const dt = st.lastNow ? Math.min(0.05, (now - st.lastNow) / 1000) : 0.016;
      st.lastNow = now;
      // where the sub is this frame
      let descending = false, progress = 0;
      if (st.tween) {
        progress = Math.min(1, (now - st.tween.start) / st.tween.ms);
        st.shown = st.tween.from + (st.tween.to - st.tween.from) * ease(progress);
        descending = progress < 1;
        if (progress >= 1) { st.shown = st.tween.to; const done = st.tween; st.tween = null; finishTween(done, now); }
      }
      const off = cameraOffset(st.shown, st.h);
      const subY = SURFACE_PAD + st.shown * PX_PER_M - off;
      const scale = Math.max(0.58, Math.min(1.15, st.w / 220));
      const subX = st.w * 0.5 + (st.effects.shudder > now ? (rng() - 0.5) * 7 : 0);
      const topDepth = (off - SURFACE_PAD) / PX_PER_M;
      const fadeIn = st.fade ? Math.min(1, (now - st.fade.start) / FADE_MS) : 1;
      if (st.fade && fadeIn >= 1) st.fade = null;
      ctx.globalAlpha = st.fade ? fadeIn : 1;
      // water in bands
      for (let y = 0; y < st.h; y += BAND_PX) {
        const d = (y + BAND_PX / 2 + off - SURFACE_PAD) / PX_PER_M;
        ctx.fillStyle = d < 0 ? SKY : waterColor(d);
        ctx.fillRect(0, y, st.w, BAND_PX + 1);
      }
      // the surface and its light
      const surfY = SURFACE_PAD - off;
      if (surfY > -200) {
        ctx.fillStyle = SKY;
        ctx.beginPath(); ctx.moveTo(0, 0);
        for (let x = 0; x <= st.w; x += 6) ctx.lineTo(x, surfY + Math.sin((x + t * 22) / 46) * 2.4);
        ctx.lineTo(st.w, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 2; ctx.globalAlpha *= 0.9;
        ctx.beginPath(); for (let x = 0; x <= st.w; x += 6) ctx.lineTo(x, surfY + Math.sin((x + t * 22) / 46) * 2.4); ctx.stroke();
        ctx.globalAlpha = st.fade ? fadeIn : 1;
        ctx.fillStyle = INK;
        for (let i = 0; i < 3; i++) {
          const bx = (i + 0.5) * st.w / 3 + Math.sin(t * 0.3 + i) * 8;
          ctx.globalAlpha = (st.fade ? fadeIn : 1) * 0.10;
          ctx.beginPath(); ctx.moveTo(bx - 8, surfY); ctx.lineTo(bx + 8, surfY); ctx.lineTo(bx + 34, surfY + 260); ctx.lineTo(bx - 30, surfY + 260); ctx.closePath(); ctx.fill();
        }
        ctx.globalAlpha = st.fade ? fadeIn : 1;
      }
      // the progress rail on the left edge: the whole ocean, with the sub's place on it
      const railTop = 12, railH = st.h - 24;
      for (const z of ZONE_BOUNDS) {
        ctx.fillStyle = ZONE_FILL[z[0]]; ctx.globalAlpha = (st.fade ? fadeIn : 1) * 0.45;
        ctx.fillRect(4, railTop + railH * z[1] / MAX_M, 4, railH * (z[2] - z[1]) / MAX_M);
      }
      ctx.globalAlpha = st.fade ? fadeIn : 1;
      ctx.fillStyle = GOLD;
      ctx.beginPath(); ctx.arc(6, railTop + railH * Math.min(1, st.shown / MAX_M), 3.5, 0, Math.PI * 2); ctx.fill();
      // ticks, zone names and landmarks
      ctx.font = '600 10px ' + FONT; ctx.textBaseline = 'middle';
      for (let m = 500; m <= MAX_M; m += 500) {
        const y = SURFACE_PAD + m * PX_PER_M - off;
        if (y < -10 || y > st.h + 10) continue;
        const major = m % 1000 === 0;
        ctx.strokeStyle = INK; ctx.globalAlpha = (st.fade ? fadeIn : 1) * (major ? 0.22 : 0.12); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(major ? 30 : 22, y); ctx.stroke();
        if (major) { ctx.fillStyle = INK; ctx.globalAlpha = (st.fade ? fadeIn : 1) * 0.5; ctx.textAlign = 'left'; ctx.fillText(fmt(m), 34, y); }
      }
      for (const z of ZONE_BOUNDS) {                    // zone names sit just above the line where the zone ends
        const y = SURFACE_PAD + Math.min(MAX_M, z[2]) * PX_PER_M - off - 24;   // above the landmark label on the same line
        if (y < 20 || y > st.h - 60) continue;
        ctx.fillStyle = INK; ctx.globalAlpha = (st.fade ? fadeIn : 1) * 0.28; ctx.textAlign = 'right'; ctx.font = '700 10px ' + FONT;
        ctx.fillText(ZONE_NAMES[z[0]].toUpperCase(), st.w - 8, y);
      }
      for (const key of Object.keys(LANDMARK_LABELS)) {
        const m = Number(key);
        const y = SURFACE_PAD + m * PX_PER_M - off;
        if (y < -10 || y > st.h + 10) continue;
        const passed = st.passed.has(m);
        ctx.strokeStyle = passed ? ACCENT : INK; ctx.globalAlpha = (st.fade ? fadeIn : 1) * (passed ? 0.55 : 0.25); ctx.lineWidth = 1;
        ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(12, y); ctx.lineTo(st.w, y); ctx.stroke(); ctx.setLineDash([]);
        if (st.w >= 150) { ctx.fillStyle = passed ? ACCENT : INK; ctx.globalAlpha = (st.fade ? fadeIn : 1) * (passed ? 0.9 : 0.45); ctx.textAlign = 'right'; ctx.font = '600 9.5px ' + FONT; ctx.fillText(LANDMARK_LABELS[m] + ' · ' + fmt(m) + ' m', st.w - 8, y - 7); }
      }
      ctx.globalAlpha = st.fade ? fadeIn : 1;
      // bioluminescent specks below 1,000 m
      for (const sp of st.specks) {
        const y = sp.col - off;
        if (y < -4 || y > st.h + 4) continue;
        const tw = still ? 0.6 : 0.45 + 0.55 * Math.max(0, Math.sin(t * 1.7 + sp.phase));
        ctx.fillStyle = sp.hue; ctx.globalAlpha = (st.fade ? fadeIn : 1) * 0.75 * tw;
        ctx.beginPath(); ctx.arc(12 + sp.fx * (st.w - 24), y, sp.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = st.fade ? fadeIn : 1;
      // the living ocean: creatures of the zone around the camera
      const zone = zoneCodeAt(Math.max(0, topDepth + (st.h / 2) / PX_PER_M));
      for (const m of st.movers) {
        if (!m.alive) { if (!still && rng() < 0.006) spawnMover(m, zone, now); else if (still && !m.alive && st.tick < 3) spawnMover(m, zone, now); continue; }
        if (!still) m.x += m.vx * dt;
        const y = m.col - off + Math.sin(t * 1.3 + m.phase) * 4;
        if (m.x < -60 || m.x > st.w + 60 || y < -60 || y > st.h + 60) { m.alive = false; continue; }
        ctx.save();
        ctx.translate(m.x, y);
        if (m.flip) ctx.scale(-1, 1);
        ctx.scale(m.scale, m.scale);
        ctx.globalAlpha = (st.fade ? fadeIn : 1) * 0.8;
        const img = m.art ? artImage(m.art) : null;
        if (img && img.complete && img.naturalWidth > 0) ctx.drawImage(img, -28, -28, 56, 56);
        else (SILHOUETTES[m.kind] || SILHOUETTES.fish)(ctx, { t, phase: m.phase, deep: m.deep });
        ctx.restore();
      }
      ctx.globalAlpha = st.fade ? fadeIn : 1;
      // the seabed, at rest, when the floor of the zone is in view
      if (st.mode === 'rest') {
        const z = ZONE_BOUNDS.find(b => st.depth < b[2]) || ZONE_BOUNDS[ZONE_BOUNDS.length - 1];
        const floorY = SURFACE_PAD + Math.min(MAX_M, z[2]) * PX_PER_M - off + 46;
        if (floorY < st.h + 30) {
          ctx.fillStyle = DARK; ctx.globalAlpha = (st.fade ? fadeIn : 1) * 0.85;
          ctx.beginPath(); ctx.moveTo(0, st.h); ctx.lineTo(0, floorY);
          for (let x = 0; x <= st.w; x += 12) ctx.lineTo(x, floorY + Math.sin(x * 0.11) * 5 + Math.sin(x * 0.031) * 8);
          ctx.lineTo(st.w, st.h); ctx.closePath(); ctx.fill();
          ctx.globalAlpha = st.fade ? fadeIn : 1;
        }
      }
      // bubbles rise through the water (so they trail behind a sinking sub)
      for (const b of st.bubbles) {
        if (!b.alive) continue;
        const age = now - b.born;
        if (age > b.life) { b.alive = false; continue; }
        b.y += b.vy * dt; b.x += (b.vx + Math.sin(t * 5 + b.r) * 8) * dt;
        ctx.strokeStyle = INK; ctx.globalAlpha = (st.fade ? fadeIn : 1) * 0.55 * (1 - age / b.life); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(b.x, b.y - off, b.r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = st.fade ? fadeIn : 1;
      // speed lines during a plunge
      if (st.effects.speed > now) {
        const k = (st.effects.speed - now) / SPEED_MS;
        ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.globalAlpha = (st.fade ? fadeIn : 1) * 0.5 * k;
        for (let i = 0; i < 7; i++) { const x = 16 + ((i * 53 + Math.floor(t * 90)) % Math.max(1, st.w - 30)); const y0 = (i * 97 + t * 900) % st.h; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 - 40 - 30 * k); ctx.stroke(); }
        ctx.globalAlpha = st.fade ? fadeIn : 1;
      }
      // the submarine
      if (descending && !still && st.tick % 2 === 0) spawnBubble(now, subX - 44 * scale, subY + 2, false);
      const fistK = st.effects.fist > now ? Math.min(1, (st.effects.fist - now) / FIST_MS * 2.2) : 0;
      drawSub(ctx, { x: subX, y: subY, scale, tilt: still ? 0 : subTilt({ descending, progress }), t, lamp: lampStrength(st.shown) * (st.mode === 'rest' ? 0.9 : 1), fist: fistK, flicker: st.effects.flicker > now ? 1 : 0, spin: descending ? 22 : (st.mode === 'rest' ? 2.5 : 5) });
      // the depth readout, counting up as the sub sinks (bottom-left, clear of the sub at the surface)
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const hudH = 46, hudY = st.h - hudH - 10;
      ctx.fillStyle = DARK; ctx.globalAlpha = (st.fade ? fadeIn : 1) * 0.55;
      ctx.fillRect(10, hudY, Math.min(st.w - 20, 124), hudH);
      ctx.globalAlpha = st.fade ? fadeIn : 1;
      ctx.fillStyle = INK; ctx.font = '800 ' + (st.w < 150 ? 19 : 24) + 'px ' + FONT;
      ctx.fillText(fmt(st.shown) + ' m', 16, hudY + 27);
      ctx.fillStyle = ACCENT; ctx.font = '700 10px ' + FONT;
      ctx.fillText(ZONE_NAMES[zoneCodeAt(st.shown)].toUpperCase() + ' ZONE', 16, hudY + 40);
      // a landmark popping in as it is crossed
      if (st.pop && now - st.pop.start < POP_MS) {
        const k = (now - st.pop.start) / POP_MS;
        const a = k < 0.15 ? k / 0.15 : k > 0.75 ? (1 - k) / 0.25 : 1;
        const y = SURFACE_PAD + st.pop.depth * PX_PER_M - off;
        const text = st.w < NARROW_W ? (LANDMARK_SHORT[st.pop.depth] || st.pop.label) : st.pop.label;
        ctx.font = '800 ' + (st.w < NARROW_W ? 10 : 11) + 'px ' + FONT;
        const tw = Math.min(st.w - 16, ctx.measureText(text).width + 18);
        const x = Math.max(8, Math.min(st.w - tw - 8, st.w / 2 - tw / 2));
        ctx.globalAlpha = (st.fade ? fadeIn : 1) * a;
        ctx.fillStyle = DARK; ctx.fillRect(x, y - 24 - (1 - a) * 6, tw, 20);
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 1; ctx.strokeRect(x, y - 24 - (1 - a) * 6, tw, 20);
        ctx.fillStyle = ACCENT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + tw / 2, y - 14 - (1 - a) * 6);
        ctx.globalAlpha = st.fade ? fadeIn : 1;
      } else if (st.pop) st.pop = null;
      // the Hadal flash
      if (st.effects.flash > now) {
        ctx.fillStyle = GOLD; ctx.globalAlpha = (st.fade ? fadeIn : 1) * 0.55 * (st.effects.flash - now) / FLASH_MS;
        ctx.fillRect(0, 0, st.w, st.h);
      }
      ctx.globalAlpha = 1;
      // landmarks crossed this frame
      for (const key of Object.keys(LANDMARK_LABELS)) {
        const m = Number(key);
        if (st.shown >= m && !st.passed.has(m)) { st.passed.add(m); st.pop = { depth: m, label: LANDMARK_LABELS[m] + ' · ' + fmt(m) + ' m', start: now }; if (opts.onLandmark) opts.onLandmark({ depth: m, label: LANDMARK_LABELS[m] }); }
      }
      if (st.tween && opts.onFrame) opts.onFrame(Math.round(st.shown));
      if (descending && st.shown > 0) container.dataset.effect = 'descend';
      else if (st.effects.shudder > now) container.dataset.effect = 'stall';
      else if (st.effects.flicker > now) container.dataset.effect = 'flicker';
      else if (st.effects.fist > now) container.dataset.effect = 'hadal';
      else container.dataset.effect = '';
    }
    function finishTween(tw, now) {
      st.depth = tw.to;
      if (tw.tier === 'hadal') { st.effects.fist = now + FIST_MS; burst(now, st.w * 0.5, SURFACE_PAD + st.depth * PX_PER_M - cameraOffset(st.depth, st.h), 18); }
      label();
      if (opts.onFrame) opts.onFrame(Math.round(st.depth));
      if (opts.onSettle) opts.onSettle(st.depth);
    }
    function busy(now) {
      return !!(st.tween || st.fade || st.pop || st.effects.shudder > now || st.effects.flicker > now || st.effects.flash > now || st.effects.fist > now || st.effects.speed > now || st.bubbles.some(b => b.alive));
    }
    function frame(now) {
      st.raf = 0;
      if (!st.running) return;
      if (!canvas.isConnected) { destroy(); return; }
      st.tick++;
      if (!st.halfRate || st.tick % 2 === 0) {
        const t0 = performance.now();
        draw(now);
        st.avgDraw += (performance.now() - t0 - st.avgDraw) * BUDGET_SMOOTHING;
        st.halfRate = st.avgDraw > FRAME_BUDGET_MS;
      }
      if (still && !busy(now)) { st.lastNow = 0; return; }       // reduced motion: draw only while something changes
      st.raf = root.requestAnimationFrame(frame);
    }
    function onVisibility() {
      if (doc.hidden) { if (st.raf) root.cancelAnimationFrame(st.raf); st.raf = 0; st.lastNow = 0; }
      else invalidate();
    }
    function destroy() {
      st.running = false;
      if (st.raf) root.cancelAnimationFrame(st.raf); st.raf = 0;
      root.removeEventListener('resize', resize);
      doc.removeEventListener('visibilitychange', onVisibility);
      if (ro) ro.disconnect();
    }

    // ---- the API the game uses
    // The sub sinks to `depth`. Returns the duration so sounds and badges can be timed to it (0 under reduced motion).
    function descendTo(depth, o) {
      const now = performance.now();
      const to = Math.max(0, depth || 0);
      const from = st.tween ? st.shown : st.depth;
      if (st.tween) { st.tween = null; }
      st.lastNow = 0;
      if (still) {
        st.depth = st.shown = to; st.fade = { start: now };
        if (o && o.tier === 'hadal') st.effects.flash = now + FLASH_MS;
        label(); invalidate();
        return 0;
      }
      const ms = o && o.ms > 0 ? Math.round(o.ms) : descentMs(to - from);
      st.tween = { from, to, start: now, ms, tier: o && o.tier };
      if (o && o.tier === 'hadal') { st.effects.speed = now + Math.min(SPEED_MS, ms); st.effects.flash = now + FLASH_MS; }
      invalidate();
      return ms;
    }
    function stall() {
      const now = performance.now();
      st.effects.shudder = now + SHUDDER_MS;
      if (!still) burst(now, st.w * 0.5, SURFACE_PAD + st.depth * PX_PER_M - cameraOffset(st.depth, st.h), 7);
      container.dataset.effect = 'stall';
      invalidate();
    }
    function flicker() { st.effects.flicker = performance.now() + FLICKER_MS; container.dataset.effect = 'flicker'; invalidate(); }
    function celebrate() {
      const now = performance.now();
      st.effects.flash = now + FLASH_MS; st.effects.fist = now + FIST_MS;
      if (!still) burst(now, st.w * 0.5, SURFACE_PAD + st.depth * PX_PER_M - cameraOffset(st.depth, st.h), 24);
      invalidate();
    }
    function setDepth(depth) { st.tween = null; st.depth = st.shown = Math.max(0, depth || 0); for (const lm of Object.keys(LANDMARK_LABELS)) if (Number(lm) <= st.depth) st.passed.add(Number(lm)); label(); invalidate(); }
    function rest() { st.mode = 'rest'; label(); invalidate(); }

    let ro = null;
    if (root.ResizeObserver) { ro = new root.ResizeObserver(resize); ro.observe(container); }
    root.addEventListener('resize', resize);
    doc.addEventListener('visibilitychange', onVisibility);
    resize();
    label();
    return { el: canvas, descendTo, stall, flicker, celebrate, setDepth, rest, destroy, getDepth: () => st.depth, isStill: () => still };
  }

  return {
    PX_PER_M, SUB_FRAC, SURFACE_PAD, FLOOR_PAD, DESCENT_MAX_MS, TAKEOVER_MIN_MS, TAKEOVER_MAX_MS, MAX_MOVERS, PALETTE, SILHOUETTES, CREATURES, LANDMARK_LABELS,
    columnHeight, cameraOffset, subScreenY, descentMs, takeoverMs, ease, waterColor, lampStrength, zoneCodeAt, creaturesFor, subTilt, drawSub, mount,
  };
});
