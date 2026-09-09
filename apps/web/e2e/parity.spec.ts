import { expect, test } from '@playwright/test';
import { curatedPalettes, defaultParams, generators, renderToSvg } from '@patternwall/core';

/**
 * The load-bearing test.
 *
 * PatternWall's central claim is that the SVG string is the single source of
 * truth: the preview, the PNG and any future server render are all the same
 * bytes. If the browser and Node ever disagree — a locale-dependent number
 * format, a Math difference, a stray Date — everything downstream quietly
 * stops being reproducible. So this compares them character for character.
 */
test.describe('browser and Node render identically', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof window.patternwall?.render === 'function');
  });

  for (const g of generators) {
    test(`${g.id} matches byte for byte across palettes and seeds`, async ({ page }) => {
      for (const paletteId of ['obsidian', 'paper', 'crt-green']) {
        for (const seed of ['parity-1', 'parity-2']) {
          const input = {
            generatorId: g.id,
            seed,
            width: 300,
            height: 650,
            bleed: 0.08,
            paletteId,
            params: defaultParams(g) as Record<string, number | string | boolean>,
          };
          const fromBrowser = await page.evaluate((i) => window.patternwall!.render(i), input);
          const palette = curatedPalettes.find((p) => p.id === paletteId)!;
          const fromNode = renderToSvg({
            generator: g,
            width: input.width,
            height: input.height,
            palette,
            params: input.params,
            seed,
            bleed: input.bleed,
          });
          expect(fromBrowser.length, `${g.id}/${paletteId}/${seed} length`).toBe(fromNode.length);
          expect(fromBrowser, `${g.id}/${paletteId}/${seed}`).toBe(fromNode);
        }
      }
    });
  }

  test('non-default parameters also match', async ({ page }) => {
    for (const g of generators) {
      const params = { ...defaultParams(g) } as Record<string, number | string | boolean>;
      for (const spec of g.params) {
        if (spec.type === 'number') params[spec.key] = Number(((spec.min + spec.max) / 2).toFixed(2));
        else if (spec.type === 'boolean') params[spec.key] = !spec.default;
        else params[spec.key] = spec.options[spec.options.length - 1]!.value;
      }
      const input = { generatorId: g.id, seed: 'mid', width: 220, height: 476, bleed: 0, paletteId: 'riso-pink', params };
      const fromBrowser = await page.evaluate((i) => window.patternwall!.render(i), input);
      const palette = curatedPalettes.find((p) => p.id === 'riso-pink')!;
      const fromNode = renderToSvg({ generator: g, width: 220, height: 476, palette, params, seed: 'mid', bleed: 0 });
      expect(fromBrowser, g.id).toBe(fromNode);
    }
  });
});
