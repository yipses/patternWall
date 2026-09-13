import { accentAt } from '../palette.js';
import { hexToOklch, oklchToHex } from '../color.js';
import { createNoise2D } from '../noise.js';
import { clamp } from '../geometry.js';
import { GRID_SIZE, unpackGrid } from '../imagegrid.js';
import { el, num, svgRoot } from '../svg.js';
import { pBool, pNum, pStr, type Generator, type RenderContext } from '../types.js';

const description = `
Drive a ring of nails into a board, tie on one long black thread, and wind it from nail to nail across the middle. Every pass lays a straight chord over whatever is already there. Do it two thousand times and a face appears — not because any thread knows about the face, but because the places the thread crossed most often are the places that needed to be dark.

The picture is made by a greedy search, which is the whole of the algorithm. Start at a nail. For every other nail, look at the straight line to it and ask how much of the *remaining* darkness that line would cover — the darkness the picture still wants and the thread has not supplied yet. Take the best one, draw it, subtract what it just supplied from that remainder, and start again from the nail you arrived at. Nothing is ever undone and nothing is planned ahead; each step is the best single chord available at that moment, and the portrait is the residue of two thousand such decisions.

What makes it work is the subtraction. Without it the search would pick the same darkest chord forever; with it, every thread makes its own line slightly less attractive and the next one has to go somewhere else. How much each thread supplies is not a setting — it is derived. Add up all the darkness the picture asks for, divide by the number of threads and the length of an average chord, and that is what one thread is worth. Get it wrong and the failure is total rather than subtle: too much and the search fills the whole disc solid before it gets to the detail, too little and it never commits to the shadows at all.

**Threads** therefore controls the tone as much as the detail. Each one is worth less than the last, so a thousand threads and three thousand threads carry the same total ink and differ in how finely it is distributed. **Nails** sets how many directions are available; below about a hundred the chords visibly snap to a coarse set of angles, and past three hundred the extra choices mostly duplicate each other.

Upload a picture and it becomes the target. Anything you give it is reduced to a 48×48 grid of sixteen darkness levels before the solver sees it, which sounds brutal and costs almost nothing: measured against the full-resolution original, the coarse target scores 0.75 correlation where the full one scores 0.78. That reduction is what lets the whole picture travel in the share link — a string-art link is the portrait, not a reference to one. With no picture given, the target is a field of the seed's own noise, which makes an abstract rather than a portrait.
`.trim();

/**
 * The grid the solver actually works on.
 *
 * The stored target is 48x48, but solving at 48 is a different thing from
 * solving *from* 48: the residual is the solver's memory of what it has
 * already covered, and at 48 cells a single thread darkens a huge fraction of
 * every cell it touches, so the bookkeeping is far coarser than the geometry.
 * Measured, solving on the stored grid scores 0.63 correlation where
 * upsampling it first and solving at 128 scores 0.72 and at 300 scores 0.75.
 * 192 sits where the curve has flattened and costs about a third of a second.
 */
const SOLVE_GRID = 192;

/**
 * Nails nearer than this fraction of the ring are not offered as a target.
 *
 * A chord between neighbouring nails is a few pixels long, covers almost
 * nothing, and scores well on any measure that divides by length — so without
 * a floor the search spends its threads creeping around the rim.
 */
const MIN_SPAN = 0.04;

/**
 * The thread count the drawn opacity is calibrated against, and the alpha it
 * gets there. Away from it the alpha moves inversely, so that the same total
 * ink reaches the board however finely it is divided.
 */
const REFERENCE_THREADS = 1800;
const REFERENCE_ALPHA = 0.5;

/** Mean chord length of a circle of radius 1, used to derive the ink. */
const MEAN_CHORD = 4 / Math.PI;

export const stringArt: Generator = {
  id: 'string-art',
  name: 'String Art',
  tagline: 'One thread, a ring of nails, and a picture made of straight lines.',
  tags: ['radial', 'flow'],
  description,
  params: [
    { key: 'image', label: 'Picture', type: 'image', default: '', description: 'The photograph the thread is trying to reproduce, reduced to a 48×48 grid of sixteen darkness levels — small enough that the whole picture travels in the share link. With none given, the target is a field of the seed’s own noise.' },
    { key: 'threads', label: 'Threads', type: 'number', min: 300, max: 4000, step: 50, default: 1800, description: 'How many chords are wound. Each is worth less ink than the last, because the total is fixed by how dark the picture is — so this trades boldness for fineness rather than making the image darker.' },
    { key: 'nails', label: 'Nails', type: 'number', min: 60, max: 360, step: 4, default: 240, description: 'How many directions the thread can take. Below about a hundred the chords snap to a visibly coarse set of angles; past three hundred the extra choices mostly duplicate ones already there.' },
    { key: 'diameter', label: 'Diameter', type: 'number', min: 0.4, max: 1.2, step: 0.01, default: 0.92, description: 'The width of the ring as a fraction of the canvas width. Above 1 the nails run off the sides, which crops the disc into the frame.' },
    { key: 'offsetX', label: 'Offset across', type: 'number', min: -0.5, max: 0.5, step: 0.01, default: 0, description: 'Moves the ring left or right from the middle, as a fraction of the canvas width.' },
    { key: 'offsetY', label: 'Offset down', type: 'number', min: -0.5, max: 0.5, step: 0.01, default: 0, description: 'Moves the ring up or down from the middle, as a fraction of the canvas height. Pushing it below centre puts the picture clear of the clock.' },
    { key: 'thickness', label: 'Thread', type: 'number', min: 0.3, max: 2.5, step: 0.05, default: 1, description: 'How heavy the thread is drawn. It does not change where the threads go — only how much of the board each one covers, so it is the fastest way to lift or flatten the contrast of a finished winding.' },
    { key: 'contrast', label: 'Contrast', type: 'number', min: 0.4, max: 2.5, step: 0.05, default: 1, description: 'A curve on the target before any thread is wound. Below 1 lifts the mid tones so more of the picture gets attention; above 1 drives them down and the thread concentrates on the darkest passages.' },
    { key: 'nailsVisible', label: 'Show nails', type: 'boolean', default: true, description: 'Draws the ring of nails the thread is wound around. They are the one part of the picture that is not thread.' },
  ],

  render(ctx: RenderContext): string {
    const { width: w, height: h, palette, params, rng } = ctx;

    const threads = Math.round(clamp(pNum(params, 'threads', 1800), 300, 4000));
    const nailCount = Math.round(clamp(pNum(params, 'nails', 240), 60, 360));
    const diameter = clamp(pNum(params, 'diameter', 0.92), 0.4, 1.2);
    const offsetX = clamp(pNum(params, 'offsetX', 0), -0.5, 0.5);
    const offsetY = clamp(pNum(params, 'offsetY', 0), -0.5, 0.5);
    const thickness = clamp(pNum(params, 'thickness', 1), 0.3, 2.5);
    const contrast = clamp(pNum(params, 'contrast', 1), 0.4, 2.5);
    const nailsVisible = pBool(params, 'nailsVisible', true);

    const radius = (w * diameter) / 2;
    const cx = w / 2 + offsetX * w;
    const cy = h / 2 + offsetY * h;

    // The target, on the solver's grid. A given picture is a 48x48 grid
    // stretched to it; with none, the seed's own noise stands in, so the
    // pattern is still a pattern rather than an empty ring.
    const given = unpackGrid(pStr(params, 'image', ''));
    const target = new Float32Array(SOLVE_GRID * SOLVE_GRID);
    const noise = createNoise2D(rng);
    for (let j = 0; j < SOLVE_GRID; j++) {
      for (let i = 0; i < SOLVE_GRID; i++) {
        // Outside the ring there is no board to cover, so nothing there can
        // ever be worth a thread.
        const nx = (i + 0.5) / SOLVE_GRID - 0.5;
        const ny = (j + 0.5) / SOLVE_GRID - 0.5;
        if (nx * nx + ny * ny > 0.25) continue;
        let v: number;
        if (given) {
          // Bilinear, not nearest: the stored grid is a quarter the solver's
          // resolution each way, and nearest would hand the search a staircase
          // to chase along every tonal edge.
          const fx = Math.min(GRID_SIZE - 1.001, ((i + 0.5) * GRID_SIZE) / SOLVE_GRID - 0.5);
          const fy = Math.min(GRID_SIZE - 1.001, ((j + 0.5) * GRID_SIZE) / SOLVE_GRID - 0.5);
          const i0 = Math.max(0, Math.floor(fx));
          const j0 = Math.max(0, Math.floor(fy));
          const tx = fx - i0;
          const ty = fy - j0;
          const i1 = Math.min(GRID_SIZE - 1, i0 + 1);
          const j1 = Math.min(GRID_SIZE - 1, j0 + 1);
          v =
            (given[j0 * GRID_SIZE + i0] as number) * (1 - tx) * (1 - ty) +
            (given[j0 * GRID_SIZE + i1] as number) * tx * (1 - ty) +
            (given[j1 * GRID_SIZE + i0] as number) * (1 - tx) * ty +
            (given[j1 * GRID_SIZE + i1] as number) * tx * ty;
        } else {
          // No picture given, so the seed supplies one. Plain noise will not
          // do: it is uniform by construction, and a uniform target gives the
          // search no reason to prefer one chord over another, so the disc
          // comes out an even haze. What makes a picture is a *composition* —
          // here a bright centre falling to a dark rim, which the noise then
          // breaks up into lobes. The vignette is what the thread has an
          // opinion about; the noise is what stops it being a gradient.
          const r2 = (nx * nx + ny * ny) * 4;
          const vignette = clamp(r2 * 0.95, 0, 1);
          const lobes = clamp(noise.fbm(nx * 2.6, ny * 2.6, 3) * 0.5 + 0.5, 0, 1);
          v = clamp(vignette * 0.68 + lobes * 0.5 - 0.12, 0, 1);
        }
        target[j * SOLVE_GRID + i] = Math.pow(v, contrast);
      }
    }

    // Nails, in solver coordinates and in canvas coordinates. The solve is done
    // on the grid and drawn on the canvas, and keeping the two in step by index
    // rather than by rescaling coordinates is what makes a thumbnail and an
    // export wind the identical thread.
    const gr = SOLVE_GRID / 2 - 0.5;
    const gx = new Float64Array(nailCount);
    const gy = new Float64Array(nailCount);
    const px = new Float64Array(nailCount);
    const py = new Float64Array(nailCount);
    for (let i = 0; i < nailCount; i++) {
      const a = (i / nailCount) * Math.PI * 2 - Math.PI / 2;
      gx[i] = SOLVE_GRID / 2 + gr * Math.cos(a);
      gy[i] = SOLVE_GRID / 2 + gr * Math.sin(a);
      px[i] = cx + radius * Math.cos(a);
      py[i] = cy + radius * Math.sin(a);
    }

    // What one thread is worth, derived rather than set. The total ink the
    // picture asks for, divided among the threads that will carry it. This is
    // the number the whole thing turns on: a constant here fills the disc solid
    // at high thread counts and never reaches the shadows at low ones.
    let wanted = 0;
    let boardCells = 0;
    for (let i = 0; i < target.length; i++) {
      wanted += target[i] as number;
      if ((target[i] as number) > 0) boardCells += 1;
    }
    const ink = wanted / Math.max(1, threads * gr * MEAN_CHORD);
    // The same budget has to govern the *drawn* thread as well as the solver's
    // bookkeeping, or the two disagree about what the picture is. Deriving only
    // the subtraction makes thread count a brightness control by the back door:
    // each thread is drawn at a fixed alpha, so four times as many threads is
    // four times the ink on the board however carefully the search rationed it.
    // Measured before this, quadrupling the count laid 2.15x the ink.
    //
    // So the alpha moves inversely with the count, against a fixed reference,
    // and scales with how dark the picture is — a pale target gets a fainter
    // thread rather than the same thread wound fewer times.
    const meanDark = boardCells > 0 ? wanted / boardCells : 0.5;
    const alpha = clamp((REFERENCE_ALPHA * meanDark * REFERENCE_THREADS) / (0.5 * threads), 0.05, 0.9);

    const residual = Float32Array.from(target);
    const minSpan = Math.max(1, Math.round(nailCount * MIN_SPAN));
    const order: number[] = [0];
    let at = 0;

    for (let t = 0; t < threads; t++) {
      let bestNail = -1;
      let bestScore = 0;
      for (let step = minSpan; step <= nailCount - minSpan; step++) {
        const cand = (at + step) % nailCount;
        // Walk the chord on the grid, averaging the darkness still wanted.
        // Averaged rather than summed, because a sum rewards length as much as
        // darkness and a diameter is the longest chord there is. The two are
        // not far apart in practice -- swapping the mean for a sum still
        // produces a recognisable picture, and it is a choice rather than a
        // correctness question -- but the mean is the one that answers "is
        // there darkness along here", which is the question being asked.
        const x0 = gx[at] as number;
        const y0 = gy[at] as number;
        const dx = (gx[cand] as number) - x0;
        const dy = (gy[cand] as number) - y0;
        const steps = Math.max(1, Math.round(Math.hypot(dx, dy)));
        let sum = 0;
        for (let k = 0; k <= steps; k++) {
          const x = Math.round(x0 + (dx * k) / steps);
          const y = Math.round(y0 + (dy * k) / steps);
          if (x >= 0 && y >= 0 && x < SOLVE_GRID && y < SOLVE_GRID) sum += residual[y * SOLVE_GRID + x] as number;
        }
        const score = sum / (steps + 1);
        if (score > bestScore) {
          bestScore = score;
          bestNail = cand;
        }
      }
      // Nothing left that a thread would improve. Stopping here rather than
      // winding out the full count is what keeps a sparse picture sparse.
      if (bestNail < 0) break;

      const x0 = gx[at] as number;
      const y0 = gy[at] as number;
      const dx = (gx[bestNail] as number) - x0;
      const dy = (gy[bestNail] as number) - y0;
      const steps = Math.max(1, Math.round(Math.hypot(dx, dy)));
      for (let k = 0; k <= steps; k++) {
        const x = Math.round(x0 + (dx * k) / steps);
        const y = Math.round(y0 + (dy * k) / steps);
        if (x >= 0 && y >= 0 && x < SOLVE_GRID && y < SOLVE_GRID) {
          const idx = y * SOLVE_GRID + x;
          residual[idx] = Math.max(0, (residual[idx] as number) - ink);
        }
      }
      order.push(bestNail);
      at = bestNail;
    }

    // One path, because it is one thread. That is both the truth of the object
    // and the cheapest possible document: two thousand chords are two thousand
    // coordinate pairs, not two thousand elements.
    let d = '';
    for (let i = 0; i < order.length; i++) {
      const n = order[i] as number;
      d += `${i === 0 ? 'M' : 'L'}${num(px[n] as number, 1)} ${num(py[n] as number, 1)}`;
    }

    const paper = hexToOklch(palette.background);
    const thread = hexToOklch(accentAt(palette, 0.5));
    // The thread is drawn well short of opaque, because the picture is made of
    // overlap: a chord that crosses fifty others has to read darker than one
    // that crosses five, and at full strength every chord is the same black and
    // the tone collapses to a silhouette.
    const strokeWidth = (w / 900) * thickness;
    const threadHex = oklchToHex({
      ...thread,
      l: clamp(paper.l + (thread.l - paper.l) * 1.1, 0.03, 0.97),
    });

    let body = el('rect', { x: 0, y: 0, width: w, height: h, fill: palette.background });
    body += el('path', {
      d,
      fill: 'none',
      stroke: threadHex,
      'stroke-width': num(strokeWidth, 3),
      'stroke-opacity': num(alpha, 3),
      'stroke-linecap': 'round',
    });

    if (nailsVisible) {
      let nails = '';
      for (let i = 0; i < nailCount; i++) {
        nails += el('circle', { cx: num(px[i] as number, 1), cy: num(py[i] as number, 1), r: num(strokeWidth * 1.1, 3) });
      }
      body += el('g', { fill: palette.ink, 'fill-opacity': '0.55' }, nails);
    }

    return svgRoot(w, h, `${stringArt.name} wallpaper`, body);
  },
};
