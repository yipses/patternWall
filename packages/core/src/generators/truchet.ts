import { accentAt, accentRamp } from '../palette.js';
import { hexToOklch, mixOklch, oklchToHex } from '../color.js';
import { createNoise2D } from '../noise.js';
import { hashSeed } from '../rng.js';
import { clamp, quietFactor, smoothstep } from '../geometry.js';
import { el, num, svgRoot } from '../svg.js';
import { pBool, pNum, pStr, type Generator, type RenderContext } from '../types.js';

const description = `
A Truchet tile is a square with an asymmetric mark on it — Sébastien Truchet’s original was a square split into two triangles — and a Truchet tiling is what you get when you fill a grid with copies of that square in random rotations. The remarkable thing is how little you have to specify. One tile, four rotations and a coin flip per cell produce paths that wander across the whole grid, close into loops, and look considered in a way that no part of the rule accounts for.

Three tile sets are offered here and they behave quite differently. **Quarter arcs** join edge midpoints with two 90° curves centred on opposite corners, so every cell edge is a connection point and the marks meet: the result is a tangle of closed loops. The corner is the whole trick — two circles of a given radius pass through any pair of points, and centring these on the cell's middle instead produces marks that still meet at the edges but can never curl around a grid vertex, so no loop, half circle or full circle ever forms. **Diagonals** connect corners instead, which means paths meet at cell corners rather than edges and the tiling reads as a lattice of switchbacks rather than as loops. **Triangles** fill half of each cell, which turns the whole thing from line work into a mass of light and dark, and is by far the strongest option at low densities.

Two controls decide how much the arcs behave like a single continuous system. **Open ends** drops marks, so paths stop rather than always continuing; a field with nothing dropped can only close into loops or run off the canvas, which reads as busier than it is. **Divisions** replaces each single quarter arc with a fan of concentric ones sharing the same corner. Because a neighbour's fan is centred on that same physical point whenever the rotations agree, every radius in the fan meets its opposite number across the edge and the marks become nested ribbons; where the rotations disagree, the lines simply stop. Both of the cell’s marks are fanned, and the two sets stay clear of each other because the radii stop where circles centred on opposite corners would touch; carried past that point they would cross, and the result is moiré rather than pattern.

On the diagonal set the same control does something structurally different, and something the arcs cannot quite manage. The single corner-to-corner line becomes a family of parallel chords spaced one cell width over the count — the only spacing that tiles, because it puts every crossing at a multiple of itself along each edge, and puts them there in both rotations. Where a fan only meets its neighbour when the two cells agree on a corner, every chord here finds its partner across every edge whichever way the cell beyond it happens to be turned, provided the two cells are the same size. Subdivision is the exception and a visible one: a quartered cell draws its family at half the spacing, so half of its crossings meet nothing and the finer patch is edged with stopped lines — which is a good part of why a subdivided passage reads as a patch rather than as more of the same weave. Past three or four the cells stop reading as cells at all and the grid becomes a woven field of chevrons and nested diamonds, which is a different pattern from the maze of switchbacks a count of one gives you.

The triangles divide too, and on that same lattice. Each rotation of the tile is a half cell with its right angle at one corner, so scaling it about that corner sweeps the hypotenuse across the cell and a slice at k/n lands exactly where the diagonal family crosses. Filling every other band turns the solid half-cell into ribbons, and because the band edges fall where a neighbour puts its own, the ribbons run on through the grid instead of stopping at it — which is why raising this makes the tile set agree with itself across edges more often than the solid version does, not less.

Subdivision is where this implementation departs from the classical rule. A fraction of cells are replaced by a 2×2 block of quarter-size tiles, and that fraction rises toward the bottom of the canvas. A uniform grid has a uniform level of interest, which is exactly wrong for a wallpaper: the eye wants somewhere to rest and somewhere to look. Pushing the fine detail downward puts the busy passage where the app icons and the dock live, and leaves the clock sitting on something calm.

Grid **density** interacts with everything. Below about six columns the tiles are large enough that you read each one individually and the tile set matters enormously; above about twenty you stop seeing tiles at all and start seeing a woven texture, at which point stroke weight matters more than which set you chose.
`.trim();

type TileKind = 'arcs' | 'diagonals' | 'triangles';

/**
 * Swells of colour across the image, in cycles. Low on purpose: the point is
 * that a region is one accent and the next region another, with the transition
 * spread across many cells instead of landing on a cell edge.
 */
const COLOR_FIELD = 1.6;

export const truchet: Generator = {
  id: 'truchet',
  name: 'Truchet',
  tagline: 'One tile, four rotations, and paths nobody planned.',
  tags: ['grid'],
  description,
  params: [
    { key: 'density', label: 'Grid density', type: 'number', min: 3, max: 26, step: 1, default: 8, description: 'Columns across the canvas. Rows follow from the aspect ratio so cells stay square.' },
    {
      key: 'tileSet',
      label: 'Tile set',
      type: 'select',
      options: [
        { value: 'arcs', label: 'Quarter arcs' },
        { value: 'diagonals', label: 'Diagonals' },
        { value: 'triangles', label: 'Triangles' },
      ],
      default: 'arcs',
      description: 'Arcs make continuous loops, diagonals make switchbacks, triangles make mass instead of line.',
    },
    { key: 'weight', label: 'Stroke weight', type: 'number', min: 0.02, max: 0.5, step: 0.01, default: 0.16, description: 'Line width as a fraction of the cell. Above about 0.4 the arcs start to touch and read as solid.' },
    { key: 'subdivide', label: 'Subdivision', type: 'number', min: 0, max: 1, step: 0.02, default: 0.35, description: 'Chance that a cell becomes a 2x2 block of smaller tiles. Weighted toward the lower canvas.' },
    { key: 'colorSpread', label: 'Colour spread', type: 'number', min: 0, max: 1, step: 0.01, default: 0.6, description: 'How much of the colour comes from the drifting field rather than from height. At zero the palette runs top to bottom; at one it pools into regions that wander across the image.' },
    { key: 'quietTop', label: 'Quiet top', type: 'number', min: 0, max: 1, step: 0.01, default: 0.55, description: 'Thins the strokes and suppresses subdivision where iOS draws the clock.' },
    { key: 'gap', label: 'Cell gap', type: 'boolean', default: false, description: 'Inset every tile slightly so the grid itself becomes visible as white space.' },
    { key: 'openEnds', label: 'Open ends', type: 'number', min: 0, max: 0.8, step: 0.02, default: 0, description: 'Chance a cell is left empty, breaking the surface up. A cell’s two marks go together, so this leaves a real hole rather than a half-covered cell — and the ends in the pattern come for free either way, wherever two neighbours face different corners.' },
    { key: 'arcCount', label: 'Divisions', type: 'number', min: 1, max: 12, step: 1, default: 1, description: 'How many parts each cell’s mark is divided into. Quarter arcs become concentric, added either side of the radius that joins the neighbouring cells, and how far they reach is Arc spread’s job rather than this one. A diagonal becomes a family of parallel chords across the cell. A triangle is sliced into bands parallel to its hypotenuse with every other one filled, so the solid mass becomes ribbons. All three divide on a spacing that puts each part’s edges where a cell of the same size puts its own, so raising this adds detail inside a mark that keeps its size, and any stroke thins to the gap it leaves.' },
    { key: 'arcSpacing', label: 'Arc spread', type: 'number', min: 0.15, max: 1, step: 0.05, default: 1, description: 'How much of the cell the rings reach across. The gap between them is worked out from that and the division count, so every arc you ask for fits, and the stroke thins if it has to rather than closing the rings into a solid block. Quarter arcs only: a family of diagonals has no say in how far it spreads, because the spacing that makes it meet its neighbours is the spacing that fills the cell.' },
    { key: 'colorBlend', label: 'Colour blend', type: 'number', min: 0, max: 1, step: 0.02, default: 1, description: 'How finely the palette is resolved between its accents. At zero only the accents themselves are used, so regions of colour meet at hard edges. Raise it and the steps between them are filled in, so one region eases into the next.' },
  ],

  render(ctx: RenderContext): string {
    const { width: w, height: h, palette, params, rng, safeZones } = ctx;
    const noise = createNoise2D(rng);

    const cols = Math.max(2, Math.round(pNum(params, 'density', 8)));
    const tileSet = pStr(params, 'tileSet', 'arcs');
    const weight = pNum(params, 'weight', 0.16);
    const subdivide = pNum(params, 'subdivide', 0.35);
    const colorSpread = pNum(params, 'colorSpread', 0.6);
    const colorBlend = pNum(params, 'colorBlend', 1);
    const openEnds = pNum(params, 'openEnds', 0);
    const arcCount = Math.max(1, Math.round(pNum(params, 'arcCount', 1)));
    const arcSpacing = pNum(params, 'arcSpacing', 1);
    const quietTop = pNum(params, 'quietTop', 0.55);
    const gap = pBool(params, 'gap', false);

    const cell = w / cols;
    const rows = Math.ceil(h / cell) + 1;
    const originY = (h - rows * cell) / 2;

    const bg = hexToOklch(palette.background);
    const tintTop = oklchToHex({ ...bg, l: clamp(bg.l + (palette.mode === 'dark' ? 0.018 : -0.014), 0, 1) });
    const tintBottom = oklchToHex(mixOklch(bg, hexToOklch(accentAt(palette, 0.75)), palette.mode === 'dark' ? 0.1 : 0.07));

    // Painting every tile a flat colour is what makes the palette read as
    // blocks: however many intermediate hues the ramp is resolved into, the
    // boundary between two neighbouring tiles is still an edge, because each
    // tile is one colour from edge to edge. The only way to get a continuous
    // blend is for the paint itself to vary across the canvas, so above zero
    // the marks are stroked with a gradient spanning the whole image and the
    // per-tile colour is not used at all.
    //
    // Blend sets how much of the accent ramp that gradient covers: a narrow
    // slice around the middle is a subtle wash, the full width runs the
    // palette end to end.
    const defs = el(
      'defs',
      {},
      el(
        'linearGradient',
        { id: 'tr-bg', x1: '0', y1: '0', x2: '0', y2: '1' },
        el('stop', { offset: '0', 'stop-color': tintTop }) + el('stop', { offset: '1', 'stop-color': tintBottom }),
      ),
    );

    // Tiles are grouped by colour so the SVG carries one fill/stroke per group
    // rather than per shape.
    // One band per accent rather than a continuous ramp: a Truchet grid shows
    // large flat areas of each colour, and interpolated in-between hues would
    // quietly replace the palette the person chose with a gradient they did
    // not.
    // Tiles are bucketed by colour and each bucket emitted as one group, so
    // the number of buckets is also the colour resolution. At zero blend there
    // is one bucket per accent and the tiling reads as flat areas of exactly
    // the colours in the palette; raising it interpolates intermediate steps
    // along the ramp until the transitions stop being visible as edges. The
    // ramp is sampled in OKLab, so a mid-point between two accents is the
    // colour the eye expects rather than the one the hex arithmetic gives.
    const flatBands = Math.max(1, Math.min(4, palette.accents.length));
    const bands = Math.max(flatBands, Math.round(flatBands + (48 - flatBands) * clamp(colorBlend, 0, 1)));
    const bandColors = accentRamp(palette, bands);
    const strokeBuckets: string[][] = Array.from({ length: bands }, () => []);
    const fillBuckets: string[][] = Array.from({ length: bands }, () => []);

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
      const t = clamp(n * colorSpread + v * (1 - colorSpread) * 0.9, 0, 1);
      return Math.min(bands - 1, Math.floor(t * bands));
    };

    const drawTile = (x: number, y: number, size: number, depth: number): void => {
      const cy = y + size / 2;
      const q = quietFactor(cy, h, quietTop, safeZones);
      const inset = gap ? size * 0.07 : 0;
      const s = size - inset * 2;
      const x0 = x + inset;
      const y0 = y + inset;
      if (s <= 0.5) return;

      const sw = clamp(weight * s * (0.34 + 0.66 * q), s * 0.012, s * 0.62);
      const band = bandAt(x + size / 2, cy);
      const rot = rng.int(0, 3);
      const kind = tileSet as TileKind;

      if (kind === 'triangles') {
        const pts: [number, number][][] = [
          [
            [x0, y0],
            [x0 + s, y0],
            [x0, y0 + s],
          ],
          [
            [x0 + s, y0],
            [x0 + s, y0 + s],
            [x0, y0],
          ],
          [
            [x0 + s, y0 + s],
            [x0, y0 + s],
            [x0 + s, y0],
          ],
          [
            [x0, y0 + s],
            [x0, y0],
            [x0 + s, y0 + s],
          ],
        ];
        const tri = pts[rot] as [number, number][];

        // The count works here too, and on the same lattice as the diagonals.
        // In all four rotations the first vertex is the right-angle corner, so
        // scaling the triangle about it sweeps the hypotenuse across the cell:
        // the similar triangle at parameter t carries its hypotenuse on the
        // chord t*s from that corner. Slice at consecutive multiples of 1/n and
        // every band edge lands on a multiple of s/n along the cell edge, which
        // is the lattice a neighbour puts its own edges on whichever way it is
        // turned. Measured across interior cell edges, this agrees with the
        // neighbouring cell more often than the solid tile does, not less:
        // 37% of samples disagree at a count of three against 52% solid.
        const corner = tri[0] as [number, number];
        const legA = tri[1] as [number, number];
        const legB = tri[2] as [number, number];
        const bands = Math.max(1, arcCount);
        const fillOpacity = num(clamp(0.16 + 0.74 * q + depth * 0.08, 0.06, 1), 2);

        // t >= 1 returns the vertex itself rather than corner + (p - corner),
        // which is the same point in algebra and not always the same float. A
        // single band has to emit the exact string this tile has always
        // emitted, so the arithmetic is skipped rather than trusted.
        const at = (p: [number, number], t: number): [number, number] =>
          t >= 1 ? p : [corner[0] + t * (p[0] - corner[0]), corner[1] + t * (p[1] - corner[1])];

        // Each band takes its colour from the field at its own centroid, the way
        // the arcs and the diagonal chords do. Colouring every band from the
        // cell's centre gives the whole tile one step of the ramp, so the colour
        // can only change at a cell boundary and the grid shows as flat blocks
        // however finely the blend resolves the palette.
        //
        // A single band is the whole triangle, and is left on the tile's own
        // colour: sampling its centroid instead would be marginally more honest
        // and would repaint every existing undivided render for no one's
        // benefit.
        const emit = (ps: [number, number][]): void => {
          let cx = 0;
          let cy2 = 0;
          for (const pt of ps) {
            cx += pt[0];
            cy2 += pt[1];
          }
          const bandIndex = bands === 1 ? band : bandAt(cx / ps.length, cy2 / ps.length);
          (fillBuckets[bandIndex] as string[]).push(
            el('polygon', {
              points: ps.map((pt) => `${num(pt[0], 1)},${num(pt[1], 1)}`).join(' '),
              'fill-opacity': fillOpacity,
            }),
          );
        };

        // Every other band, counted down from the hypotenuse. Filling all of
        // them would reassemble the solid triangle; alternating is what turns
        // the mass into ribbons, and starting at the outermost keeps the band
        // along the hypotenuse — the edge that gives the tile its direction —
        // at every count. One band is the whole triangle, so the tile set is
        // unchanged until the count is raised.
        for (let k = bands - 1; k >= 0; k -= 2) {
          const t0 = k / bands;
          const t1 = (k + 1) / bands;
          emit(t0 === 0 ? [corner, at(legA, t1), at(legB, t1)] : [at(legA, t0), at(legA, t1), at(legB, t1), at(legB, t0)]);
        }
        return;
      }

      const opacity = num(clamp(0.16 + 0.84 * q, 0.06, 1), 2);
      if (kind === 'arcs') {
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

        // Whether a mark is kept is decided by hashing the tile's position
        // rather than by drawing from the seeded stream. Two reasons: the
        // decision has to be stable while the slider moves, so that opening the
        // field up does not also reshuffle every rotation and colour
        // underneath it; and a hash is independent per tile, where the value
        // noise used elsewhere is smooth and would clear whole regions instead
        // of scattering ends through the pattern.
        // Indices in half-cells, never pixels. A pixel-keyed hash would drop
        // different arcs in a 108px thumbnail than in a 1399px export, and the
        // preview would stop being the thing you downloaded. Half-cells give
        // whole numbers for both full tiles and the 2x2 subdivided ones.
        const gx = Math.round((x / cell) * 2);
        const gy = Math.round(((y - originY) / cell) * 2);
        const gs = Math.round((size / cell) * 2);
        //
        // The salt is per mark but the decision is, in practice, per cell, and
        // that is the behaviour to keep. hashSeed is FNV-1a, whose last step is
        // a multiply: flipping the final character moves the result by about
        // 0.014 of the range, so salts 1 and 2 fall the same side of any
        // threshold 98.8% of the time and a cell almost always loses both marks
        // or neither. That is what the tiling wants — a cell left with one mark
        // covers two of its four edge midpoints, which is the scattered-arcs
        // failure the two-mark design exists to avoid — so this is not a bug to
        // fix here. It is worth knowing that giving hashSeed a proper
        // finalising mix, which would otherwise look like a clean improvement,
        // would silently turn Open ends into a control that shreds cells.
        const keep = (salt: number): boolean =>
          openEnds <= 0 || hashSeed(`${gx}:${gy}:${gs}:${salt}`) / 0x100000000 >= openEnds;

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
        // The radii are anchored on s/2 and grow in both directions from it,
        // rather than nesting inward from the outer edge. An arc meets the
        // shared edge at its own radius from the corner it is centred on, so
        // two marks line up only when they are centred on the same end of that
        // edge — except at s/2, which is equidistant from both and therefore
        // joins whatever the neighbour's rotation is. A set that does not
        // contain s/2 has no guaranteed connection anywhere, which is how
        // filling the cell from the outside in silently disconnected the whole
        // tiling.
        //
        // Every cell uses the same set, so a neighbour's arc is centred on the
        // same physical corner whenever the rotations agree and each arc meets
        // its opposite number on the shared edge. Where the rotations disagree
        // the lines simply stop: the ends in the pattern are structural, not
        // something a knob manufactures.
        const r = s / 2;
        const mid = 0.70710678; // the 45 degree point of a quarter arc, and the outward ceiling

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
        const fanSw = step > 0 ? Math.min(sw, step * 0.68) : sw;

        // Each arc is coloured from the field at its own midpoint, not at the
        // tile's centre. Sampling once per tile and quantising the result gives
        // every arc in the cell the same step of the ramp, so two neighbouring
        // tiles can land on different steps and the whole cell boundary shows
        // as an edge.
        const corners: [0 | 1 | 2 | 3, 0 | 1 | 2 | 3] = rot % 2 === 0 ? [0, 2] : [1, 3];
        corners.forEach((corner, markIndex) => {
          if (!keep(markIndex + 1)) return;
          for (const rho of radii) {
            if (rho < s * 0.015) continue;
            const k = rho * mid;
            const mx = corner === 1 || corner === 2 ? x0 + s - k : x0 + k;
            const my = corner === 2 || corner === 3 ? y0 + s - k : y0 + k;
            (strokeBuckets[bandAt(mx, my)] as string[]).push(
              el('path', { d: arcPath(corner, rho), 'stroke-width': num(fanSw, 2), 'stroke-opacity': opacity }),
            );
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
      // Subdivision is the one exception, and it is not fixable from here: a
      // quartered cell has half the cell width and therefore half the spacing,
      // so only every second crossing lines up with a full-size neighbour. The
      // arcs have the same seam for the same reason, and it is part of what
      // makes a subdivided patch read as a patch.
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
      const lineSw = lines > 1 ? Math.min(sw, perp * 0.68) : sw;

      // One path per chord, each coloured from the field at its own midpoint,
      // the way the arcs are. Colouring the whole cell from its centre was
      // right when a cell held one line through that centre, and became wrong
      // the moment the count filled the cell with a family: every chord got the
      // one step of the ramp, so the colour changed only at cell boundaries and
      // the grid read as blocks of flat colour. Raising the blend cannot help
      // that — it only gives each block a finer flat colour — which is what
      // "the colour blend is broken" looks like.
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
        const d = `M${num(px, 1)} ${num(py, 1)}L${num(qx, 1)} ${num(qy, 1)}`;
        const chordBand = lines === 1 ? band : bandAt((px + qx) / 2, (py + qy) / 2);
        (strokeBuckets[chordBand] as string[]).push(
          el('path', { d: d + (k === kMax ? extra : ''), 'stroke-width': num(lineSw, 2), 'stroke-opacity': opacity }),
        );
      }
    };

    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) {
        const x = rx * cell;
        const y = originY + ry * cell;
        const cy = y + cell / 2;
        const q = quietFactor(cy, h, quietTop, safeZones);
        // Subdivision is weighted downward: the busy passage belongs where the
        // app grid is, not under the clock.
        const bias = smoothstep(0.15, 1, (cy + cell) / h);
        const chance = subdivide * (0.25 + 0.95 * bias) * (0.3 + 0.7 * q);
        // The guard is on column count, not on pixels: a threshold in pixels
        // would make a 108px thumbnail subdivide differently from a 1399px
        // export, and since the decision consumes the random stream the two
        // would stop being the same picture at all.
        if (cols <= 18 && rng.bool(clamp(chance, 0, 0.95))) {
          const half = cell / 2;
          for (let sy = 0; sy < 2; sy++) {
            for (let sx = 0; sx < 2; sx++) {
              drawTile(x + sx * half, y + sy * half, half, 1);
            }
          }
        } else {
          drawTile(x, y, cell, 0);
        }
      }
    }

    let body = defs + el('rect', { x: 0, y: 0, width: w, height: h, fill: 'url(#tr-bg)' });

    for (let b = 0; b < bands; b++) {
      const fills = fillBuckets[b] as string[];
      const strokes = strokeBuckets[b] as string[];
      const color = bandColors[b] as string;
      if (fills.length > 0) body += el('g', { fill: color, stroke: 'none' }, fills.join(''));
      if (strokes.length > 0) {
        body += el('g', { fill: 'none', stroke: color, 'stroke-linecap': 'round' }, strokes.join(''));
      }
    }

    return svgRoot(w, h, `${truchet.name} wallpaper`, body);
  },
};
