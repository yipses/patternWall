import { describe, expect, it } from 'vitest';
import { renderToSvg } from '../src/index.js';
import { ALL_GENERATORS, baseParams, TEST_PALETTES } from './helpers.js';

const flowDots = ALL_GENERATORS.find((g) => g.id === 'flow-dots')!;

/**
 * Share of dots in each accent band, read off the emitted groups.
 *
 * The generator buckets dots by band and emits one `<g fill="…">` per band, so
 * splitting on that and counting circles gives the distribution across the ramp
 * without having to rasterise anything.
 */
function bandShares(colorSpread: number): number[] {
  const svg = renderToSvg({
    generator: flowDots,
    width: 430,
    height: 932,
    palette: TEST_PALETTES[0]!,
    params: { ...baseParams(flowDots), colorSpread },
    seed: 'fd',
    bleed: 0.08,
  });
  const counts = svg.split('<g fill="').slice(1).map((chunk) => (chunk.match(/<circle/g) ?? []).length);
  const total = counts.reduce((a, b) => a + b, 0);
  expect(total, 'no dots were emitted to measure').toBeGreaterThan(500);
  return counts.map((n) => n / total);
}

describe('flow-dots colour spread', () => {
  /**
   * The control used to add its two sources rather than crossfade between them,
   * so the sum overflowed and the clamp swept everything above 1 into the last
   * band. Measured on the emitted SVG, the final accent held 42.4% of every dot
   * at spread 1 and 31.5% at the default of 0.7 — a third of the image painted
   * one colour by arithmetic accident. It is now 10.1% and 14.2%.
   *
   * The bound is 0.20, which clears both broken figures and both fixed ones by
   * a wide margin, and is loose enough that the bell shape at intermediate
   * spreads is allowed — an even distribution is not the goal, an unpooled one
   * is.
   *
   * Spread 0 is deliberately not tested: the colour there is purely the
   * vertical gradient, so the distribution reflects where the dots are on the
   * canvas rather than anything this control does. Its first band holds 23% at
   * both ends of the fix.
   */
  it('does not pool dots in the last accent', () => {
    for (const spread of [0.7, 1]) {
      const shares = bandShares(spread);
      const worst = Math.max(...shares);
      expect(worst, `spread ${spread}: one accent holds ${(worst * 100).toFixed(1)}% of the dots`).toBeLessThan(0.2);
    }
  });

  /**
   * The other end of the same bug: while the last band swallowed everything,
   * the first was starved to 2.0% at spread 1. Both ends of the ramp should be
   * reachable, or the palette the person chose is not the palette they get.
   */
  it('reaches the first accent as well as the last', () => {
    const shares = bandShares(1);
    expect(shares[0] as number, `the first accent holds ${((shares[0] as number) * 100).toFixed(1)}% of the dots`).toBeGreaterThan(0.04);
  });
});
