import { accentAt } from '../palette.js';
import { hexToOklch, oklchToHex } from '../color.js';
import { createNoise2D } from '../noise.js';
import { clamp, smoothstep } from '../geometry.js';
import { el, num, points, svgRoot } from '../svg.js';
import { pNum, type Generator, type RenderContext } from '../types.js';

const description = `
A cube seen corner-on is three rhombi: a top face and two sides meeting at a vertical edge. Draw that edge and the two faces either side of it and you have a chevron; stack the cubes and the chevrons run into each other into columns of light and shade. The quilters got here first — this is the Tumbling Blocks block, pieced from diamonds since the 1850s — and the reason it has lasted is that the eye insists on reading a flat arrangement of sixty-degree rhombi as solid objects with a light source, even knowing better.

Underneath it is a heightfield rather than a tiling. Every cell of a square ground grid carries a stack of cubes, the stack heights come from fractal noise, and the whole thing is projected isometrically: one step across the ground moves the drawing half a cube down and √3⁄2 across, and one storey up moves it a whole cube straight up. Nothing here is drawn in perspective, which is the point of the projection — a cube at the top of the canvas is exactly the same size and shape as one at the bottom, so the pattern reads as depth without ever having a vanishing point to give it away.

Because it is a heightfield and not a pile of loose cubes, the visible geometry is small and exact. A column shows its top face, and it shows each of its two front walls only down to whatever its neighbour on that side has reached — below that the neighbour is in the way. So the drawing is the *surface*, never the inside, and there is no need to sort or hide anything: the walls are exactly as tall as the step between one stack and the next. **Relief** is the height of those steps. At zero every stack is one cube tall, the walls vanish and what is left is the flat diamond tiling the projection started from; wind it up and the surface breaks into terraces.

**Skyline** is the composition control, and it is a structural one rather than a wash. Stacks grow taller toward the bottom of the canvas, so the upper third settles into a near-flat plain of top faces — quiet ground for a clock to sit on — while the lower canvas, which iOS leaves alone, carries the towers and the deep shaded walls. Nothing is dimmed to achieve that; there is simply less relief up there, the same way a distant plain has less to look at than the foreground.

The three faces of every cube are one accent at three lightnesses, not three different colours: **face light** is the spread between them, and keeping the hue fixed is what makes the light read as light rather than as decoration. **Mortar** insets each face by a hairline of the background, which is the difference between a stack of blocks and a single faceted surface — at zero the faces meet directly and the pattern tips back toward being flat, which is worth looking at too.
`.trim();

/**
 * A cube's edge, projected. One step across the ground moves half that
 * distance down the screen and `SQRT3_2` of it across; one storey moves a
 * whole one straight up.
 */
const SQRT3_2 = Math.sqrt(3) / 2;

/**
 * The tallest a stack may get, in storeys. It bounds how far above its own
 * ground square a column can reach, which is what says how many rows of cells
 * beyond the top edge have to be walked before the first visible one.
 */
const MAX_STOREYS = 9;

/**
 * Accent steps the colour walks, fixed rather than tied to the block count, so
 * the palette moves at the same rate whether the blocks are large or small.
 */
const COLOR_STEPS = 24;

/** Noise frequency for the stack heights, in canvas widths. */
const TERRAIN_FIELD = 2.6;

/**
 * How far a block's body is pulled from its accent toward the paper.
 *
 * This pattern covers the canvas completely, which no other generator here
 * does, and that changes what a colour is allowed to be. A mark on a dark
 * ground can be a full-strength accent because there is ground around it to
 * say so; a wall of full-strength accent is just a bright wallpaper, and the
 * palette stops being visible as anything but a hue. Pulling the body toward
 * the paper in *lightness* — and only barely in chroma — is what keeps the
 * palette's own darkness in the picture without turning every block to mud,
 * which is what mixing the two colours outright does against a near-black
 * background.
 */
const BODY_TOWARD_PAPER = 0.42;

/**
 * ...but never closer to the paper than this, in lightness.
 *
 * The fraction alone leaves the pattern at the mercy of how bright a palette's
 * accents happen to be, and measured across the curated set that runs from
 * 0.47 of a lightness unit away from the paper on Obsidian down to 0.19 on
 * Fog — the difference between a solid block landscape and a wash. A floor
 * costs the brighter palettes nothing and gives the quiet ones something to
 * be a block against.
 */
const BODY_MIN_FROM_PAPER = 0.34;

/**
 * Where the skyline ramp starts and finishes, as fractions of the canvas
 * height. It begins below the clock so the whole of that zone is plain, and
 * finishes before the bottom so the towers have somewhere to stand.
 */
const SKY_FROM = 0.18;
const SKY_TO = 0.88;

/** Lightness between the lit face and the shaded one, at full face light. */
const FACE_SPREAD = 0.3;

/**
 * The colour field is deliberately broader than the terrain. Both at the same
 * frequency gives every little massif its own hue and the map reads as
 * confetti; at half of it the colour moves across the canvas in a few large
 * regions and the relief is what carries the detail.
 */
const COLOR_FIELD = TERRAIN_FIELD * 0.42;

/** Offsets so the colour field is a different slice of the same noise. */
const COLOR_OFFSET_X = 31.7;
const COLOR_OFFSET_Y = -18.3;

export const chevronBlocks: Generator = {
  id: 'chevron-blocks',
  name: 'Chevron Blocks',
  tagline: 'A heightfield of cubes, seen corner-on, where every edge is a chevron.',
  tags: ['isometric', 'grid'],
  description,
  params: [
    { key: 'blockSize', label: 'Block size', type: 'number', min: 0.035, max: 0.16, step: 0.005, default: 0.075, description: 'The edge of one cube, as a fraction of the canvas width. Everything else is derived from it, so this is the only control that changes how many blocks there are.' },
    { key: 'relief', label: 'Relief', type: 'number', min: 0, max: 1, step: 0.01, default: 0.62, description: 'How far the stacks differ in height. At zero every stack is a single cube, the walls disappear and the pattern falls back to the flat diamond tiling underneath it; high up it becomes a landscape of terraces and deep shaded steps.' },
    { key: 'skyline', label: 'Skyline', type: 'number', min: 0, max: 1, step: 0.01, default: 0.85, description: 'Grows the stacks toward the bottom of the canvas and flattens them toward the top, so the clock sits on a quiet plain and the towers fall in the lower half where iOS covers nothing. Structural rather than a dimming — there is genuinely less relief up there.' },
    { key: 'clumping', label: 'Clumping', type: 'number', min: 0.4, max: 3.5, step: 0.05, default: 0.8, description: 'How broad the high ground is. Low values give two or three massifs across the width; high values break the surface into small scattered towers.' },
    { key: 'faceLight', label: 'Face light', type: 'number', min: 0, max: 1, step: 0.01, default: 0.62, description: 'The lightness spread between a cube’s three faces. It is one accent at three lightnesses rather than three colours, which is what makes the eye read it as a light source. At zero the faces match and the solid collapses into flat hexagons.' },
    { key: 'colorSpread', label: 'Colour spread', type: 'number', min: 0, max: 1, step: 0.01, default: 0.7, description: 'How much of the accent ramp the blocks walk as they cross the canvas. At zero every block is the middle of the palette and only the shading varies.' },
    { key: 'mortar', label: 'Mortar', type: 'number', min: 0, max: 1, step: 0.01, default: 0.35, description: 'A hairline of background between one face and the next. It is the difference between a stack of separate blocks and one faceted surface; at zero the faces meet directly.' },
  ],

  render(ctx: RenderContext): string {
    const { width: w, height: h, palette, params, rng } = ctx;
    const noise = createNoise2D(rng);
    const paper = hexToOklch(palette.background);

    const size = clamp(pNum(params, 'blockSize', 0.075), 0.035, 0.16);
    const relief = clamp(pNum(params, 'relief', 0.62), 0, 1);
    const skyline = clamp(pNum(params, 'skyline', 0.85), 0, 1);
    const clumping = clamp(pNum(params, 'clumping', 0.8), 0.4, 3.5);
    const faceLight = clamp(pNum(params, 'faceLight', 0.62), 0, 1);
    const colorSpread = clamp(pNum(params, 'colorSpread', 0.7), 0, 1);
    const mortar = clamp(pNum(params, 'mortar', 0.35), 0, 1);

    // The projection, in canvas units. `ux`/`uy` are one ground step; `uz` is
    // one storey. All three are fractions of the width, so the lattice is the
    // same shape at a 108px thumbnail and a 1399px export and every decision
    // below can be keyed on grid indices.
    const edge = w * size;
    const ux = edge * SQRT3_2;
    const uy = edge * 0.5;
    const uz = edge;
    const ox = w / 2;

    /**
     * Where a ground corner lands on the canvas.
     *
     * `i` and `j` are the two ground axes and `k` is the storey. The two
     * ground axes are symmetric about the vertical: stepping along one moves
     * right and down, stepping along the other moves left and down by the same
     * amount, which is what makes the top faces rhombi rather than squares.
     */
    const px = (i: number, j: number): number => ox + ux * (i - j);
    const py = (i: number, j: number, k: number): number => uy * (i + j) - uz * k;

    /**
     * How tall the stack on one ground square is, in storeys, at least one.
     *
     * Sampled in canvas-relative coordinates rather than in cell counts, so
     * that changing the block size changes how big the blocks are without also
     * rearranging the landscape they sit in. Both arguments come from grid
     * indices, so a thumbnail and an export agree exactly.
     */
    const heightAt = (i: number, j: number): number => {
      const nx = (size * SQRT3_2 * (i - j)) * TERRAIN_FIELD * clumping;
      const ny = (size * 0.5 * (i + j)) * TERRAIN_FIELD * clumping;
      const field = noise.fbm(nx, ny, 3) * 0.5 + 0.5;
      // Skyline is a claim about composition, and it earns it structurally:
      // what falls off toward the top is the amount of relief, not the ink. A
      // factor keyed on height applied to a uniform tiling draws a horizontal
      // band across it — that mistake is recorded elsewhere in this repo — but
      // here the stacks up there genuinely are shorter, so the top of the
      // canvas has less to say rather than being told to say it quietly.
      const ground = clamp((uy * (i + j)) / Math.max(1, h), -0.3, 1.3);
      const bias = 1 - skyline * (1 - smoothstep(SKY_FROM, SKY_TO, ground));
      const rise = relief * MAX_STOREYS * bias;
      return 1 + Math.round(clamp(field, 0, 1) * rise);
    };

    /** The accent step a whole column is painted in. */
    const tintAt = (i: number, j: number): number => {
      const nx = (size * SQRT3_2 * (i - j)) * COLOR_FIELD + COLOR_OFFSET_X;
      const ny = (size * 0.5 * (i + j)) * COLOR_FIELD + COLOR_OFFSET_Y;
      const field = noise.fbm(nx, ny, 2) * 0.5 + 0.5;
      const t = clamp(0.5 + (field - 0.5) * colorSpread * 2, 0, 1);
      return Math.round(t * (COLOR_STEPS - 1)) / (COLOR_STEPS - 1);
    };

    // The three faces are one accent at three lightnesses. Hue held fixed is
    // the whole trick: three different colours read as three shapes, and the
    // same colour at three lightnesses reads as one shape with a light on it.
    const faceCache = new Map<number, [string, string, string]>();
    const facesFor = (t: number): [string, string, string] => {
      const key = Math.round(t * (COLOR_STEPS - 1));
      const found = faceCache.get(key);
      if (found) return found;
      const acc = hexToOklch(accentAt(palette, t));
      // Light from above, and the same arithmetic on a dark palette and a light
      // one: the body sits partway from the accent toward the paper, the roof
      // rises from it and the shaded wall falls. Anchoring on the paper's own
      // lightness is what makes one rule serve both — on black the blocks
      // darken toward it, on white they lighten, and in each case the lit face
      // is the one nearer the light.
      const away = acc.l >= paper.l ? 1 : -1;
      const reach = Math.max(BODY_MIN_FROM_PAPER, Math.abs(acc.l - paper.l) * (1 - BODY_TOWARD_PAPER));
      const mid = paper.l + away * reach;
      const spread = faceLight * FACE_SPREAD;
      const face = (dl: number, chroma: number): string =>
        oklchToHex({ l: clamp(mid + dl, 0.03, 0.98), c: acc.c * chroma, h: acc.h });
      // The two walls differ from each other as well as from the roof. A cube
      // with one lit face and two matching ones reads as a folded sheet rather
      // than as a solid, because nothing distinguishes its vertical edge.
      const trio: [string, string, string] = [
        face(spread * 0.62, 0.95),
        face(0, 0.85),
        face(-spread, 0.7),
      ];
      faceCache.set(key, trio);
      return trio;
    };

    // How far the lattice has to run to cover the canvas.
    //
    // The two ends are not symmetric, which is the easy thing to get wrong —
    // and getting it wrong the generous way costs geometry rather than showing
    // up as a hole, so it is worth stating why. A stack grows a whole cube
    // upward per storey while a row of ground steps down only half of one, so
    // height moves everything *up* the canvas. That means the bottom edge needs
    // the margin: a column whose ground square is well below the canvas can
    // still have its roof inside it, two rows below per storey it might be
    // tall. The top edge needs almost none, because the columns that cover it
    // are ones whose ground is *below* it — a flat stack one cube high shows at
    // its own ground row plus two, and every taller one shows lower still.
    //
    // Measured by sweeping both: starting the walk four rows above the canvas
    // is clear of any gap, and starting it four rows below opens 4.3% of the
    // canvas. At the other end, half this margin leaves 0.3% bare at the
    // largest blocks and full relief, and none of it leaves 33%.
    const dSpan = Math.ceil((w / 2 + ux * 2) / ux);
    const rows = Math.ceil(h / uy);
    const sMin = -4;
    const sMax = rows + 2 * MAX_STOREYS + 2;

    const heights = new Map<number, number>();
    const heightOf = (i: number, j: number): number => {
      const key = (i + 512) * 4096 + (j + 512);
      let v = heights.get(key);
      if (v === undefined) {
        v = heightAt(i, j);
        heights.set(key, v);
      }
      return v;
    };

    const quad = (a: [number, number], b: [number, number], c: [number, number], d: [number, number], fill: string): string =>
      el('polygon', { points: points([a, b, c, d]), fill });

    let body = '';
    // Back to front: a larger ground sum is nearer the viewer and lower on the
    // canvas. Within one column the walls are cut to the neighbour's height
    // already, so nothing inside a column can overlap anything else in it and
    // the order there is free.
    for (let s = sMin; s <= sMax; s++) {
      for (let d = -dSpan; d <= dSpan; d++) {
        // i + j and i - j must agree in parity for i and j to be whole.
        if (((s + d) & 1) !== 0) continue;
        const i = (s + d) / 2;
        const j = (s - d) / 2;

        const top = heightOf(i, j);
        const right = heightOf(i + 1, j);
        const left = heightOf(i, j + 1);

        // Everything this column draws sits between its roof and the lower of
        // its two neighbours' roofs. If that band is off the canvas, so is the
        // column.
        const roofY = py(i, j, top);
        const footY = py(i + 1, j + 1, Math.min(right, left));
        if (footY < -uy || roofY > h + uy) continue;

        const [topFace, leftFace, rightFace] = facesFor(tintAt(i, j));

        // The roof: the rhombus of the ground square, lifted to the top of the
        // stack. Its far corner is up the canvas and its near corner down it.
        const back: [number, number] = [px(i, j), py(i, j, top)];
        const east: [number, number] = [px(i + 1, j), py(i + 1, j, top)];
        const front: [number, number] = [px(i + 1, j + 1), py(i + 1, j + 1, top)];
        const west: [number, number] = [px(i, j + 1), py(i, j + 1, top)];
        body += quad(back, east, front, west, topFace);

        // The two walls, one storey at a time so that every block keeps its own
        // edges. Each runs from the roof down to the neighbour on that side —
        // below that the neighbour is in front of it, and a heightfield never
        // shows its own inside.
        for (let k = top; k > right; k--) {
          body += quad(
            [px(i + 1, j), py(i + 1, j, k)],
            [px(i + 1, j + 1), py(i + 1, j + 1, k)],
            [px(i + 1, j + 1), py(i + 1, j + 1, k - 1)],
            [px(i + 1, j), py(i + 1, j, k - 1)],
            rightFace,
          );
        }
        for (let k = top; k > left; k--) {
          body += quad(
            [px(i, j + 1), py(i, j + 1, k)],
            [px(i + 1, j + 1), py(i + 1, j + 1, k)],
            [px(i + 1, j + 1), py(i + 1, j + 1, k - 1)],
            [px(i, j + 1), py(i, j + 1, k - 1)],
            leftFace,
          );
        }
      }
    }

    // The mortar is a stroke in the background colour on the group rather than
    // a gap between the shapes, so it costs one attribute instead of shrinking
    // several thousand polygons. Fill still varies per face, so the group
    // cannot also carry that — and the faces cannot be grouped by colour
    // either, since a nearer block has to be able to paint over a further one.
    const line = mortar > 0 ? edge * 0.055 * mortar : 0;
    const attrsFor: Record<string, string | number> = line > 0
      ? { stroke: palette.background, 'stroke-width': num(line, 3), 'stroke-linejoin': 'round' }
      : {};

    return svgRoot(
      w,
      h,
      `${chevronBlocks.name} wallpaper`,
      el('rect', { x: 0, y: 0, width: w, height: h, fill: palette.background }) + el('g', attrsFor, body),
    );
  },
};
