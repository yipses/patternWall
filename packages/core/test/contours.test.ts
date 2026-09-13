import { describe, expect, it } from 'vitest';
import { renderToSvg } from '../src/index.js';
import { ALL_GENERATORS, baseParams, TEST_PALETTES } from './helpers.js';

const contours = ALL_GENERATORS.find((g) => g.id === 'contours')!;

function render(over: Record<string, number | string | boolean>, size = 600): string {
  return renderToSvg({
    generator: contours,
    width: size,
    height: size,
    palette: TEST_PALETTES[0]!,
    params: { ...baseParams(contours), ...over },
    seed: 'survey',
    bleed: 0,
  });
}

/** Each subpath of the render: its first point, last point, and whether it closes. */
function subpaths(svg: string): { start: [number, number]; end: [number, number]; closed: boolean; points: number }[] {
  const out: { start: [number, number]; end: [number, number]; closed: boolean; points: number }[] = [];
  for (const chunk of svg.split(/M(?=[-\d])/).slice(1)) {
    const body = chunk.replace(/".*$/s, '');
    const nums = (body.match(/-?[\d.]+/g) ?? []).map(Number);
    if (nums.length < 4) continue;
    out.push({
      start: [nums[0] as number, nums[1] as number],
      end: [nums[nums.length - 2] as number, nums[nums.length - 1] as number],
      closed: body.trimEnd().endsWith('Z'),
      points: (body.match(/C/g) ?? []).length,
    });
  }
  return out;
}

describe('contours', () => {
  /**
   * A contour is a closed curve, or it runs off the canvas. It cannot stop in
   * the middle of the map.
   *
   * That is the one property marching squares can break silently, and since the
   * crossings are chained into whole curves it can now be asserted directly:
   * every subpath either closes with a Z or has both of its ends on the canvas
   * border. An earlier version of this test counted unpaired segment endpoints,
   * which said the same thing about the raw fragments; this says it about the
   * curves that actually get drawn, so it also covers the chaining.
   *
   * Run at two settings on purpose. The first is ordinary country; the second
   * is rough, finely sampled and small-scale, which is where the ambiguous
   * saddle cells occur — measured, they are a fraction of a percent of
   * crossings. Testing only the ordinary case once left the saddle handling
   * with no coverage at all: collapsing it to a single segment passed, which is
   * the "test that cannot fail" trap in its purest form.
   */
  it.each([
    ['ordinary country', { resolution: 60, levels: 18 }],
    ['rough country, where saddles occur', { resolution: 200, levels: 60, detail: 5, scale: 6, grain: 1, incision: 0.8 }],
  ])('leaves no contour stopping in the middle of the map: %s', (_label, over) => {
    const SIZE = 600;
    const paths = subpaths(render(over, SIZE));
    expect(paths.length, 'no contours to check').toBeGreaterThan(20);

    const onBorder = ([x, y]: [number, number]): boolean => {
      const eps = 0.3;
      return x <= eps || y <= eps || x >= SIZE - eps || y >= SIZE - eps;
    };

    const dangling = paths.filter((p) => !p.closed && !(onBorder(p.start) && onBorder(p.end)));
    expect(
      dangling.length,
      `${dangling.length} contours stop in the interior, e.g. ${dangling
        .slice(0, 3)
        .map((p) => `${p.start.map((n) => n.toFixed(1)).join(',')}->${p.end.map((n) => n.toFixed(1)).join(',')}`)
        .join(' ')}`,
    ).toBe(0);
  });

  /**
   * The curves are interpolated, so a coarse grid should cost small features
   * rather than smoothness. Every contour is drawn as cubic segments; a run of
   * straight hops would mean the chaining or the smoothing stopped happening,
   * which is the regression that would quietly put the faceting back.
   */
  it('draws curves rather than straight hops', () => {
    const svg = render({ resolution: 60, levels: 18 }, 600);
    expect(svg).not.toMatch(/L-?[\d.]+ -?[\d.]+L/);
    const curvy = subpaths(svg).filter((p) => p.points > 0).length;
    expect(curvy / subpaths(svg).length, 'most contours should be curves').toBeGreaterThan(0.9);
  });

  /**
   * Relief is a composition claim: the upper canvas is meant to be calm ground
   * for the clock, with the dense contours in the lower half. It flattens the
   * field rather than dimming the ink, so the test is about how much line there
   * is up there, not how bright it is.
   *
   * The two ends are compared against each other on one seed rather than
   * against fixed numbers, because the measure is strongly seed-dependent: over
   * four seeds, relief 0 gives a top-to-bottom ratio anywhere from 0.68 to
   * 1.70, and relief 1 from 0.07 to 0.25. A constant bound calibrated on one
   * seed sits right on the line for another — this test failed at 0.2539
   * against a 0.25 bound the first time the defaults moved, which is the
   * threshold-picked-by-eye trap in CLAUDE.md arriving on schedule. The ratio
   * between the two ends is stable where the ends themselves are not: it never
   * exceeds 0.30, so a bound of half is clear of every seed measured, and the
   * bug this guards against — relief ignored entirely — puts it at 1.
   */
  it('empties the top of the canvas as relief rises, and not at zero', () => {
    const SIZE = 600;
    // Counted as points on the drawn curves: the contours are cubics now, so
    // there are no segments to take midpoints of, and how many points a band
    // of the canvas holds tracks how much contour runs through it.
    const topShare = (relief: number): number => {
      const svg = render({ relief, resolution: 60 }, SIZE);
      let top = 0;
      let bottom = 0;
      for (const d of svg.matchAll(/ d="([^"]+)"/g)) {
        const nums = ((d[1] as string).match(/-?[\d.]+/g) ?? []).map(Number);
        for (let i = 1; i < nums.length; i += 2) {
          const y = nums[i] as number;
          if (y < SIZE * 0.25) top += 1;
          else if (y > SIZE * 0.75) bottom += 1;
        }
      }
      expect(bottom, 'no contours in the lower canvas to compare against').toBeGreaterThan(50);
      return top / bottom;
    };

    const flat = topShare(0);
    const relieved = topShare(1);
    expect(flat, `at relief 0 the country should be equally rugged everywhere, got ${flat.toFixed(3)}`).toBeGreaterThan(0.4);
    expect(
      relieved,
      `relief 1 left ${relieved.toFixed(3)} of the lower canvas's contours up top, against ${flat.toFixed(3)} at relief 0`,
    ).toBeLessThan(flat * 0.5);
  });
});
