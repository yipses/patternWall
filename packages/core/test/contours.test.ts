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

/** Every `M x y L x y` in the render, as its two endpoints. */
function segments(svg: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of svg.matchAll(/M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)/g)) {
    out.push([`${m[1]},${m[2]}`, `${m[3]},${m[4]}`]);
  }
  return out;
}

describe('contours', () => {
  /**
   * A contour is a closed curve, or it runs off the canvas. It cannot stop in
   * the middle of the map.
   *
   * That is the one property marching squares can break silently. Every
   * crossing point sits on an edge shared by two cells, so each cell that
   * touches it must contribute a segment end: the ends pair up, and a contour
   * with an odd end somewhere in the interior means a cell answered the wrong
   * case. The picture still looks like a map when this is wrong — it just has
   * lines that stop dead — which is exactly the kind of fault that ships.
   *
   * Points on the canvas border are excluded: a contour running off the edge is
   * genuinely unpaired there, and has nowhere to be paired from.
   *
   * Run at two settings on purpose. The first is ordinary country; the second
   * is rough, finely sampled and small-scale, which is the only place the
   * ambiguous saddle cells occur at all — measured, they are 0% of crossings at
   * the default and 0.41% here. Testing only the ordinary case left the saddle
   * handling with no coverage whatsoever: collapsing it to a single segment
   * passed, which is the "test that cannot fail" trap in its purest form.
   */
  it.each([
    ['ordinary country', { resolution: 60, levels: 18 }],
    ['rough country, where saddles occur', { resolution: 200, levels: 60, detail: 5, scale: 6 }],
  ])('leaves no contour stopping in the middle of the map: %s', (_label, over) => {
    const SIZE = 600;
    const svg = render(over, SIZE);
    const segs = segments(svg);
    expect(segs.length, 'no contour segments to check').toBeGreaterThan(500);

    const ends = new Map<string, number>();
    for (const [p, q] of segs) {
      ends.set(p, (ends.get(p) ?? 0) + 1);
      ends.set(q, (ends.get(q) ?? 0) + 1);
    }

    const onBorder = (key: string): boolean => {
      const [x, y] = key.split(',').map(Number) as [number, number];
      const eps = 0.2;
      return x <= eps || y <= eps || x >= SIZE - eps || y >= SIZE - eps;
    };

    const dangling = [...ends.entries()].filter(([key, n]) => n % 2 === 1 && !onBorder(key));
    expect(
      dangling.length,
      `${dangling.length} contour ends stop in the interior, e.g. ${dangling.slice(0, 3).map(([k]) => k).join(' ')}`,
    ).toBe(0);
  });

  /**
   * Relief is a composition claim: the upper canvas is meant to be calm ground
   * for the clock, with the dense contours in the lower half. It flattens the
   * field rather than dimming the ink, so the test is about how much line there
   * is up there, not how bright it is.
   *
   * The thresholds come from measuring both ends rather than from taste: at
   * relief 0 the top holds about 0.9 of what the bottom does, and at relief 1
   * about 0.05.
   */
  it('empties the top of the canvas as relief rises, and not at zero', () => {
    const SIZE = 600;
    const topShare = (relief: number): number => {
      const segs = segments(render({ relief, resolution: 60 }, SIZE));
      let top = 0;
      let bottom = 0;
      for (const [p, q] of segs) {
        const y = (Number(p.split(',')[1]) + Number(q.split(',')[1])) / 2;
        if (y < SIZE * 0.25) top += 1;
        else if (y > SIZE * 0.75) bottom += 1;
      }
      expect(bottom, 'no contours in the lower canvas to compare against').toBeGreaterThan(50);
      return top / bottom;
    };

    expect(topShare(0), 'at relief 0 the country should be equally rugged everywhere').toBeGreaterThan(0.6);
    expect(topShare(1), 'at relief 1 the top should be nearly bare').toBeLessThan(0.25);
  });
});
