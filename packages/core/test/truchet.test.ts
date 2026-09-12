import { describe, expect, it } from 'vitest';
import { curatedPalettes, defaultParams, getGenerator, renderToSvg } from '../src/index.js';

const truchet = getGenerator('truchet')!;
const palette = curatedPalettes[0]!;

function render(overrides: Record<string, number | string | boolean>, size = 400): string {
  return renderToSvg({
    generator: truchet,
    width: size,
    height: size,
    palette,
    params: { ...defaultParams(truchet), tileSet: 'arcs', ...overrides },
    seed: 'truchet-geometry',
    bleed: 0,
  });
}

describe('truchet quarter arcs', () => {
  /**
   * Two circles of a given radius pass through any two points closer together
   * than its diameter, and the sweep flag picks which one. For a quarter arc
   * joining two edge midpoints of a cell, that is the difference between a
   * circle centred on the cell's corner and one centred on the cell's middle.
   *
   * Only the corner-centred choice is a Truchet tile. Get it wrong and the
   * marks still meet at the edge midpoints, so the tiling looks plausible at a
   * glance — but no arc is ever centred on a grid vertex, so the loops, half
   * circles and full circles that are the whole point of the pattern cannot
   * form. The tiling silently degrades into disconnected quarters of inscribed
   * circles.
   */
  it('centres every arc on a cell corner, not the cell middle', () => {
    const svg = render({});
    const arcs = svg.match(/A[\d.]+ [\d.]+ 0 0 (\d)/g) ?? [];
    expect(arcs.length).toBeGreaterThan(20);
    for (const arc of arcs) expect(arc.endsWith(' 0')).toBe(true);
  });


  /**
   * Colour is sampled from a field across the image, so neighbouring marks land
   * on neighbouring steps of the ramp and a region of one accent eases into a
   * region of another. Blend is the resolution of that ramp: at zero only the
   * palette's own accents are used and the regions meet at hard edges.
   */
  it('resolves the palette into a ramp only when blend is raised', () => {
    const strokeHexes = (svg: string): Set<string> =>
      new Set([...svg.matchAll(/stroke="(#[0-9a-f]{6})"/gi)].map((m) => (m[1] as string).toLowerCase()));

    const flat = strokeHexes(render({ colorBlend: 0 }));
    const blended = strokeHexes(render({ colorBlend: 1 }));
    const accents = new Set(palette.accents.map((a) => a.toLowerCase()));

    expect(flat.size).toBeGreaterThan(0);
    for (const c of flat) expect(accents.has(c)).toBe(true);
    expect(blended.size).toBeGreaterThan(flat.size * 2);
  });

  /**
   * The colour field is sampled in normalised canvas coordinates, never in
   * pixels. Keyed on pixels, a 108px gallery thumbnail gets a far coarser field
   * than a 1399px export and the two are coloured differently — so the preview
   * stops being the thing you download, exactly as the geometry would if it
   * measured in pixels.
   */
  it('colours the same configuration identically at any size', () => {
    const paletteOf = (svg: string): string =>
      [...new Set([...svg.matchAll(/stroke="(#[0-9a-f]{6})"/gi)].map((m) => (m[1] as string).toLowerCase()))]
        .sort()
        .join(',');

    const small = paletteOf(render({}, 120));
    const large = paletteOf(render({}, 1200));
    expect(small).not.toBe('');
    expect(small).toBe(large);
  });
});

describe('truchet diagonals', () => {
  const SIZE = 420;
  const COLS = 7;

  const segments = (svg: string): [number, number][][] =>
    [...svg.matchAll(/M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)/g)].map((m) => [
      [Number(m[1]), Number(m[2])],
      [Number(m[3]), Number(m[4])],
    ]);

  const diagonals = (arcCount: number): string =>
    render({ tileSet: 'diagonals', density: COLS, subdivide: 0, gap: false, arcCount }, SIZE);

  /**
   * Raising the arc count on this tile set used to do nothing at all: the
   * control belonged to the arcs branch and the diagonals branch drew its one
   * corner-to-corner line whatever the count said.
   */
  it('draws 2n-1 parallel chords per cell rather than ignoring the count', () => {
    const counts = [1, 2, 3, 6].map((n) => segments(diagonals(n)).length);
    expect(new Set(counts).size).toBe(counts.length);
    // 2n-1 chords per cell, against the same cell count each time. The single
    // chord case also carries the spur, so compare the multi-chord cases.
    const cells = counts[1]! / 3;
    expect(counts[2]).toBe(cells * 5);
    expect(counts[3]).toBe(cells * 11);
  });

  /**
   * The spacing is what makes the family tile, and s/n is the only choice that
   * does: a chord offset by k*(s/n) crosses every cell edge at a multiple of
   * s/n from the corner, in both rotations, so each one meets a partner across
   * the edge whatever the neighbour rolled.
   *
   * Any other extent breaks it, and not obviously — narrowing the family to
   * the chords nearest the diagonal, which is what Arc spread would do if it
   * were wired in here, leaves a cell crossing its right edge near the bottom
   * corner and its left edge near the top one. Two neighbours of the same
   * rotation then overlap only when the family is at least half width, and
   * below that 62% of crossings have nothing on the other side: the lines stop
   * dead along the boundary and the grid reads straight through the pattern.
   * This test fails at exactly that rate if the truncation is reintroduced.
   */
  it('gives every interior edge crossing a partner, at any arc count', () => {
    const cell = SIZE / COLS;
    const rows = Math.ceil(SIZE / cell) + 1;
    const originY = (SIZE - rows * cell) / 2;

    for (const arcCount of [2, 3, 4, 8, 12]) {
      const tally = new Map<string, number>();
      for (const seg of segments(diagonals(arcCount))) {
        for (const [x, y] of seg) {
          // Only endpoints landing on an interior vertical cell edge, and not
          // on a grid vertex — a chord ending on a vertex meets the cell
          // diagonally opposite, which is the tile set's own kind of end.
          const col = x / cell;
          if (Math.abs(col - Math.round(col)) > 1e-6) continue;
          if (Math.round(col) <= 0 || Math.round(col) >= COLS) continue;
          const ry = (y - originY) / cell;
          if (Math.abs(ry - Math.round(ry)) < 1e-6) continue;
          if (y < originY + cell || y > originY + (rows - 1) * cell) continue;
          const key = `${x.toFixed(1)},${y.toFixed(1)}`;
          tally.set(key, (tally.get(key) ?? 0) + 1);
        }
      }
      const lonely = [...tally.values()].filter((v) => v < 2).length;
      expect(tally.size).toBeGreaterThan(20);
      expect({ arcCount, lonely }).toEqual({ arcCount, lonely: 0 });
    }
  });
});
