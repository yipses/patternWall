import { accent, accentAt } from '../palette.js';
import { hexToOklch, mixOklab, mixOklch, oklchToHex } from '../color.js';
import { createNoise2D } from '../noise.js';
import { clamp, quietFactor, smoothstep } from '../geometry.js';
import { el, num, smoothPath, svgRoot } from '../svg.js';
import { pNum, pStr, type Generator, type RenderContext } from '../types.js';

const description = `
A ridgeline plot stacks many one-dimensional curves down a page and lets each one hide the ones behind it. The chart form has a well-known ancestor in a 1979 record sleeve, and it is popular for the same reason it works as a wallpaper: the occlusion does all the work. Without it you have a tangle of overlapping lines; with it you have depth, and the eye reads a landscape receding into the distance rather than a graph.

The occlusion is not clever. Each ridge is drawn as a filled shape — the curve itself, then straight down to the bottom of the canvas and closed — in the background colour, and only then is the curve stroked on top. Draw the ridges back to front and every ridge paints over whatever was behind it. This costs one extra filled polygon per line and produces a result that would otherwise need a depth buffer. The fill is not quite the background colour: it carries a few percent of an accent, and the amount rises toward the front, which separates the planes even where no line crosses.

Each curve samples a two-dimensional noise field along a horizontal slice, with the slice index as the second coordinate. That is what makes neighbouring ridges resemble each other instead of being independent — the field is continuous in both directions, so a peak in one line has a smaller cousin in the line behind it, and the whole stack reads as one terrain rather than as thirty unrelated graphs. **Roughness** mixes in ridged noise, which is the absolute value of the field folded over; it sharpens crests into peaks and is the difference between rolling hills and mountains.

The **amplitude envelope** decides where the drama sits. *Lower* — the default — grows the amplitude toward the bottom of the canvas, so the top few ridges are almost flat lines and the bottom ones are tall and interlocking. That is deliberately not the classical form, which puts the tallest peaks in the middle; but a phone is not a record sleeve, and a flat, quiet band at the top of the screen is exactly where the clock needs to sit. The other envelopes are there because the classical version is also beautiful, and because the parameter should not lie about what it can do.

**Line count** and **amplitude** interact in a way worth knowing: for a given amplitude, more lines means more overlap and more occlusion, so the individual curves get shorter and the surface gets denser. Around forty lines the stack stops reading as separate curves and becomes a texture. Below about fifteen you see each curve entirely, which is a much more graphic, poster-like result.
`.trim();

export const ridgelines: Generator = {
  id: 'ridgelines',
  name: 'Ridgelines',
  tagline: 'A stack of curves, each one hiding the one behind it.',
  tags: ['flow', 'noise'],
  description,
  params: [
    { key: 'lines', label: 'Line count', type: 'number', min: 6, max: 70, step: 1, default: 32, description: 'How many ridges are stacked. Above about forty they stop reading as curves and become a surface.' },
    { key: 'resolution', label: 'Resolution', type: 'number', min: 20, max: 200, step: 2, default: 96, description: 'Samples per curve before smoothing. Low values give an angular, faceted terrain.' },
    { key: 'amplitude', label: 'Amplitude', type: 'number', min: 0.05, max: 1, step: 0.01, default: 0.52, description: 'Peak height, relative to the gap between ridges. Above about 0.6 the ridges interlock heavily.' },
    { key: 'scale', label: 'Terrain scale', type: 'number', min: 0.3, max: 4, step: 0.05, default: 1.25, description: 'Horizontal size of the features. Low values give a few broad hills across the width.' },
    {
      key: 'envelope',
      label: 'Amplitude envelope',
      type: 'select',
      options: [
        { value: 'lower', label: 'Growing downward' },
        { value: 'centre', label: 'Peaked in the middle' },
        { value: 'even', label: 'Even' },
        { value: 'upper', label: 'Growing upward' },
      ],
      default: 'lower',
      description: 'Where the tall ridges sit. Growing downward keeps the top of the screen calm for the clock.',
    },
    { key: 'roughness', label: 'Roughness', type: 'number', min: 0, max: 1, step: 0.01, default: 0.34, description: 'Blends in ridged noise, sharpening rolling hills into crests and peaks.' },
    { key: 'weight', label: 'Line weight', type: 'number', min: 0.2, max: 4, step: 0.05, default: 1.35, description: 'Stroke width, scaled to the canvas. Set it low and the fills do all the drawing.' },
    { key: 'tint', label: 'Fill tint', type: 'number', min: 0, max: 1, step: 0.01, default: 0.38, description: 'How much accent bleeds into the opaque fill behind each ridge. This is what separates the planes.' },
    { key: 'colorSpread', label: 'Colour spread', type: 'number', min: 0, max: 1, step: 0.01, default: 0.8, description: 'How far the strokes travel along the accent ramp from back to front.' },
    { key: 'quietTop', label: 'Quiet top', type: 'number', min: 0, max: 1, step: 0.01, default: 0.6, description: 'Flattens and fades the ridges that fall where iOS draws the clock and the widget row.' },
  ],

  render(ctx: RenderContext): string {
    const { width: w, height: h, palette, params, rng, safeZones } = ctx;
    const noise = createNoise2D(rng);
    const minDim = Math.min(w, h);

    const lines = Math.max(2, Math.round(pNum(params, 'lines', 32)));
    const resolution = Math.max(6, Math.round(pNum(params, 'resolution', 96)));
    const amplitude = pNum(params, 'amplitude', 0.52);
    const scale = pNum(params, 'scale', 1.25);
    const envelope = pStr(params, 'envelope', 'lower');
    const roughness = pNum(params, 'roughness', 0.34);
    const weight = pNum(params, 'weight', 1.35);
    const tint = pNum(params, 'tint', 0.38);
    const colorSpread = pNum(params, 'colorSpread', 0.8);
    const quietTop = pNum(params, 'quietTop', 0.6);

    const top = h * 0.04;
    const bottom = h * 0.985;
    const gap = (bottom - top) / (lines - 1);
    const margin = w * 0.06;
    const fieldX = (scale * 3.4) / w;

    const bg = hexToOklch(palette.background);
    const backdropTop = oklchToHex({ ...bg, l: clamp(bg.l + (palette.mode === 'dark' ? 0.035 : -0.03), 0, 1) });
    const backdropBottom = oklchToHex(mixOklch(bg, hexToOklch(accent(palette, 0)), palette.mode === 'dark' ? 0.06 : 0.05));

    const defs = el(
      'defs',
      {},
      el(
        'linearGradient',
        { id: 'rg-bg', x1: '0', y1: '0', x2: '0', y2: '1' },
        el('stop', { offset: '0', 'stop-color': backdropTop }) + el('stop', { offset: '1', 'stop-color': backdropBottom }),
      ),
    );

    const envAt = (t: number): number => {
      switch (envelope) {
        case 'centre':
          return 0.25 + 0.75 * Math.sin(Math.PI * clamp(t, 0, 1));
        case 'even':
          return 1;
        case 'upper':
          return 0.22 + 0.9 * (1 - t);
        default:
          return 0.2 + 1.05 * smoothstep(0, 1, t);
      }
    };

    let body = defs + el('rect', { x: 0, y: 0, width: w, height: h, fill: 'url(#rg-bg)' });

    for (let i = 0; i < lines; i++) {
      const t = i / (lines - 1);
      const baseY = top + gap * i;
      const q = quietFactor(baseY, h, quietTop, safeZones);
      const amp = gap * amplitude * 5.2 * envAt(t) * (0.25 + 0.75 * q);

      const pts: [number, number][] = [];
      for (let s = 0; s <= resolution; s++) {
        const x = -margin + ((w + margin * 2) * s) / resolution;
        const nx = x * fieldX;
        const ny = t * 2.6 + 11;
        const smooth = noise.fbm(nx, ny, 4, 2.07, 0.52);
        const crest = noise.ridged(nx * 1.3, ny * 1.3, 3) * 2 - 1;
        const v = smooth * (1 - roughness) + crest * roughness;
        // Taper to the baseline at the very edges so no ridge starts mid-air.
        const edge = smoothstep(0, 0.09, s / resolution) * smoothstep(0, 0.09, 1 - s / resolution);
        pts.push([x, baseY - v * amp * (0.35 + 0.65 * edge)]);
      }

      const d = smoothPath(pts, 1, 1);
      const closed = `${d}L${num(w + margin, 1)} ${num(h + gap, 1)}L${num(-margin, 1)} ${num(h + gap, 1)}Z`;

      const fillMix = clamp(tint * (0.2 + 0.8 * t), 0, 1);
      const fill = oklchToHex(mixOklab(bg, hexToOklch(accentAt(palette, clamp(t, 0, 1))), fillMix * 0.28));
      const stroke = accentAt(palette, clamp(t * colorSpread + (1 - colorSpread) * 0.15, 0, 1));
      const sw = Math.max(minDim * 0.0009, minDim * 0.0022 * weight * (0.6 + 0.6 * t));

      body += el('path', { d: closed, fill, stroke: 'none' });
      body += el('path', {
        d,
        fill: 'none',
        stroke,
        'stroke-width': num(sw, 2),
        'stroke-opacity': num(clamp(0.3 + 0.7 * q, 0.08, 1), 2),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      });
    }

    return svgRoot(w, h, `${ridgelines.name} wallpaper`, body);
  },
};
