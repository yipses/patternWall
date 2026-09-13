import { describe, expect, it } from 'vitest';
import { GRID_SIZE, GRID_SIZES, gridChars, packGrid, renderToSvg, unpackGrid } from '../src/index.js';
import { ALL_GENERATORS, baseParams, rasterize, sampleGrid, TEST_PALETTES } from './helpers.js';

const stringArt = ALL_GENERATORS.find((g) => g.id === 'string-art')!;
const SIZE = 300;

function render(over: Record<string, number | string | boolean> = {}): string {
  return renderToSvg({
    generator: stringArt,
    width: SIZE,
    height: SIZE,
    palette: TEST_PALETTES[0]!,
    params: { ...baseParams(stringArt), ...over },
    seed: 'thread',
    bleed: 0,
  });
}

/** How big the board is on the canvas, as a fraction of it. Mirrors `scale`. */
const BOARD = 0.94;

/** A picture built from a rule over normalised coordinates in -0.5..0.5. */
function picture(f: (x: number, y: number) => number): string {
  const cells = new Float32Array(GRID_SIZE * GRID_SIZE);
  for (let j = 0; j < GRID_SIZE; j++) {
    for (let i = 0; i < GRID_SIZE; i++) {
      cells[j * GRID_SIZE + i] = f((i + 0.5) / GRID_SIZE - 0.5, (j + 0.5) / GRID_SIZE - 0.5);
    }
  }
  return packGrid(cells, GRID_SIZE);
}

/** A dark disc of the given radius on a light ground. */
const disc = (r: number): string => picture((x, y) => (Math.sqrt(x * x + y * y) < r ? 0.95 : 0.05));

/** A dark ring with a light hole in it. */
const ring = (inner: number, outer: number): string =>
  picture((x, y) => {
    const d = Math.sqrt(x * x + y * y);
    return d >= inner && d < outer ? 0.95 : 0.05;
  });

/** Nail centres, in canvas fractions, in the order they were driven. */
function nails(svg: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /<circle cx="([-\d.]+)" cy="([-\d.]+)"/g;
  let m = re.exec(svg);
  while (m) {
    out.push([Number(m[1]) / SIZE, Number(m[2]) / SIZE]);
    m = re.exec(svg);
  }
  return out;
}

/** Mean darkness away from the paper, within a centred disc of radius `to`. */
function inkWithin(svg: string, from: number, to: number): number {
  const { pixels } = rasterize(svg, SIZE);
  const paper = TEST_PALETTES[0]!.background;
  const [pr, pg, pb] = [1, 3, 5].map((i) => parseInt(paper.slice(i, i + 2), 16)) as [number, number, number];
  const paperLum = (0.2126 * pr + 0.7152 * pg + 0.0722 * pb) / 255;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x + 0.5) / SIZE - 0.5;
      const dy = (y + 0.5) / SIZE - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < from || r >= to) continue;
      const o = (y * SIZE + x) * 4;
      const lum =
        (0.2126 * (pixels[o] as number) + 0.7152 * (pixels[o + 1] as number) + 0.0722 * (pixels[o + 2] as number)) /
        255;
      sum += Math.abs(lum - paperLum);
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}

describe('string-art', () => {
  /**
   * The nails are the drawing.
   *
   * This is the claim the whole construction rests on and the one that
   * separates it from what this pattern used to be. The old version drove its
   * nails around a circular rim at uniform angles — they carried no
   * information at all — and made the picture entirely out of chord density.
   * Here a nail is driven on an *outline*, which is why the board reads as the
   * subject before a single thread goes on.
   *
   * So: a dark disc, one tone, no shading. Every nail must sit on the disc's
   * edge and nowhere else, and they must be evenly spaced along it, because
   * marching squares puts vertices where the grid is rather than where the
   * curve turns — spacing by vertex would crowd them into the corners.
   *
   * Bounds from measurement. Against the real thing 81 nails land at a mean
   * radius of 0.2819 where the picture's edge is 0.282, their radii span
   * 0.0038 of the canvas, and the widest gap between neighbours is 1.013x the
   * median. Watched failing twice: placing nails at ring vertices instead of
   * at even arc length takes the gap ratio to 1.32, and driving them into a
   * rim circle as the old version did puts their mean radius at 0.444.
   */
  it('drives the nails along the picture’s outline, evenly spaced', () => {
    const svg = render({ image: disc(0.3), tones: 1, coverage: 0.28, shading: 0 });
    const pts = nails(svg);
    expect(pts.length, 'no nails were driven at all').toBeGreaterThan(30);

    const radii = pts.map(([x, y]) => Math.sqrt((x - 0.5) * (x - 0.5) + (y - 0.5) * (y - 0.5)));
    const lo = Math.min(...radii);
    const hi = Math.max(...radii);
    // The disc's edge, mapped onto the canvas by the board's size.
    const want = 0.3 * BOARD;
    expect(
      (lo + hi) / 2,
      `the nails sit at radius ${((lo + hi) / 2).toFixed(3)} of the canvas, where the picture's edge is ${want.toFixed(3)}`,
    ).toBeCloseTo(want, 1);
    expect(hi - lo, `the nails' radii span ${(hi - lo).toFixed(3)}, so they are not on one outline`).toBeLessThan(0.03);

    const gaps = pts.map(([x, y], i) => {
      const [nx, ny] = pts[(i + 1) % pts.length] as [number, number];
      return Math.sqrt((nx - x) * (nx - x) + (ny - y) * (ny - y));
    });
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] as number;
    const worst = (sorted[sorted.length - 1] as number) / median;
    expect(worst, `the widest gap between neighbouring nails is ${worst.toFixed(3)}x the median`).toBeLessThan(1.15);
  });

  /**
   * The thread shades a region; it does not bridge across one.
   *
   * A star polygon on a ring stays inside it only while the ring is convex.
   * On anything else — the notch between a helmet's cheek and its jaw, the
   * opening of a crescent, the hole in a ring — some chords leave the shape,
   * and those are exactly the chords that would destroy the drawing, because
   * the hole is the thing that makes it a ring rather than a disc.
   *
   * Each chord is therefore tested along its own length and dropped if it
   * leaves. This asserts the consequence at the place a reader would look:
   * a dark ring with a light hole must come out with an empty hole.
   *
   * Measured: the middle of the hole carries 0.002 of the render's ink
   * against 0.121 in the ring's own body. Watched failing by removing the
   * test at the chord, which fills the hole to 0.093 — thirty-nine times over.
   */
  it('leaves a hole in the picture as a hole in the thread', () => {
    const svg = render({ image: ring(0.18, 0.34), tones: 1, coverage: 0.26, nailsVisible: false });
    const hole = inkWithin(svg, 0, 0.12);
    const body = inkWithin(svg, 0.2, 0.3);
    expect(body, `the ring's own body carries only ${body.toFixed(3)} ink, so nothing was wound`).toBeGreaterThan(0.03);
    expect(
      hole,
      `the hole carries ${hole.toFixed(3)} ink against ${body.toFixed(3)} in the body, so chords are bridging it`,
    ).toBeLessThan(body * 0.2);
  });

  /**
   * Shading makes more thread, at every setting.
   *
   * This is a regression test for a fault that shipped in the first build of
   * this construction and is worth the words, because it is the "two controls
   * that fight" shape and it looked like a design rather than a bug.
   *
   * Two quantities decide a region's winding: how far in the star-polygon
   * families reach, and how many of them are wound inside that reach. Both
   * were free, and a fixed chord budget was spent by widening the stride
   * between families until it fitted. So asking for more shading asked for
   * more reach, which spread the same budget thinner: at `shading` 1 a render
   * carried 1,539 chords in visibly separated bands where 0.55 carried 1,653.
   * The control ran backwards, and every individual piece of it was correct.
   *
   * Reach is now fixed by the tone and shading buys passes within it, and on
   * the subject below the chord counts run 1,196 / 2,541 / 4,108 across the
   * three settings. Watched failing by putting the first build back: it reads
   * 3,783 chords at 0.6 shading and 3,411 at 1, which is the inversion, and
   * the assertion that catches it is the plain one that more must be more.
   */
  it('winds more thread the more shading is asked for', () => {
    const image = disc(0.33);
    const read = (shading: number): { chords: number; ink: number } => {
      const svg = render({ image, shading, nailsVisible: false });
      return { chords: (svg.match(/<line/g) ?? []).length, ink: inkWithin(svg, 0, 0.34) };
    };
    const low = read(0.2);
    const mid = read(0.6);
    const high = read(1);

    expect(
      mid.chords,
      `${low.chords} chords at 0.2 shading and ${mid.chords} at 0.6`,
    ).toBeGreaterThan(low.chords * 1.3);
    expect(
      high.chords,
      `${mid.chords} chords at 0.6 shading and ${high.chords} at 1 — raising shading thinned the winding`,
    ).toBeGreaterThan(mid.chords);
    expect(high.ink, `${mid.ink.toFixed(3)} ink at 0.6 shading and ${high.ink.toFixed(3)} at 1`).toBeGreaterThan(mid.ink);
    expect(low.ink, `${low.ink.toFixed(3)} ink at 0.2 shading and ${mid.ink.toFixed(3)} at 0.6`).toBeLessThan(mid.ink);
  });

  /**
   * Deeper tones are traced as their own shapes, inside the shallower ones.
   *
   * A picture is posterised at nested quantiles, so a dark mark inside a
   * mid-grey body has to come out as an outline of its own rather than as
   * more thread in the body's winding. This is what "including internal
   * structures" means, and it is the difference between a silhouette and a
   * drawing.
   *
   * The subject is a mid-grey disc with a dark bar across it. With one tone
   * only the disc is found; with three, the bar is traced too, which shows up
   * as nails along the bar's own edges — well inside the disc's outline.
   *
   * Measured: 0.0% of nails fall inside the silhouette at one tone and 23.5%
   * at three. Watched failing by giving every tone the same threshold instead
   * of halving it each time, which takes the three-tone reading to 0.0% —
   * three copies of the silhouette and no drawing.
   */
  it('traces internal structure, not just the silhouette', () => {
    const subject = picture((x, y) => {
      if (Math.sqrt(x * x + y * y) >= 0.33) return 0.04;
      return Math.abs(y) < 0.07 && Math.abs(x) < 0.22 ? 0.95 : 0.5;
    });
    const inner = (svg: string): number => {
      const pts = nails(svg);
      const deep = pts.filter(([x, y]) => Math.sqrt((x - 0.5) * (x - 0.5) + (y - 0.5) * (y - 0.5)) < 0.33 * BOARD * 0.8);
      return pts.length === 0 ? 0 : deep.length / pts.length;
    };
    const silhouette = inner(render({ image: subject, tones: 1, coverage: 0.34, shading: 0 }));
    const drawing = inner(render({ image: subject, tones: 3, coverage: 0.34, shading: 0 }));

    expect(
      silhouette,
      `at one tone ${(silhouette * 100).toFixed(0)}% of nails are inside the silhouette, so the outline is not the outline`,
    ).toBeLessThan(0.08);
    expect(
      drawing,
      `at three tones only ${(drawing * 100).toFixed(0)}% of nails are inside the silhouette, so the bar was not traced`,
    ).toBeGreaterThan(0.12);
  });

  /**
   * The picture survives the round trip that lets it travel in a link.
   *
   * `packGrid` and `unpackGrid` are the reason a string-art share link is the
   * portrait rather than a reference to one, so the codec is asserted directly
   * as well as through the render: sixteen levels, so nothing may move by more
   * than half a step.
   */
  it('packs and unpacks a picture at every size within one quantisation step', () => {
    for (const size of GRID_SIZES) {
      const cells = new Float32Array(size * size);
      for (let i = 0; i < cells.length; i++) cells[i] = (i % 97) / 96;
      const packed = packGrid(cells, size);
      expect(packed.length, `a ${size} grid packed to ${packed.length} characters`).toBe(gridChars(size));

      const back = unpackGrid(packed);
      expect(back, `a freshly packed ${size} grid did not unpack`).not.toBeNull();
      // The grid carries its own size, which is what lets a link made at one
      // detail setting still read at another.
      expect(back!.size, 'the grid forgot what size it was').toBe(size);
      let worst = 0;
      for (let i = 0; i < cells.length; i++) worst = Math.max(worst, Math.abs(back!.values[i]! - cells[i]!));
      expect(worst, `at ${size} a value moved by ${worst.toFixed(4)}, more than half a level`).toBeLessThanOrEqual(
        0.5 / 15 + 1e-6,
      );
    }

    expect(unpackGrid(''), 'the empty string is not a picture').toBeNull();
    expect(unpackGrid('not-a-grid'), 'a short string is not a picture').toBeNull();
    expect(unpackGrid(sampleGrid().replace(/^.{5}/, '*****')), 'a grid with foreign characters').toBeNull();
    // A grid whose marker says one size and whose body is another length is
    // the failure a bare length check would miss.
    expect(unpackGrid(sampleGrid().slice(0, -4)), 'a truncated grid').toBeNull();
  });
});
