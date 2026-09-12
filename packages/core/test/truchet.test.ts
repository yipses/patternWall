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
   * A flat per-tile colour can never blend into its neighbour, however many
   * intermediate hues the ramp is resolved into — the boundary between two
   * tiles is an edge because each tile is one colour edge to edge. So above
   * zero the paint itself has to vary across the canvas.
   *
   * Zero must still be faithful to the palette: exactly the hexes the person
   * chose, no invented in-between hues.
   */
  it('paints with a canvas gradient once blend is raised, and flat accents at zero', () => {
    const flat = render({ colorBlend: 0 });
    const blended = render({ colorBlend: 1 });

    const strokeHexes = (svg: string): Set<string> =>
      new Set([...svg.matchAll(/stroke="(#[0-9a-f]{6})"/gi)].map((m) => (m[1] as string).toLowerCase()));
    const accents = new Set(palette.accents.map((a) => a.toLowerCase()));

    // Flat: real hexes, all of them from the palette, no gradient paint.
    const flatColors = strokeHexes(flat);
    expect(flatColors.size).toBeGreaterThan(0);
    for (const c of flatColors) expect(accents.has(c)).toBe(true);
    expect(flat).not.toContain('url(#tr-ink)');

    // Blended: the marks are painted by position, so no per-tile colour is
    // left at all, and the gradient it uses actually exists.
    expect(strokeHexes(blended).size).toBe(0);
    expect(blended).toContain('stroke="url(#tr-ink)"');
    expect(blended).toContain('id="tr-ink"');
    // A gradient of one stop is not a blend.
    const stops = [...blended.matchAll(/<linearGradient id="tr-ink"[\s\S]*?<\/linearGradient>/g)]
      .flatMap((m) => [...(m[0] as string).matchAll(/<stop /g)]);
    expect(stops.length).toBeGreaterThan(2);
  });
});
