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
