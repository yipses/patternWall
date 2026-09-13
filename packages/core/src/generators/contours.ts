import { accentAt } from '../palette.js';
import { hexToOklch, mixOklch, oklchToHex } from '../color.js';
import { createNoise2D } from '../noise.js';
import { clamp, smoothstep } from '../geometry.js';
import { el, num, svgRoot } from '../svg.js';
import { pNum, type Generator, type RenderContext } from '../types.js';

const description = `
A contour map is a landscape answering one question over and over: where exactly is this height? Join up every point at 200 metres and you get a line; do it at 220 and you get another inside it; keep going and the shape of a hill appears without anything ever drawing a hill. Nothing here is a picture of terrain. There is a height at every point on the canvas, and everything you see is the set of places where that height crosses a round number.

The heights come from fractal noise — several octaves of a smooth random field, each one half the amplitude and twice the frequency of the last. **Terrain scale** sets how far you are standing back: low values give two or three broad massifs across the width, high values a crowded archipelago. **Detail** is the octave count, and it changes the character rather than the size: at one octave the land is all smooth domes, and each octave after that roughens the coastline without moving the mountains. The two are worth separating because "bigger hills" and "rougher hills" are different requests and a single knob answering both would satisfy neither.

Left there, though, the result is not a landscape. Fractal noise is isotropic — nothing in it prefers a direction — so every landform comes out a rounded blob and the map reads as splodges. Real country is nothing but direction: ridges that run for miles, valleys that branch, the whole surface organised by the water coming off it. **Grain** supplies that by looking the field up at a point the field itself has moved, so the land is dragged through itself and acquires a flow. **Valley incision** supplies the other half. Plain noise domes where water cuts, so the second field mixed in here is ridged noise — folded at its zero crossing so it creases instead of curving — and the contours start kinking upstream in the V that gives a printed sheet away as terrain rather than decoration. Both are easy to overdo: past about a third, the incision stops cutting valleys and starts shattering the map into small closed rings.

The lines are found by marching squares. The field is sampled onto a grid, and every cell of that grid is compared against each height that passes through it: a cell with two corners above the line and two below has the line crossing two of its edges, and where it crosses is worked out by interpolating between the corner heights. Walk every cell and the crossings assemble into closed loops without anything ever having to trace one. **Resolution** is that grid, and it is the honest cost control — it sets how finely the curves are followed and it is the one parameter that decides how long a render takes.

Two cases are genuinely ambiguous: a cell with high corners diagonally opposite each other is either a saddle or a pinch, and the crossings alone cannot say which. Taking the average of the four corners settles it, and the difference is visible — guess wrong and contours join across a pass that should divide them, which is the difference between two hills and one lumpy one.

**Index contours** are the cartographer's convention of drawing every fifth line heavier, and they are the reason a real map reads as height rather than as pattern: the eye counts the bold lines and gets elevation for free, where a field of identical lines only gives shape. **Relief** is composition rather than geology. It flattens the field toward the top of the canvas, so the upper third holds a few wide, calm lines and the lower canvas carries the dense contours and the peaks. A phone's clock sits on that quiet ground, and the detail lands where iOS covers nothing.
`.trim();

/**
 * Height is quantised into this many bands for colour regardless of the line
 * count, so the palette walks the elevation at the same rate whether you are
 * drawing eight contours or sixty.
 */
const COLOR_STEPS = 32;

/**
 * How far the warp field may drag a sample, in the same units as the terrain
 * scale. Large enough that ridges genuinely run rather than merely lean;
 * small enough that the land does not fold back through itself.
 */
const WARP_REACH = 0.65;

/** Offsets so the two warp fields are different slices of the same noise. */
const WARP_X = 11.3;
const WARP_Y = -7.1;

export const contours: Generator = {
  id: 'contours',
  name: 'Contours',
  tagline: 'A landscape nobody surveyed, read from above.',
  tags: ['noise', 'organic'],
  description,
  params: [
    { key: 'levels', label: 'Contour lines', type: 'number', min: 6, max: 60, step: 1, default: 22, description: 'How many heights get a line. More lines read as steeper country, because a contour map shows slope as line density.' },
    { key: 'scale', label: 'Terrain scale', type: 'number', min: 0.6, max: 6, step: 0.1, default: 1.5, description: 'How far back you are standing. Low values give two or three broad massifs across the width; high values an archipelago of small islands.' },
    { key: 'detail', label: 'Detail', type: 'number', min: 1, max: 5, step: 1, default: 3, description: 'Octaves of noise. One gives smooth domes; each one after roughens the coastline without moving the mountains.' },
    { key: 'resolution', label: 'Resolution', type: 'number', min: 40, max: 220, step: 10, default: 130, description: 'The sampling grid the lines are traced on. Low values give an angular, faceted map. This is what a render costs, so it is the knob to reach for if the preview feels slow.' },
    { key: 'weight', label: 'Line weight', type: 'number', min: 0.3, max: 3, step: 0.05, default: 1, description: 'Line width, scaled to the canvas so it looks the same at any export size.' },
    { key: 'indexEvery', label: 'Index contours', type: 'number', min: 0, max: 10, step: 1, default: 5, description: 'Draw every nth line heavier, the way a printed map does, so the eye can count elevation instead of only reading shape. Zero draws every line the same.' },
    { key: 'relief', label: 'Relief', type: 'number', min: 0, max: 1, step: 0.01, default: 0.55, description: 'Flattens the land toward the top of the canvas, so the clock sits on calm ground and the dense contours fall in the lower half. At zero the country is equally rugged everywhere.' },
    { key: 'colorSpread', label: 'Colour spread', type: 'number', min: 0, max: 1, step: 0.01, default: 0.75, description: 'How much of the accent ramp the elevation walks through. At zero every line is the middle of the palette; at one the lowest contour and the highest sit at opposite ends of it.' },
    { key: 'grain', label: 'Grain', type: 'number', min: 0, max: 1, step: 0.01, default: 0.45, description: 'Gives the country a direction. At zero every hill is a rounded blob, because plain noise has no orientation and the contours come out as splodges; raising it drags the field through itself so ridges run, valleys branch and the whole map acquires the flow of somewhere real.' },
    { key: 'incision', label: 'Valley incision', type: 'number', min: 0, max: 1, step: 0.01, default: 0.22, description: 'Cuts the valleys rather than rounding them. Blends in ridged noise, which creases where plain noise would dome, so contours kink sharply along the lines water would take \u2014 the V pointing upstream that gives a printed sheet away as terrain and not decoration.' },
  ],

  render(ctx: RenderContext): string {
    const { width: w, height: h, palette, params, rng } = ctx;
    const noise = createNoise2D(rng);

    const levels = Math.max(2, Math.round(pNum(params, 'levels', 22)));
    const scale = pNum(params, 'scale', 1.5);
    const detail = Math.max(1, Math.round(pNum(params, 'detail', 3)));
    const indexEvery = Math.max(0, Math.round(pNum(params, 'indexEvery', 5)));
    const relief = clamp(pNum(params, 'relief', 0.55), 0, 1);
    const colorSpread = clamp(pNum(params, 'colorSpread', 0.75), 0, 1);
    const weight = pNum(params, 'weight', 1);
    const grain = clamp(pNum(params, 'grain', 0.45), 0, 1);
    const incision = clamp(pNum(params, 'incision', 0.22), 0, 1);

    // The sampling grid is a parameter, never a function of the canvas size.
    // Deriving it from pixels would trace a 108px thumbnail on a coarser grid
    // than a 1399px export and hand back a different map — the preview has to
    // be the thing you download.
    const cols = Math.max(8, Math.round(pNum(params, 'resolution', 130)));
    const rows = Math.max(8, Math.round((cols * h) / Math.max(1, w)));

    const minDim = Math.min(w, h);
    const aspect = h / Math.max(1, w);

    // The field, sampled once. Everything below reads it; nothing re-evaluates
    // the noise, because at this grid size that would be the whole cost.
    const field = new Float64Array((cols + 1) * (rows + 1));
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      // Relief is composition, not geology: rather than dimming the ink at the
      // top — which on a field of lines would draw a horizontal band across it
      // — it flattens the land itself toward 0.5, so fewer contour heights are
      // crossed up there and the map genuinely has less to say. The seam a
      // brightness ramp would leave cannot form, because what varies is how
      // much terrain there is rather than how it is painted.
      const amp = 1 - relief * (1 - smoothstep(0.02, 0.92, v));
      for (let i = 0; i <= cols; i++) {
        const u = i / cols;
        let sx = u * scale;
        let sy = v * scale * aspect;

        // Domain warp: look the field up at a point the field itself has
        // moved. Plain fractal noise is isotropic, so every landform comes out
        // a rounded blob and the contours read as splodges rather than as
        // country — nothing in it prefers a direction, and real landscapes are
        // nothing but direction: ridges that run, valleys that branch, drainage
        // organising the lot. Dragging the sample point through a second field
        // supplies that grain for the cost of two more lookups. Two octaves is
        // enough; the warp wants to be smooth, and detail in it only jitters
        // the result.
        if (grain > 0) {
          const reach = grain * WARP_REACH;
          sx += noise.fbm(sx + WARP_X, sy + WARP_Y, 2) * reach;
          sy += noise.fbm(sx - WARP_X, sy - WARP_Y, 2) * reach;
        }

        // Plain noise domes; ridged noise creases. Real slopes are cut by the
        // water coming off them, so the contours kink upstream in a V instead
        // of curving smoothly, and that crease is most of what makes a printed
        // sheet read as terrain. `ridged` already returns 0..1, so the two mix
        // directly.
        const domed = noise.fbm(sx, sy, detail) * 0.5 + 0.5;
        const raw = incision > 0 ? domed * (1 - incision) + noise.ridged(sx, sy, detail) * incision : domed;
        field[j * (cols + 1) + i] = 0.5 + (raw - 0.5) * amp;
      }
    }

    // One path per contour height, built as a run of two-point segments. The
    // segments of a level share a stroke, so they share a group and a single
    // `d` — a level is one element however many cells it crosses.
    const paths: string[] = new Array(levels).fill('');

    const cw = w / cols;
    const ch = h / rows;

    for (let j = 0; j < rows; j++) {
      const y0 = j * ch;
      const y1 = y0 + ch;
      const rowA = j * (cols + 1);
      const rowB = (j + 1) * (cols + 1);
      for (let i = 0; i < cols; i++) {
        const x0 = i * cw;
        const x1 = x0 + cw;
        const a = field[rowA + i] as number; // top left
        const b = field[rowA + i + 1] as number; // top right
        const c = field[rowB + i + 1] as number; // bottom right
        const e = field[rowB + i] as number; // bottom left

        // Only the heights that actually pass through this cell are tested.
        // Without this every cell would be compared against every level, which
        // is the difference between a render and a stall at high resolutions.
        const lo = Math.min(a, b, c, e);
        const hi = Math.max(a, b, c, e);
        let first = Math.floor(lo * levels) + 1;
        if (first < 1) first = 1;
        const last = Math.min(levels - 1, Math.floor(hi * levels));

        for (let L = first; L <= last; L++) {
          const iso = L / levels;
          const idx = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (e > iso ? 1 : 0);
          if (idx === 0 || idx === 15) continue;

          // Where the line crosses each edge, by linear interpolation between
          // the two corner heights it runs between.
          const tx = x0 + cw * ((iso - a) / (b - a || 1e-9));
          const ry = y0 + ch * ((iso - b) / (c - b || 1e-9));
          const bx = x0 + cw * ((iso - e) / (c - e || 1e-9));
          const ly = y0 + ch * ((iso - a) / (e - a || 1e-9));

          const T = `${num(tx, 1)} ${num(y0, 1)}`;
          const R = `${num(x1, 1)} ${num(ry, 1)}`;
          const B = `${num(bx, 1)} ${num(y1, 1)}`;
          const Lf = `${num(x0, 1)} ${num(ly, 1)}`;

          let d = '';
          switch (idx) {
            case 1: case 14: d = `M${Lf}L${B}`; break;
            case 2: case 13: d = `M${B}L${R}`; break;
            case 3: case 12: d = `M${Lf}L${R}`; break;
            case 4: case 11: d = `M${T}L${R}`; break;
            case 6: case 9: d = `M${T}L${B}`; break;
            case 7: case 8: d = `M${T}L${Lf}`; break;
            // The two ambiguous cells. Diagonally opposite corners are above
            // the line, and the crossings alone cannot say whether this is one
            // ridge pinching through or two that pass without touching. The
            // average of the four corners settles it: guess wrong and contours
            // join across a saddle that should divide them, which turns two
            // hills into one lumpy one.
            case 5:
              d = (a + b + c + e) / 4 > iso ? `M${T}L${R}M${Lf}L${B}` : `M${T}L${Lf}M${B}L${R}`;
              break;
            case 10:
              d = (a + b + c + e) / 4 > iso ? `M${T}L${Lf}M${B}L${R}` : `M${T}L${R}M${Lf}L${B}`;
              break;
            default: break;
          }
          if (d) paths[L] += d;
        }
      }
    }

    const bg = hexToOklch(palette.background);
    const tintTop = oklchToHex({ ...bg, l: clamp(bg.l + (palette.mode === 'dark' ? 0.014 : -0.012), 0, 1) });
    const tintBottom = oklchToHex(
      mixOklch(bg, hexToOklch(accentAt(palette, 0.7)), palette.mode === 'dark' ? 0.12 : 0.08),
    );
    const defs = el(
      'defs',
      {},
      el(
        'linearGradient',
        { id: 'ct-bg', x1: '0', y1: '0', x2: '0', y2: '1' },
        el('stop', { offset: '0', 'stop-color': tintTop }) + el('stop', { offset: '1', 'stop-color': tintBottom }),
      ),
    );

    let body = defs + el('rect', { x: 0, y: 0, width: w, height: h, fill: 'url(#ct-bg)' });

    const base = minDim * 0.0022 * weight;
    for (let L = 1; L < levels; L++) {
      const d = paths[L] as string;
      if (!d) continue;
      // Elevation walks the ramp. Quantising it to a fixed number of steps
      // rather than to the line count keeps the palette moving at the same
      // rate whether there are eight contours or sixty.
      const t = clamp(0.5 + ((L / levels) - 0.5) * colorSpread, 0, 1);
      const step = Math.round(t * (COLOR_STEPS - 1)) / (COLOR_STEPS - 1);
      const isIndex = indexEvery > 0 && L % indexEvery === 0;
      body += el(
        'g',
        {
          fill: 'none',
          stroke: accentAt(palette, step),
          'stroke-width': num(isIndex ? base * 2.1 : base, 2),
          'stroke-linecap': 'round',
          'stroke-opacity': isIndex ? '1' : '0.82',
        },
        el('path', { d }),
      );
    }

    return svgRoot(w, h, `${contours.name} wallpaper`, body);
  },
};
