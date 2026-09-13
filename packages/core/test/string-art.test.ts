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
    params: { ...baseParams(stringArt), nailsVisible: false, ...over },
    seed: 'thread',
    bleed: 0,
  });
}

/** A grid that is dark in the middle, or dark at the rim. */
function blob(inverted: boolean): string {
  const cells = new Float32Array(GRID_SIZE * GRID_SIZE);
  for (let j = 0; j < GRID_SIZE; j++) {
    for (let i = 0; i < GRID_SIZE; i++) {
      const nx = (i + 0.5) / GRID_SIZE - 0.5;
      const ny = (j + 0.5) / GRID_SIZE - 0.5;
      const middle = Math.max(0, 1 - Math.hypot(nx, ny) * 2.6);
      cells[j * GRID_SIZE + i] = inverted ? 1 - middle : middle;
    }
  }
  return packGrid(cells);
}

/** Mean thread coverage inside a centred disc of the given radius fraction. */
function inkWithin(svg: string, from: number, to: number): number {
  const { pixels } = rasterize(svg, SIZE);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const r = Math.hypot((x + 0.5) / SIZE - 0.5, (y + 0.5) / SIZE - 0.5) * 2;
      if (r < from || r >= to) continue;
      const o = (y * SIZE + x) * 4;
      sum +=
        0.2126 * (pixels[o] as number) + 0.7152 * (pixels[o + 1] as number) + 0.0722 * (pixels[o + 2] as number);
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n / 255;
}

describe('string-art', () => {
  /**
   * The picture is a picture of the picture.
   *
   * Everything else here is machinery in service of this one claim, and it is
   * the claim that can fail while every other test stays green: a solver that
   * ignored its target, or read it upside down, or lost it somewhere between
   * the packed string and the residual, would still wind a perfectly
   * respectable disc of thread.
   *
   * So the target is a blob — dark in the middle, light at the rim — and the
   * assertion is that the thread went where the darkness was. The same grid
   * inverted has to flip it, which is what rules out a solver that happens to
   * crowd the middle for geometric reasons: chords do bunch toward the centre
   * of a circle, so "more ink in the middle" on its own proves nothing.
   *
   * Bounds taken from measurement: the centre-dark target scores 2.16
   * centre-to-rim and the edge-dark one 0.66. Watched failing by solving
   * against a flat target, which takes the first to 1.11.
   */
  it('winds the thread where the picture is dark', () => {
    const middleDark = render({ image: blob(false) });
    const rimDark = render({ image: blob(true) });

    const centreA = inkWithin(middleDark, 0, 0.45);
    const rimA = inkWithin(middleDark, 0.62, 0.95);
    const centreB = inkWithin(rimDark, 0, 0.45);
    const rimB = inkWithin(rimDark, 0.62, 0.95);

    expect(centreA, `a centre-dark picture put ${centreA.toFixed(3)} ink in the middle and ${rimA.toFixed(3)} at the rim`).toBeGreaterThan(rimA * 1.6);
    expect(centreB, `an edge-dark picture put ${centreB.toFixed(3)} ink in the middle and ${rimB.toFixed(3)} at the rim`).toBeLessThan(rimB * 0.8);
  });

  /**
   * How much one thread is worth is derived, not chosen.
   *
   * The total ink is fixed by how dark the target is, and divided among
   * however many threads are asked for, so thread count trades boldness for
   * fineness rather than making the picture darker.
   *
   * What this catches specifically is the drawn alpha being a constant, which
   * it was until this test was written: deriving only the solver's subtraction
   * leaves thread count a brightness control by the back door, and quadrupling
   * it laid 2.15x the ink. It does *not* catch a constant ink-per-thread
   * inside the solver — that changes how the threads are distributed without
   * moving the total on the board — and it is worth saying so rather than
   * leaving a reader to assume otherwise.
   */
  it('spends the same ink whether it is wound in few threads or many', () => {
    const image = blob(false);
    const few = inkWithin(render({ image, threads: 700 }), 0, 0.95);
    const many = inkWithin(render({ image, threads: 2800 }), 0, 0.95);
    const ratio = many / Math.max(1e-6, few);
    expect(
      ratio,
      `four times the threads laid ${ratio.toFixed(2)}x the ink, so the ink per thread is not derived`,
    ).toBeLessThan(1.6);
    expect(ratio, `four times the threads laid only ${ratio.toFixed(2)}x the ink`).toBeGreaterThan(0.6);
  });

  /**
   * Where the thread crosses itself, it gets darker. That is the whole medium.
   *
   * This generator drew its winding as a single `<path>` at first, because a
   * wound board really is one continuous thread and saying so cost two
   * thousand elements less. It also made the picture impossible, and the bug
   * was invisible from any angle except this one: SVG strokes a path as one
   * shape and applies opacity to the result, so a path that crosses itself
   * does not composite with itself. Ten overlapping strokes at 30% rendered
   * at 178 on a 0-255 scale where one stroke gives 179; as ten elements, 8.
   *
   * With no accumulation, tone can only come from how much *area* is covered,
   * which saturates almost immediately — every render came out one flat grey
   * with a hint of a face in it. So the assertion is about depth, not shape:
   * the darkest place in a render has to be far darker than a single thread,
   * which is only true if crossings add up.
   */
  it('darkens where the thread crosses itself', () => {
    const svg = render({ image: blob(false), threads: 1200 });
    const { pixels } = rasterize(svg, SIZE);

    const paper = TEST_PALETTES[0]!.background;
    const [pr, pg, pb] = [1, 3, 5].map((i) => parseInt(paper.slice(i, i + 2), 16)) as [number, number, number];
    const paperLum = (0.2126 * pr + 0.7152 * pg + 0.0722 * pb) / 255;

    // How far from the paper each pixel got, and how many distinct depths
    // there are. A render with no accumulation has essentially two: paper, and
    // one thread's worth.
    const depths = new Set<number>();
    let deepest = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const r = Math.hypot((x + 0.5) / SIZE - 0.5, (y + 0.5) / SIZE - 0.5) * 2;
        if (r > 0.85) continue;
        const o = (y * SIZE + x) * 4;
        const lum =
          (0.2126 * (pixels[o] as number) + 0.7152 * (pixels[o + 1] as number) + 0.0722 * (pixels[o + 2] as number)) /
          255;
        const depth = Math.abs(lum - paperLum);
        if (depth > deepest) deepest = depth;
        depths.add(Math.round(depth * 40));
      }
    }

    const single = Number(/stroke-opacity="([\d.]+)"/.exec(svg)?.[1] ?? '1');
    expect(single, 'no thread opacity to compare against').toBeGreaterThan(0);
    // One thread lays `single` of the way from paper to thread colour. The
    // deepest point of a real winding is many threads on top of each other.
    expect(
      deepest / single,
      `the darkest point is ${(deepest / single).toFixed(1)} threads deep, so crossings are not accumulating`,
    ).toBeGreaterThan(3);
    expect(depths.size, `only ${depths.size} distinct depths in the whole render`).toBeGreaterThan(12);
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
