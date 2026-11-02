# FATHOM Hadal illustrations — brief for illustrator agents

Every prompt in FATHOM has one "Hadal" answer — the rarest, most satisfying accepted answer. When a player lands it, the game shows a small original illustration of it, and the Logbook keeps it.

## What to make

One SVG per entity, written to `/home/claude/fathom/data/illustrations/<entity-id>.svg`.

- `viewBox="0 0 256 256"`, no width/height attributes, transparent background (no background rect).
- Flat vector shapes only: `<path>`, `<circle>`, `<ellipse>`, `<rect>`, `<polygon>`, `<line>`. No text, no gradients, no filters, no images, no scripts, no external references.
- Use 2–5 colours from this palette only: `#2BD1C6` (lagoon), `#86D9EC` (pale aqua), `#3C6AE0` (midnight blue), `#B49BFF` (lavender), `#FFD24A` (gold), `#F26A4B` (coral), `#E2B94F` (sand), `#EAF4F7` (foam white), `#0C2A3A` (deep ink, for outlines or eyes). Fills only or fills plus a 4–6 px `#0C2A3A` stroke.
- Under 4 KB per file, around 8–30 shapes. Think "clean sticker": a recognisable silhouette, one or two characteristic details (the tasselled wobbegong's fringe, the hourglass dolphin's white patches, the goose barnacle's stalk, the sea pig's legs), a simple eye if it has one.
- Original work drawn from your own understanding of the animal's shape. Do not trace, copy or imitate any existing illustration, logo, mascot or photograph.
- For places (a sea, a trench, an island, a strait): a simple map-like glyph — a coastline shape, a trench as a dark cleft in a seabed, an island as a landmass with a lagoon. For vessels: the ship or submersible silhouette. For people: NOT a portrait — draw an object tied to them (Marie Tharp: a seafloor map with a ridge; an explorer: a compass or a ship). For plants: the plant. For "other" things: a simple emblem.
- Centre the subject with roughly 16 px of margin; fill the frame; no drop shadows.

## Check your work

Render a quick contact sheet with the pre-installed Playwright to make sure each file parses and looks like the thing:

```
node -e "
const { chromium } = require('playwright'); const fs = require('fs');
(async () => { const files = process.argv.slice(1); const b = await chromium.launch(); const p = await b.newPage();
  await p.setViewportSize({ width: 1040, height: 1040 });
  const cells = files.map(f => '<div style=\"width:128px;height:128px;display:inline-block;background:#0C2A3A;margin:2px\">' + fs.readFileSync(f, 'utf8') + '</div>').join('');
  await p.setContent('<body style=\"margin:0;background:#0C2A3A\">' + cells + '</body>'); await p.screenshot({ path: '/tmp/sheet.png' }); await b.close(); })();
" data/illustrations/*.svg
```

Then look at /tmp/sheet.png with the Read tool. Fix anything broken or unrecognisable. Report back with the list of files written and anything you were unsure how to draw.
