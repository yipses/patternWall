import { expect, test } from '@playwright/test';
import { GRID_SIZE, packGrid } from '@patternwall/core';
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

  /*
   * Every param kind, at a value that is not its default.
   *
   * The `boolean` and `image` branches below are unreachable today and are not
   * dead code: both boolean params and the only image param live in `retired`,
   * and nothing registered declares either. They stay because the fallthrough
   * reads `spec.options`, so the first registered generator to declare one
   * would not fail this test, it would crash it somewhere unhelpful.
   *
   * What they cannot do is make the claim they look like they make. The
   * browser side of this comparison goes through `RenderBridge`, which calls
   * `getGenerator`, which deliberately does not search `retired` — a pattern
   * that is not in the app must not resolve from anywhere. So browser-vs-Node
   * parity for the image param is **not** covered here, only in the core
   * suite, which sweeps `ALL_GENERATORS` in Node alone. Reaching it would mean
   * giving the bridge a way to resolve a retired id, which is the invariant
   * this repo would rather keep.
   */
  test('non-default parameters also match', async ({ page }) => {
    for (const g of generators) {
      const params = { ...defaultParams(g) } as Record<string, number | string | boolean>;
      for (const spec of g.params) {
        if (spec.type === 'number') params[spec.key] = Number(((spec.min + spec.max) / 2).toFixed(2));
        else if (spec.type === 'boolean') params[spec.key] = !spec.default;
        else if (spec.type === 'image') params[spec.key] = sampleGrid();
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

/**
 * A deterministic sample picture, the same one the core suite builds.
 *
 * Kept as a local copy rather than imported from the core test helpers,
 * because those are not part of the published package and this suite compiles
 * against the package rather than the workspace's test tree.
 */
function sampleGrid(): string {
  const cells = new Float32Array(GRID_SIZE * GRID_SIZE);
  for (let j = 0; j < GRID_SIZE; j++) {
    for (let i = 0; i < GRID_SIZE; i++) {
      const nx = (i + 0.5) / GRID_SIZE - 0.5;
      const ny = (j + 0.5) / GRID_SIZE - 0.5;
      cells[j * GRID_SIZE + i] = Math.max(0, 1 - Math.hypot(nx, ny) * 2.6);
    }
  }
  return packGrid(cells);
}
