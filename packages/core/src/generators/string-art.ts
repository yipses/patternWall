import { accentAt } from '../palette.js';
import { hexToOklch, mixOklch, oklchToHex } from '../color.js';
import { createNoise2D } from '../noise.js';
import { clamp } from '../geometry.js';
import { GRID_SIZES, unpackGrid } from '../imagegrid.js';
import { el, num, svgRoot } from '../svg.js';
import { pBool, pNum, pStr, type Generator, type RenderContext } from '../types.js';

const description = `
Drive a ring of nails into a board, tie on one long black thread, and wind it from nail to nail across the middle. Every pass lays a straight chord over whatever is already there. Do it two thousand times and a face appears — not because any thread knows about the face, but because the places the thread crossed most often are the places that needed to be dark.

The picture is made by a greedy search, which is the whole of the algorithm. Start at a nail. For every other nail, look at the straight line to it and ask how much of the *remaining* darkness that line would cover — the darkness the picture still wants and the thread has not supplied yet. Take the best one, draw it, subtract what it just supplied from that remainder, and start again from the nail you arrived at. Nothing is ever undone and nothing is planned ahead; each step is the best single chord available at that moment, and the portrait is the residue of two thousand such decisions.

What makes it work is the subtraction. Without it the search would pick the same darkest chord forever; with it, every thread makes its own line slightly less attractive and the next one has to go somewhere else. How much each thread supplies is not a setting — it is derived. Add up all the darkness the picture asks for, divide by the number of threads and the length of an average chord, and that is what one thread is worth. Get it wrong and the failure is total rather than subtle: too much and the search fills the whole disc solid before it gets to the detail, too little and it never commits to the shadows at all.

**Threads** therefore controls the fineness rather than the darkness. Each one is worth less than the last, because the total is fixed by the picture, so a thousand threads and three thousand carry the same ink and differ in how finely it is divided — though more of them do resolve more, because tone here is made of crossings and more threads means more places to cross. **Nails** sets how many directions are available; below about a hundred the chords visibly snap to a coarse set of angles, and past three hundred the extra choices mostly duplicate each other.

Upload a picture and it becomes the target. Whatever you give it is reduced to a square grid of sixteen darkness levels before the solver sees it, because the whole picture has to travel in the share link — a string-art link is the portrait, not a reference to one. **Picture detail** is where that trade is made, and it is a real one: measured against a full-resolution original with detail at several scales, a 48-cell grid scores 0.73 correlation for about 1,500 characters of URL and a 128-cell grid scores 0.79 for about 11,000. Finer than that stops paying — 192 cells costs 24,600 characters and scores *worse*, because the gain is in how finely the solver tracks its own work rather than in how much of the photograph it was handed. With no picture given, the target is a composition of the seed's own making, which is an abstract rather than a portrait.
`.trim();

/**
 * The grid the solver actually works on, derived from the stored one.
 *
 * These are two different resolutions doing two different jobs, and the second
 * one turns out to be the bigger lever. The stored grid is how much of the
 * photograph survived; the solve grid is the residual, which is the solver's
 * memory of where it has already put thread. Too coarse a residual and one
 * chord darkens a huge fraction of every cell it crosses, so the search
 * loses track of its own work long before it runs out of picture.
 *
 * Measured from a 128 grid against a detailed original: solving at 192 scores
 * 0.755, at 256 scores 0.778 and at 320 scores 0.789 — a bigger gain than
 * going from a 48 store to a 128 one, and it costs only time. Storing finer
 * than 128 is the thing that does not pay: a 192 grid is 24,580 characters of
 * link and scores 0.776, which a 128 grid beats by being solved on more field.
 *
 * Two and a half times the stored size, bounded, is where those numbers put
 * it. The ceiling is a render-time decision: 320 solves in about two seconds.
 */
const SOLVE_MULTIPLE = 2.5;
const SOLVE_MIN = 192;
const SOLVE_MAX = 320;

/**
 * Nails nearer than this fraction of the ring are not offered as a target.
 *
 * A chord between neighbouring nails is a few pixels long, covers almost
 * nothing, and scores well on any measure that divides by length — so without
 * a floor the search spends its threads creeping around the rim.
 */
const MIN_SPAN = 0.04;

/**
 * How wide a thread is drawn, in solver cells.
 *
 * The solver's model is a chord one cell wide, so one cell is the honest
 * width — and measured, 1.4 of them is better: 0.853 correlation against
 * 0.814 at exactly one. A stroke narrower than the cell it is accounted
 * against leaves gaps the solver thinks it filled.
 */
const THREAD_CELLS = 1.4;

/** Score every nth pixel of a candidate chord. See the note at its use. */
const SCORE_STRIDE = 2;

/**
 * What the drawn thread is worth, against what the solver budgeted.
 *
 * The solver adds darkness linearly: N passes over a cell subtract N times the
 * ink. Paint does not work that way — N strokes at alpha a leave 1-(1-a)^N,
 * which is always less — so a thread drawn at exactly its budgeted worth
 * arrives lighter than the picture asked for. Measured, alpha at the budget
 * gives a mean darkness of 0.686 against a target of 0.783; at 1.4 times it,
 * 0.814, and correlation is unmoved either way (0.813 against 0.800). This is
 * that compensation and nothing more: it is a fact about compositing, not a
 * knob for taste.
 */
const ALPHA_OVER_INK = 1.4;

/** Mean chord length of a circle of radius 1, used to derive the ink. */
const MEAN_CHORD = 4 / Math.PI;

export const stringArt: Generator = {
  id: 'string-art',
  name: 'String Art',
  tagline: 'One thread, a ring of nails, and a picture made of straight lines.',
  tags: ['radial', 'flow'],
  description,
  params: [
    { key: 'image', label: 'Picture', type: 'image', default: '', description: 'The photograph the thread is trying to reproduce, reduced to a grid of sixteen darkness levels — small enough that the whole picture travels in the share link. How fine that grid is comes from Picture detail. With none given, the target is a composition of the seed’s own making.' },
    { key: 'threads', label: 'Threads', type: 'number', min: 300, max: 4000, step: 50, default: 2500, description: 'How many chords are wound. Each is worth less ink than the last, because the total is fixed by how dark the picture is — so this trades boldness for fineness rather than making the image darker.' },
    { key: 'nails', label: 'Nails', type: 'number', min: 60, max: 360, step: 4, default: 240, description: 'How many directions the thread can take. Below about a hundred the chords snap to a visibly coarse set of angles; past three hundred the extra choices mostly duplicate ones already there.' },
    { key: 'diameter', label: 'Diameter', type: 'number', min: 0.4, max: 1.2, step: 0.01, default: 0.92, description: 'The width of the ring as a fraction of the canvas width. Above 1 the nails run off the sides, which crops the disc into the frame.' },
    { key: 'offsetX', label: 'Offset across', type: 'number', min: -0.5, max: 0.5, step: 0.01, default: 0, description: 'Moves the ring left or right from the middle, as a fraction of the canvas width.' },
    { key: 'offsetY', label: 'Offset down', type: 'number', min: -0.5, max: 0.5, step: 0.01, default: 0, description: 'Moves the ring up or down from the middle, as a fraction of the canvas height. Pushing it below centre puts the picture clear of the clock.' },
    { key: 'thickness', label: 'Thread', type: 'number', min: 0.3, max: 2.5, step: 0.05, default: 1, description: 'How heavy the thread is drawn. It does not change where the threads go — only how much of the board each one covers, so it is the fastest way to lift or flatten the contrast of a finished winding.' },
    { key: 'contrast', label: 'Contrast', type: 'number', min: 0.4, max: 2.5, step: 0.05, default: 1, description: 'A curve on the target before any thread is wound. Below 1 lifts the mid tones so more of the picture gets attention; above 1 drives them down and the thread concentrates on the darkest passages.' },
    { key: 'nailsVisible', label: 'Show nails', type: 'boolean', default: true, description: 'Draws the ring of nails the thread is wound around. They are the one part of the picture that is not thread.' },
    { key: 'detail', label: 'Picture detail', type: 'select', options: [{ value: '48', label: 'Coarse \u2014 short link' }, { value: '64', label: 'Low' }, { value: '96', label: 'High' }, { value: '128', label: 'Finest \u2014 long link' }], default: '128', description: 'How finely a picture is read when you choose one. The whole picture travels in the share link, so this is a trade rather than a free setting: coarse is about 1,500 characters of URL and finest is about 11,000. It applies to the next picture you pick \u2014 the one already loaded keeps whatever it was read at, since the original is not kept.' },
  ],

  render(ctx: RenderContext): string {
    const { width: w, height: h, palette, params, rng } = ctx;

    const threads = Math.round(clamp(pNum(params, 'threads', 2500), 300, 4000));
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

    // The target, on the solver's grid. A given picture is a stored grid
    // stretched to it; with none, the seed's own noise stands in, so the
    // pattern is still a pattern rather than an empty ring.
    const given = unpackGrid(pStr(params, 'image', ''));
    // The stored picture names its own size, so a link made at one detail
    // setting still reads at another; the control only governs what the next
    // upload is reduced to.
    const gridSize = given ? given.size : (GRID_SIZES[GRID_SIZES.length - 1] as number);
    const SOLVE_GRID = Math.round(
      clamp(gridSize * SOLVE_MULTIPLE, SOLVE_MIN, SOLVE_MAX),
    );
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
          const g = given.values;
          const fx = Math.min(gridSize - 1.001, ((i + 0.5) * gridSize) / SOLVE_GRID - 0.5);
          const fy = Math.min(gridSize - 1.001, ((j + 0.5) * gridSize) / SOLVE_GRID - 0.5);
          const i0 = Math.max(0, Math.floor(fx));
          const j0 = Math.max(0, Math.floor(fy));
          const tx = fx - i0;
          const ty = fy - j0;
          const i1 = Math.min(gridSize - 1, i0 + 1);
          const j1 = Math.min(gridSize - 1, j0 + 1);
          v =
            (g[j0 * gridSize + i0] as number) * (1 - tx) * (1 - ty) +
            (g[j0 * gridSize + i1] as number) * tx * (1 - ty) +
            (g[j1 * gridSize + i0] as number) * (1 - tx) * ty +
            (g[j1 * gridSize + i1] as number) * tx * ty;
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
        // `Math.pow` is implementation-approximated, and this target feeds a
        // greedy search that turns one bit of difference into a different
        // picture, so it is not called unless it has something to do.
        target[j * SOLVE_GRID + i] = contrast === 1 ? v : Math.pow(v, contrast);
      }
    }

    // Nails, in solver coordinates and in canvas coordinates. The solve is done
    // on the grid and drawn on the canvas, and keeping the two in step by index
    // rather than by rescaling coordinates is what makes a thumbnail and an
    // export wind the identical thread.
    const gr = SOLVE_GRID / 2 - 0.5;
    // The solver's nails are whole cells, settled once.
    //
    // This is not a rounding convenience, it is what makes the pattern the
    // same picture everywhere. A greedy search has no tolerance: two engines
    // that disagree about a chord's length in the last bit choose a different
    // chord, and from there the two windings share nothing. Integer endpoints
    // make every length `Math.sqrt` of an exact integer, and `sqrt` is the one
    // root operation IEEE-754 pins exactly — where `Math.hypot`, which this
    // used, is explicitly allowed to approximate however an engine likes.
    const gx = new Int32Array(nailCount);
    const gy = new Int32Array(nailCount);
    const px = new Float64Array(nailCount);
    const py = new Float64Array(nailCount);
    for (let i = 0; i < nailCount; i++) {
      const a = (i / nailCount) * Math.PI * 2 - Math.PI / 2;
      gx[i] = Math.round(SOLVE_GRID / 2 + gr * Math.cos(a));
      gy[i] = Math.round(SOLVE_GRID / 2 + gr * Math.sin(a));
      px[i] = cx + radius * Math.cos(a);
      py[i] = cy + radius * Math.sin(a);
    }

    // What one thread is worth, derived rather than set. The total ink the
    // picture asks for, divided among the threads that will carry it. This is
    // the number the whole thing turns on: a constant here fills the disc solid
    // at high thread counts and never reaches the shadows at low ones.
    let wanted = 0;
    for (let i = 0; i < target.length; i++) wanted += target[i] as number;
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
    // The drawn thread is worth what the solver said it was worth. That only
    // became a meaningful statement once chords stopped sharing one path — see
    // the note on the emission below — because before it, overlapping strokes
    // did not accumulate and the alpha only set an overall level.
    const alpha = clamp(ink * ALPHA_OVER_INK, 0.01, 0.9);

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
        const steps = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
        // Scored on every second pixel. The search runs threads x nails x
        // chord length, which at the top of both sliders is half a billion
        // reads, and it is choosing between chords rather than measuring one:
        // a mean taken over half the pixels ranks them the same way. The
        // subtraction below still walks every pixel, because that *is* a
        // measurement and a gap in it would be a gap in the picture.
        let sum = 0;
        let taken = 0;
        for (let k = 0; k <= steps; k += SCORE_STRIDE) {
          const x = Math.round(x0 + (dx * k) / steps);
          const y = Math.round(y0 + (dy * k) / steps);
          if (x >= 0 && y >= 0 && x < SOLVE_GRID && y < SOLVE_GRID) sum += residual[y * SOLVE_GRID + x] as number;
          taken += 1;
        }
        const score = sum / taken;
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
      const steps = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
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

    // One element per chord, and this is the thing the whole pattern turned on.
    //
    // It was a single `<path>` first, because a wound board really is one
    // continuous thread and saying so in the drawing was pleasing and cheap:
    // two thousand chords as one path instead of two thousand elements. It
    // also made the picture impossible. SVG strokes a path as one shape and
    // *then* applies its opacity, so where a path crosses itself it does not
    // composite with itself — ten overlapping strokes at 30% render exactly as
    // dark as one, measured at 178 against 179 on a 0-255 scale, where ten
    // separate elements give 8.
    //
    // Tone in string art is made of crossings. A region gets dark because
    // forty threads passed through it, not because the threads there are
    // darker. With one path, tone could only come from how much *area* was
    // covered, which saturates almost at once and flattens the whole disc to
    // one grey. As separate elements the same solve goes from 0.69 correlation
    // with its target to 0.85.
    let body = '';
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1] as number;
      const b = order[i] as number;
      body += el('line', {
        x1: num(px[a] as number, 1),
        y1: num(py[a] as number, 1),
        x2: num(px[b] as number, 1),
        y2: num(py[b] as number, 1),
      });
    }

    // The thread is mostly the palette's ink, with a little accent in it.
    //
    // String art is a tonal medium and the darkest it can go is whatever one
    // thread colour is: full coverage of a mid accent simply cannot reach the
    // dark end of a photograph. Measured across the curated palettes, `ink`
    // carries two to three times the contrast against the paper that the
    // middle of the accent ramp does — 15.7 against 6.8 on Paper, 12.4 against
    // 4.7 on Riso Pink — and that ratio is the tonal range this pattern has to
    // work in. Keeping a third of the accent in it is what stops every palette
    // rendering the same grey thread.
    const thread = mixOklch(hexToOklch(palette.ink), hexToOklch(accentAt(palette, 0.5)), 0.35);

    const strokeWidth = (w / SOLVE_GRID) * THREAD_CELLS * thickness;
    const threadHex = oklchToHex(thread);

    let out = el('rect', { x: 0, y: 0, width: w, height: h, fill: palette.background });
    out += el(
      'g',
      {
        stroke: threadHex,
        'stroke-width': num(strokeWidth, 3),
        'stroke-opacity': num(alpha, 4),
        'stroke-linecap': 'round',
        fill: 'none',
      },
      body,
    );

    if (nailsVisible) {
      let nails = '';
      for (let i = 0; i < nailCount; i++) {
        nails += el('circle', { cx: num(px[i] as number, 1), cy: num(py[i] as number, 1), r: num(strokeWidth * 1.1, 3) });
      }
      out += el('g', { fill: palette.ink, 'fill-opacity': '0.55' }, nails);
    }

    return svgRoot(w, h, `${stringArt.name} wallpaper`, out);
  },
};
