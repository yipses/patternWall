import { describe, expect, it } from 'vitest';
import { curatedPalettes, defaultParams, getGenerator, renderToSvg } from '../src/index.js';
import { rasterize } from './helpers.js';

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

/**
 * Mean distance from the paper, over the whole canvas.
 *
 * Not `nonBackgroundFraction`, which counts pixels differing from the top-left
 * one: on a tiling that covers the canvas the top-left pixel is usually ink
 * rather than paper, so it reads 0.999 for a thin render and 0.975 for a heavy
 * one — backwards, and both saturated. Measuring against the palette's own
 * background instead answers the question actually being asked, which is how
 * much of the paper is covered.
 */
function ink(overrides: Record<string, number | string | boolean>): number {
  const { pixels } = rasterize(render(overrides), 300);
  const [pr, pg, pb] = [1, 3, 5].map((i) => parseInt(palette.background.slice(i, i + 2), 16)) as [number, number, number];
  const paper = (0.2126 * pr + 0.7152 * pg + 0.0722 * pb) / 255;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const lum =
      (0.2126 * (pixels[i] as number) + 0.7152 * (pixels[i + 1] as number) + 0.0722 * (pixels[i + 2] as number)) / 255;
    sum += Math.abs(lum - paper);
    n += 1;
  }
  return n === 0 ? 0 : sum / n;
}

describe('truchet stroke weight', () => {
  /**
   * Every tile set answers to weight, and answers in the same direction.
   *
   * Triangles did not, for as long as this generator has existed. They are
   * filled and weight sets a stroke width, so there was nothing for it to
   * apply itself to — and rather than being noticed as a bug it was written
   * down twice as a known dead knob, in this repo's own notes and in the
   * parameter's description. It survived because a slider that does nothing on
   * one of three settings is easy to look past.
   *
   * What ended that was binding the three controls to the picture: weight is
   * truchet's horizontal drag now, so a dead control became a dead *gesture*,
   * and a third of the way a person drives this pattern did nothing on a third
   * of its tile sets. It was reported the same week.
   *
   * So the test is the general claim rather than the specific fix — heavier is
   * more ink, on every set, at an undivided tile and a divided one both. That
   * is the assertion a fourth tile set would have to pass too, which is the
   * only reason this catches the next one instead of just this one.
   *
   * Measured, thin 0.05 against heavy 0.45: arcs 0.056 -> 0.481 undivided and
   * 0.157 -> 0.415 at three divisions, diagonals 0.058 -> 0.447 and
   * 0.154 -> 0.466, triangles 0.030 -> 0.300 and 0.051 -> 0.299. Watched
   * failing against the code as it was, where the triangles read 0.300 thin
   * and 0.300 heavy, and 0.205 either way when divided — the same number to
   * three places, which is what a dead control looks like when you finally
   * measure it.
   */
  it('lays more ink the heavier it is, on every tile set', () => {
    for (const tileSet of ['arcs', 'diagonals', 'triangles']) {
      for (const arcCount of [1, 3]) {
        const thin = ink({ tileSet, arcCount, weight: 0.05 });
        const heavy = ink({ tileSet, arcCount, weight: 0.45 });
        expect(
          heavy,
          `${tileSet} at ${arcCount} division(s) laid ${heavy.toFixed(3)} ink heavy against ${thin.toFixed(3)} thin`,
        ).toBeGreaterThan(thin * 1.25);
      }
    }
  });

  /**
   * The whole slider does something, at every division count.
   *
   * The test above uses 0.05 against 0.45 at one and three divisions, and it
   * passed against the bug this one catches, because 0.05 is below the gap at
   * three divisions and so the thin end still moved. The fault was at the
   * *top* of the slider and it got worse the further you raised divisions: a
   * stroke was sized as a fraction of the cell and then clamped to the gap
   * between rings, so above the gap the control asked for a width it could not
   * have and got the gap. Measured on the arcs at eight columns, the share of
   * the slider's travel that changed the rendered stroke at all was 100% at
   * one division, 29% at three and 6% at twelve — with the 0.16 default
   * already inside the dead zone from three divisions up.
   *
   * So this asks the question the other test cannot: from the default upward,
   * at the counts where the gap is tightest. Against the old clamp both ends
   * render the identical stroke — 1.38px at twelve divisions whether you ask
   * for 0.16 or 0.5 — and the assertion reads the same number twice.
   *
   * Triangles are deliberately not here. Their ceiling is real: `weight` has
   * always been a fraction of pitch there, and at twice its pitch a band has
   * closed the gap either side of it and the tile is solid, so the top of the
   * slider is saturation rather than a clamp. It is visible in the picture,
   * which is the difference that matters.
   */
  it('keeps answering above the default, where the gap is tightest', () => {
    for (const [tileSet, arcCount] of [
      ['arcs', 12],
      ['arcs', 6],
      ['diagonals', 6],
    ] as const) {
      const mid = ink({ tileSet, arcCount, weight: 0.16 });
      const heavy = ink({ tileSet, arcCount, weight: 0.5 });
      expect(
        heavy,
        `${tileSet} at ${arcCount} divisions laid ${heavy.toFixed(3)} ink at the top of the slider against ${mid.toFixed(3)} at the default`,
      ).toBeGreaterThan(mid * 1.25);
    }
  });

  /**
   * The default is the render it always was.
   *
   * Giving a dead control something to do is a change to every picture that
   * used it, and the one place that must not move is where nobody asked it to.
   * The fill is anchored on the default weight precisely so that this holds:
   * at exactly the default the arithmetic reduces to the expression this tile
   * emitted before the control existed, byte for byte, at every division count.
   */
  it('leaves the default weight emitting exactly what it always emitted', () => {
    // Pinned rather than compared against a recomputation, so that a change to
    // the fill arithmetic that happens to be self-consistent still fails here.
    // Taken from the code before this control existed, not from the code
    // after it: measured under `git stash`, which is the only way the claim
    // means anything.
    //
    // The undivided number is the original and must never move — it is the
    // identity of this tile set. The two divided ones were re-pinned once, on
    // purpose, when the opposite triangle was added to give a divided cell
    // legs on all four of its edges; that roughly doubles the marks in a
    // divided tile and is the change recorded in the block below. Re-pin these
    // only with a reason of that size.
    expect(render({ tileSet: 'triangles' }).length).toBe(5691);
    expect(render({ tileSet: 'triangles', arcCount: 3 }).length).toBe(16727);
    expect(render({ tileSet: 'triangles', arcCount: 6 }).length).toBe(32547);
  });

  /**
   * An undivided triangle thinned is still a triangle.
   *
   * This is the half of the rule that total ink cannot see, and the reason the
   * band is anchored at its corner-side edge rather than centred on itself. At
   * full fill the two are the same expression, so every other test here passes
   * either way; they only diverge once the band is thinned, and then a centred
   * band becomes a four-sided strip across the middle of the tile while an
   * anchored one scales about the right angle and stays the shape it was.
   *
   * Keeping the two legs on the cell edges is also what keeps the join: that is
   * where the neighbouring tiles meet this one, and a strip floating in the
   * middle of a cell meets nothing.
   */
  it('shrinks an undivided triangle as a triangle, not into a band across it', () => {
    const svg = render({ tileSet: 'triangles', arcCount: 1, weight: 0.05 });
    const polygons = svg.match(/<polygon points="([^"]+)"/g) ?? [];
    expect(polygons.length, 'no triangles were drawn at all').toBeGreaterThan(20);
    for (const p of polygons) {
      const corners = (p.match(/,/g) ?? []).length;
      expect(corners, `a thinned triangle came out with ${corners} corners: ${p}`).toBe(3);
    }
  });

  /**
   * Past the top the bands fuse, which is what gives the upper half of the
   * slider something to say on a divided tile.
   *
   * This used to assert that a heavy divided triangle covers the *same* as a
   * heavy undivided one, within 0.02, and that equality was an artefact rather
   * than a property: both were a solid half cell, because a lone triangle only
   * ever used half of its own cell. With the opposite triangle drawn the
   * divided tile has the whole cell to fuse across, and measures 0.574 against
   * 0.300 — about twice, which is the ratio you would expect from a mark that
   * stopped wasting half its cell.
   *
   * So the claim is the one that survives that: the top of the slider fuses
   * ribbons into mass, more than a default-weight divided tile lays and at
   * least as much as a solid undivided one. Bounds taken from the two
   * measurements, not from what sounds reasonable.
   */
  it('grows a divided triangle back into solid mass', () => {
    const heavyDivided = ink({ tileSet: 'triangles', arcCount: 3, weight: 0.45 });
    const lightDivided = ink({ tileSet: 'triangles', arcCount: 3 });
    const solid = ink({ tileSet: 'triangles', arcCount: 1, weight: 0.45 });
    expect(
      heavyDivided,
      `a divided triangle at full weight covers ${heavyDivided.toFixed(3)} against ${lightDivided.toFixed(3)} at the default`,
    ).toBeGreaterThan(lightDivided * 1.3);
    expect(
      heavyDivided,
      `a divided triangle at full weight covers ${heavyDivided.toFixed(3)} against ${solid.toFixed(3)} for a solid undivided one`,
    ).toBeGreaterThan(solid);
  });
});

/**
 * The worst colour step between two arc ends that touch, in RGB distance, and
 * the longest straight span any single colour covers.
 */
function arcSeams(svg: string, width: number): { worst: number; span: number } {
  const marks: { colour: string; a: [number, number]; b: [number, number] }[] = [];
  for (const gm of svg.matchAll(/<g [^>]*stroke="(#[0-9a-f]{6})"[^>]*>(.*?)<\/g>/gs)) {
    const colour = gm[1] as string;
    for (const pm of (gm[2] as string).matchAll(/d="M([-\d.]+) ([-\d.]+)A[\d.]+ [\d.]+ 0 0 0 ([-\d.]+) ([-\d.]+)"/g)) {
      marks.push({ colour, a: [Number(pm[1]), Number(pm[2])], b: [Number(pm[3]), Number(pm[4])] });
    }
  }
  const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const at = new Map<string, string[]>();
  for (const m of marks) {
    for (const p of [m.a, m.b]) {
      const k = `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
      const list = at.get(k);
      if (list) list.push(m.colour);
      else at.set(k, [m.colour]);
    }
  }
  let worst = 0;
  for (const cols of at.values()) {
    for (let i = 0; i < cols.length; i++) {
      for (let j = i + 1; j < cols.length; j++) {
        const [r1, g1, b1] = rgb(cols[i] as string) as [number, number, number];
        const [r2, g2, b2] = rgb(cols[j] as string) as [number, number, number];
        worst = Math.max(worst, Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2));
      }
    }
  }
  let span = 0;
  for (const m of marks) span = Math.max(span, Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) / width);
  return { worst, span };
}

describe('truchet triangles and the division count', () => {
  /**
   * Dividing a triangle must not empty the tiling out.
   *
   * A lone triangle is bounded by two cell edges and the diagonal, so it
   * touches only two of its cell's four edges — this repo's own "one mark per
   * cell cannot tile" note, written about the arcs, which were fixed for it
   * long ago and left this set as the one that never was. Measured over all
   * sixteen rotation pairs, only 4 put ink on both sides of a shared edge and
   * 8 put it on one side only.
   *
   * What made it visible was the count. Filling every other band of a half
   * cell inks less and less of the cell as the count rises — measured at five
   * columns, 0.538 of the canvas undivided against 0.337 at six divisions, a
   * 37% collapse — so raising divisions thinned the pattern to scattered
   * ribbons instead of dividing it. It was reported as divisions "not doing
   * well" on this tile set, which is exactly what it was.
   *
   * Drawing the opposite triangle on the complementary parity gives the cell
   * legs on all four edges and holds the ink: 0.517 to 0.550 across the same
   * range. The bound is taken from between the two measurements rather than
   * from what sounds reasonable.
   */
  it('holds its ink as the division count rises', () => {
    const solid = ink({ tileSet: 'triangles', arcCount: 1 });
    for (const arcCount of [2, 3, 4, 6]) {
      const divided = ink({ tileSet: 'triangles', arcCount });
      expect(
        divided,
        `triangles laid ${divided.toFixed(3)} ink at ${arcCount} divisions against ${solid.toFixed(3)} undivided`,
      ).toBeGreaterThan(solid * 0.85);
    }
  });

});

describe('truchet arc colour', () => {
  /**
   * A ribbon does not change colour in a step where it crosses a cell edge.
   *
   * The chords have been cut into pieces for colour since the fault was found
   * on them; the arcs never were, and it shows in exactly the way the note
   * about flat units predicts. One colour per arc is one colour across
   * (pi/2)*rho of the canvas, and rho reaches s/sqrt(2) — so at five columns a
   * single arc carries one colour across 18.5% of the width, against the 6%
   * the chords hold to. Two arcs meeting at a cell edge then sample a whole
   * cell apart, and the ribbon running through them changes hue in a hard
   * vertical line at the join.
   *
   * It was reported at full colour blend, and that is where it shows worst
   * rather than where it starts: a fine ramp makes the step a different colour
   * where a coarse one would have landed on a neighbour.
   *
   * So the assertion is the symptom, measured where it appears — the colour
   * distance between two arc ends that touch — and the rule underneath it.
   * Measured at full blend, worst join and longest one-colour span:
   *
   *     columns    before            after
   *      3         227.7 / 33.3%     62.7 / 6.2%
   *      5         140.3 / 20.0%     66.6 / 5.5%
   *      8         114.6 / 12.5%     48.9 / 4.6%
   *     12         100.0 /  8.3%     57.3 / 4.5%
   *     20          66.6 /  5.0%     66.6 / 5.0%   (no cutting either way)
   *
   * The bounds sit between those two columns rather than at the rule, and the
   * reason is the 66.6 floor: that is the step between neighbouring bands of a
   * 48-colour ramp, which is what full blend *is*, and it is there at twenty
   * columns where nothing changed. A bound tight enough to call it a fault
   * would fail against correct output.
   *
   * The span bound is 7% and not the 6% the chords hold to, for the reason the
   * cut table gives: six pieces is the ceiling, and at three columns that
   * leaves 6.2%.
   */
  it('does not step in colour where two arcs meet', () => {
    for (const [density, before] of [[3, 227.7], [5, 140.3], [8, 114.6], [12, 100]] as const) {
      const svg = render({ tileSet: 'arcs', density, arcCount: 6, colorSpread: 1 });
      const { worst, span } = arcSeams(svg, 400);
      expect(worst, `at ${density} columns the worst join steps ${worst.toFixed(1)}, where it was ${before}`).toBeLessThan(80);
      expect(span, `at ${density} columns one colour runs ${(span * 100).toFixed(1)}% of the width`).toBeLessThan(0.07);
    }
  });

  /**
   * And it costs nothing where there is no fault to fix. Past about nineteen
   * columns an arc is already shorter than the rule allows, so it is emitted
   * exactly as it always was — which is also the grid where the render is
   * heaviest and quadrupling the mark count would hurt most.
   */
  it('leaves a fine grid emitting exactly what it always emitted', () => {
    // Pinned from before the arcs were cut, measured under `git stash`.
    expect(render({ tileSet: 'arcs', density: 20, arcCount: 6 }).length).toBe(334434);
  });
});

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
      const svg = render({ density: 4, arcCount }, 1200);
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
      const svg = render({ density: 4, arcCount }, 1200);
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
      const svg = render({ density: COLS, arcCount }, SIZE);
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
   * The palette is resolved into a ramp, not shown as its bare accents.
   *
   * This used to be a control — `colorBlend`, a slider from the accents
   * themselves up to a 48-step ramp between them — and the assertion was that
   * the two ends differed. The control is gone and the ramp is always full,
   * so what is left to claim is the thing the top of that slider bought: the
   * render uses colours the palette does not literally contain, which is what
   * makes a region ease into the next instead of meeting it at an edge.
   *
   * The bottom end went because it had one idea and the rest of the range was
   * a finer version of it, and because it was where the arcs' flat-unit fault
   * showed worst — a slider carrying the weight of a bug rather than an idea.
   */
  it('resolves the palette into a ramp rather than its bare accents', () => {
    const strokeHexes = (svg: string): Set<string> =>
      new Set([...svg.matchAll(/stroke="(#[0-9a-f]{6})"/gi)].map((m) => (m[1] as string).toLowerCase()));

    const drawn = strokeHexes(render({ colorSpread: 1 }));
    const accents = new Set(palette.accents.map((a) => a.toLowerCase()));

    expect(drawn.size, 'nothing was drawn').toBeGreaterThan(0);
    expect(
      drawn.size,
      `${drawn.size} stroke colours for a palette of ${accents.size} accents`,
    ).toBeGreaterThan(accents.size * 3);
    const between = [...drawn].filter((c) => !accents.has(c));
    expect(between.length, 'every colour drawn is a bare accent, so nothing is interpolated').toBeGreaterThan(
      drawn.size / 2,
    );
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
    render({ tileSet: 'diagonals', density: COLS, arcCount }, SIZE);

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
    render({ tileSet: 'triangles', density: COLS, arcCount }, SIZE);

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

/**
 * No diagonal mark may carry one colour across more than 6% of the canvas
 * width.
 *
 * This is the property behind a fault that survived the earlier per-mark fix.
 * Sampling once per chord stopped whole cells being one flat colour, but a
 * colour boundary could then only fall in the gap *between* chords — and every
 * chord runs at 45°, so the field's contours snapped onto a lattice of parallel
 * lines and came out as straight-edged diamond facets across what should be a
 * smooth wash. Resolution was fine across the family (spacing s/n) and coarse
 * along it (nothing changes for the chord's whole 1.41s length).
 *
 * The bound is the anisotropy stated as a number, so it fails wherever a chord
 * is long relative to the colour field, not only at the density someone
 * happened to look at. Before the fix, a chord spans 1.41/cols of the canvas:
 * 0.47 at three columns, 0.18 at the default eight, and the bound is only met
 * by accident past about 23 columns.
 */
describe('truchet diagonal colour resolution', () => {
  const MAX_SEGMENT = 0.06;

  for (const density of [3, 6, 8, 12, 26]) {
    it(`keeps a single-colour piece under ${MAX_SEGMENT * 100}% of the canvas at density ${density}`, () => {
      const W = 900;
      const svg = render({ tileSet: 'diagonals', density, arcCount: 4 }, W);
      // Measure the first line segment of every path; the one path that also
      // carries the corner spur is measured on its chord piece alone.
      const lengths: number[] = [];
      for (const m of svg.matchAll(/d="M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)/g)) {
        lengths.push(Math.hypot(Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])));
      }
      expect(lengths.length, 'no diagonal marks to measure').toBeGreaterThan(20);
      const worst = Math.max(...lengths) / W;
      expect(
        worst,
        `a mark carries one colour across ${(worst * 100).toFixed(1)}% of the canvas at density ${density}`,
      ).toBeLessThanOrEqual(MAX_SEGMENT * 1.02);
    });
  }
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
        params: { ...defaultParams(truchet), tileSet, density: COLS, arcCount: 6 },
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
