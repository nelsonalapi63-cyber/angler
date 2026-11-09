/* ANGLER — share card: a PNG of the dive drawn on a canvas, sent with the Web Share API when the browser allows
 * files, otherwise shown in a modal with a download link. Nothing here touches the network. */
(function (root) {
  'use strict';

  const W = 1080, H = 1350;                       // portrait card (4:5) — fits feeds and chat previews
  const PAD = 72;
  const FONT = '"Avenir Next", "Segoe UI", "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif';
  const TIER_FILL = { tidepool: '#86D9EC', baitball: '#E2B94F', reef: '#F26A4B', twilight: '#B49BFF', midnight: '#3C6AE0', hadal: '#FFD24A', miss: '#2A3640' };
  const TIER_LETTER = { tidepool: 'T', baitball: 'B', reef: 'R', twilight: 'Tw', midnight: 'M', hadal: 'H', miss: '·' };
  const ZONE_FILL = { sunlight: '#2BD1C6', twilight: '#4C9BE8', midnight: '#3C5BD9', abyss: '#2B3F9E', hadal: '#1B1F5A' };
  const RAIL = { x: W - PAD - 70, top: 330, bottom: H - 300, w: 26 };

  const F = () => root.Fathom;

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function label(record) {
    const { dive, packsById } = F();
    if (record.mode === 'daily') return dive.BRAND + ' #' + record.number;
    if (record.mode === 'archive') return 'Archive · ' + dive.BRAND + ' #' + dive.puzzleNumber(record.dayKey);
    if (record.mode === 'pack') return (packsById[record.packId] ? packsById[record.packId].name : 'Themed') + ' pack';
    if (record.mode === 'challenge') return 'Challenge';
    return 'Free Dive';
  }

  // Draws the card and returns the canvas.
  function render(record) {
    const { dive, config } = F();
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const depth = Math.max(0, record.depth || 0);
    const frac = Math.min(1, depth / dive.CHALLENGER_DEEP_M);

    // water: lighter at the top, darkest at the bottom
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0F4C5C'); bg.addColorStop(0.35, '#071D33'); bg.addColorStop(1, '#02060D');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // light rays from the surface
    ctx.save();
    ctx.globalAlpha = 0.09;
    for (let i = 0; i < 7; i++) {
      const x = 120 + i * 150;
      ctx.beginPath(); ctx.moveTo(x - 30, 0); ctx.lineTo(x + 30, 0); ctx.lineTo(x + 140, 760); ctx.lineTo(x - 90, 760); ctx.closePath();
      ctx.fillStyle = '#EAF4F7'; ctx.fill();
    }
    ctx.restore();
    // a few bubbles
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2;
    [[150, 980, 9], [210, 1120, 6], [900, 1040, 11], [860, 1210, 7], [520, 1240, 5]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); });
    ctx.restore();

    // header
    ctx.fillStyle = '#EAF4F7';
    ctx.font = '800 56px ' + FONT;
    ctx.textBaseline = 'alphabetic';
    const word = dive.BRAND;
    let x = PAD;
    for (const ch of word) { ctx.fillText(ch, x, PAD + 56); x += ctx.measureText(ch).width + 12; }
    ctx.fillStyle = '#2BD1C6';
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(PAD + 10 + i * 20, PAD + 78, 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#A3BCC8';
    ctx.font = '600 34px ' + FONT;
    ctx.fillText(label(record) + (record.dayKey ? ' · ' + root.FathomPages.niceDate(record.dayKey) : ''), PAD, PAD + 134);

    // the depth
    const zone = dive.zoneFor(depth);
    ctx.fillStyle = '#EAF4F7';
    ctx.font = '800 190px ' + FONT;
    const depthText = dive.formatMeters(depth);
    ctx.fillText(depthText, PAD - 6, 540);
    const dw = ctx.measureText(depthText).width;
    ctx.font = '600 64px ' + FONT; ctx.fillStyle = '#A3BCC8';
    ctx.fillText('m', PAD + dw + 16, 540);
    ctx.font = '700 52px ' + FONT; ctx.fillStyle = '#EAF4F7';
    ctx.fillText(zone.name, PAD, 620);
    ctx.font = '400 32px ' + FONT; ctx.fillStyle = '#A3BCC8';
    wrapText(ctx, zone.fact, PAD, 672, RAIL.x - PAD - 90, 42, 3);

    // tier blocks
    const tiers = record.tiers || [];
    const bw = 92, gap = 16, by = 820;
    tiers.forEach((t, i) => {
      const code = t || 'miss';
      const bx = PAD + i * (bw + gap);
      roundRect(ctx, bx, by, bw, bw, 18); ctx.fillStyle = TIER_FILL[code]; ctx.fill();
      ctx.fillStyle = code === 'miss' ? '#7F8F9C' : (code === 'midnight' ? '#FFFFFF' : '#06202A');
      ctx.font = '800 38px ' + FONT; ctx.textAlign = 'center';
      ctx.fillText(TIER_LETTER[code], bx + bw / 2, by + bw / 2 + 14);
      ctx.textAlign = 'left';
    });
    ctx.fillStyle = '#A3BCC8'; ctx.font = '600 28px ' + FONT;
    const hadal = tiers.filter(t => t === 'hadal').length, misses = tiers.filter(t => !t).length;
    ctx.fillText((hadal ? hadal + ' Hadal · ' : '') + (tiers.length - misses) + ' of ' + tiers.length + ' accepted' + (record.hints ? ' · ' + record.hints + (record.hints === 1 ? ' hint' : ' hints') : ''), PAD, by + bw + 52);

    // percentile (server-verified only) and the invitation
    const pct = root.FathomOnline && root.FathomOnline.lastPercentile ? root.FathomOnline.lastPercentile(record) : null;
    ctx.fillStyle = '#FFD24A'; ctx.font = '800 44px ' + FONT;
    if (pct != null) ctx.fillText('Top ' + pct + '% of today’s divers', PAD, 1060);
    else ctx.fillText('Can you go deeper?', PAD, 1060);
    ctx.fillStyle = '#EAF4F7'; ctx.font = '500 34px ' + FONT;
    wrapText(ctx, dive.TAGLINE, PAD, 1118, RAIL.x - PAD - 90, 44, 2);
    ctx.fillStyle = '#2BD1C6'; ctx.font = '700 36px ' + FONT;
    ctx.fillText((config.SITE_URL || '').replace(/^https?:\/\//, '') || 'Play ' + dive.BRAND, PAD, 1228);

    // the rail: zones, landmarks, marker
    const railH = RAIL.bottom - RAIL.top;
    for (const z of dive.ZONES) {
      const y1 = RAIL.top + (z.from / dive.CHALLENGER_DEEP_M) * railH, y2 = RAIL.top + (Math.min(z.to, dive.CHALLENGER_DEEP_M) / dive.CHALLENGER_DEEP_M) * railH;
      ctx.fillStyle = ZONE_FILL[z.code]; ctx.globalAlpha = 0.5; ctx.fillRect(RAIL.x, y1, RAIL.w, y2 - y1); ctx.globalAlpha = 1;
    }
    roundRect(ctx, RAIL.x - 3, RAIL.top - 3, RAIL.w + 6, railH + 6, 14); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#2BD1C6'; ctx.globalAlpha = 0.9; ctx.fillRect(RAIL.x + 7, RAIL.top, RAIL.w - 14, frac * railH); ctx.globalAlpha = 1;
    ctx.font = '600 22px ' + FONT; ctx.fillStyle = '#A3BCC8'; ctx.textAlign = 'right';
    for (const lm of [dive.LANDMARKS[0], dive.LANDMARKS[2], dive.LANDMARKS[4], dive.LANDMARKS[6]]) {
      const y = RAIL.top + (lm.depth / dive.CHALLENGER_DEEP_M) * railH;
      ctx.fillRect(RAIL.x - 14, y - 1, 10, 2);
      ctx.fillText(dive.formatMeters(lm.depth), RAIL.x - 22, y + 8);
    }
    ctx.textAlign = 'left';
    const my = RAIL.top + frac * railH;
    ctx.beginPath(); ctx.arc(RAIL.x + RAIL.w / 2, my, 20, 0, Math.PI * 2); ctx.fillStyle = '#FFD24A'; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = '#0C2A3A'; ctx.stroke();
    return canvas;
  }
  // Greedy word wrap onto at most maxLines lines; the last line is clipped with an ellipsis if the text runs on.
  function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
    const words = String(text || '').split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      let last = lines.slice(maxLines - 1).join(' ');
      while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1).replace(/\s+$/, '');
      lines.length = maxLines - 1; lines.push(last + '…');
    }
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineH));
  }

  function fileName(record) { return F().dive.BRAND.toLowerCase() + '-' + (record.mode === 'daily' && record.number ? record.number : record.mode) + '.png'; }
  function shareText(record) {
    const { dive, config } = F();
    const pct = root.FathomOnline && root.FathomOnline.lastPercentile ? root.FathomOnline.lastPercentile(record) : null;
    return dive.shareText({ number: record.number || dive.puzzleNumber(F().todayKey()), label: record.mode === 'daily' ? null : label(record), depth: record.depth, percentile: record.mode === 'daily' ? pct : null, tiers: record.tiers, siteUrl: config.SITE_URL });
  }

  // Opens the system share sheet with the PNG when the browser can share files; otherwise a modal with the image.
  function open(record) {
    const { toast } = F();
    let canvas;
    try { canvas = render(record); } catch (e) { canvas = null; }
    if (!canvas) { root.FathomGame.copyText(shareText(record), 'Copied results to clipboard'); return; }
    const text = shareText(record);
    const toBlob = () => new Promise((resolve) => { try { canvas.toBlob(resolve, 'image/png'); } catch (e) { resolve(null); } });
    toBlob().then((blob) => {
      if (!blob) { showModal(record, canvas.toDataURL('image/png'), text); return; }
      const file = typeof File === 'function' ? new File([blob], fileName(record), { type: 'image/png' }) : null;
      if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], text }).then(() => toast('Shared'), () => showModal(record, URL.createObjectURL(blob), text));
      } else showModal(record, URL.createObjectURL(blob), text);
    });
  }
  function showModal(record, url, text) {
    const { el, modal } = F();
    const img = el('img', { class: 'share-card', src: url, alt: 'Your ' + F().dive.BRAND + ' result card', width: String(W / 2), height: String(H / 2) });
    const body = el('div', {}, [
      img,
      el('div', { class: 'row', style: 'margin-top:12px' }, [
        el('a', { class: 'btn btn-primary', href: url, download: fileName(record), text: 'Download PNG' }),
        el('button', { class: 'btn', type: 'button', text: 'Copy text', onClick: () => root.FathomGame.copyText(text, 'Copied results to clipboard') }),
      ]),
      el('p', { class: 'small muted', style: 'margin:10px 0 0', text: 'On a phone, press and hold the image to save or share it.' }),
    ]);
    modal({ title: 'Your dive card', body });
  }

  root.FathomShare = { open, render, shareText, W, H };
})(window);
