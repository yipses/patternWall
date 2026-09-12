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
   * Concentric rings that are not evenly spaced is the one fault in this mark
   * you cannot help seeing, and it shipped: each side of s/2 used to divide its
   * own room by its own step count, so the inward gaps came out 2.32x the
   * outward ones at every single count. The rings bunched against the cell edge
   * and sprawled toward the corner.
   *
   * The room is genuinely lopsided — 0.207s above s/2 against 0.480s below it —
   * so using all of it and spacing evenly are not both available. Even spacing
   * wins: one step, taken from whichever side is tighter.
   *
   * Measured on a large cell so that rounding coordinates to one decimal does
   * not show up as unevenness; the same render at a 100px cell sits at 1.03x on
   * rounding alone.
   */
  it('spaces the concentric arcs evenly on both sides of the joining radius', () => {
    for (const arcCount of [3, 5, 7, 9, 12]) {
      const svg = render({ density: 4, subdivide: 0, gap: false, arcCount }, 1200);
      const radii = [...new Set([...svg.matchAll(/A([\d.]+) [\d.]+ 0 0 0/g)].map((m) => Number(m[1])))].sort(
        (a, b) => a - b,
      );
      expect(radii.length).toBe(arcCount);
      const gaps = radii.slice(1).map((v, i) => v - (radii[i] as number));
      const spread = Math.max(...gaps) / Math.min(...gaps);
      expect({ arcCount, even: spread < 1.05 }).toEqual({ arcCount, even: true });
    }
  });

  /**
   * What decides whether the marks line up is that the radii set is a mirror of
   * itself about s/2 — not that it contains s/2, which is what an earlier
   * version of this test asserted and what the comments in the generator used
   * to claim.
   *
   * Two cells share an edge. Where their rotations differ they measure arc ends
   * from the same corner of it and every radius meets its twin whatever the set
   * is. Where the rotations agree — half of all edges — one measures from the
   * top and the other from the bottom, so an arc at p can only meet an arc at
   * s - p. A set without that mirror strands ends on half the edges in the
   * grid, which is exactly what shipped: giving the inward and outward sides
   * their own step left about two thirds of arc ends stopping dead, and sharing
   * one step still stranded the outermost ring at every even count, because a
   * set centred on s/2 that contains s/2 must have an odd number of members.
   */
  it('builds a radii set that mirrors itself about s/2, at odd and even counts', () => {
    const cell = 1200 / 4;
    for (const arcCount of [1, 2, 3, 4, 5, 6, 8, 11, 12]) {
      const svg = render({ density: 4, subdivide: 0, gap: false, arcCount }, 1200);
      const radii = [...new Set([...svg.matchAll(/A([\d.]+) [\d.]+ 0 0 0/g)].map((m) => Number(m[1])))];
      expect(radii.length).toBe(arcCount);
      const unmirrored = radii.filter((v) => !radii.some((w) => Math.abs(w - (cell - v)) < 0.6));
      expect({ arcCount, unmirrored: unmirrored.length }).toEqual({ arcCount, unmirrored: 0 });
      // and the ribbon still reaches the ceiling that keeps opposite corners apart
      const reach = Math.max(...radii) / (cell * 0.70710678);
      expect({ arcCount, reachesCeiling: arcCount === 1 || reach > 0.99 }).toEqual({ arcCount, reachesCeiling: true });
      expect(Math.max(...radii)).toBeLessThanOrEqual(cell * 0.70710678 + 0.6);
    }
  });

  /**
   * The property behind all of that, measured where it shows: an arc end that
   * lands on an interior cell edge should have another arc ending on the same
   * point. This is the test that would have caught the original fault, and it
   * fails at 57% for three arcs against the two-step radii that shipped.
   */
  it('leaves no arc end unpartnered on an interior cell edge', () => {
    const SIZE = 600;
    const COLS = 6;
    const cell = SIZE / COLS;
    const rows = Math.ceil(SIZE / cell) + 1;
    const originY = (SIZE - rows * cell) / 2;

    for (const arcCount of [1, 2, 3, 4, 7, 12]) {
      const svg = render({ density: COLS, subdivide: 0, gap: false, openEnds: 0, arcCount }, SIZE);
      const tally = new Map<string, number>();
      for (const m of svg.matchAll(/M([\d.-]+) ([\d.-]+)A[\d.]+ [\d.]+ 0 0 0 ([\d.-]+) ([\d.-]+)/g)) {
        for (const [x, y] of [
          [Number(m[1]), Number(m[2])],
          [Number(m[3]), Number(m[4])],
        ]) {
          const col = (x as number) / cell;
          const onV = Math.abs(col - Math.round(col)) < 1e-6;
          const ry = ((y as number) - originY) / cell;
          const onH = Math.abs(ry - Math.round(ry)) < 1e-6;
          if (!onV && !onH) continue;
          if (onV && (Math.round(col) <= 0 || Math.round(col) >= COLS)) continue;
          if (!onV && ((y as number) < originY + cell || (y as number) > originY + (rows - 1) * cell)) continue;
          const key = `${(x as number).toFixed(1)},${(y as number).toFixed(1)}`;
          tally.set(key, (tally.get(key) ?? 0) + 1);
        }
      }
      const lonely = [...tally.values()].filter((v) => v < 2).length;
      expect(tally.size).toBeGreaterThan(30);
      expect({ arcCount, lonely }).toEqual({ arcCount, lonely: 0 });
    }
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

describe('truchet triangles', () => {
  const SIZE = 420;
  const COLS = 7;

  const triangles = (arcCount: number): string =>
    render({ tileSet: 'triangles', density: COLS, subdivide: 0, gap: false, arcCount }, SIZE);

  const vertices = (svg: string): [number, number][] =>
    [...svg.matchAll(/<polygon points="([^"]+)"/g)].flatMap((m) =>
      (m[1] as string).split(' ').map((pair) => {
        const [x, y] = pair.split(',');
        return [Number(x), Number(y)] as [number, number];
      }),
    );

  /**
   * The count was wired into the arcs and then the diagonals, and left the
   * triangles alone, so raising it on this set did nothing whatever. A solid
   * half-cell has no lines to count, which is what made it look like the
   * control simply did not apply.
   */
  it('slices the tile into bands rather than ignoring the count', () => {
    const counts = [1, 3, 6].map((n) => (triangles(n).match(/<polygon/g) ?? []).length);
    expect(new Set(counts).size).toBe(counts.length);
    expect(counts[1]!).toBeGreaterThan(counts[0]!);
  });

  /**
   * Every rotation of this tile lists its right-angle corner first, so scaling
   * about that vertex sweeps the hypotenuse across the cell and a slice at k/n
   * lands on the chord k*(s/n). That is the same lattice the diagonal family
   * crosses its edges on, and it is the whole reason a band can meet the band
   * in the cell beyond it: a neighbour puts its own band edges at multiples of
   * s/n too, whichever way it is turned.
   *
   * Slice anywhere else — s/(n+0.5), say — and every interior band edge lands
   * where the neighbour has nothing, so the bands butt against the cell
   * boundary instead of continuing through it.
   */
  it('puts every band edge on the shared s/n lattice', () => {
    const cell = SIZE / COLS;
    const rows = Math.ceil(SIZE / cell) + 1;
    const originY = (SIZE - rows * cell) / 2;

    for (const arcCount of [2, 3, 4, 8]) {
      const step = cell / arcCount;
      const isMultiple = (v: number, of: number): boolean => Math.abs(v / of - Math.round(v / of)) < 0.02;
      const offGrid = vertices(triangles(arcCount)).filter(([x, y]) => {
        const lx = x - Math.floor(x / cell + 1e-6) * cell;
        const ly = y - originY - Math.floor((y - originY) / cell + 1e-6) * cell;
        // Bands are trapezoids whose corners ride the two legs of the triangle,
        // and the legs are cell edges — so each vertex sits on an edge, a
        // whole number of steps from the corner it was scaled about.
        const onVertical = (isMultiple(lx, cell) && isMultiple(ly, step));
        const onHorizontal = (isMultiple(ly, cell) && isMultiple(lx, step));
        return !(onVertical || onHorizontal);
      });
      expect(vertices(triangles(arcCount)).length).toBeGreaterThan(50);
      expect({ arcCount, offGrid: offGrid.length }).toEqual({ arcCount, offGrid: 0 });
    }
  });
});

describe('truchet colour resolution', () => {
  const SIZE = 600;
  const COLS = 6;

  /**
   * Colour is sampled from a field across the canvas, and where it is sampled
   * decides whether the blend control does anything. Sampling once per tile
   * gives every mark in that cell the same step of the ramp, so the colour can
   * only change at a cell boundary and the grid reads as flat blocks — and
   * raising the blend just gives each block a finer flat colour, which is what
   * a broken blend looks like from the outside.
   *
   * The arcs were fixed for this long ago, per arc at its own midpoint. The
   * diagonals and triangles kept sampling per tile, which was equivalent while
   * a cell held one mark through its centre and became wrong the moment the
   * division count filled the cell.
   */
  it('resolves colour within a cell, not just between cells', () => {
    for (const tileSet of ['arcs', 'diagonals', 'triangles']) {
      const svg = renderToSvg({
        generator: truchet,
        width: SIZE,
        height: SIZE,
        palette,
        params: { ...defaultParams(truchet), tileSet, density: COLS, subdivide: 0, arcCount: 6, colorBlend: 1 },
        seed: 'colour-resolution',
        bleed: 0,
      });
      const cell = SIZE / COLS;
      const perCell = new Map<string, Set<string>>();
      const add = (x: number, y: number, colour: string): void => {
        const key = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
        if (!perCell.has(key)) perCell.set(key, new Set());
        (perCell.get(key) as Set<string>).add(colour);
      };
      for (const m of svg.matchAll(/<g [^>]*(?:stroke|fill)="(#[0-9a-f]{6})"[^>]*>(.*?)<\/g>/gi)) {
        const colour = m[1] as string;
        const body = m[2] as string;
        // Key each mark on its own midpoint. Its endpoints sit on cell edges,
        // and bucketing by those lands half of them in the neighbouring cell,
        // which mixes two cells' colours together and scores a flat tiling as
        // if it resolved — this test passed against the very bug it exists to
        // catch until the midpoint went in.
        for (const e of body.matchAll(/M([\d.-]+) ([\d.-]+)(?:L|A[\d.]+ [\d.]+ 0 0 0 )([\d.-]+) ([\d.-]+)/g)) {
          add((Number(e[1]) + Number(e[3])) / 2, (Number(e[2]) + Number(e[4])) / 2, colour);
        }
        for (const e of body.matchAll(/points="([^"]+)"/g)) {
          const pts = (e[1] as string).split(' ').map((q) => q.split(',').map(Number));
          const cx = pts.reduce((acc, q) => acc + (q[0] as number), 0) / pts.length;
          const cy2 = pts.reduce((acc, q) => acc + (q[1] as number), 0) / pts.length;
          add(cx, cy2, colour);
        }
      }
      const sizes = [...perCell.values()].map((c) => c.size);
      const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      const most = Math.max(...sizes);
      // Thresholds taken from measurement, not taste. Per-tile colour scores a
      // mean of 1.73 and never puts more than 2 colours in a cell — the stray
      // second one is a mark whose midpoint rounds into a neighbour. Per-mark
      // colour scores 2.9 to 4.4 with up to 10. An earlier version of this
      // test asserted mean > 1.6 and so passed against the bug.
      expect({ tileSet, mean: mean > 2.5, most: most >= 4 }).toEqual({ tileSet, mean: true, most: true });
    }
  });
});
