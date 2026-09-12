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
   * Colour blend decides how many steps the accents are resolved into, which
   * is what turns hard edges between flat areas into a continuous ramp. Zero
   * must stay faithful to the palette the person chose — exactly those hexes,
   * no invented in-between hues — and one must clearly exceed them.
   */
  it('resolves the accents into a ramp only when blend is raised', () => {
    const colorsIn = (svg: string): Set<string> =>
      new Set([...svg.matchAll(/stroke="(#[0-9a-f]{6})"/gi)].map((m) => (m[1] as string).toLowerCase()));

    const flat = colorsIn(render({ colorBlend: 0 }));
    const blended = colorsIn(render({ colorBlend: 1 }));
    const accents = new Set(palette.accents.map((a) => a.toLowerCase()));

    // Every colour drawn at zero blend is one of the palette's own accents.
    for (const c of flat) expect(accents.has(c)).toBe(true);
    expect(blended.size).toBeGreaterThan(flat.size * 2);
  });
});
