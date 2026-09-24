import { accentAt, accentRamp } from '../palette.js';
import { hexToOklch, mixOklch, oklchToHex } from '../color.js';
import { createNoise2D } from '../noise.js';
import { clamp } from '../geometry.js';
import { el, num, svgRoot } from '../svg.js';
import { pNum, pStr, type Generator, type ParamSpec, type RenderContext } from '../types.js';

const arcsDescription = `
A Truchet tile is a square with an asymmetric mark on it — Sébastien Truchet’s original was a square split into two triangles — and a Truchet tiling is what you get when you fill a grid with copies of that square in random rotations. The remarkable thing is how little you have to specify. One tile, four rotations and a coin flip per cell produce paths that wander across the whole grid, close into loops, and look considered in a way that no part of the rule accounts for.

This one draws **quarter arcs**: two 90° curves per cell, centred on opposite corners, joining the midpoints of the edges they touch. Every cell edge is therefore a connection point and every mark meets whatever its neighbour offers, so the tiling comes out as a tangle of closed loops. The corner is the whole trick, and it is easy to get wrong — two circles of a given radius pass through any pair of points, and centring these on the cell’s middle instead gives marks that still meet at the edges but can never curl around a grid vertex. That version looks plausible and no loop, half circle or full circle ever forms in it at any density or seed.

**Divisions** decides how much the arcs behave like a single continuous system. It replaces each quarter arc with a fan of concentric ones sharing the same corner. Because a neighbour’s fan is centred on that same physical point whenever the rotations agree, every radius in the fan meets its opposite number across the edge and the marks become nested ribbons; where the rotations disagree, the lines simply stop. Those stopped ends are the structure of the tiling rather than an effect applied to it — a rotation facing away from its neighbour terminates a path, and no probability control is needed to produce one. What makes the fan join is that its radii mirror about the half cell, not that any particular radius is present: they are spread evenly and centred there, so odd counts include the middle radius and even counts straddle it, and both mirror exactly.

Both of the cell’s marks are fanned, and the two sets stay clear of each other because the radii stop where circles centred on opposite corners would touch. Carried past that point they cross, and the result is moiré rather than pattern. **Arc spread** moves that ceiling inward, and the gap between rings is worked out from the spread and the count rather than being set independently — so every arc you ask for fits, and the stroke thins to the gap it is left rather than the gap having to accommodate the stroke.

Grid **density** interacts with everything. Below about six columns the tiles are large enough that you read each one individually and the loops are the subject; above about twenty you stop seeing tiles at all and start seeing a woven texture, at which point stroke weight matters more than anything else on the panel.
`.trim();

const diagonalsDescription = `
A Truchet tile is a square with an asymmetric mark on it, and a Truchet tiling is what you get when you fill a grid with copies of that square in random rotations. One tile, four rotations and a coin flip per cell produce paths that wander across the whole grid and look considered in a way that no part of the rule accounts for. Sébastien Truchet was cataloguing floor tiles in 1704; the arrangement outlives the tile.

This one connects **corners** rather than edge midpoints. Paths meet at the cell’s corners, which makes the tiling read as a lattice of switchbacks rather than as the loops the arcs give you — sharper, more woven, and more obviously a grid. At one division it is a maze of diagonal zigzags, and it is the tile set that survives being pushed hardest.

**Divisions** does something here that the arcs cannot quite manage. The single corner-to-corner line becomes a family of parallel chords spaced one cell width over the count — the only spacing that tiles, because it puts every crossing at a multiple of itself along each edge, and puts them there in both rotations. Where a fan only meets its neighbour when the two cells agree on a corner, every chord here finds its partner across every edge whichever way the cell beyond it happens to be turned. Past three or four the cells stop reading as cells at all and the grid becomes a woven field of chevrons and nested diamonds. The count stops at six: a family is 2n-1 chords, so six already crosses one cell with eleven lines, and past that the tiling reads as grey rather than as a pattern.

The extent of the family is not a free choice either, which is why there is no spread control here. Truncating it to the chords nearest the diagonal leaves a cell crossing its right edge near one corner and its left edge near the other, so two neighbours turned the same way miss each other entirely. The spacing that makes the family join is the spacing that fills the cell.

Colour comes from a field drifting across the canvas, and each chord is stroked with a gradient sampled along its own length rather than painted one flat colour. Sampling once per chord sounds sufficient and is not: a colour boundary could then only fall in the gap between chords, and since every chord runs at 45° the field’s contours snapped onto a lattice of parallel lines and came out as straight-edged facets. Grid **density** decides the rest — below about six columns you read individual tiles, above about twenty a woven texture.
`.trim();

type TileKind = 'arcs' | 'diagonals';

/**
 * Swells of colour across the image, in cycles. Low on purpose: the point is
 * that a region is one accent and the next region another, with the transition
 * spread across many cells instead of landing on a cell edge.
 */
const COLOR_FIELD = 1.6;

/**
 * The longest a single piece of a diagonal chord may be, as a fraction of the
 * canvas width. The colour field cycles COLOR_FIELD times across the image, so
 * this keeps one flat piece to roughly a tenth of a cycle.
 */
const MAX_SEGMENT = 0.06;

/**
 * The points a quarter arc may be cut at, as [sin, cos] of k*(90/n) degrees.
 *
 * Written out rather than computed, because this file calls no trigonometry at
 * all and that is deliberate. These coordinates do not only position a mark —
 * each piece is coloured by the field at its own midpoint, so the numbers feed
 * a *decision* about which band it lands in, and `Math.cos` and `Math.sin` are
 * both explicitly implementation-approximated where `sqrt` is not. A last-bit
 * difference between two engines would put one piece of one arc in a different
 * band, and the browser and Node would stop agreeing about the picture.
 *
 * Only counts whose angles are writable exactly enough to matter: 1, 2, 3, 4
 * and 6. Six is the ceiling, which at the coarsest grid leaves a piece
 * spanning 6.2% of the canvas against the 6% the chords hold to — near enough
 * that buying eight, and the eleven-and-a-quarter-degree table that comes with
 * it, is not worth the lines.
 */
const ARC_CUTS: Record<number, readonly (readonly [number, number])[]> = {
  1: [[0, 1], [1, 0]],
  2: [[0, 1], [0.70710678, 0.70710678], [1, 0]],
  3: [[0, 1], [0.5, 0.8660254], [0.8660254, 0.5], [1, 0]],
  4: [[0, 1], [0.38268343, 0.92387953], [0.70710678, 0.70710678], [0.92387953, 0.38268343], [1, 0]],
  6: [
    [0, 1],
    [0.25881905, 0.96592583],
    [0.5, 0.8660254],
    [0.70710678, 0.70710678],
    [0.8660254, 0.5],
    [0.96592583, 0.25881905],
    [1, 0],
  ],
};
/** Cut counts available, smallest first. */
const ARC_CUT_COUNTS = [1, 2, 3, 4, 6];



/**
 * How much of its own pitch a stroked mark may fill.
 *
 * Three versions of this have shipped and the middle one was wrong in a way
 * worth recording, because it was wrong in the opposite direction from the
 * first.
 *
 * It began as `min(weight * s, pitch * 0.68)`: a width read off the cell, then
 * limited so raising the division count could not close the rings into a
 * block. Both halves are right and together they killed the slider — above the
 * gap it asked for a stroke it could not have and got the gap, so at eight
 * columns the travel that changed anything ran 100% at one division, 29% at
 * three and 6% at twelve.
 *
 * The fix for that made the pitch the *unit* rather than the ceiling,
 * `weight / 0.414` of the gap, which does keep the whole slider live. It also
 * thinned every divided render that already existed, because the default then
 * filled 0.386 of the pitch where the old ceiling allowed 0.68. Measured on the
 * arcs at three columns and four divisions: 13.46px before, 7.65px after, and
 * 5.73 against 1.91 at a low weight. It was reported as the arcs no longer
 * being "smooth as before", which is what losing 43% of the stroke looks like.
 *
 * So keep the original shape — cell-relative, limited by the room between
 * marks — and scale the *limit* instead of reinterpreting the control. At and
 * below the default the limit is exactly the 0.68 it always was, so nothing
 * that already renders changes at all; above the default it opens toward a
 * whole pitch, which is where marks touch and read as solid, and that is the
 * headroom the upper travel needs once the limit bites.
 *
 * The general form: when a control is dead because a *constant* ceiling
 * truncates it, scale the ceiling. Reinterpreting the control moves every
 * value the control already had, which is a change to every saved render
 * rather than to the dead range you meant to fix.
 */
const WEIGHT_DEFAULT = 0.16;
const PITCH_AT_DEFAULT = 0.68;

/** The top of the weight slider, where a mark fills its pitch and marks touch. */
const WEIGHT_MAX = 0.5;



/**
 * One implementation, two patterns.
 *
 * Arcs and diagonals were a `tileSet` select on a single generator for as long
 * as this file existed, and the tap gesture cycled it. Tap now cycles the
 * *pattern*, so a select whose whole job was to be the tap has nothing left to
 * be: the two tile sets are two entries in the registry and the parameter is
 * gone. They keep sharing a render because they share almost all of it — the
 * grid, the rotation, the colour field and the stroke rule are one program
 * with a single branch in it.
 *
 * What the split buys beyond the gesture is that each one's range can be its
 * own. Divisions means n concentric rings on the arcs, where twelve is the
 * point of raising it, and 2n-1 parallel chords on the diagonals, where twelve
 * is twenty-three lines through one cell. That used to need `limits` — a
 * ceiling declared against another parameter's value, applied in a second pass
 * of `coerceParams` because it cannot be resolved until that parameter has
 * settled. Now it is a number in a spec. Nothing in the registry declares
 * `limits` any more; the machinery stays, because a mode switch with a
 * dependent range is the obvious next thing a generator will reach for, and
 * its tests run against a fabricated generator rather than this one.
 */
interface TruchetFlavour {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** The top of the divisions slider. See the note above. */
  divisionMax: number;
  divisionNote: string;
}

function makeTruchet(KIND: TileKind, flavour: TruchetFlavour): Generator {
  return {
  id: flavour.id,
  name: flavour.name,
  tagline: flavour.tagline,
  tags: ['grid'],
  description: flavour.description,
  params: [
    { key: 'density', label: 'Grid density', type: 'number', min: 3, max: 26, step: 1, default: 8, description: 'Columns across the canvas. Rows follow from the aspect ratio so cells stay square.' },
    { key: 'weight', label: 'Stroke weight', type: 'number', min: 0.02, max: 0.5, step: 0.01, default: 0.16, description: 'How much of its own share of the cell each mark fills. An undivided tile has the whole cell to itself and this is a line width; divide it and the share is the gap between one mark and the next, so the same setting keeps the same look instead of the marks thickening until they merge. Past the default they do merge, which is what reads as solid.' },
    { key: 'colorSpread', label: 'Colour spread', type: 'number', min: 0, max: 1, step: 0.01, default: 0.25, description: 'How much of the colour comes from the drifting field rather than from the direction below. At zero the palette runs cleanly along that axis; at one the direction does nothing and the colour pools into regions that wander across the image. It shipped at 0.6 for a while and the field dominated \u2014 a blob of one accent sitting in the middle of another, which is what a wandering field looks like once it is most of the mix.' },
    { key: 'arcCount', label: 'Divisions', type: 'number', min: 1, max: flavour.divisionMax, step: 1, default: 1, description: flavour.divisionNote },
    ...(KIND === 'arcs'
      ? ([
          { key: 'arcSpacing', label: 'Arc spread', type: 'number', min: 0.15, max: 1, step: 0.05, default: 1, description: 'How much of the cell the rings reach across. The gap between them is worked out from that and the division count, so every arc you ask for fits, and the stroke is sized from that gap rather than clamped by it.' },
        ] as ParamSpec[])
      : []),
    {
      key: 'colorAxis',
      label: 'Colour direction',
      type: 'select',
      options: [
        { value: 'vertical', label: 'Vertical' },
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'diagonal', label: 'Diagonal' },
      ],
      default: 'vertical',
      description:
        'Which way the palette runs where it is not coming from the drifting field. Vertical is the wallpaper default and the one the composition is tuned for \u2014 the quiet end goes under the clock. The diagonal runs corner to corner on the screen rather than in the pattern\u2019s own coordinates, so it reads at forty-five degrees whatever the canvas is shaped like. At a colour spread of one the field supplies everything and this does nothing, which is a fair sign you have turned the spread too far up.',
    },
  ],

  /**
   * Grid density across, divisions down.
   *
   * There is no third binding to choose any more: tap belongs to the registry,
   * so a pattern nominates two quantities and everything else lives behind the
   * gear. These are the two whose whole range is worth travelling, and the
   * horizontal one used to be `weight`.
   *
   * It lost the slot to the fault this repo's own rules predict. `weight` is a
   * fraction of the cell, and the fan thins its stroke to the gap so that
   * raising the division count cannot close the rings into a block — which
   * means the moment divisions is above one, most of the weight slider asks
   * for a stroke wider than the gap and gets the gap. Measured on the arcs at
   * 8 columns: the slider changes the stroke over 100% of its travel at one
   * division, 29% at three, and 6% at twelve, and the 0.16 default is already
   * inside the dead zone from three divisions up. The two axes were therefore
   * coupled, with the vertical one deciding how much of the horizontal one did
   * anything.
   *
   * Density is uncoupled from both and is the control a person reaches for
   * first anyway — it decides whether you are reading tiles or reading a
   * texture.
   */
  primary: { x: 'density', y: 'arcCount' },

  render(ctx: RenderContext): string {
    const { width: w, height: h, palette, params, rng } = ctx;
    const noise = createNoise2D(rng);

    const cols = Math.max(2, Math.round(pNum(params, 'density', 8)));
    const weight = pNum(params, 'weight', 0.16);
    const colorSpread = pNum(params, 'colorSpread', 0.25);
    const colorAxis = pStr(params, 'colorAxis', 'vertical');
// The colour ramp is always resolved to its full depth.
    //
    // This was a control, and it had one job worth doing at its bottom end —
    // showing the palette's accents as flat regions — and nothing worth doing
    // anywhere else, because every step above that is just a finer version of
    // the same wash. It was also the setting that made the arcs' flat-unit
    // fault visible, which is a fair sign that the slider was carrying the
    // weight of a bug rather than an idea.
    const arcCount = Math.max(1, Math.round(pNum(params, 'arcCount', 1)));
    const arcSpacing = pNum(params, 'arcSpacing', 1);

    const cell = w / cols;
    const rows = Math.ceil(h / cell) + 1;
    const originY = (h - rows * cell) / 2;

    const bg = hexToOklch(palette.background);
    const tintTop = oklchToHex({ ...bg, l: clamp(bg.l + (palette.mode === 'dark' ? 0.018 : -0.014), 0, 1) });
    const tintBottom = oklchToHex(mixOklch(bg, hexToOklch(accentAt(palette, 0.75)), palette.mode === 'dark' ? 0.1 : 0.07));

    // A vertical wash behind the tiling, and nothing else. It is the only
    // gradient in this generator: the marks themselves are stroked with flat
    // band colours.
    //
    // Two layers of commentary used to sit here describing designs that were
    // tried and reverted — one claiming the marks were stroked with a gradient
    // spanning the image and the per-tile colour unused, one arguing for
    // exactly one band per accent with no interpolation at all. Both were true
    // when written and neither describes this code, which is the trap CLAUDE.md
    // warns about; they contradicted each other and the block below them.
    const bgGradient = el(
      'linearGradient',
      { id: 'tr-bg', x1: '0', y1: '0', x2: '0', y2: '1' },
      el('stop', { offset: '0', 'stop-color': tintTop }) + el('stop', { offset: '1', 'stop-color': tintBottom }),
    );

    // A chord whose colour changes along its length is stroked with a gradient
    // of its own, so these accumulate as tiles are drawn and join the defs at
    // the end. A chord of one colour never makes one.
    const chordGradients: string[] = [];
    const gradientIds = new Map<string, string>();
    const gradientPaths: string[] = [];

    // Tiles are grouped by colour so the SVG carries one fill/stroke per group
    // rather than per shape.
    //
    // Marks are bucketed by colour and each bucket emitted as one group, so
    // the number of buckets is also the colour resolution. Forty-eight of them,
    // always, sampled in OKLab so a mid-point between two accents is the colour
    // the eye expects rather than the one the hex arithmetic gives.
    //
    // It used to be a control. What stood here explained, in the present tense,
    // what zero blend and full blend each looked like -- and then retracted it
    // two sentences later, because the slider was removed and the arithmetic
    // reduced to this constant. Half a comment about a design that no longer
    // exists is the trap this file has its own note about, twelve lines down.
    const bands = 48;
    const bandColors = accentRamp(palette, bands);
    const strokeBuckets: string[][] = Array.from({ length: bands }, () => []);

    // Colour comes from a field sampled in normalised canvas coordinates, not
    // in pixels. A pixel-keyed frequency would give a 108px thumbnail a much
    // coarser colour field than a 1399px export, so the preview would not be
    // the thing you downloaded — the same trap the geometry already avoids.
    //
    // The frequency is deliberately low: a couple of slow swells across the
    // image, so one region settles on one accent and a neighbouring region on
    // another, with the change spread over many cells rather than happening at
    // a cell edge. Sampling per mark rather than per tile is what stops the
    // grid from showing through as colour.
    const aspect = h / Math.max(1, w);
    const bandAt = (px: number, py: number): number => {
      const u = px / Math.max(1, w);
      const v = py / Math.max(1, h);
      const n = noise.value(u * COLOR_FIELD + 3, v * COLOR_FIELD * aspect - 9) * 0.5 + 0.5;
      // The axis the palette runs along where the field is not supplying it.
      // The diagonal is `(px + py) / (w + h)` rewritten in normalised terms, so
      // its iso-lines sit at forty-five degrees on the *screen* rather than in
      // the pattern's own coordinates -- on a 9:19.5 canvas `(u + v) / 2` is
      // dominated by `v` and barely leans.
      const ramp =
        colorAxis === 'horizontal'
          ? u
          : colorAxis === 'diagonal'
            ? (u + v * aspect) / (1 + aspect)
            : v;
      const t = clamp(n * colorSpread + ramp * (1 - colorSpread) * 0.9, 0, 1);
      return Math.min(bands - 1, Math.floor(t * bands));
    };



    const drawTile = (x: number, y: number, size: number): void => {
      const s = size;
      const x0 = x;
      const y0 = y;
      if (s <= 0.5) return;

      // One stroke width for the whole tile. The lower bound keeps the lightest
      // weight visible at small cell sizes. The upper one cannot be reached at
      // the declared range -- `weight` stops at 0.5 -- and the reason written
      // here for years was wrong twice over, since both thinning rules below
      // take a `Math.min` against this and so can only reduce it. It stays as
      // a guard against the range moving, which this file records happening.
      const sw = clamp(weight * s, s * 0.012, s * 0.62);

      // Strictly additive: unchanged at and below the default, opening toward a
      // whole pitch above it. See WEIGHT_DEFAULT.
      const pitchShare =
        weight <= WEIGHT_DEFAULT
          ? PITCH_AT_DEFAULT
          : clamp(
              PITCH_AT_DEFAULT + ((weight - WEIGHT_DEFAULT) / (WEIGHT_MAX - WEIGHT_DEFAULT)) * (1 - PITCH_AT_DEFAULT),
              PITCH_AT_DEFAULT,
              1,
            );

      const rot = rng.int(0, 3);

      if (KIND === 'arcs') {
        // Sweep flag 0, not 1. With sweep 1 the renderer picks the other of the
        // two circles that fit these endpoints — the one centred on the cell
        // centre — so every arc bulged away from its corner. The marks still
        // met at the edge midpoints, so the tiling looked plausible, but no arc
        // was ever centred on a grid vertex and the loops, half circles and
        // full circles that make a Truchet tiling worth looking at could not
        // form at all. Sweep 0 centres each quarter arc on its corner.
        const arcPath = (corner: 0 | 1 | 2 | 3, rho: number): string => {
          const R = num(rho, 1);
          if (corner === 0) return `M${num(x0, 1)} ${num(y0 + rho, 1)}A${R} ${R} 0 0 0 ${num(x0 + rho, 1)} ${num(y0, 1)}`;
          if (corner === 1) return `M${num(x0 + s - rho, 1)} ${num(y0, 1)}A${R} ${R} 0 0 0 ${num(x0 + s, 1)} ${num(y0 + rho, 1)}`;
          if (corner === 2) return `M${num(x0 + s, 1)} ${num(y0 + s - rho, 1)}A${R} ${R} 0 0 0 ${num(x0 + s - rho, 1)} ${num(y0 + s, 1)}`;
          return `M${num(x0 + rho, 1)} ${num(y0 + s, 1)}A${R} ${R} 0 0 0 ${num(x0, 1)} ${num(y0 + s - rho, 1)}`;
        };

        // Two marks on opposite corners, the classical tile. One mark per cell
        // covers only two of the cell's four edge midpoints, so most edges have
        // nothing on the other side to meet and the tiling falls apart into
        // scattered arcs — which is what happened when this was changed to a
        // single fan to fill the cell better. It does not need to be a choice:
        // two quarter discs of radius s/sqrt(2) cover the same 78% of a cell as
        // one of radius s, and cover all four midpoints while doing it.
        //
        // s/sqrt(2) is the ceiling because circles centred on opposite corners
        // meet once their radii sum past the diagonal, s*sqrt(2).
        //
        // The radii are centred on s/2 and grow in both directions from it,
        // rather than nesting inward from the outer edge — filling the cell from
        // the outside in silently disconnected the whole tiling. What makes them
        // join is that the set mirrors itself about s/2, which is derived where
        // the set is built, below. (An earlier note here claimed the set had to
        // *contain* s/2; it does not, and believing that shipped a round of
        // bugs at even counts.)
        //
        // Every cell uses the same set, so a neighbour's arc is centred on the
        // same physical corner whenever the rotations agree and each arc meets
        // its opposite number on the shared edge. Where the rotations disagree
        // the lines simply stop: the ends in the pattern are structural, not
        // something a knob manufactures.
        const r = s / 2;
        const mid = 0.70710678; // the 45 degree point of a quarter arc, and the outward ceiling

        // How many pieces each arc is cut into for colour, by the same rule the
        // chords already follow and for the same reason — which the arcs never
        // got, and it shows.
        //
        // One flat colour per arc is a flat colour across (pi/2)*rho of the
        // canvas, and rho reaches s/sqrt(2), so at five columns a single arc
        // carries one colour across 22% of the width against the 6% the chords
        // hold to. Two arcs that meet across a cell edge sample a whole cell
        // apart, so a ribbon running through the grid changes colour in a hard
        // step at the join: reported as strange non-smooth colour at full
        // blend, which is exactly where the ramp is fine enough for the step to
        // be a different hue rather than a neighbouring one.
        //
        // Keyed on the column count and never on pixels, so a thumbnail and an
        // export cut their arcs the same way. Past about nineteen columns an
        // arc is already short enough to need no cutting at all, which is
        // where the render is heaviest.
        const wantCuts = (1.5708 / (cols * 1.4142)) / MAX_SEGMENT;
        const cuts = ARC_CUT_COUNTS.find((n) => n >= wantCuts) ?? ARC_CUT_COUNTS[ARC_CUT_COUNTS.length - 1] ?? 1;

        // The gap is derived, not given. Asking for twelve arcs at a spacing
        // that only fits eight used to drop four of them silently, and a stroke
        // heavier than the gap closed the rings into a block. Instead: divide
        // the room available by the steps needed, so every arc asked for fits.
        //
        // The set has to be a mirror of itself about s/2, and that is what
        // decides whether the marks line up — not, as the old note here had it,
        // whether s/2 is in the set.
        //
        // Two cells share an edge. A cell whose marks sit on corners 0 and 2
        // meets its right edge from the bottom corner of that edge; one with
        // marks on 1 and 3 meets it from the top. Where the rotations differ,
        // both measure from the same corner and every radius meets its twin
        // whatever the set is. Where they agree — half of all edges — one
        // measures from the top and the other from the bottom, so an arc at
        // radius p meets an arc at s - p, and only a set containing both joins
        // at all.
        //
        // Giving the inward and outward sides their own step broke that at
        // every count: p mirrored to s - p, which the other step size never
        // landed on, so about two thirds of arc ends stopped dead on a cell
        // boundary. Sharing one step fixed the odd counts by accident and left
        // the even ones stranding their outermost ring, because a set centred
        // on s/2 that contains s/2 has to have an odd number of members.
        //
        // So: n radii, evenly spaced, centred on s/2 rather than anchored to
        // it. Odd counts still include s/2; even counts straddle it, which
        // costs nothing — s/2 was never the thing doing the work.
        const spread = clamp(arcSpacing, 0.05, 1);
        const outRoom = s * mid - r;
        const half = (arcCount - 1) / 2;
        const step = half > 0 ? (outRoom / half) * spread : 0;

        const radii: number[] = [];
        for (let j = 0; j < arcCount; j++) radii.push(r + (j - half) * step);

        // The stroke gives way to the gap rather than the other way round, so a
        // heavy weight thins to keep the rings readable instead of merging
        // them. A single arc has no neighbour to crowd and keeps its weight.
        // Cell-relative, limited by the room between rings, with the limit
        // itself scaling above the default so the top of the slider lives.
        const fanSw = step > 0 ? Math.min(sw, step * pitchShare) : sw;

        // Each arc is coloured from the field at its own midpoint, not at the
        // tile's centre. Sampling once per tile and quantising the result gives
        // every arc in the cell the same step of the ramp, so two neighbouring
        // tiles can land on different steps and the whole cell boundary shows
        // as an edge.
        // Where an arc sits on the circle it is drawn on, at parameter t along
        // its quarter turn. Each corner is the same sweep reflected, and the
        // reflections are exact arithmetic on the table's literals.
        const arcPoint = (corner: 0 | 1 | 2 | 3, rho: number, at: readonly [number, number]): [number, number] => {
          const [sn, cs] = at;
          if (corner === 0) return [x0 + rho * sn, y0 + rho * cs];
          if (corner === 1) return [x0 + s - rho * cs, y0 + rho * sn];
          if (corner === 2) return [x0 + s - rho * sn, y0 + s - rho * cs];
          return [x0 + rho * cs, y0 + s - rho * sn];
        };

        const corners: [0 | 1 | 2 | 3, 0 | 1 | 2 | 3] = rot % 2 === 0 ? [0, 2] : [1, 3];
        corners.forEach((corner) => {
          for (const rho of radii) {
            // Undivided, the arc is emitted exactly as it always was: the same
            // path string, sampled at the same 45 degree point. Anything else
            // repaints every render fine enough not to have the fault.
            if (cuts === 1) {
              const k = rho * mid;
              const mx = corner === 1 || corner === 2 ? x0 + s - k : x0 + k;
              const my = corner === 2 || corner === 3 ? y0 + s - k : y0 + k;
              (strokeBuckets[bandAt(mx, my)] as string[]).push(
                el('path', { d: arcPath(corner, rho), 'stroke-width': num(fanSw, 2) }),
              );
              continue;
            }
            const R = num(rho, 1);
            const stops = ARC_CUTS[cuts] as readonly (readonly [number, number])[];
            for (let c = 0; c < cuts; c++) {
              const from = arcPoint(corner, rho, stops[c] as readonly [number, number]);
              const to = arcPoint(corner, rho, stops[c + 1] as readonly [number, number]);
              // Sampled at the chord midpoint rather than the arc's own, which
              // would need the trigonometry of every half step as well. Over a
              // piece this short the two are a pixel or two apart and the band
              // is the same; what matters is that it is exact arithmetic on
              // two table entries, and so identical in every engine.
              (strokeBuckets[bandAt((from[0] + to[0]) / 2, (from[1] + to[1]) / 2)] as string[]).push(
                el('path', {
                  d: `M${num(from[0], 1)} ${num(from[1], 1)}A${R} ${R} 0 0 0 ${num(to[0], 1)} ${num(to[1], 1)}`,
                  'stroke-width': num(fanSw, 2),
                }),
              );
            }
          }
        });
        return;
      }

      const a = rot % 2 === 0;

      // Divisions means something here too: the single corner-to-corner
      // diagonal becomes a family of parallel chords at spacing s/n.
      //
      // The spacing is what makes it tile, and s/n is the only choice that
      // does. A chord offset from the diagonal by k*(s/n) crosses each cell
      // edge at a multiple of s/n from the corner, and it does so in both
      // rotations: the main-diagonal family and the anti-diagonal family put
      // their crossings on the identical lattice, mirrored onto itself. So
      // every line meets a partner across every edge whatever the neighbour
      // rolled — measured on a uniform grid, 0% of interior crossings are left
      // unpartnered here against 49% for the arcs, where only s/2 joins
      // unconditionally. Any other spacing crosses at points the neighbour has
      // nothing at, and the grid shows as a row of stopped lines.
      //
      // Arc spread is deliberately not wired in here. Narrowing the family to
      // the chords nearest the diagonal looks like the obvious analogue of
      // what it does to the arcs, and it breaks the tiling: a cell crosses its
      // right edge in the band nearest the bottom corner and its left edge in
      // the band nearest the top one, so two neighbours of the same rotation
      // only overlap once the family is at least half width. Below that the
      // lines stop dead along the cell boundary and the grid reads straight
      // through the pattern. The extent is not a free choice — it is fixed by
      // the same lattice that makes the family join at all — so the count owns
      // it, the way the count owns arc spacing on the other tile set.
      const lines = Math.max(1, arcCount);
      const step = s / lines;
      const kMax = lines - 1;

      // Drawn before the chords rather than after, which is the same position
      // in the seeded stream because the loop below draws nothing from it. Move
      // it past an rng call and every rotation and colour after it shifts.
      //
      // The spur only survives on the single-line tile, where it is what stops
      // a plain lattice reading as graph paper; a family already has that
      // interest, and a stray mark across it at 45 degrees is the one line in
      // the cell that meets nothing.
      const spur = rng.bool(0.35);
      const extra =
        lines === 1 && spur
          ? a
            ? `M${num(x0 + s, 1)} ${num(y0, 1)}L${num(x0 + s * 0.6, 1)} ${num(y0 + s * 0.4, 1)}`
            : `M${num(x0, 1)} ${num(y0, 1)}L${num(x0 + s * 0.4, 1)} ${num(y0 + s * 0.4, 1)}`
          : '';

      // Neighbouring chords sit step/sqrt(2) apart measured perpendicular, not
      // step — the offset is along an axis and the line runs at 45 degrees to
      // it. Thinning to `step` would still let a heavy stroke close the family
      // into a solid triangle.
      const perp = step * 0.70710678;
      const lineSw = lines > 1 ? Math.min(sw, perp * pitchShare) : sw;

      // Each chord is stroked with a gradient sampled along its own length,
      // rather than carrying one colour end to end.
      //
      // It was cut into separately-stroked pieces first, which is what the
      // derivation below is about and why the sample count is still derived
      // the same way -- the gradient replaced the pieces, not the rule that
      // sets how finely the colour has to be read. Cutting also left every
      // join as two strokes sharing an exact edge, which is a seam a renderer
      // may open; the gradient has no joins at all.
      //
      // Sampling once per chord fixed the cell-sized blocks and left a subtler
      // version of the same fault. A colour boundary can then only fall in the
      // gap *between* two chords, and every chord in the grid runs at 45°, so
      // the field's contours get snapped onto a lattice of parallel lines and
      // come out as straight-edged diamond facets — hard patches across a
      // render that should be a smooth wash. The resolution is fine across the
      // family, where the spacing is s/n, and coarse along it, where nothing
      // changes for the chord's whole 1.41s length. Facets are what that
      // anisotropy looks like.
      //
      // The sample count is derived rather than fixed, because the fault scales
      // with cell size: a chord spans 1.41/cols of the canvas and the colour
      // field cycles COLOR_FIELD times across it, so the pieces needed fall off
      // as the grid gets finer. At 26 columns a chord is already short enough
      // to need none, which is exactly where paying for them would hurt most —
      // that render is 35,000 marks before anything is cut.
      //
      // Keyed on the column count, never on pixels: a thumbnail and an export
      // must read their chords the same way or they stop being the same
      // picture. This is a count of gradient stops rather than of marks, and
      // the same 6% rule sets it: no stretch of one colour may cross more than
      // that fraction of the canvas.
      const samples = Math.max(1, Math.min(12, Math.ceil(1.4142 / (cols * MAX_SEGMENT))));
      for (let k = -kMax; k <= kMax; k++) {
        const o = k * step;
        // Each chord is written from its top-most end so that the single-line
        // case emits exactly the string this generator has always emitted.
        const [px, py, qx, qy] = a
          ? k >= 0
            ? [x0, y0 + o, x0 + s - o, y0 + s]
            : [x0 - o, y0, x0 + s, y0 + s + o]
          : k <= 0
            ? [x0 + s + o, y0, x0, y0 + s + o]
            : [x0 + s, y0 + o, x0 + o, y0 + s];

        // One path for the whole chord, and where its colour changes along the
        // way that path is stroked with a gradient rather than cut into pieces.
        //
        // Cutting was the fix for a real fault — a chord carrying one colour
        // end to end put every colour boundary in the gap between chords, and
        // since every chord runs at 45 degrees the field's contours snapped
        // onto a lattice of parallel lines and came out as diamond facets. But
        // each cut left two paths sharing an endpoint exactly, and a shared
        // edge between two separately rasterised shapes is the classic
        // hairline: two antialiased edges at 50% coverage composite to 75%,
        // not 100%, and the paper shows through. Three columns at three
        // divisions carried 927 of those. Chrome and resvg composite exactly
        // and show nothing; Safari drew the lines dashed end to end, at the
        // spacing of the pieces.
        //
        // A gradient buys what the cutting bought without the seam, and buys
        // it better: the colour is continuous along the chord rather than
        // stepped, so the 6% rule is satisfied by there being no flat stretch
        // at all rather than by keeping each one short.
        const d0 = `M${num(px, 1)} ${num(py, 1)}L${num(qx, 1)} ${num(qy, 1)}`;
        const d = d0 + (k === kMax ? extra : '');

        // Read the field where the pieces used to take it: at the midpoint of
        // each equal division of the chord.
        let uniform = true;
        const along: number[] = [];
        for (let j = 0; j < samples; j++) {
          const t = (j + 0.5) / samples;
          along.push(bandAt(px + (qx - px) * t, py + (qy - py) * t));
          if (along[j] !== along[0]) uniform = false;
        }

        if (uniform) {
          (strokeBuckets[along[0] as number] as string[]).push(
            el('path', { d, 'stroke-width': num(lineSw, 2) }),
          );
        } else {
          // Keyed on the chord's own bounding box rather than on the canvas,
          // which is what lets two chords share one definition. Every chord
          // here runs at exactly 45 degrees and downward, so its box is a
          // square and the gradient axis is one of its two diagonals — the
          // chord is the diagonal. A definition therefore depends only on
          // which way the chord leans and what colours run along it, and a
          // render reuses a handful of them instead of writing one per mark.
          // Keying on the canvas instead cost 57% more bytes at fourteen
          // columns, because the axis then carries four coordinates that no
          // two chords ever share.
          const leansRight = qx > px;
          let stops = '';
          for (let j = 0; j < samples; j++) {
            stops += el('stop', {
              offset: num((j + 0.5) / samples, 3),
              'stop-color': bandColors[along[j] as number] as string,
            });
          }
          const key = `${leansRight ? 'r' : 'l'}|${stops}`;
          let id = gradientIds.get(key);
          if (id === undefined) {
            id = `tg${gradientIds.size}`;
            gradientIds.set(key, id);
            chordGradients.push(
              el(
                'linearGradient',
                leansRight
                  ? { id, x1: '0', y1: '0', x2: '1', y2: '1' }
                  : { id, x1: '1', y1: '0', x2: '0', y2: '1' },
                stops,
              ),
            );
          }
          gradientPaths.push(el('path', { d, stroke: `url(#${id})`, 'stroke-width': num(lineSw, 2) }));
        }
      }
    };

    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) {
        drawTile(rx * cell, originY + ry * cell, cell);
      }
    }

    /*
     * A turn is two chords meeting end to end, so the cap is the join.
     *
     * Every mark here is one straight segment belonging to one cell, and two
     * neighbours turning the same corner meet exactly at the cell edge. SVG
     * has no join to apply -- they are separate paths -- so whatever the cap
     * draws is what the corner looks like. A round cap reaches w/2 from the
     * shared point and a mitre reaches w/(2 sin45) = 0.707w, so the corner was
     * being bitten back by 0.207w and the gap behind it opened into a bead.
     * Every corner sits on the cell lattice, so those beads are a regular dot
     * screen laid over the picture, and at high division counts they are the
     * first thing you see. It was reported as patterns emerging from the
     * corners, which is exactly what it is.
     *
     * A square cap extends w/2 *along* each segment, and at 90 degrees the two
     * extensions cover precisely the mitre point: measured against a real
     * mitre-joined polyline at 4x, zero differing pixels, where the round cap
     * differs by 222 of 14,310 -- 1.55% of the corner missing. Every turn on
     * this tiling is 90 degrees (the chords run at +-45) or 180, and a square
     * cap on a straight continuation is covered by the neighbour's own body,
     * so there is no case where it overshoots.
     *
     * The arcs keep the round cap and are byte-identical. Their marks meet
     * their neighbours tangentially rather than at a corner, so there is no
     * mitre to reach and a square cap would put a flat overhang on the outside
     * of a curve.
     */
    const cap = KIND === 'diagonals' ? 'square' : 'round';

    let body =
      el('defs', {}, bgGradient + chordGradients.join('')) +
      el('rect', { x: 0, y: 0, width: w, height: h, fill: 'url(#tr-bg)' });

    for (let b = 0; b < bands; b++) {
      const strokes = strokeBuckets[b] as string[];
      const color = bandColors[b] as string;
      if (strokes.length > 0) {
        body += el('g', { fill: 'none', stroke: color, 'stroke-linecap': cap }, strokes.join(''));
      }
    }

    // The chords that carry a gradient cannot sit in a group that names one
    // stroke, so they go in a group of their own after the flat ones.
    if (gradientPaths.length > 0) {
      body += el('g', { fill: 'none', 'stroke-linecap': cap }, gradientPaths.join(''));
    }

    return svgRoot(w, h, `${flavour.name} wallpaper`, body);
  },
  };
}

export const truchetArcs = makeTruchet('arcs', {
  id: 'truchet-arcs',
  name: 'Truchet Arcs',
  tagline: 'Quarter circles on a grid, closing into loops nobody planned.',
  description: arcsDescription,
  divisionMax: 12,
  divisionNote:
    'How many concentric rings each quarter arc becomes, added either side of the radius that joins the neighbouring cells. They are spread evenly and centred on that radius, which is what makes each ring meet its opposite number across an edge; how far they reach is Arc spread\u2019s job rather than this one. Raising it adds detail inside a mark that keeps its size, and the stroke follows the gap it leaves rather than being clamped by it.',
});

export const truchetDiagonals = makeTruchet('diagonals', {
  id: 'truchet-diagonals',
  name: 'Truchet Diagonals',
  tagline: 'Corner to corner, and a lattice of switchbacks.',
  description: diagonalsDescription,
  divisionMax: 6,
  divisionNote:
    'How many parallel chords cross each cell. The corner-to-corner line becomes a family spaced one cell width over the count, which is the only spacing that tiles: it puts every crossing at a multiple of itself along each edge, in both rotations, so every chord meets a partner across every edge. A family is 2n-1 chords, so this stops at six \u2014 past that one cell carries more than a dozen lines and the tiling reads as grey.',
});
