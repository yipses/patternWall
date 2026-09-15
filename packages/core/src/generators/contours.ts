import { accentAt } from '../palette.js';
import { hexToOklch, mixOklch, oklchToHex } from '../color.js';
import { createNoise2D } from '../noise.js';
import { clamp } from '../geometry.js';
import { el, num, smoothPath, svgRoot } from '../svg.js';
import { pNum, type Generator, type RenderContext } from '../types.js';

const description = `
A contour map is a landscape answering one question over and over: where exactly is this height? Join up every point at 200 metres and you get a line; do it at 220 and you get another inside it; keep going and the shape of a hill appears without anything ever drawing a hill. Nothing here is a picture of terrain. There is a height at every point on the canvas, and everything you see is the set of places where that height crosses a round number.

The heights come from fractal noise — several octaves of a smooth random field, each one half the amplitude and twice the frequency of the last. **Terrain scale** sets how far you are standing back: low values give two or three broad massifs across the width, high values a crowded archipelago. **Detail** is the octave count, and it changes the character rather than the size: at one octave the land is all smooth domes, and each octave after that roughens the coastline without moving the mountains. The two are worth separating because "bigger hills" and "rougher hills" are different requests and a single knob answering both would satisfy neither.

Left there, though, the result is not a landscape. Fractal noise is isotropic — nothing in it prefers a direction — so every landform comes out a rounded blob and the map reads as splodges. Real country is nothing but direction: ridges that run for miles, valleys that branch, the whole surface organised by the water coming off it. **Grain** supplies that by looking the field up at a point the field itself has moved, so the land is dragged through itself and acquires a flow. **Valley incision** supplies the other half. Plain noise domes where water cuts, so the second field mixed in here is ridged noise — folded at its zero crossing so it creases instead of curving — and the contours start kinking upstream in the V that gives a printed sheet away as terrain rather than decoration. Both are easy to overdo, and both sliders stop where overdoing them begins: past about a fifth the incision leaves off cutting valleys and starts shattering the map into small closed rings, and a warp much beyond a quarter drags the land through itself until the ridges stop running and start folding. Both ship at zero, which is the plainest and quietest version of this map — smooth domes, no drainage, nothing competing with the lines themselves. Raise either and the country starts having an opinion about which way the water runs.

The lines are found by marching squares. The field is sampled onto a grid, and every cell of that grid is compared against each height that passes through it: a cell with two corners above the line and two below has the line crossing two of its edges, and where it crosses is worked out by interpolating between the corner heights. That gives a heap of disconnected two-point fragments, which are then chained back into the curves they belong to — each crossing sits on one grid edge, and an edge is shared by exactly two cells, so the fragments join without any guessing about which end meets which — and drawn as a smooth curve through the crossings rather than as a run of straight hops between them.

Chaining is what makes **resolution** a fair control rather than a tax. Drawn fragment by fragment, the only route to a smooth curve is a finer grid, and the grid is the one thing a render actually costs. Interpolated, a coarse grid gives a curve just as smooth; what it costs instead is memory of small things, so islands vanish and narrow inlets round off before anything ever looks angular. The default sits where the small islands survive.

Two cases are genuinely ambiguous: a cell with high corners diagonally opposite each other is either a saddle or a pinch, and the crossings alone cannot say which. Taking the average of the four corners settles it, and the difference is visible — guess wrong and contours join across a pass that should divide them, which is the difference between two hills and one lumpy one.

**Elevation tint** is the layer wash a printed atlas puts under its contours — lowland one shade, high ground another — and it answers a question the lines cannot. Contour spacing tells you how steep somewhere is, but reading height off it means counting rings inward from a number you have to find first; a wash tells you at a glance. Its interval is deliberately much coarser than the contour interval, and derived rather than set: about six steps whatever the line count, always a whole number of contour intervals, so every boundary in the wash is a line the map already draws. That is not only cartographic tidiness — tinting a band per contour turns out to be unaffordable, because at ordinary settings the height changes by about one band across a single grid cell, so there is no flat interior anywhere to fill cheaply.

The interval a contour map can carry is not a free choice, and the render treats it as one it has to earn. Line density is how the map says "steep", so a steep enough slope at a fine enough interval runs its lines together into a solid mass \u2014 ask for sixty lines and the most interesting ground comes back as a blob. Two things happen where that threatens. The stroke thins to the gap available rather than the gap having to accommodate the stroke, which answers a heavy pen; and where no width would help, the interval itself doubles, and doubles again to the index contours, exactly as a printed sheet drops intermediate lines off a scarp and keeps the ones the eye counts by. Where there is room, neither happens and the line count you asked for is the line count you get.

The same rule runs the other way. Flat country is the one place a contour map has nothing to say — the lines are simply far apart, and the reader gets an expanse of blank paper over ground that may well be doing something. **Supplementary lines** are the printed answer: an extra contour at half the interval, drawn only where there is room for it and dashed so it cannot be mistaken for part of the real one. Between the two, the interval the map carries stops being a number you set and becomes one the terrain answers.

**Depression ticks** settle the one ambiguity a contour map has. A closed ring is the same mark around a summit and around a hollow, and nothing in the line says which it is; the convention that separates them is a row of short ticks on the downhill side, pointing into the basin. Here every closed contour is asked which way its own interior falls, and the ones enclosing low ground get ticked, so craters, sinks and dry lake beds stop reading as hills. Below sea level they are left off — a basin already under water has a shoreline to explain it.

**Index contours** are the cartographer's convention of drawing every fifth line heavier, and they are the reason a real map reads as height rather than as pattern: the eye counts the bold lines and gets elevation for free, where a field of identical lines only gives shape.
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

/**
 * Width buckets for the crowding thinner. A stroke width belongs to an
 * element, so a contour can only be drawn at one width; quantising to a few
 * steps keeps the group count proportional to the line count while still
 * reading as a continuous taper.
 */
const WIDTH_STEPS = 6;

/**
 * How many stroke widths of paper a contour wants between itself and its
 * neighbour before the interval is left alone. Below this the lines are
 * decimated rather than merely thinned, because past a point no width helps:
 * sixteen lines through sixteen pixels is a solid block at any weight.
 */
const ROOM_WANTED = 3;

/**
 * How empty the map has to be before a half-interval line is drawn into it,
 * as a multiple of the stroke width. The control slides between the two: at
 * its lowest only the emptiest ground gets one, at its highest most open
 * ground does.
 */
const SUPP_AT_MOST = 34;
const SUPP_AT_LEAST = 9;

/** Offsets so the two warp fields are different slices of the same noise. */
const WARP_X = 11.3;
const WARP_Y = -7.1;

export const contours: Generator = {
  id: 'contours',
  name: 'Contours',
  tagline: 'A landscape nobody surveyed, read from above.',
  tags: ['noise', 'organic'],
  description,
  /**
   * The shipped defaults moved, and the numbers in this file did not.
   *
   * Measurements in the comments below that say "at the defaults" or "the
   * default terrain" were taken against the previous set — levels 14, scale
   * 1.5, detail 3, resolution 90, weight 1, index every 5, colour spread 0.75,
   * grain 0.25, incision 0.2, sea level 0.32, elevation tint 0.65,
   * supplementary 0.5. They are still the right measurements for the claims
   * they support; they are simply no longer a description of what a fresh
   * render looks like.
   *
   * Three tests in `contours.test.ts` read their terrain from `defaultParams`
   * and broke on this, which is what `CALIBRATED` in that file exists to stop
   * happening again. The movers were not the ones anyone would guess: index
   * contours going from every fifth line to every second, and weight dropping
   * to its minimum, which leaves more room and so more supplementary lines.
   */
  params: [
    { key: 'levels', label: 'Contour lines', type: 'number', min: 6, max: 60, step: 1, default: 8, description: 'How many heights get a line. Every one of them lands inside the terrain, because the field is stretched to the relief actually present before any height is asked of it. More lines read as steeper country, since a contour map shows slope as line density.' },
    { key: 'scale', label: 'Terrain scale', type: 'number', min: 0.6, max: 4, step: 0.1, default: 2, description: 'How far back you are standing. Low values give two or three broad massifs across the width; high values an archipelago of small islands.' },
    { key: 'detail', label: 'Detail', type: 'number', min: 1, max: 5, step: 1, default: 2, description: 'Octaves of noise. One gives smooth domes; each one after roughens the coastline without moving the mountains.' },
    { key: 'resolution', label: 'Resolution', type: 'number', min: 40, max: 220, step: 10, default: 100, description: 'The sampling grid the lines are traced on. Since the crossings are chained and smoothed, low values do not make the curves angular \u2014 they make the map forget small things, dropping islands and rounding off narrow inlets. This is what a render costs, so it is the knob to reach for if the preview feels slow.' },
    { key: 'weight', label: 'Line weight', type: 'number', min: 0.3, max: 2, step: 0.05, default: 0.3, description: 'Line width, scaled to the canvas so it looks the same at any export size.' },
    { key: 'indexEvery', label: 'Index contours', type: 'number', min: 0, max: 10, step: 1, default: 2, description: 'Draw every nth line heavier, the way a printed map does, so the eye can count elevation instead of only reading shape. Zero draws every line the same.' },
    { key: 'colorSpread', label: 'Colour spread', type: 'number', min: 0, max: 1, step: 0.01, default: 0.35, description: 'How much of the accent ramp the elevation walks through. At zero every line is the middle of the palette; at one the lowest contour and the highest sit at opposite ends of it.' },
    { key: 'grain', label: 'Grain', type: 'number', min: 0, max: 0.25, step: 0.01, default: 0, description: 'Gives the country a direction. At zero every hill is a rounded blob, because plain noise has no orientation and the contours come out as splodges; raising it drags the field through itself so ridges run, valleys branch and the whole map acquires the flow of somewhere real.' },
    { key: 'incision', label: 'Valley incision', type: 'number', min: 0, max: 0.2, step: 0.01, default: 0, description: 'Cuts the valleys rather than rounding them. Blends in ridged noise, which creases where plain noise would dome, so contours kink sharply along the lines water would take \u2014 the V pointing upstream that gives a printed sheet away as terrain and not decoration.' },
    { key: 'seaLevel', label: 'Sea level', type: 'number', min: 0, max: 0.75, step: 0.01, default: 0, description: 'Floods the land below a chosen height. The coastline is a contour like any other \u2014 the level snaps to the nearest one, because a shoreline that ran between two contours would be the only line on the map not answering the same question as the rest. At zero there is no water, which is a different and drier kind of country.' },
    { key: 'elevationTint', label: 'Elevation tint', type: 'number', min: 0, max: 1, step: 0.01, default: 0, description: 'Paints each band between two contours in its own shade, the way a printed atlas washes lowland green and high ground brown. The lines give you slope through their spacing; the tint gives you height at a glance, without having to count them. Kept well short of full strength on purpose \u2014 a map in saturated bands stops being a map and becomes a poster.' },
    { key: 'hachures', label: 'Depression ticks', type: 'number', min: 0, max: 1, step: 0.01, default: 0.6, description: 'A ring of contour is the same line whether it encircles a summit or a hollow, and nothing about the line says which \u2014 on a printed sheet the difference is carried by short ticks drawn on the downhill side, pointing into the basin. Here they are added to every closed contour whose interior is lower than the line itself, so craters, sinks and dry lake beds stop reading as hills. Above the sea only: a basin already under water has a shoreline to explain it.' },
    { key: 'supplementary', label: 'Supplementary lines', type: 'number', min: 0, max: 1, step: 0.01, default: 0.4, description: 'Draws a dashed line at half the contour interval wherever the map has room for it. Flat country is the one place a contour map says nothing \u2014 the lines are simply far apart \u2014 and the printed answer is an extra line between them, dashed so it cannot be mistaken for the real interval. It is the same rule as the thinning and dropping on steep ground, read from the other end: the interval follows the terrain. At zero the map keeps one interval everywhere.' },
  ],

  /**
   * Terrain scale across, detail down.
   *
   * Scale is how much ground the frame covers — a single hill or a whole
   * range — and detail is how many octaves of noise are folded in, so one
   * moves the camera and the other decides how rough the country is. Between
   * them they reach every map this generator can draw.
   *
   * Contour lines was the obvious third and it loses to detail on the same
   * argument the arcs' `weight` lost on: past a point it stops being the
   * lever. Crowding sixty lines through a slope makes a solid mass, and what
   * fixes that is the interval, which is what a printed sheet changes too.
   *
   * Detail has four steps across the whole travel, which is coarse for a
   * scrub and is the honest range of the control — an octave is not a
   * quantity you tune, it is a choice between five terrains.
   */
  primary: { x: 'scale', y: 'detail' },

  render(ctx: RenderContext): string {
    const { width: w, height: h, palette, params, rng } = ctx;
    const noise = createNoise2D(rng);

    const levels = Math.max(2, Math.round(pNum(params, 'levels', 14)));
    const scale = pNum(params, 'scale', 1.5);
    const detail = Math.max(1, Math.round(pNum(params, 'detail', 3)));
    const indexEvery = Math.max(0, Math.round(pNum(params, 'indexEvery', 5)));
    const colorSpread = clamp(pNum(params, 'colorSpread', 0.75), 0, 1);
    const weight = pNum(params, 'weight', 1);
    const grain = clamp(pNum(params, 'grain', 0.45), 0, 1);
    const incision = clamp(pNum(params, 'incision', 0.22), 0, 1);
    // Snapped to a contour: the shoreline is then a line the map already draws,
    // and the fill beneath it ends exactly where that line runs.
    const elevationTint = clamp(pNum(params, 'elevationTint', 0.65), 0, 1);
    const hachures = clamp(pNum(params, 'hachures', 0.6), 0, 1);
    const supplementary = clamp(pNum(params, 'supplementary', 0.5), 0, 1);

    // Sub-levels. With supplementary lines switched on the field is traced at
    // twice the contour interval and every second sub-level is a candidate for
    // a dashed half-interval line; with them off nothing extra is traced, and
    // the render costs exactly what it did. `k` counts sub-levels throughout,
    // `k / sub` is the contour level it belongs to.
    const sub = supplementary > 0 ? 2 : 1;
    const steps = levels * sub;
    // The wash interval is derived, not set, and it is a whole number of
    // contour intervals so every wash boundary is a line the map already draws.
    //
    // Six steps, near enough, whatever the line count -- the same reasoning as
    // COLOR_STEPS: the palette should walk the elevation at one rate whether
    // there are eight contours or sixty. Tying it to the index contours instead
    // was tried and reads better on paper than on a phone: at the default
    // fourteen lines every fifth, it gives three bands, and one of them covers
    // most of the canvas, so the wash is invisible where it is not steep.
    const washEvery = Math.max(1, Math.round(levels / 6));
    const washSteps = Math.ceil(levels / washEvery);
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
        field[j * (cols + 1) + i] =
          incision > 0 ? domed * (1 - incision) + noise.ridged(sx, sy, detail) * incision : domed;
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
    const touched: number[][] = Array.from({ length: steps }, () => []);

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
        let first = Math.floor(lo * steps) + 1;
        if (first < 1) first = 1;
        const last = Math.min(steps - 1, Math.floor(hi * steps));
        if (last < first) continue;

        const tE = j * cols + i;
        const bE = (j + 1) * cols + i;
        const lE = HCOUNT + j * (cols + 1) + i;
        const rE = lE + 1;

        for (let L = first; L <= last; L++) {
          const iso = L / steps;
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

    /**
     * The field at an arbitrary point, between grid samples.
     *
     * Only the hachures need this — everything else reads corners directly —
     * but they need it off the grid, a fraction of a cell to one side of a
     * traced curve. Bilinear rather than nearest, because a whole cell of
     * rounding at that distance would often land the probe back on the line it
     * was measuring away from.
     */
    const sampleField = (x: number, y: number): number => {
      const gx = clamp(x / cw, 0, cols);
      const gy = clamp(y / ch, 0, rows);
      const i0 = Math.min(cols - 1, Math.floor(gx));
      const j0 = Math.min(rows - 1, Math.floor(gy));
      const fx = gx - i0;
      const fy = gy - j0;
      const r0 = j0 * (cols + 1) + i0;
      const r1 = r0 + cols + 1;
      return (
        (field[r0] as number) * (1 - fx) * (1 - fy) +
        (field[r0 + 1] as number) * fx * (1 - fy) +
        (field[r1] as number) * (1 - fx) * fy +
        (field[r1 + 1] as number) * fx * fy
      );
    };

    /**
     * How far apart the contours are at a point, in canvas units.
     *
     * A contour map already says how steep somewhere is through how close its
     * lines run, so that distance is a quantity the render can read off rather
     * than guess at: a height interval of 1/levels divided by the slope gives
     * the gap to the next line. The slope is a central difference on the grid,
     * in field units per pixel, so the gap comes out in pixels and scales with
     * the canvas exactly as the rest of the geometry does.
     */
    const gapAt = (x: number, y: number): number => {
      const dx = (sampleField(x + cw, y) - sampleField(x - cw, y)) / (2 * cw);
      const dy = (sampleField(x, y + ch) - sampleField(x, y - ch)) / (2 * ch);
      const slope = Math.hypot(dx, dy);
      return slope > 1e-9 ? 1 / levels / slope : Infinity;
    };

    // A tick every this many cells along the ring, and this long. Both in cell
    // widths rather than pixels, so a thumbnail and an export tick at the same
    // density — the grid is keyed on the column count, so a cell is the same
    // fraction of the canvas at any size.
    const cell = Math.min(cw, ch);
    const tickGap = cell * 2.6;
    const tickLen = cell * 1.15 * hachures;
    const probe = cell * 0.75;

    const hachurePaths: string[] = new Array(steps).fill('');

    /**
     * Ticks on the downhill side of a closed contour, if that side is inside.
     *
     * A ring is the same mark around a summit and around a hollow; the
     * convention that separates them is a short tick into the low ground. So
     * the test is literally that: step a fraction of a cell off the curve
     * toward its interior and ask the field whether it is lower there.
     *
     * Which way is inward comes from the ring's own winding rather than from a
     * centroid, because a contour is rarely convex — a centroid falls outside
     * any ring shaped like a horseshoe, and the sign it gives is then simply
     * wrong. The shoelace sign says which way the walk goes around, and the
     * quarter turn that points into the polygon follows from it. The reading is
     * taken at several points and voted on, since one probe on a narrow neck
     * can cross the ring and sample the far side.
     */
    const hachuresFor = (pts: [number, number][], iso: number): string => {
      const n = pts.length;
      let area2 = 0;
      for (let k = 0; k < n; k++) {
        const [x1, y1] = pts[k] as [number, number];
        const [x2, y2] = pts[(k + 1) % n] as [number, number];
        area2 += x1 * y2 - x2 * y1;
      }
      const orient = area2 > 0 ? 1 : -1;

      // Unit inward normal at k, from a central difference so it follows the
      // curve rather than one segment of it.
      const inward = (k: number): [number, number] => {
        const [px, py] = pts[(k - 1 + n) % n] as [number, number];
        const [qx, qy] = pts[(k + 1) % n] as [number, number];
        const tx = qx - px;
        const ty = qy - py;
        const len = Math.hypot(tx, ty) || 1e-9;
        return [(orient * -ty) / len, (orient * tx) / len];
      };

      /**
       * Is this point enclosed by the ring? Even-odd, against the ring's own
       * crossings.
       *
       * The field check below asks whether a tick ends on lower ground, which
       * is the claim a hachure makes about height. It is not the whole claim:
       * a tick also says "the basin is this way", and near a col the ground
       * immediately *outside* a ring can be lower than the ring as well, so a
       * normal that has flipped at a kink can point outward and still pass a
       * height test. Measured on the default terrain, two ticks in 117 did
       * exactly that. The two checks answer different halves of the same
       * sentence and both are cheap, so both are made.
       */
      const encloses = (px2: number, py2: number): boolean => {
        let hit = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const [xi, yi] = pts[i] as [number, number];
          const [xj, yj] = pts[j] as [number, number];
          if (yi > py2 !== yj > py2 && px2 < ((xj - xi) * (py2 - yi)) / (yj - yi || 1e-9) + xi) hit = !hit;
        }
        return hit;
      };

      // Twelve probes, and a majority decides whether this ring is a hollow at
      // all. It is now an optimisation rather than a correctness check, and the
      // distinction is worth stating because it used to be the other way round.
      //
      // Before the row rule at the bottom of this function existed, dropping
      // this vote let summit rings pick up two or three stray ticks apiece,
      // which is exactly the error the convention exists to prevent. The row
      // rule now catches those, and it catches them by asking the question at
      // the row instead of at twelve samples of it. Measured with the vote
      // deleted, across five seeds at two settings, the emitted ticks are
      // identical — so nothing downstream depends on it, and no test
      // distinguishes it. It stays because it is twelve field lookups that
      // save a perimeter walk and a full tick pass on every ring that is
      // plainly a hill, which is most of them.
      let low = 0;
      let votes = 0;
      const stride = Math.max(1, Math.floor(n / 12));
      for (let k = 0; k < n; k += stride) {
        const [px, py] = pts[k] as [number, number];
        const [nx, ny] = inward(k);
        if (sampleField(px + nx * probe, py + ny * probe) < iso) low += 1;
        votes += 1;
      }
      if (votes === 0 || low * 2 <= votes) return '';

      // A tick must not cross its own basin and come out the far side, which a
      // fixed length does on any ring narrower than it — and rings that narrow
      // are common, since a long thin hollow has plenty of crossings without
      // ever being wide. Area over perimeter is the half width of a long thin
      // shape and the radius over two of a round one, so twice it is the room
      // available in the worst direction; the tick takes most of that or its
      // nominal length, whichever is less.
      let perim = 0;
      for (let k = 0; k < n; k++) {
        const [x1, y1] = pts[k] as [number, number];
        const [x2, y2] = pts[(k + 1) % n] as [number, number];
        perim += Math.hypot(x2 - x1, y2 - y1);
      }
      const room = perim > 0 ? (Math.abs(area2) / perim) * 1.7 : tickLen;
      const reach = Math.min(tickLen, room);

      let d = '';
      let drawn = 0;
      let carried = tickGap;
      for (let k = 0; k < n; k++) {
        const [px, py] = pts[k] as [number, number];
        const [qx, qy] = pts[(k + 1) % n] as [number, number];
        carried += Math.hypot(qx - px, qy - py);
        if (carried < tickGap) continue;
        const [nx, ny] = inward(k);
        const ex = px + nx * reach;
        const ey = py + ny * reach;
        // Every tick is checked against the field before it is drawn, rather
        // than trusted to the winding. The claim a hachure makes is that it
        // points downhill, so that is what gets asserted, one mark at a time.
        // The winding is right about the ring as a whole and wrong here and
        // there along it: at a tight kink — and incised country is full of
        // them — the chord between a point's neighbours can run backwards
        // against the local tangent and take the normal with it. Measured, two
        // ticks in forty-four came out pointing uphill; they are now simply not
        // drawn, which costs a gap in one row of ticks and nothing else.
        //
        // And against the ring as well as the field, for the reason given on
        // `encloses`: downhill and inward are two claims rather than one, and a
        // flipped normal that happens to find lower ground outside the ring
        // passes the first while failing the second.
        if (sampleField(ex, ey) >= iso || !encloses(ex, ey)) continue;
        carried = 0;
        drawn += 1;
        d += `M${num(px, 2)} ${num(py, 2)}L${num(ex, 2)} ${num(ey, 2)}`;
      }

      // The row, or nothing. A hachured contour is a row of ticks all the way
      // round, and a ring carrying one or two is not a ticked hollow — it is a
      // speck, and it reads as dirt on the map rather than as a convention.
      //
      // The two per-tick checks above are what make this necessary: on a small
      // ring in rough country most of a row can fail them, leaving a single
      // mark behind that claims a basin the rest of the ring would not support.
      // Measured over the default terrain, the split is clean rather than a
      // judgement call — every ring that is genuinely a hollow fills 0.70 to
      // 1.04 of the slots its perimeter has room for, and the one ring this
      // drops fills 0.28. The bound sits in the gap.
      return drawn >= Math.max(2, (perim / tickGap) * 0.5) ? d : '';
    };

    const traceFrom = (start: number, L: number): string => {
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
      // Ticks go on rings above the water, and only on rings with room for
      // them: a hollow four crossings across is a rounding artefact of the
      // grid, and ticking it just speckles the map.
      if (ring && hachures > 0 && L % sub === 0 && L / sub > seaIndex && chain.length >= 10) {
        hachurePaths[L] += hachuresFor(pts, L / steps);
      }
      lastGap = gapOf(pts);
      return smoothPath(pts, 1, 1, ring);
    };

    /**
     * The gap a whole contour has to live in, taken low rather than average.
     *
     * A line that is crowded along a quarter of its length has to be drawn for
     * that quarter, or it merges there — and a mean is exactly the statistic
     * that hides it, since the roomy three quarters pull it up. The quartile is
     * cheap and says what is needed: a line crowded anywhere much is a thin
     * line.
     */
    const gapOf = (pts: [number, number][]): number => {
      const gaps: number[] = [];
      const stride = Math.max(1, Math.floor(pts.length / 24));
      for (let k = 0; k < pts.length; k += stride) {
        const [x, y] = pts[k] as [number, number];
        gaps.push(gapAt(x, y));
      }
      gaps.sort((a, b) => a - b);
      return gaps[Math.floor(gaps.length * 0.25)] ?? Infinity;
    };

    let lastGap = Infinity;

    // Contours are grouped by level and by how much room they have, because a
    // stroke width is an attribute of an element and cannot vary along a path.
    // Six buckets: enough that the thinning reads as continuous, few enough
    // that the group count stays in proportion to the line count.
    const paths: string[][] = Array.from({ length: steps }, () => new Array(WIDTH_STEPS).fill(''));
    // Supplementary lines are one path per sub-level: they are all drawn at one
    // width, because the test that lets them exist at all is that there is
    // room for them.
    const extra: string[] = new Array(steps).fill('');
    for (let k = 1; k < steps; k++) {
      const ids = touched[k] as number[];
      if (ids.length === 0) continue;
      const isMain = k % sub === 0;
      const L = k / sub;
      const take = (id: number): void => {
        const d = traceFrom(id, k);
        if (!d) return;
        const stroke = minDim * 0.0022 * weight;
        const ratio = lastGap / stroke;
        if (!isMain) {
          // A half-interval line goes in where the full interval has left the
          // map empty, and nowhere else. `lastGap` is the gap between the full
          // contours either side of it, so halving it is what this line is
          // about to do; the test is that what remains is still several times
          // the room a line needs, scaled by how much of it the reader asked
          // for. Measured at the defaults the chain ratios run 5.1 at the
          // tightest to 32 at the ninetieth percentile, so this reaches a
          // quarter of the map at the low end of the control and most of the
          // open ground at the high end.
          if (ratio < SUPP_AT_MOST - (SUPP_AT_MOST - SUPP_AT_LEAST) * supplementary) return;
          extra[k] += d;
          return;
        }
        // Two answers to crowding, because they answer different causes.
        //
        // The stroke first thins to the gap rather than the gap accommodating
        // the stroke, which is the rule the truchet arcs settled on and is what
        // a heavy weight setting needs: at sixty lines and weight 3 it takes
        // the mean ink from 0.45 to 0.23.
        //
        // Past a point, though, width is the wrong lever entirely. Sixteen
        // lines through sixteen pixels is a solid block whatever they are drawn
        // at, and that is what asking for sixty contours across a scarp means.
        // A printed map answers by changing the interval, not the pen: steep
        // ground carries fewer contours, and the ones it keeps are the index
        // lines the eye counts by. So where there is not room for every line,
        // this keeps every second one, and where there is not room for those
        // either, only the index contours. Measured at sixty levels, mean ink
        // falls from 0.175 to 0.102 and the worst window from 0.506 to 0.270,
        // while the default render is pixel for pixel what it was — there is
        // room at fourteen lines, so nothing is dropped and nothing thins.
        const decimated = indexEvery > 0 ? indexEvery : 4;
        const keepEvery = ratio >= ROOM_WANTED ? 1 : ratio * 2 >= ROOM_WANTED ? 2 : decimated;
        if (keepEvery > 1 && L % keepEvery !== 0) return;
        const f = Math.max(1 / WIDTH_STEPS, Math.min(1, ratio * 0.5));
        const bucket = Math.max(0, Math.min(WIDTH_STEPS - 1, Math.round(f * WIDTH_STEPS) - 1));
        (paths[k] as string[])[bucket] += d;
      };
      for (const id of ids) if (seen[id] === 0 && sb[id] === -1) take(id);
      for (const id of ids) if (seen[id] === 0) take(id);
    }

    // Everything below a given height, as a fill.
    //
    // Used twice: once for the sea, and once per band for the elevation tint.
    // Filled cell by cell rather than by closing the contour rings into
    // polygons -- a contour that runs off the canvas is not a closed ring, so
    // filling from the rings would need the open ones stitched together along
    // the border, real work for a boundary the stroke then covers anyway.
    // Walking each cell's edges in order and collecting the corners below the
    // line, plus the crossings, gives the same region to within a stroke width.
    //
    // The two diagonal cases come out as a bowtie, since the region there is
    // two opposite corners the walk joins into one loop. They are a fraction of
    // a percent of cells and both lobes still fill.
    //
    // Runs of wholly submerged cells merge along the row into one rectangle.
    // Only the cells the boundary actually crosses need their own polygon, and
    // open water is most of the water: at a high sea level the per-cell version
    // spent 600kB of path data drawing the same rectangle forty times in a row,
    // which the preview renders synchronously on the main thread. The merge is
    // exact -- adjacent full cells share an edge -- and it is what makes the
    // tint affordable at all, since that asks for this fill once per band.
    const fillBelow = (iso: number): string => {
      let d = '';
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
          d += `M${rx0} ${ry0}L${rx1} ${ry0}L${rx1} ${ry1}L${rx0} ${ry1}Z`;
          runFrom = -1;
        };
        for (let i = 0; i < cols; i++) {
          const a = field[rowA + i] as number;
          const b = field[rowA + i + 1] as number;
          const c = field[rowB + i + 1] as number;
          const e = field[rowB + i] as number;
          const A = a > iso;
          const B = b > iso;
          const C = c > iso;
          const E = e > iso;
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
          if (A !== B) at(x0 + cw * ((iso - a) / (b - a || 1e-9)), y0);
          if (!B) at(x1, y0);
          if (B !== C) at(x1, y0 + ch * ((iso - b) / (c - b || 1e-9)));
          if (!C) at(x1, y1);
          if (C !== E) at(x0 + cw * ((iso - e) / (c - e || 1e-9)), y1);
          if (!E) at(x0, y1);
          if (E !== A) at(x0, y0 + ch * ((iso - a) / (e - a || 1e-9)));
          if (pts.length >= 3) d += `M${pts.join('L')}Z`;
        }
        flush(cols);
      }
      return d;
    };

    const water = seaIndex > 0 ? fillBelow(seaIndex / levels) : '';

    const bg = hexToOklch(palette.background);

    /**
     * The wash for one elevation band.
     *
     * Hue walks the same ramp the contour lines walk, quantised the same way,
     * so a band and the line bounding it are never a step apart. What carries
     * the height, though, is lightness rather than hue: mixing a near-black
     * background with an accent at a constant strength leaves every low band
     * indistinguishable from every other and from the paper, which is what the
     * first version of this did — 434kB of fill that could not be seen. The
     * mix deepens with height and the result is pushed away from the
     * background's own lightness, up on a dark palette and down on a light one,
     * so the ramp reads as relief in the way a printed atlas does.
     */
    const tintFor = (k: number): string => {
      const f = washSteps > 1 ? k / (washSteps - 1) : 0;
      const t = clamp(0.5 + ((k + 0.5) / washSteps - 0.5) * colorSpread, 0, 1);
      const step = Math.round(t * (COLOR_STEPS - 1)) / (COLOR_STEPS - 1);
      const mixed = mixOklch(bg, hexToOklch(accentAt(palette, step)), elevationTint * (0.06 + 0.3 * f));
      const lift = elevationTint * 0.16 * f;
      return oklchToHex({ ...mixed, l: clamp(mixed.l + (palette.mode === 'dark' ? lift : -lift), 0, 1) });
    };

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

    // Elevation tint: the ground between two heights washed in its own shade.
    //
    // The wash is deliberately far coarser than the contour interval, and that
    // is the whole of what makes it affordable. Two versions of this were
    // written on the assumption that a band per contour was the thing to build,
    // and the arithmetic says it never was. At fourteen levels on a ninety
    // column grid the bands are 0.071 of the field apart, which is about what
    // the field moves across one cell, so essentially every cell spans a
    // boundary: measured, 16,438 of 17,550 cells. There is no interior left to
    // merge into runs and no version of a per-cell fill that is cheap. The
    // first attempt -- nested sub-level fills, each band repainting the ground
    // beneath it -- came to 692kB at the defaults and 7.1MB at sixty levels;
    // classifying cells instead made it 995kB, because the optimisation had
    // nothing to work on.
    //
    // A printed atlas does not tint per contour either. The layer tint has its
    // own, much coarser interval, and it changes on the index contours -- the
    // bold ones -- so the wash boundary is always a line the map already draws
    // heavier. Keying it there gives the cartography and the cost at once: the
    // bands are wide enough that most cells sit wholly inside one, the runs
    // merge along the row, and only the cells an index contour crosses need a
    // polygon.
    //
    // Within such a cell the nesting still does the work: its own rectangle in
    // the colour of the highest band it touches, then one sub-level polygon per
    // boundary crossing it, each landing in a band painted later. Bands are
    // emitted top down so that order holds.
    if (elevationTint > 0 && washSteps > 1) {
      const bandOf = (v: number): number =>
        Math.min(washSteps - 1, Math.max(0, Math.floor((v * levels) / washEvery)));
      const bandPaths: string[] = new Array(washSteps).fill('');
      for (let j = 0; j < rows; j++) {
        const y0 = j * ch;
        const y1 = y0 + ch;
        const rowA = j * (cols + 1);
        const rowB = (j + 1) * (cols + 1);
        let runBand = -1;
        let runFrom = 0;
        const flush = (until: number): void => {
          if (runBand < 0) return;
          const rx0 = num(runFrom * cw, 1);
          const rx1 = num(until * cw, 1);
          const ry0 = num(y0, 1);
          const ry1 = num(y1, 1);
          bandPaths[runBand] += `M${rx0} ${ry0}L${rx1} ${ry0}L${rx1} ${ry1}L${rx0} ${ry1}Z`;
          runBand = -1;
        };
        for (let i = 0; i < cols; i++) {
          const a = field[rowA + i] as number;
          const b = field[rowA + i + 1] as number;
          const c = field[rowB + i + 1] as number;
          const e = field[rowB + i] as number;
          const hiBand = bandOf(Math.max(a, b, c, e));
          const loBand = bandOf(Math.min(a, b, c, e));
          // Every cell joins the run for the highest band it touches, straddled
          // or not. For a cell wholly inside a band that is the whole story;
          // for a straddled one it lays down the base the sub-level polygons
          // below then paint over, which is the same rectangle the cell would
          // have emitted on its own — except that it merges with its
          // neighbours instead of costing a subpath each.
          if (runBand !== hiBand) {
            flush(i);
            runBand = hiBand;
            runFrom = i;
          }
          if (hiBand === loBand) continue;
          const x0 = i * cw;
          const x1 = x0 + cw;
          for (let k = hiBand; k > loBand; k--) {
            const iso = (k * washEvery) / levels;
            const A = a > iso;
            const B = b > iso;
            const C = c > iso;
            const E = e > iso;
            if (A && B && C && E) continue;
            const pts: string[] = [];
            const at = (x: number, y: number): void => {
              pts.push(`${num(x, 1)} ${num(y, 1)}`);
            };
            if (!A) at(x0, y0);
            if (A !== B) at(x0 + cw * ((iso - a) / (b - a || 1e-9)), y0);
            if (!B) at(x1, y0);
            if (B !== C) at(x1, y0 + ch * ((iso - b) / (c - b || 1e-9)));
            if (!C) at(x1, y1);
            if (C !== E) at(x0 + cw * ((iso - e) / (c - e || 1e-9)), y1);
            if (!E) at(x0, y1);
            if (E !== A) at(x0, y0 + ch * ((iso - a) / (e - a || 1e-9)));
            if (pts.length >= 3) bandPaths[k - 1] += `M${pts.join('L')}Z`;
          }
        }
        flush(cols);
      }
      for (let k = washSteps - 1; k >= 0; k--) {
        const d = bandPaths[k] as string;
        if (!d) continue;
        body += el('path', { d, fill: tintFor(k), stroke: 'none' });
      }
    }

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
    for (let k = 1; k < steps; k++) {
      // Supplementary lines go down first and lightly: half the interval,
      // dashed so they cannot be counted as part of it, and thinner. A printed
      // sheet distinguishes them exactly this way, and it matters here for the
      // same reason — a reader counting index contours must not pick one up.
      const supp = extra[k] as string;
      if (supp) {
        const ts = clamp(0.5 + (k / steps - 0.5) * colorSpread, 0, 1);
        const ss = Math.round(ts * (COLOR_STEPS - 1)) / (COLOR_STEPS - 1);
        body += el(
          'g',
          {
            fill: 'none',
            stroke: accentAt(palette, ss),
            'stroke-width': num(base * 0.7, 2),
            'stroke-linecap': 'butt',
            'stroke-dasharray': `${num(cell * 0.8, 2)} ${num(cell * 0.7, 2)}`,
            'stroke-opacity': '0.55',
          },
          el('path', { d: supp }),
        );
      }
      if (k % sub !== 0) continue;
      const L = k / sub;
      const buckets = paths[k] as string[];
      const ticks = hachurePaths[k] as string;
      if (buckets.every((d) => !d) && !ticks) continue;
      // Elevation walks the ramp. Quantising it to a fixed number of steps
      // rather than to the line count keeps the palette moving at the same
      // rate whether there are eight contours or sixty.
      const t = clamp(0.5 + (L / levels - 0.5) * colorSpread, 0, 1);
      const step = Math.round(t * (COLOR_STEPS - 1)) / (COLOR_STEPS - 1);
      const isIndex = indexEvery > 0 && L % indexEvery === 0;
      // The shoreline is the one line on the map that separates two kinds of
      // place rather than two heights, so it carries more weight than even an
      // index contour.
      const isCoast = L === seaIndex;
      const full = isCoast ? base * 3.2 : isIndex ? base * 2.1 : base;
      // One group per level, one path per width. The stroke width sits on the
      // path rather than on the group because a level is one thing — one
      // colour, one opacity, one line on the legend — that happens to be drawn
      // at several widths where the ground crowds it. Splitting a level into
      // several groups instead says there are more contours than there are, to
      // a reader and to a test alike.
      let inner = '';
      for (let b = 0; b < WIDTH_STEPS; b++) {
        const d = buckets[b] as string;
        if (!d) continue;
        // An index contour keeps its extra weight as a multiple of whatever the
        // crowding allows rather than in spite of it. It has to stay heavier
        // than its neighbours even where all of them are thin, and drawing it
        // at full width through a crowded slope just puts the blob back.
        inner += el('path', { d, 'stroke-width': num((full * (b + 1)) / WIDTH_STEPS, 2) });
      }
      if (inner) {
        body += el(
          'g',
          {
            fill: 'none',
            stroke: accentAt(palette, step),
            'stroke-linecap': 'round',
            'stroke-opacity': isCoast || isIndex ? '1' : '0.82',
          },
          inner,
        );
      }
      // The ticks are the same ink as the contour they belong to, because on a
      // sheet they are part of that line rather than an annotation of it. Their
      // own group only because they are drawn butt-ended and a shade finer: a
      // round cap on a mark this short is most of the mark.
      if (ticks) {
        body += el(
          'g',
          {
            fill: 'none',
            stroke: accentAt(palette, step),
            'stroke-width': num(base * 0.85, 2),
            'stroke-linecap': 'butt',
            'stroke-opacity': '0.82',
          },
          el('path', { d: ticks }),
        );
      }
    }

    return svgRoot(w, h, `${contours.name} wallpaper`, body);
  },
};
