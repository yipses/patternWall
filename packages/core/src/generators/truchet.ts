import { accent, accentAt } from '../palette.js';
import { hexToOklch, mixOklch, oklchToHex } from '../color.js';
import { createNoise2D } from '../noise.js';
import { hashSeed } from '../rng.js';
import { clamp, quietFactor, smoothstep } from '../geometry.js';
import { el, num, svgRoot } from '../svg.js';
import { pBool, pNum, pStr, type Generator, type RenderContext } from '../types.js';

const description = `
A Truchet tile is a square with an asymmetric mark on it — Sébastien Truchet’s original was a square split into two triangles — and a Truchet tiling is what you get when you fill a grid with copies of that square in random rotations. The remarkable thing is how little you have to specify. One tile, four rotations and a coin flip per cell produce paths that wander across the whole grid, close into loops, and look considered in a way that no part of the rule accounts for.

Three tile sets are offered here and they behave quite differently. **Quarter arcs** join edge midpoints with two 90° curves centred on opposite corners, so every cell edge is a connection point and the marks meet: the result is a tangle of closed loops. The corner is the whole trick — two circles of a given radius pass through any pair of points, and centring these on the cell's middle instead produces marks that still meet at the edges but can never curl around a grid vertex, so no loop, half circle or full circle ever forms. **Diagonals** connect corners instead, which means paths meet at cell corners rather than edges and the tiling reads as a lattice of switchbacks rather than as loops. **Triangles** fill half of each cell, which turns the whole thing from line work into a mass of light and dark, and is by far the strongest option at low densities. The mixed set chooses per cell, which sacrifices the single coherent logic for a texture that is more restless.

Two controls decide how much the arcs behave like a single continuous system. **Open ends** drops marks, so paths stop rather than always continuing; a field with nothing dropped can only close into loops or run off the canvas, which reads as busier than it is. **Arc count** replaces each single quarter arc with a fan of concentric ones sharing the same corner. Because a neighbour's fan is centred on that same physical point whenever the rotations agree, every radius in the fan meets its opposite number across the edge and the marks become nested ribbons; where the rotations disagree, the lines simply stop. A fan is drawn on one corner rather than two, because circles centred on opposite corners of a square intersect as soon as their radii sum past the diagonal, and two opposing fans turn into moiré rather than pattern.

Subdivision is where this implementation departs from the classical rule. A fraction of cells are replaced by a 2×2 block of quarter-size tiles, and that fraction rises toward the bottom of the canvas. A uniform grid has a uniform level of interest, which is exactly wrong for a wallpaper: the eye wants somewhere to rest and somewhere to look. Pushing the fine detail downward puts the busy passage where the app icons and the dock live, and leaves the clock sitting on something calm.

**Row weight** does a similar job with a different lever. Stroke width increases as the grid descends, which reads as the pattern advancing toward you — a very cheap depth cue that costs one multiplication per row. At zero every line is the same width and the tiling flattens into a diagram, which is sometimes what you want.

Grid **density** interacts with everything. Below about six columns the tiles are large enough that you read each one individually and the tile set matters enormously; above about twenty you stop seeing tiles at all and start seeing a woven texture, at which point stroke weight matters more than which set you chose.
`.trim();

type TileKind = 'arcs' | 'diagonals' | 'triangles';

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
        { value: 'mixed', label: 'Mixed' },
      ],
      default: 'arcs',
      description: 'Arcs make continuous loops, diagonals make switchbacks, triangles make mass instead of line.',
    },
    { key: 'weight', label: 'Stroke weight', type: 'number', min: 0.02, max: 0.5, step: 0.01, default: 0.16, description: 'Line width as a fraction of the cell. Above about 0.4 the arcs start to touch and read as solid.' },
    { key: 'rowVariation', label: 'Row weight variation', type: 'number', min: 0, max: 1, step: 0.02, default: 0.55, description: 'How much heavier the strokes get toward the bottom. A cheap and effective depth cue.' },
    { key: 'subdivide', label: 'Subdivision', type: 'number', min: 0, max: 1, step: 0.02, default: 0.35, description: 'Chance that a cell becomes a 2x2 block of smaller tiles. Weighted toward the lower canvas.' },
    { key: 'colorSpread', label: 'Colour spread', type: 'number', min: 0, max: 1, step: 0.01, default: 0.6, description: 'How much of the tile colour comes from noise rather than from height. At zero the accents run as a clean vertical ramp; at one they scatter.' },
    { key: 'quietTop', label: 'Quiet top', type: 'number', min: 0, max: 1, step: 0.01, default: 0.55, description: 'Thins the strokes and suppresses subdivision where iOS draws the clock.' },
    { key: 'gap', label: 'Cell gap', type: 'boolean', default: false, description: 'Inset every tile slightly so the grid itself becomes visible as white space.' },
    { key: 'openEnds', label: 'Open ends', type: 'number', min: 0, max: 0.8, step: 0.02, default: 0.22, description: 'Chance a tile drops one of its two arcs, so paths terminate instead of always closing into loops. Applies to the single-arc tile only: a fan needs every cell to carry the same radii or its arcs have nothing to meet across the edge, and ends there already come from neighbours facing different corners.' },
    { key: 'arcCount', label: 'Arc count', type: 'number', min: 1, max: 12, step: 1, default: 1, description: 'Concentric arcs per mark, nested inward. The outermost stays put, so raising this adds rings inside a mark the same size rather than shrinking it. Once the rings reach the corner, more has no effect.' },
    { key: 'arcSpacing', label: 'Arc spacing', type: 'number', min: 0.03, max: 0.2, step: 0.005, default: 0.09, description: 'Gap between concentric arcs, as a fraction of the cell. Tight values read as a single thick braid, wide ones as separate lines.' },
  ],

  render(ctx: RenderContext): string {
    const { width: w, height: h, palette, params, rng, safeZones } = ctx;
    const noise = createNoise2D(rng);

    const cols = Math.max(2, Math.round(pNum(params, 'density', 8)));
    const tileSet = pStr(params, 'tileSet', 'arcs');
    const weight = pNum(params, 'weight', 0.16);
    const rowVariation = pNum(params, 'rowVariation', 0.55);
    const subdivide = pNum(params, 'subdivide', 0.35);
    const colorSpread = pNum(params, 'colorSpread', 0.6);
    const openEnds = pNum(params, 'openEnds', 0.22);
    const arcCount = Math.max(1, Math.round(pNum(params, 'arcCount', 1)));
    const arcSpacing = pNum(params, 'arcSpacing', 0.09);
    const quietTop = pNum(params, 'quietTop', 0.55);
    const gap = pBool(params, 'gap', false);

    const cell = w / cols;
    const rows = Math.ceil(h / cell) + 1;
    const originY = (h - rows * cell) / 2;

    const bg = hexToOklch(palette.background);
    const tintTop = oklchToHex({ ...bg, l: clamp(bg.l + (palette.mode === 'dark' ? 0.018 : -0.014), 0, 1) });
    const tintBottom = oklchToHex(mixOklch(bg, hexToOklch(accentAt(palette, 0.75)), palette.mode === 'dark' ? 0.1 : 0.07));

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
    const bands = Math.max(1, Math.min(4, palette.accents.length));
    const strokeBuckets: string[][] = Array.from({ length: bands }, () => []);
    const fillBuckets: string[][] = Array.from({ length: bands }, () => []);

    const kindFor = (rx: number, ry: number): TileKind => {
      if (tileSet === 'mixed') {
        const v = noise.value(rx * 3.1 + 7, ry * 3.1 - 3);
        return v < -0.2 ? 'diagonals' : v > 0.25 ? 'triangles' : 'arcs';
      }
      return tileSet as TileKind;
    };

    const drawTile = (x: number, y: number, size: number, depth: number): void => {
      const cy = y + size / 2;
      const q = quietFactor(cy, h, quietTop, safeZones);
      const rowT = clamp((cy - originY) / Math.max(1, h), 0, 1);
      const inset = gap ? size * 0.07 : 0;
      const s = size - inset * 2;
      const x0 = x + inset;
      const y0 = y + inset;
      if (s <= 0.5) return;

      const sw = clamp(weight * s * (1 - rowVariation * 0.5 + rowVariation * rowT * 1.1) * (0.34 + 0.66 * q), s * 0.012, s * 0.62);
      const tone = clamp(
        (noise.value(x * 0.015 + 3, y * 0.015 - 9) * 0.5 + 0.5) * colorSpread + rowT * (1 - colorSpread) * 0.9,
        0,
        1,
      );
      const band = Math.min(bands - 1, Math.floor(tone * bands));
      const rot = rng.int(0, 3);
      const kind = kindFor(x / Math.max(1, cell), y / Math.max(1, cell));

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
        (fillBuckets[band] as string[]).push(
          el('polygon', {
            points: tri.map((p) => `${num(p[0], 1)},${num(p[1], 1)}`).join(' '),
            'fill-opacity': num(clamp(0.16 + 0.74 * q + depth * 0.08, 0.06, 1), 2),
          }),
        );
        return;
      }

      const opacity = num(clamp(0.16 + 0.84 * q, 0.06, 1), 2);
      if (kind === 'arcs') {
        const r = s / 2;
        const a = rot % 2 === 0;
        // Two quarter arcs joining opposite pairs of edge midpoints.
        // Sweep flag 0, not 1. With sweep 1 the renderer picks the other of the
        // two circles that fit these endpoints — the one centred on the cell
        // centre — so every arc bulged away from its corner. The marks still
        // met at the edge midpoints, so the tiling looked plausible, but no arc
        // was ever centred on a grid vertex and the loops, half circles and
        // full circles that make a Truchet tiling worth looking at could not
        // form at all. Sweep 0 centres each quarter arc on its corner.
        // A fan is centred on one corner and a neighbour's fan is centred on
        // the same physical point when their rotations agree, so every radius
        // meets its opposite number across the edge. Where they disagree the
        // lines simply stop, which is where the open ends come from.
        //
        // One arc per mark is the classic tile: two quarter arcs on opposite
        // corners, both through the edge midpoints. More than one switches to a
        // single fan per cell. Two opposing fans would cross — circles centred
        // on opposite corners intersect once their radii sum past the diagonal
        // — and the result is moire rather than pattern.
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
        const keep = (salt: number): boolean =>
          openEnds <= 0 || hashSeed(`${gx}:${gy}:${gs}:${salt}`) / 0x100000000 >= openEnds;

        // The drop is per mark, never per radius. A mark is a ribbon of
        // concentric arcs that reads as a single stroke, so dropping radii out
        // of it does not make a path end, it shreds the ribbon into unrelated
        // fragments. Dropping a whole mark leaves the tile's other one, so the
        // cell keeps something and the neighbour's arcs across that edge stop
        // there — a real end rather than a hole.
        //
        // Arc count nests inward from the outer radius rather than growing
        // outward from the corner. The outermost arc is always the one through
        // the edge midpoints, so raising the count adds rings inside a mark
        // that stays the same size, instead of replacing it with a smaller
        // one. It also means the tile is the classic Truchet tile at every
        // count — two marks on opposite corners — rather than switching shape
        // at two.
        //
        // Capping the radii at r is what makes two opposing marks safe: circles
        // centred on opposite corners of a square intersect only once their
        // radii sum past the diagonal, s * sqrt(2), and two radii of at most
        // s / 2 sum to at most s. Let a fan grow past r and the two marks cross,
        // which is moire rather than pattern.
        let d = '';
        const corners: [0 | 1 | 2 | 3, 0 | 1 | 2 | 3] = a ? [0, 2] : [1, 3];
        corners.forEach((corner, markIndex) => {
          if (!keep(markIndex + 1)) return;
          for (let i = 0; i < arcCount; i++) {
            const rho = r - i * arcSpacing * s;
            // Stop when the ribbon has reached the corner it is centred on.
            if (rho < s * 0.02) break;
            d += arcPath(corner, rho);
          }
        });
        if (!d) return;
        // A fan drawn with the full stroke weight closes up into a solid block.
        // Cap it against the gap so the lines stay separate whatever the
        // weight slider says.
        const fanSw = arcCount > 1 ? Math.min(sw, arcSpacing * s * 0.55) : sw;
        (strokeBuckets[band] as string[]).push(
          el('path', { d, 'stroke-width': num(fanSw, 2), 'stroke-opacity': opacity }),
        );
        return;
      }

      const a = rot % 2 === 0;
      const d = a
        ? `M${num(x0, 1)} ${num(y0, 1)}L${num(x0 + s, 1)} ${num(y0 + s, 1)}`
        : `M${num(x0 + s, 1)} ${num(y0, 1)}L${num(x0, 1)} ${num(y0 + s, 1)}`;
      const extra = rng.bool(0.35)
        ? a
          ? `M${num(x0 + s, 1)} ${num(y0, 1)}L${num(x0 + s * 0.6, 1)} ${num(y0 + s * 0.4, 1)}`
          : `M${num(x0, 1)} ${num(y0, 1)}L${num(x0 + s * 0.4, 1)} ${num(y0 + s * 0.4, 1)}`
        : '';
      (strokeBuckets[band] as string[]).push(el('path', { d: d + extra, 'stroke-width': num(sw, 2), 'stroke-opacity': opacity }));
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
      const color = accent(palette, b);
      if (fills.length > 0) body += el('g', { fill: color, stroke: 'none' }, fills.join(''));
      if (strokes.length > 0) {
        body += el('g', { fill: 'none', stroke: color, 'stroke-linecap': 'round' }, strokes.join(''));
      }
    }

    return svgRoot(w, h, `${truchet.name} wallpaper`, body);
  },
};
