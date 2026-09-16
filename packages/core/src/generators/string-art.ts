import { accentAt } from '../palette.js';
import { hexToOklch, mixOklch, oklchToHex } from '../color.js';
import { createNoise2D } from '../noise.js';
import { clamp } from '../geometry.js';
import { GRID_SIZES, unpackGrid } from '../imagegrid.js';
import { el, num, svgRoot } from '../svg.js';
import { pBool, pNum, pStr, type Generator, type RenderContext } from '../types.js';

const description = `
A real string-art board is built in two movements, and they are not the same movement. First the maker finds the *outlines* of the subject — the silhouette, and every internal edge that matters: the slots of a helmet, the ridge of a nose, the counters of a letter — and drives a nail every few millimetres along each one. At that point, before a single thread is tied, the board already reads as the picture. Only then does the thread go on, wound from nail to nail *within* each outline, and its job is shading: a region is dark because a lot of thread crossed it, light because little did.

This draws the same way. A picture is reduced to a small grid of darkness, and a few nested thresholds are taken through it by quantile rather than by value — the darkest third, then the darkest sixth, then the darkest twelfth — so a flat photograph and a contrasty one both yield the same number of usable shapes. Marching squares traces each threshold into closed rings, and nails are driven along every ring at a fixed spacing, which is the physical truth of the thing: a nail is a nail, so a big shape gets more of them than a small one rather than the same number spread thinner.

The shading is wound as a star polygon inside each ring. Join every nail to the one a fixed number of places around, and the chords fall into a family whose inner boundary is a smaller copy of the ring; increase that number and the family reaches further in. So how dark a region wants to be becomes how many families are wound in it, and the thread naturally bunches near the outline and thins toward the middle — which is what the caustic on a real board looks like, and it is a property of the geometry rather than something tuned in. A chord that would leave its region is dropped, tested at the chord rather than assumed from the shape, so a concave outline keeps its concavity instead of being bridged over.

Nothing here is a search. The earlier version of this pattern was one — a greedy solver picking two thousand chords across a circular loom to approximate a photograph's tone — and it could not make these pictures, because it had no idea what an edge was. It only ever knew how dark a point was, and every chord it drew ran the full width of the disc and deposited ink along all of it. The result was a soft average of a face. Edges come from where the nails are; the thread only shades. Splitting those two jobs is the whole difference.

There are two kinds of picture and they have to be read differently, which is the one thing here you have to tell it. In a photograph the dark parts are the shapes, so they are what gets outlined and shaded. In a *line drawing* the dark parts are the boundaries, and the thing to fill is what they enclose — read a drawing as a photograph and you get outlines with nothing inside them, because a stroke two pixels wide has no interior to wind. **Picture is** switches between the two, and it cannot be worked out from the pixels: a heavy drawing and a high-contrast photograph measure much the same.

**Tones** is how many nested outlines are traced, and **Coverage** is how much of the picture counts as dark. **Simplify** blurs the field before tracing, which is what separates an outline from a coastline: too little and every speck of grain becomes its own ring, and in a drawing it is also what decides how wide a stroke reads — a thread may pass over a mark narrower than the nails are spaced, and may not span a gap wider than that. **Shading** is how much thread goes on. At zero it is line art. With no picture given, the subject is a field of the seed's own making, which posterises into nested islands rather than a portrait.
`.trim();

/**
 * The grid the outlines are traced on.
 *
 * Fixed, and deliberately not the stored picture's size. Those are two
 * different questions: how much of the photograph survived into the link
 * (`detail`, 48 to 128) and how finely a ring is drawn. Tracing on the stored
 * grid would tie the second to the first, so raising picture detail would
 * quietly change the *shape* of every outline rather than only how much
 * information fed it. A stored grid is resampled up to this, and a coarse one
 * simply arrives smooth.
 */
const TRACE = 128;

/** Widest blur, in trace cells, that `simplify` may ask for. */
const MAX_BLUR = 6;

/** Bins used to find a threshold by quantile. */
const HIST_BINS = 256;

/**
 * A ring with fewer nails than this is not a shape, it is a speck.
 *
 * Below a handful of nails a star polygon has no interior to wind — every
 * stride is either the outline or the outline's mirror — so such a ring can
 * only ever contribute a dot of outline. The floor is above that rather than
 * at it, because a ring small enough to be a speck reads as grain however
 * neatly it is wound, and a scattering of specks around a subject is the one
 * thing that makes this look like noise rather than a drawing.
 */
const MIN_RING_NAILS = 10;

/**
 * Nails in the whole render, at most.
 *
 * Spacing is the control, and this is the backstop for the case where a
 * picture traces into a very long coastline at a very fine spacing. It is
 * applied by *widening the spacing* rather than by truncating the list, so
 * what gives way is nail density everywhere rather than half the picture.
 */
const MAX_NAILS = 1200;

/**
 * Shading chords in the whole render, at most.
 *
 * Applied by scaling every region's pass count down together, not by
 * truncating a list: what gives way is density everywhere rather than the
 * last shapes getting nothing.
 *
 * It must not be applied to the *reach* instead, and the first version was.
 * Spreading a fixed chord budget over a longer reach makes the picture
 * sparser, so `shading` at 1 came out thinner and more banded than at 0.55 —
 * 1,539 chords against 1,653, in visibly separated families. That is the
 * "two controls that fight" fault: reach and density were both free, and the
 * budget silently traded one for the other. Reach is now fixed by the tone
 * and `shading` buys passes within it, so the control moves the quantity a
 * person can actually see.
 */
const CHORD_BUDGET = 6000;

/**
 * Star-polygon families wound in one region, at full shading.
 *
 * A family is one stride: every nail joined to the one `m` places round. The
 * count is what density is made of, and the reach is what it is spread over.
 */
const PASS_MAX = 22;

/**
 * How far the families reach in, as a fraction of the distance to the middle.
 *
 * A family at stride m has its inner boundary at cos(pi*m/n) of the ring, so
 * this is strongly non-linear: reaching half way in to the nails' own stride
 * limit still leaves the middle 70% of a round shape empty, and only the top
 * of the range fills a region through. The shallowest tone therefore starts
 * well up the range rather than at nothing, and the deepest fills through.
 */
const REACH_BASE = 0.35;
const REACH_SPAN = 0.65;

/**
 * How a chord is tested before it is allowed to shade.
 *
 * Not "does every sample stay inside", which is what this was, and not "do
 * most of them", which was the first attempt at loosening it. Both ask about
 * the total, and the total is the wrong question.
 *
 * A thread on a real board passes over whatever is in its way. What it cannot
 * do is span a space that is not part of the board's figure — that is the
 * chord bridging the opening of a crescent, or the hole of a ring, and it is
 * the one thing that destroys a drawing. In a traced line drawing almost every
 * long chord clips a drawn line on its way across, so a rule about the total
 * left the big cells empty while the small ones filled, because a short chord
 * has less to cross.
 *
 * The rule that separates them is the *longest unbroken excursion*: a thread
 * may cross a gap narrower than the nails are spaced, and may not cross one
 * wider. That needs no constant of its own — the nail spacing is already the
 * finest thing this board resolves, so a gap it cannot fit a nail into is a
 * mark, and a wider one is a space. Measured, a chord across a drawn line runs
 * out for 4 cells against a spacing of 3, one across an eye slot for 14, and
 * one bridging a crescent for 47.
 */
const SAMPLE_CELLS = 1.5;

/** Thread width and nail radius, as fractions of the nail spacing. */
const THREAD_OF_SPACING = 0.11;
const NAIL_OF_SPACING = 0.15;

/**
 * How solid a thread is drawn.
 *
 * The outline is nearly opaque because it is the drawing; the shading is not,
 * because tone here is made of crossings and a stack of opaque chords is a
 * blot rather than a shadow. Both are drawn as separate elements for the same
 * reason — an SVG path does not composite with itself, so a winding drawn as
 * one path has no tone at all.
 */
const OUTLINE_ALPHA = 0.95;
const SHADE_ALPHA = 0.4;

/** Read a field cell, clamped to the grid. */
function at(f: Float32Array, F: number, x: number, y: number): number {
  const xi = x < 0 ? 0 : x > F - 1 ? F - 1 : x;
  const yi = y < 0 ? 0 : y > F - 1 ? F - 1 : y;
  return f[yi * F + xi] as number;
}

/** Bilinear sample of the field at fractional grid coordinates. */
function sample(f: Float32Array, F: number, x: number, y: number): number {
  const fx = x < 0 ? 0 : x > F - 1.001 ? F - 1.001 : x;
  const fy = y < 0 ? 0 : y > F - 1.001 ? F - 1.001 : y;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const tx = fx - i0;
  const ty = fy - j0;
  const a = f[j0 * F + i0] as number;
  const b = f[j0 * F + i0 + 1] as number;
  const c = f[(j0 + 1) * F + i0] as number;
  const d = f[(j0 + 1) * F + i0 + 1] as number;
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/**
 * One axis of a box blur, with fractional end taps.
 *
 * Fractional because `simplify` is a slider: an integer-radius box would give
 * it six distinct settings and six visible jumps. The end taps carry the
 * fraction, so the radius moves continuously.
 */
function blurAxis(src: Float32Array, dst: Float32Array, F: number, r: number, alongX: boolean): void {
  const ri = Math.floor(r);
  const fr = r - ri;
  const norm = 1 / (2 * ri + 1 + 2 * fr);
  for (let j = 0; j < F; j++) {
    for (let i = 0; i < F; i++) {
      let sum = 0;
      for (let k = -ri; k <= ri; k++) sum += alongX ? at(src, F, i + k, j) : at(src, F, i, j + k);
      if (fr > 0) {
        sum += fr * (alongX ? at(src, F, i - ri - 1, j) : at(src, F, i, j - ri - 1));
        sum += fr * (alongX ? at(src, F, i + ri + 1, j) : at(src, F, i, j + ri + 1));
      }
      dst[j * F + i] = sum * norm;
    }
  }
}

/**
 * The field value that the darkest `fraction` of the picture lies above.
 *
 * Thresholds are taken by quantile and not by value, and that is the whole
 * reason this pattern survives being handed an arbitrary photograph. A
 * threshold at a fixed darkness is a different control on every picture: a
 * backlit snapshot has nothing above 0.5 and traces no rings at all, a
 * silhouette has half the frame above 0.9 and traces one enormous blob. A
 * quantile asks the question that was actually meant — "outline the darkest
 * third of this" — and answers it the same way whatever arrived.
 *
 * This is the same fault recorded for contours, where levels expressed as
 * fractions of a field's *possible* range drew eight of their twenty-two
 * lines because fractal noise only ever occupied a third of that range. The
 * cure there was to stretch the field; here the field is somebody's
 * photograph and cannot be trusted to have a shape at all, so the reading
 * moves instead.
 */
function isoAtFraction(field: Float32Array, fraction: number): number {
  const hist = new Int32Array(HIST_BINS);
  for (let i = 0; i < field.length; i++) {
    const v = field[i] as number;
    const b = v <= 0 ? 0 : v >= 1 ? HIST_BINS - 1 : Math.floor(v * HIST_BINS);
    hist[b] = (hist[b] as number) + 1;
  }
  const want = fraction * field.length;
  let seen = 0;
  for (let b = HIST_BINS - 1; b >= 0; b--) {
    const c = hist[b] as number;
    if (c > 0 && seen + c >= want) return (b + 1 - (want - seen) / c) / HIST_BINS;
    seen += c;
  }
  return 0;
}

/** A closed outline, in trace-grid coordinates. */
interface Ring {
  x: number[];
  y: number[];
}

/**
 * Marching squares, chained into closed rings.
 *
 * The field's border is forced light before this runs, so every ring closes
 * inside the frame and there are no open chains to special-case — a shape
 * touching the edge of the picture is closed along the edge rather than left
 * hanging. Each crossing sits on one grid edge and an edge is shared by
 * exactly two cells, so the fragments join without guessing which end meets
 * which; keying them by edge is what makes that true.
 *
 * The two ambiguous cases — opposite corners inside, opposite corners out —
 * are settled by the cell's own centre, which is the cheapest reading that
 * cannot contradict itself. Settling them arbitrarily instead gives a
 * crossing three neighbours, and a ring that walks into one never comes back.
 */
function traceRings(field: Float32Array, F: number, iso: number): Ring[] {
  const HCOUNT = (F - 1) * F;
  const found = new Map<number, number>();
  const px: number[] = [];
  const py: number[] = [];
  const adjA: number[] = [];
  const adjB: number[] = [];

  const crossing = (id: number, x: number, y: number): number => {
    const got = found.get(id);
    if (got !== undefined) return got;
    const n = px.length;
    px.push(x);
    py.push(y);
    adjA.push(-1);
    adjB.push(-1);
    found.set(id, n);
    return n;
  };
  const link = (a: number, b: number): void => {
    if ((adjA[a] as number) < 0) adjA[a] = b;
    else if ((adjB[a] as number) < 0) adjB[a] = b;
    if ((adjA[b] as number) < 0) adjA[b] = a;
    else if ((adjB[b] as number) < 0) adjB[b] = a;
  };
  // A crossing on a horizontal edge lies between (i,j) and (i+1,j); on a
  // vertical edge, between (i,j) and (i,j+1). Linear interpolation only —
  // every operation here is add, subtract, multiply or divide, all of which
  // IEEE-754 pins exactly, so two engines trace the identical ring.
  const onH = (i: number, j: number): number => {
    const a = field[j * F + i] as number;
    const b = field[j * F + i + 1] as number;
    return crossing(j * (F - 1) + i, i + (iso - a) / (b - a), j);
  };
  const onV = (i: number, j: number): number => {
    const a = field[j * F + i] as number;
    const b = field[(j + 1) * F + i] as number;
    return crossing(HCOUNT + j * F + i, i, j + (iso - a) / (b - a));
  };

  for (let j = 0; j < F - 1; j++) {
    for (let i = 0; i < F - 1; i++) {
      const v0 = field[j * F + i] as number;
      const v1 = field[j * F + i + 1] as number;
      const v2 = field[(j + 1) * F + i + 1] as number;
      const v3 = field[(j + 1) * F + i] as number;
      let idx = 0;
      if (v0 >= iso) idx |= 1;
      if (v1 >= iso) idx |= 2;
      if (v2 >= iso) idx |= 4;
      if (v3 >= iso) idx |= 8;
      if (idx === 0 || idx === 15) continue;

      // Which of the four cell edges the contour crosses, by case. 5 and 10
      // are the saddles: the centre decides whether the two inside corners
      // are joined through the middle or cut off separately.
      if (idx === 5 || idx === 10) {
        const middle = (v0 + v1 + v2 + v3) / 4;
        const joined = middle >= iso;
        const cutCorners = idx === 5 ? joined : !joined;
        if (cutCorners) {
          // Loops around the top-right and bottom-left corners.
          link(onH(i, j), onV(i + 1, j));
          link(onH(i, j + 1), onV(i, j));
        } else {
          // Loops around the top-left and bottom-right corners.
          link(onV(i, j), onH(i, j));
          link(onV(i + 1, j), onH(i, j + 1));
        }
        continue;
      }
      switch (idx) {
        case 1:
        case 14:
          link(onV(i, j), onH(i, j));
          break;
        case 2:
        case 13:
          link(onH(i, j), onV(i + 1, j));
          break;
        case 3:
        case 12:
          link(onV(i, j), onV(i + 1, j));
          break;
        case 4:
        case 11:
          link(onV(i + 1, j), onH(i, j + 1));
          break;
        case 6:
        case 9:
          link(onH(i, j), onH(i, j + 1));
          break;
        case 7:
        case 8:
          link(onV(i, j), onH(i, j + 1));
          break;
        default:
          break;
      }
    }
  }

  const seen = new Uint8Array(px.length);
  const rings: Ring[] = [];
  for (let s = 0; s < px.length; s++) {
    if (seen[s]) continue;
    const x: number[] = [];
    const y: number[] = [];
    let cur = s;
    while (cur >= 0 && !seen[cur]) {
      seen[cur] = 1;
      x.push(px[cur] as number);
      y.push(py[cur] as number);
      const a = adjA[cur] as number;
      const b = adjB[cur] as number;
      cur = a >= 0 && !seen[a] ? a : b >= 0 && !seen[b] ? b : -1;
    }
    if (x.length >= 3) rings.push({ x, y });
  }
  return rings;
}

/**
 * True if a ring runs along the edge of the picture.
 *
 * The field's border is forced light, so the region that reaches the frame is
 * bounded by a curve half a cell inside it and nothing else comes near.
 */
function touchesFrame(ring: Ring): boolean {
  for (let i = 0; i < ring.x.length; i++) {
    const x = ring.x[i] as number;
    const y = ring.y[i] as number;
    if (x < 1.001 || y < 1.001 || x > TRACE - 2.001 || y > TRACE - 2.001) return true;
  }
  return false;
}

/** Length once round a closed ring. */
function perimeterOf(ring: Ring): number {
  let total = 0;
  const n = ring.x.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = (ring.x[j] as number) - (ring.x[i] as number);
    const dy = (ring.y[j] as number) - (ring.y[i] as number);
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

/**
 * `count` nails at even arc length around a ring.
 *
 * Even by arc length rather than by vertex, because marching squares puts
 * vertices where the grid is and not where the curve turns — a straight run
 * of outline produces one vertex per cell and a tight curve produces three,
 * so spacing nails by vertex would drive them into every corner and leave the
 * flats bare. A nail is a nail: the same distance apart everywhere.
 */
function placeNails(ring: Ring, count: number, perim: number): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const n = ring.x.length;
  const step = perim / count;
  let seg = 0;
  let walked = 0;
  let segLen = 0;
  const lengthOf = (i: number): number => {
    const j = (i + 1) % n;
    const dx = (ring.x[j] as number) - (ring.x[i] as number);
    const dy = (ring.y[j] as number) - (ring.y[i] as number);
    return Math.sqrt(dx * dx + dy * dy);
  };
  segLen = lengthOf(0);
  for (let k = 0; k < count; k++) {
    const want = k * step;
    while (seg < n - 1 && walked + segLen < want) {
      walked += segLen;
      seg += 1;
      segLen = lengthOf(seg);
    }
    const t = segLen > 0 ? (want - walked) / segLen : 0;
    const j = (seg + 1) % n;
    x[k] = (ring.x[seg] as number) + ((ring.x[j] as number) - (ring.x[seg] as number)) * t;
    y[k] = (ring.y[seg] as number) + ((ring.y[j] as number) - (ring.y[seg] as number)) * t;
  }
  return { x, y };
}

/** A traced outline with its nails, ready to be wound. */
interface Shape {
  iso: number;
  level: number;
  nails: { x: Float64Array; y: Float64Array };
  reach: number;
  passes: number;
}

export const stringArt: Generator = {
  id: 'string-art',
  name: 'String Art',
  tagline: 'Nails driven along the outlines, thread wound inside them for the shading.',
  tags: ['radial', 'flow'],
  description,
  params: [
    { key: 'image', label: 'Picture', type: 'image', default: '', description: 'The photograph the board is built from, reduced to a grid of sixteen darkness levels — small enough that the whole picture travels in the share link. How fine that grid is comes from Picture detail. With none given, the subject is a field of the seed’s own making.' },
    { key: 'tones', label: 'Tones', type: 'number', min: 1, max: 5, step: 1, default: 3, description: 'How many nested outlines are traced. Each encloses half the area of the one before it, so one is a silhouette, three is a readable drawing, and five picks out the deepest shadows as shapes of their own.' },
    { key: 'coverage', label: 'Coverage', type: 'number', min: 0.12, max: 0.7, step: 0.01, default: 0.34, description: 'How much of the picture counts as dark, and so how much the outermost outline encloses. Read as a proportion of the picture when it is a photograph, so a flat one and a contrasty one both give usable shapes; read as a level instead when it is a drawing, because a drawing’s tones are two spikes with nothing in between and a proportion cannot find the gap.' },
    { key: 'simplify', label: 'Simplify', type: 'number', min: 0, max: 1, step: 0.02, default: 0.5, description: 'Softens the picture before the outlines are traced. This is what separates an outline from a coastline — at zero, every speck of grain becomes a ring of its own; high, and only the broad shapes survive.' },
    { key: 'nailSpacing', label: 'Nail spacing', type: 'number', min: 0.012, max: 0.05, step: 0.001, default: 0.022, description: 'How far apart the nails are driven, as a fraction of the canvas width. It is a distance and not a count, so a big shape gets more nails than a small one rather than the same number spread thinner — which is how a real board is built.' },
    { key: 'shading', label: 'Shading', type: 'number', min: 0, max: 1, step: 0.02, default: 0.62, description: 'How much thread is wound inside the outlines. At zero it is line art. Raising it reaches further in from each outline, and the deeper tones reach further than the shallow ones, which is what makes the shadows read as shadows.' },
    { key: 'scale', label: 'Size', type: 'number', min: 0.4, max: 1.15, step: 0.01, default: 0.94, description: 'The width of the board as a fraction of the canvas. Above 1 the picture runs off the sides.' },
    { key: 'offsetX', label: 'Offset across', type: 'number', min: -0.5, max: 0.5, step: 0.01, default: 0, description: 'Moves the board left or right from the middle, as a fraction of the canvas width.' },
    { key: 'offsetY', label: 'Offset down', type: 'number', min: -0.5, max: 0.5, step: 0.01, default: 0, description: 'Moves the board up or down from the middle, as a fraction of the canvas height. Pushing it below centre puts the picture clear of the clock.' },
    { key: 'thickness', label: 'Thread', type: 'number', min: 0.3, max: 2.5, step: 0.05, default: 1, description: 'How heavy the thread is drawn. It does not change where anything goes — only how much of the board each chord covers, so it is the fastest way to lift or flatten the contrast of a finished board.' },
    { key: 'nailsVisible', label: 'Show nails', type: 'boolean', default: true, description: 'Draws the nails. They are the drawing here rather than a frame around it, so turning them off leaves only the thread.' },
    { key: 'reading', label: 'Picture is', type: 'select', options: [{ value: 'masses', label: 'Shapes \u2014 a photograph' }, { value: 'lines', label: 'Lines \u2014 a drawing' }], default: 'masses', description: 'What the dark parts of your picture mean. In a photograph they are the shapes themselves, so they are what gets outlined and shaded. In a line drawing they are the *boundaries*, and the thing to fill is what they enclose \u2014 so the reading is turned inside out, and the lines come through as the gaps between wound regions. A drawing read as a photograph comes out as outlines with nothing in them, because a stroke two pixels wide has no interior to wind.' },
    { key: 'detail', label: 'Picture detail', type: 'select', options: [{ value: '48', label: 'Coarse — short link' }, { value: '64', label: 'Low' }, { value: '96', label: 'High' }, { value: '128', label: 'Finest — long link' }], default: '128', description: 'How finely a picture is read when you choose one. The whole picture travels in the share link, so this is a trade rather than a free setting: coarse is about 1,500 characters of URL and finest is about 11,000. It applies to the next picture you pick — the one already loaded keeps whatever it was read at, since the original is not kept.' },
  ],

  render(ctx: RenderContext): string {
    const { width: w, height: h, palette, params, rng } = ctx;

    const tones = Math.round(clamp(pNum(params, 'tones', 3), 1, 5));
    const coverage = clamp(pNum(params, 'coverage', 0.34), 0.12, 0.7);
    const simplify = clamp(pNum(params, 'simplify', 0.5), 0, 1);
    const nailSpacing = clamp(pNum(params, 'nailSpacing', 0.022), 0.012, 0.05);
    const shading = clamp(pNum(params, 'shading', 0.62), 0, 1);
    const scale = clamp(pNum(params, 'scale', 0.94), 0.4, 1.15);
    const offsetX = clamp(pNum(params, 'offsetX', 0), -0.5, 0.5);
    const offsetY = clamp(pNum(params, 'offsetY', 0), -0.5, 0.5);
    const thickness = clamp(pNum(params, 'thickness', 1), 0.3, 2.5);
    const nailsVisible = pBool(params, 'nailsVisible', true);
    const lines = pStr(params, 'reading', 'masses') === 'lines';

    // The board: a square of side S, because the stored picture is square.
    const S = w * scale;
    const cx = w / 2 + offsetX * w;
    const cy = h / 2 + offsetY * h;
    const toX = (gx: number): number => cx + (gx / (TRACE - 1) - 0.5) * S;
    const toY = (gy: number): number => cy + (gy / (TRACE - 1) - 0.5) * S;

    // The field the outlines are traced from. A given picture is the stored
    // grid resampled up; with none, the seed's own noise stands in.
    const given = unpackGrid(pStr(params, 'image', ''));
    const gridSize = given ? given.size : (GRID_SIZES[GRID_SIZES.length - 1] as number);
    let field = new Float32Array(TRACE * TRACE);
    const noise = createNoise2D(rng);
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < TRACE; j++) {
      for (let i = 0; i < TRACE; i++) {
        let v: number;
        if (given) {
          const g = given.values;
          const fx = Math.min(gridSize - 1.001, ((i + 0.5) * gridSize) / TRACE - 0.5);
          const fy = Math.min(gridSize - 1.001, ((j + 0.5) * gridSize) / TRACE - 0.5);
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
          // No picture, so the seed supplies a subject. Fractal noise is the
          // right stand-in precisely because this construction posterises:
          // its level sets are nested closed islands, which is the shape of
          // thing the tracer wants, where a vignette would give one ring per
          // tone and a set of concentric circles.
          //
          // Three octaves and not five. The tracer is looking for outlines,
          // and an outline is a thing you can follow with your eye; the fine
          // octaves of an fBm only add wobble along a boundary whose shape is
          // already set by the coarse ones, so they cost nails and buy
          // nothing. The island term keeps the subject clear of the frame
          // without closing it into a disc — it falls off linearly and starts
          // outside the picture, so the shapes still run wide.
          const nx = (i + 0.5) / TRACE - 0.5;
          const ny = (j + 0.5) / TRACE - 0.5;
          const island = clamp(1.9 - Math.sqrt(nx * nx + ny * ny) * 2.2, 0, 1);
          const wx = noise.fbm(nx * 1.7 + 4.1, ny * 1.7 - 2.3, 2) * 0.26;
          const wy = noise.fbm(nx * 1.7 - 3.7, ny * 1.7 + 1.9, 2) * 0.26;
          v = (noise.fbm(nx * 2.3 + wx, ny * 2.3 + wy, 3) * 0.5 + 0.5) * island;
        }
        field[j * TRACE + i] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    // Stretched to its own range before anything reads a height off it, which
    // is the lesson contours paid for: fractal noise occupies about a third of
    // its nominal range, so a field left unstretched hands the histogram below
    // a picture with most of its levels empty.
    const span = hi - lo;
    if (span > 1e-6) {
      for (let k = 0; k < field.length; k++) field[k] = ((field[k] as number) - lo) / span;
    }

    // A drawing read inside out.
    //
    // The construction shades what is dark, which is right for a photograph
    // and exactly wrong for a line drawing: there the dark is the boundary,
    // and a stroke two pixels wide traces into a ribbon with no interior, so
    // every chord leaves it at once and gets dropped. The render comes out as
    // outlines with nothing in them — which is the symptom, and no amount of
    // shading fixes it, because the shading had nowhere to go.
    //
    // Inverting puts the enclosed areas above the threshold and the strokes
    // below it, so the cells of the drawing become the masses and the drawn
    // lines come through as the gaps between wound regions. Everything
    // downstream is unchanged. Which of the two a picture is cannot be read
    // off the pixels without guessing — a high-contrast photograph and a
    // heavy drawing measure much the same — so it is a control.
    if (lines) {
      for (let k = 0; k < field.length; k++) field[k] = 1 - (field[k] as number);
    }

    if (simplify > 0) {
      const r = simplify * MAX_BLUR;
      const tmp = new Float32Array(TRACE * TRACE);
      const out = new Float32Array(TRACE * TRACE);
      blurAxis(field, tmp, TRACE, r, true);
      blurAxis(tmp, out, TRACE, r, false);
      field = out;
    }

    // The border is forced light, so every outline closes inside the frame.
    // Without it a shape running off the edge of the picture traces an open
    // chain, which has no interior to wind and no ends to join.
    for (let i = 0; i < TRACE; i++) {
      field[i] = 0;
      field[(TRACE - 1) * TRACE + i] = 0;
      field[i * TRACE] = 0;
      field[i * TRACE + TRACE - 1] = 0;
    }

    // Trace each tone. Each encloses half the area of the one before it, by
    // repeated halving rather than by `Math.pow`, which is one of the few
    // operations IEEE-754 leaves an engine free to approximate — and these
    // numbers become thresholds, where one bit is a different outline.
    const rings: { ring: Ring; iso: number; level: number; perim: number }[] = [];
    let fraction = coverage;
    let distinct = 0;
    let lastIso = -1;
    for (let level = 1; level <= tones; level++) {
      // In masses mode the threshold is a quantile of area: outline the
      // darkest `fraction` of the picture. In lines mode it cannot be, and
      // this is the one place the two readings genuinely differ.
      //
      // A drawing's histogram is two spikes — the strokes and the paper — with
      // nothing between them, so a quantile of area lands inside whichever
      // spike holds that fraction rather than in the gap. Measured on a line
      // drawing at the default coverage it put the threshold at 0.9979, a
      // fifth of one percent below the top of the range, which is a threshold
      // in name only: every blurred stroke then reads as an eight-cell-wide
      // gap instead of a two-cell one, and the big cell of the drawing kept
      // five of its four hundred and forty-eight chords because every chord
      // across it was judged to have left. The symptom was a drawing with its
      // small cells wound and its large ones empty.
      //
      // For two spikes the meaningful threshold is a level, not an area. The
      // field is already stretched to its own range, so `fraction` measured
      // down from the top of it lands between the spikes wherever they are.
      const iso = lines ? 1 - fraction : isoAtFraction(field, fraction);
      fraction *= 0.5;
      // Levels that land on the same threshold are one level, drawn once.
      // A picture with only two tones in it — a line drawing especially,
      // where nearly every cell reads the same — puts every quantile at the
      // same place, and without this the same rings are traced and wound
      // several times over while each of them is treated as a shallow tone.
      // Counting the *distinct* ones is what lets the depth below be read
      // off how many tones the picture actually had rather than how many
      // were asked for.
      if (iso <= lastIso + 1e-4 && distinct > 0) continue;
      lastIso = iso;
      distinct += 1;
      for (const ring of traceRings(field, TRACE, iso)) {
        // In lines mode the paper outside the drawing is not one of the
        // drawing's cells, and it is the region that reaches the edge of the
        // picture — after inversion it is the largest mass there is, and
        // winding it fills the whole board and buries the subject. Masses
        // mode keeps it, because there a subject that bleeds off the frame is
        // still the subject.
        if (lines && touchesFrame(ring)) continue;
        rings.push({ ring, iso, level: distinct, perim: perimeterOf(ring) });
      }
    }
    const levelCount = Math.max(1, distinct);

    // Nail spacing, in trace cells. The canvas width cancels out of this
    // entirely, which is what makes a thumbnail and an export drive nails into
    // the same places: the spacing is a fraction of the width and the board is
    // a fraction of the width.
    let spacing = (nailSpacing * (TRACE - 1)) / scale;
    let totalPerim = 0;
    for (const r of rings) totalPerim += r.perim;
    if (totalPerim / spacing > MAX_NAILS) spacing = totalPerim / MAX_NAILS;

    const shapes: Shape[] = [];
    for (const r of rings) {
      const count = Math.round(r.perim / spacing);
      if (count < MIN_RING_NAILS) continue;
      // Two separate quantities, and keeping them separate is the whole of
      // what makes `shading` behave. How far in the families reach is fixed by
      // the tone: a shallow tone rings its outline, the deepest fills through,
      // which is what makes a shadow read as deeper rather than as a second
      // outline. How many families are wound inside that reach is what
      // `shading` buys, and that is the density anyone can see.
      const limit = Math.floor((count - 1) / 2);
      const tone = r.level / levelCount;
      const reach = Math.max(1, Math.min(limit, Math.round(((REACH_BASE + REACH_SPAN * tone) * count) / 2)));
      const passes = Math.min(reach - 1, Math.round(shading * PASS_MAX * (0.5 + 0.5 * tone)));
      if (passes < 1) {
        shapes.push({ iso: r.iso, level: r.level, nails: placeNails(r.ring, count, r.perim), reach, passes: 0 });
        continue;
      }
      shapes.push({ iso: r.iso, level: r.level, nails: placeNails(r.ring, count, r.perim), reach, passes });
    }

    // The budget, spent by thinning every region together. `asked` is the
    // chord count the shading wants; if it is over, every shape loses the same
    // proportion of its passes, so what a tight budget costs is density rather
    // than whole shapes.
    // The widest gap a thread may pass over.
    //
    // The nail spacing is the first term because it is the finest thing this
    // board resolves: a gap it cannot fit a nail into is a mark rather than a
    // space. The blur is the second, and it is not a fudge — `simplify`
    // widens every gap in the field by its own radius on each side, so a
    // stroke two cells wide reads as eight at a heavy setting. A gap the blur
    // itself manufactured is not a gap in the drawing, and without this term
    // the big cell of a traced drawing keeps 26 of its 450 chords.
    const crossable = spacing + 2 * simplify * MAX_BLUR;

    let asked = 0;
    for (const s of shapes) asked += s.nails.x.length * s.passes;
    const afford = asked > CHORD_BUDGET ? CHORD_BUDGET / asked : 1;

    const outlines: string[] = [];
    const shades: string[] = [];
    for (let i = 0; i < levelCount; i++) {
      outlines.push('');
      shades.push('');
    }

    for (const s of shapes) {
      const n = s.nails.x.length;
      const nx = s.nails.x;
      const ny = s.nails.y;
      const seg = (a: number, b: number): string =>
        el('line', {
          x1: num(toX(nx[a] as number), 1),
          y1: num(toY(ny[a] as number), 1),
          x2: num(toX(nx[b] as number), 1),
          y2: num(toY(ny[b] as number), 1),
        });

      // The outline itself, always drawn: it is what the nails are for.
      let line = '';
      for (let k = 0; k < n; k++) line += seg(k, (k + 1) % n);
      outlines[s.level - 1] = (outlines[s.level - 1] as string) + line;

      let shade = '';
      const passes = Math.max(0, Math.round(s.passes * afford));
      // The families are spread evenly across the reach, so raising the count
      // closes the gaps between them rather than moving where they end.
      // Rounded up, so the families never outnumber the passes that were
      // budgeted for. Rounding down overshoots by as much as a third — at a
      // reach of 44 and fifteen passes it gives a stride of two and twenty-one
      // families — which quietly makes the budget a suggestion.
      const stride = passes > 0 ? Math.max(1, Math.ceil((s.reach - 1) / passes)) : 0;
      for (let m = 1 + stride; stride > 0 && m <= s.reach; m += stride) {
        for (let k = 0; k < n; k++) {
          const b = (k + m) % n;
          // Tested at the chord, not assumed from the shape. A star polygon
          // on a convex ring stays inside it; on a concave one a chord can
          // bridge the concavity, and bridging is exactly the thing this
          // construction exists to avoid — the notch between a helmet's cheek
          // and its jaw is a shape, not a gap to be filled in.
          const x0 = nx[k] as number;
          const y0 = ny[k] as number;
          const dx = (nx[b] as number) - x0;
          const dy = (ny[b] as number) - y0;
          const steps = Math.max(2, Math.round(Math.sqrt(dx * dx + dy * dy) / SAMPLE_CELLS));
          let run = 0;
          let worst = 0;
          for (let t = 1; t < steps; t++) {
            const f = t / steps;
            if (sample(field, TRACE, x0 + dx * f, y0 + dy * f) < s.iso) {
              run += 1;
              if (run > worst) worst = run;
            } else {
              run = 0;
            }
          }
          if (worst * SAMPLE_CELLS <= crossable) shade += seg(k, b);
        }
      }
      shades[s.level - 1] = (shades[s.level - 1] as string) + shade;
    }

    // Thread colour, one per tone. The deepest tone is nearly all ink, because
    // a tonal medium needs the contrast the ink carries and the middle of an
    // accent ramp does not have it; the shallower tones keep more accent, so
    // the nesting reads as colour as well as density — which is what the gold
    // and the white are doing on a real two-thread board.
    const inkLch = hexToOklch(palette.ink);
    const threadFor = (level: number): string => {
      const t = levelCount > 1 ? (level - 1) / (levelCount - 1) : 1;
      return oklchToHex(mixOklch(hexToOklch(accentAt(palette, 1 - t * 0.8)), inkLch, 0.3 + 0.6 * t));
    };

    const spacingCanvas = (spacing * S) / (TRACE - 1);
    const threadWidth = spacingCanvas * THREAD_OF_SPACING * thickness;
    const nailRadius = spacingCanvas * NAIL_OF_SPACING;

    let out = el('rect', { x: 0, y: 0, width: w, height: h, fill: palette.background });
    for (let level = levelCount; level >= 1; level--) {
      const shade = shades[level - 1] as string;
      if (shade === '') continue;
      out += el(
        'g',
        {
          stroke: threadFor(level),
          'stroke-width': num(threadWidth, 3),
          'stroke-opacity': num(SHADE_ALPHA, 3),
          'stroke-linecap': 'round',
          fill: 'none',
        },
        shade,
      );
    }
    for (let level = levelCount; level >= 1; level--) {
      const line = outlines[level - 1] as string;
      if (line === '') continue;
      out += el(
        'g',
        {
          stroke: threadFor(level),
          'stroke-width': num(threadWidth * 1.15, 3),
          'stroke-opacity': num(OUTLINE_ALPHA, 3),
          'stroke-linecap': 'round',
          fill: 'none',
        },
        line,
      );
    }

    if (nailsVisible) {
      let nails = '';
      for (const s of shapes) {
        for (let k = 0; k < s.nails.x.length; k++) {
          nails += el('circle', {
            cx: num(toX(s.nails.x[k] as number), 1),
            cy: num(toY(s.nails.y[k] as number), 1),
            r: num(nailRadius, 3),
          });
        }
      }
      if (nails !== '') out += el('g', { fill: palette.ink, 'fill-opacity': '0.7' }, nails);
    }

    return svgRoot(w, h, `${stringArt.name} wallpaper`, out);
  },
};
