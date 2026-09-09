import { describe, expect, it } from 'vitest';
import { renderToSvg } from '../src/index.js';
import { ALL_GENERATORS, baseParams, nonBackgroundFraction, pixelVariety, rasterize, TEST_PALETTES } from './helpers.js';

// A real rasteriser, in Node, on the exact string the browser will draw.
describe('rasterisation', () => {
  for (const g of ALL_GENERATORS) {
    it(`${g.id} rasterises to the exact requested pixel size`, () => {
      const palette = TEST_PALETTES[0]!;
      const svg = renderToSvg({ generator: g, width: 300, height: 650, palette, params: baseParams(g), seed: 'r', bleed: 0.08 });
      const out = rasterize(svg, 300);
      expect(out.width).toBe(300);
      expect(out.height).toBe(650);
      expect(out.png.length).toBeGreaterThan(1000);
      expect(out.png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    });

    it(`${g.id} rasterises identically twice`, () => {
      const palette = TEST_PALETTES[1]!;
      const svg = renderToSvg({ generator: g, width: 240, height: 520, palette, params: baseParams(g), seed: 'r2', bleed: 0.08 });
      const a = rasterize(svg, 240);
      const b = rasterize(svg, 240);
      expect(Buffer.compare(a.png, b.png)).toBe(0);
    });

    it(`${g.id} produces a non-blank canvas on every test palette`, () => {
      for (const palette of TEST_PALETTES) {
        const svg = renderToSvg({ generator: g, width: 240, height: 520, palette, params: baseParams(g), seed: 'look', bleed: 0 });
        const out = rasterize(svg, 240);
        const ink = nonBackgroundFraction(out.pixels);
        const variety = pixelVariety(out.pixels);
        expect(ink, `${g.id}/${palette.id} covered only ${(ink * 100).toFixed(1)}% of the canvas`).toBeGreaterThan(0.04);
        expect(variety, `${g.id}/${palette.id} has too few distinct colours`).toBeGreaterThan(4);
      }
    });
  }
});
