import { accentAt } from '../palette.js';
import { hexToOklch, mixOklch, oklchToHex } from '../color.js';
import { createNoise2D } from '../noise.js';
import { clamp, smoothstep } from '../geometry.js';
import { el, num, smoothPath, svgRoot } from '../svg.js';
import { pNum, type Generator, type RenderContext } from '../types.js';

const description = `
A contour map is a landscape answering one question over and over: where exactly is this height? Join up every point at 200 metres and you get a line; do it at 220 and you get another inside it; keep going and the shape of a hill appears without anything ever drawing a hill. Nothing here is a picture of terrain. There is a height at every point on the canvas, and everything you see is the set of places where that height crosses a round number.

The heights come from fractal noise — several octaves of a smooth random field, each one half the amplitude and twice the frequency of the last. **Terrain scale** sets how far you are standing back: low values give two or three broad massifs across the width, high values a crowded archipelago. **Detail** is the octave count, and it changes the character rather than the size: at one octave the land is all smooth domes, and each octave after that roughens the coastline without moving the mountains. The two are worth separating because "bigger hills" and "rougher hills" are different requests and a single knob answering both would satisfy neither.

Left there, though, the result is not a landscape. Fractal noise is isotropic — nothing in it prefers a direction — so every landform comes out a rounded blob and the map reads as splodges. Real country is nothing but direction: ridges that run for miles, valleys that branch, the whole surface organised by the water coming off it. **Grain** supplies that by looking the field up at a point the field itself has moved, so the land is dragged through itself and acquires a flow. **Valley incision** supplies the other half. Plain noise domes where water cuts, so the second field mixed in here is ridged noise — folded at its zero crossing so it creases instead of curving — and the contours start kinking upstream in the V that gives a printed sheet away as terrain rather than decoration. Both are easy to overdo: past about a third, the incision stops cutting valleys and starts shattering the map into small closed rings.

The lines are found by marching squares. The field is sampled onto a grid, and every cell of that grid is compared against each height that passes through it: a cell with two corners above the line and two below has the line crossing two of its edges, and where it crosses is worked out by interpolating between the corner heights. That gives a heap of disconnected two-point fragments, which are then chained back into the curves they belong to — each crossing sits on one grid edge, and an edge is shared by exactly two cells, so the fragments join without any guessing about which end meets which — and drawn as a smooth curve through the crossings rather than as a run of straight hops between them.

Chaining is what makes **resolution** a fair control rather than a tax. Drawn fragment by fragment, the only route to a smooth curve is a finer grid, and the grid is the one thing a render actually costs. Interpolated, a coarse grid gives a curve just as smooth; what it costs instead is memory of small things, so islands vanish and narrow inlets round off before anything ever looks angular. The default sits where the small islands survive.

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
    { key: 'levels', label: 'Contour lines', type: 'number', min: 6, max: 60, step: 1, default: 14, description: 'How many heights get a line. Every one of them lands inside the terrain, because the field is stretched to the relief actually present before any height is asked of it. More lines read as steeper country, since a contour map shows slope as line density.' },
    { key: 'scale', label: 'Terrain scale', type: 'number', min: 0.6, max: 6, step: 0.1, default: 1.5, description: 'How far back you are standing. Low values give two or three broad massifs across the width; high values an archipelago of small islands.' },
    { key: 'detail', label: 'Detail', type: 'number', min: 1, max: 5, step: 1, default: 3, description: 'Octaves of noise. One gives smooth domes; each one after roughens the coastline without moving the mountains.' },
    { key: 'resolution', label: 'Resolution', type: 'number', min: 40, max: 220, step: 10, default: 90, description: 'The sampling grid the lines are traced on. Since the crossings are chained and smoothed, low values do not make the curves angular \u2014 they make the map forget small things, dropping islands and rounding off narrow inlets. This is what a render costs, so it is the knob to reach for if the preview feels slow.' },
    { key: 'weight', label: 'Line weight', type: 'number', min: 0.3, max: 3, step: 0.05, default: 1, description: 'Line width, scaled to the canvas so it looks the same at any export size.' },
    { key: 'indexEvery', label: 'Index contours', type: 'number', min: 0, max: 10, step: 1, default: 5, description: 'Draw every nth line heavier, the way a printed map does, so the eye can count elevation instead of only reading shape. Zero draws every line the same.' },
    { key: 'relief', label: 'Relief', type: 'number', min: 0, max: 1, step: 0.01, default: 0.55, description: 'Flattens the land toward the top of the canvas, so the clock sits on calm ground and the dense contours fall in the lower half. At zero the country is equally rugged everywhere.' },
    { key: 'colorSpread', label: 'Colour spread', type: 'number', min: 0, max: 1, step: 0.01, default: 0.75, description: 'How much of the accent ramp the elevation walks through. At zero every line is the middle of the palette; at one the lowest contour and the highest sit at opposite ends of it.' },
    { key: 'grain', label: 'Grain', type: 'number', min: 0, max: 1, step: 0.01, default: 0.45, description: 'Gives the country a direction. At zero every hill is a rounded blob, because plain noise has no orientation and the contours come out as splodges; raising it drags the field through itself so ridges run, valleys branch and the whole map acquires the flow of somewhere real.' },
    { key: 'incision', label: 'Valley incision', type: 'number', min: 0, max: 1, step: 0.01, default: 0.22, description: 'Cuts the valleys rather than rounding them. Blends in ridged noise, which creases where plain noise would dome, so contours kink sharply along the lines water would take \u2014 the V pointing upstream that gives a printed sheet away as terrain and not decoration.' },
    { key: 'seaLevel', label: 'Sea level', type: 'number', min: 0, max: 0.75, step: 0.01, default: 0.32, description: 'Floods the land below a chosen height. The coastline is a contour like any other \u2014 the level snaps to the nearest one, because a shoreline that ran between two contours would be the only line on the map not answering the same question as the rest. At zero there is no water, which is a different and drier kind of country.' },
  ],

  render(ctx: RenderContext): string {
    const { width: w, height: h, palette, params, rng } = ctx;
    const noise = createNoise2D(rng);

    const levels = Math.max(2, Math.round(pNum(params, 'levels', 14)));
    const scale = pNum(params, 'scale', 1.5);
    const detail = Math.max(1, Math.round(pNum(params, 'detail', 3)));
    const indexEvery = Math.max(0, Math.round(pNum(params, 'indexEvery', 5)));
    const relief = clamp(pNum(params, 'relief', 0.55), 0, 1);
    const colorSpread = clamp(pNum(params, 'colorSpread', 0.75), 0, 1);
    const weight = pNum(params, 'weight', 1);
    const grain = clamp(pNum(params, 'grain', 0.45), 0, 1);
    const incision = clamp(pNum(params, 'incision', 0.22), 0, 1);
    // Snapped to a contour: the shoreline is then a line the map already draws,
    // and the fill beneath it ends exactly where that line runs.
    const seaRaw = clamp(pNum(params, 'seaLevel', 0.32), 0, 0.75);
    const seaIndex = seaRaw <= 0 ? 0 : Math.max(1, Math.min(levels - 1, Math.round(seaRaw * levels)));

    // The sampling grid is a parameter, never a function of the canvas size.
    // Deriving it from pixels would trace a 108px thumbnail on a coarser grid
    // than a 1399px export and hand back a different map — the preview has to
    // be the thing you download.
    const cols = Math.max(8, Math.round(pNum(params, 'resolution', 90)));
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

    // Stretch the field to fill 0..1 before any height is asked of it.
    //
    // Fractal noise is a sum of gradients and clusters hard around its middle:
    // measured at the defaults, the raw field ran 0.337 to 0.695, barely a
    // third of its nominal range. Every height is a fraction of that range, so
    // the consequences were quiet and large. Of twenty-two contour lines only
    // eight fell inside the terrain and the rest drew nothing, which made the
    // count control roughly a third as fine as it claimed. Sea level was worse
    // than coarse: the default sat below the lowest ground on the map, so the
    // water simply never appeared, and the slider did nothing at all until
    // two-thirds of its travel.
    //
    // Normalising once here fixes both, and keys them to the relief that is
    // actually present rather than to one the noise never reaches. It is
    // scale-invariant because the grid is keyed on the column count: the same
    // configuration samples the same points, and finds the same extremes, at
    // any canvas size.
    let fmin = Infinity;
    let fmax = -Infinity;
    for (let k = 0; k < field.length; k++) {
      const v = field[k] as number;
      if (v < fmin) fmin = v;
      if (v > fmax) fmax = v;
    }
    const span = fmax - fmin;
    if (span > 1e-6) {
      for (let k = 0; k < field.length; k++) field[k] = ((field[k] as number) - fmin) / span;
    }

    // Contours are traced as whole curves, not emitted cell by cell.
    //
    // Marching squares naturally produces a heap of disconnected two-point
    // segments — 7,414 of them in an export-size render — and drawing them
    // straight out means the only way to a smooth curve is a finer grid, which
    // is also the only thing a render costs. Chaining the segments back into
    // the curves they belong to breaks that trade: the same grid gives a
    // smoothed cubic through the crossings, so the map gets smoother and
    // cheaper at once, and the file shrinks because a whole contour is one
    // path instead of a hundred.
    //
    // Every crossing sits on exactly one grid edge, so the edge is the natural
    // identity for it: an integer, exact, and shared by precisely the two cells
    // that meet there. Keying the graph on coordinates would need a tolerance,
    // because `i * cw + cw` and `(i + 1) * cw` are not reliably the same float.
    const cw = w / cols;
    const ch = h / rows;
    const HCOUNT = cols * (rows + 1);
    const EDGES = HCOUNT + (cols + 1) * rows;

    // Keyed by level *and* edge, not by edge alone.
    //
    // The first version of this stamped adjacency into arrays indexed by edge
    // and reused them per level. That is wrong here, because the loop below
    // walks cells on the outside and levels on the inside: by the time a level
    // is traced, every edge it shares with a later level has had its adjacency
    // overwritten. It survived the default settings because an edge is usually
    // crossed by only one height — its two corners rarely span more than one —
    // and fell apart in rough country at sixty levels, where a single edge is
    // crossed many times over. A slot per (level, edge) costs a map lookup and
    // cannot go wrong.
    const slotOf = new Map<number, number>();
    const sx: number[] = [];
    const sy: number[] = [];
    const sa: number[] = [];
    const sb: number[] = [];
    const touched: number[][] = Array.from({ length: levels }, () => []);

    const slot = (id: number, L: number, x: number, y: number): number => {
      const key = L * EDGES + id;
      const found = slotOf.get(key);
      if (found !== undefined) return found;
      const n = sx.length;
      slotOf.set(key, n);
      sx.push(x);
      sy.push(y);
      sa.push(-1);
      sb.push(-1);
      (touched[L] as number[]).push(n);
      return n;
    };
    const link = (p: number, q: number): void => {
      if (sa[p] === -1) sa[p] = q;
      else if (sb[p] === -1) sb[p] = q;
      if (sa[q] === -1) sa[q] = p;
      else if (sb[q] === -1) sb[q] = p;
    };

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
        if (last < first) continue;

        const tE = j * cols + i;
        const bE = (j + 1) * cols + i;
        const lE = HCOUNT + j * (cols + 1) + i;
        const rE = lE + 1;

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

          switch (idx) {
            case 1: case 14:
              link(slot(lE, L, x0, ly), slot(bE, L, bx, y1)); break;
            case 2: case 13:
              link(slot(bE, L, bx, y1), slot(rE, L, x1, ry)); break;
            case 3: case 12:
              link(slot(lE, L, x0, ly), slot(rE, L, x1, ry)); break;
            case 4: case 11:
              link(slot(tE, L, tx, y0), slot(rE, L, x1, ry)); break;
            case 6: case 9:
              link(slot(tE, L, tx, y0), slot(bE, L, bx, y1)); break;
            case 7: case 8:
              link(slot(tE, L, tx, y0), slot(lE, L, x0, ly)); break;
            // The two ambiguous cells. Diagonally opposite corners are above
            // the line, and the crossings alone cannot say whether this is one
            // ridge pinching through or two that pass without touching. The
            // average of the four corners settles it: guess wrong and contours
            // join across a saddle that should divide them, which turns two
            // hills into one lumpy one.
            case 5: case 10: {
              const tS = slot(tE, L, tx, y0);
              const rS = slot(rE, L, x1, ry);
              const bS = slot(bE, L, bx, y1);
              const lS = slot(lE, L, x0, ly);
              const high = (a + b + c + e) / 4 > iso;
              if (idx === 5 ? high : !high) {
                link(tS, rS);
                link(lS, bS);
              } else {
                link(tS, lS);
                link(bS, rS);
              }
              break;
            }
            default: break;
          }
        }
      }
    }

    // Walk each level's crossings into curves. Open chains are started from
    // their ends first, so a contour running off the canvas is traced in one
    // piece rather than from somewhere in its middle; whatever is left is a
    // closed ring and can be started anywhere.
    const seen = new Uint8Array(sx.length);
    const chain: number[] = [];
    const traceFrom = (start: number): string => {
      chain.length = 0;
      let prev = -1;
      let cur = start;
      for (;;) {
        seen[cur] = 1;
        chain.push(cur);
        let next = sa[cur] as number;
        if (next === prev || next === -1 || seen[next] === 1) {
          const alt = sb[cur] as number;
          next = alt !== prev && alt !== -1 && seen[alt] !== 1 ? alt : -1;
        }
        if (next === -1) break;
        prev = cur;
        cur = next;
      }
      if (chain.length < 2) return '';
      const tail = chain[chain.length - 1] as number;
      const ring = chain.length >= 3 && (sa[tail] === start || sb[tail] === start);
      const pts: [number, number][] = chain.map((n) => [sx[n] as number, sy[n] as number]);
      return smoothPath(pts, 1, 1, ring);
    };

    const paths: string[] = new Array(levels).fill('');
    for (let L = 1; L < levels; L++) {
      const ids = touched[L] as number[];
      if (ids.length === 0) continue;
      let d = '';
      for (const id of ids) if (seen[id] === 0 && sb[id] === -1) d += traceFrom(id);
      for (const id of ids) if (seen[id] === 0) d += traceFrom(id);
      paths[L] = d;
    }

    // The water, filled cell by cell rather than by closing the coastline into
    // polygons. A contour that runs off the canvas is not a closed ring, so
    // filling from the rings alone would need the open ones stitched together
    // along the border — real work, for a boundary that is then covered by the
    // coastline stroke drawn over it. Walking each cell's edges in order and
    // collecting the corners below the line, plus the crossings, gives the same
    // region to within the width of that stroke.
    //
    // The two diagonal cases come out as a bowtie, since the water there is two
    // opposite corners the walk joins into one loop. They are a fraction of a
    // percent of cells, the lobes still fill, and the join sits under the
    // shoreline.
    //
    // Runs of wholly submerged cells are merged along the row into a single
    // rectangle. Only the cells the shoreline actually crosses need their own
    // polygon, and open water is most of the water: at a high sea level the
    // per-cell version spent 600kB of path data drawing the same rectangle
    // forty times in a row, which the preview renders synchronously on the main
    // thread. The merge is exact -- adjacent full cells share an edge -- so it
    // costs nothing but the bookkeeping.
    let water = '';
    if (seaIndex > 0) {
      const seaIso = seaIndex / levels;
      for (let j = 0; j < rows; j++) {
        const y0 = j * ch;
        const y1 = y0 + ch;
        const rowA = j * (cols + 1);
        const rowB = (j + 1) * (cols + 1);
        let runFrom = -1;
        const flush = (until: number): void => {
          if (runFrom < 0) return;
          const rx0 = num(runFrom * cw, 1);
          const rx1 = num(until * cw, 1);
          const ry0 = num(y0, 1);
          const ry1 = num(y1, 1);
          water += `M${rx0} ${ry0}L${rx1} ${ry0}L${rx1} ${ry1}L${rx0} ${ry1}Z`;
          runFrom = -1;
        };
        for (let i = 0; i < cols; i++) {
          const a = field[rowA + i] as number;
          const b = field[rowA + i + 1] as number;
          const c = field[rowB + i + 1] as number;
          const e = field[rowB + i] as number;
          const A = a > seaIso;
          const B = b > seaIso;
          const C = c > seaIso;
          const E = e > seaIso;
          if (A && B && C && E) {
            flush(i);
            continue;
          }
          if (!A && !B && !C && !E) {
            if (runFrom < 0) runFrom = i;
            continue;
          }
          flush(i);
          const x0 = i * cw;
          const x1 = x0 + cw;
          const pts: string[] = [];
          const at = (x: number, y: number): void => {
            pts.push(`${num(x, 1)} ${num(y, 1)}`);
          };
          // Round the cell: top left to top right, then down, back, and up.
          if (!A) at(x0, y0);
          if (A !== B) at(x0 + cw * ((seaIso - a) / (b - a || 1e-9)), y0);
          if (!B) at(x1, y0);
          if (B !== C) at(x1, y0 + ch * ((seaIso - b) / (c - b || 1e-9)));
          if (!C) at(x1, y1);
          if (C !== E) at(x0 + cw * ((seaIso - e) / (c - e || 1e-9)), y1);
          if (!E) at(x0, y1);
          if (E !== A) at(x0, y0 + ch * ((seaIso - a) / (e - a || 1e-9)));
          if (pts.length >= 3) water += `M${pts.join('L')}Z`;
        }
        flush(cols);
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

    // Water goes down before any contour, so the lines that cross it — the ones
    // below sea level, which a real sheet would show as soundings — read as
    // being under the surface rather than drawn on top of it. Muted rather than
    // the accent at full strength: a solid third of the canvas in a saturated
    // colour stops being a map and becomes a poster.
    if (water) {
      const low = clamp(0.5 - 0.5 * colorSpread, 0, 1);
      body += el('path', {
        d: water,
        fill: oklchToHex(mixOklch(bg, hexToOklch(accentAt(palette, low)), palette.mode === 'dark' ? 0.26 : 0.2)),
        stroke: 'none',
      });
    }

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
      // The shoreline is the one line on the map that separates two kinds of
      // place rather than two heights, so it carries more weight than even an
      // index contour.
      const isCoast = L === seaIndex;
      body += el(
        'g',
        {
          fill: 'none',
          stroke: accentAt(palette, step),
          'stroke-width': num(isCoast ? base * 3.2 : isIndex ? base * 2.1 : base, 2),
          'stroke-linecap': 'round',
          'stroke-opacity': isCoast || isIndex ? '1' : '0.82',
        },
        el('path', { d }),
      );
    }

    return svgRoot(w, h, `${contours.name} wallpaper`, body);
  },
};
