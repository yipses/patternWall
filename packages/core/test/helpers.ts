import { Resvg } from '@resvg/resvg-js';
import { curatedPalettes, defaultParams, generators, retired, GRID_SIZE, packGrid, type Generator, type Palette } from '../src/index.js';
import { createRenderContext, type RenderRequest } from '../src/render.js';
import type { RenderContext } from '../src/types.js';

export const TEST_PALETTES: Palette[] = ['obsidian', 'paper', 'riso-pink', 'crt-green', 'fog', 'neon-rain']
  .map((id) => curatedPalettes.find((p) => p.id === id))
  .filter((p): p is Palette => Boolean(p));

/**
 * Everything written, not everything shipped.
 *
 * Four patterns are in `retired`: no page, no gallery card, no place in the
 * tap cycle. Their code is still here and so are their tests, and this is the
 * seam that keeps that true — every suite that sweeps "all generators" sweeps
 * the retired ones too, so a change to a shared helper cannot quietly rot the
 * ones nobody is looking at. Tests about what the *app* offers should read
 * `generators` directly instead.
 */
export const ALL_GENERATORS: Generator[] = [...generators, ...retired];

export function baseParams(g: Generator): Record<string, number | string | boolean> {
  return defaultParams(g);
}

export interface Raster {
  png: Buffer;
  width: number;
  height: number;
  pixels: Buffer;
}

export function rasterize(svg: string, width: number): Raster {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width } });
  const img = r.render();
  return { png: Buffer.from(img.asPng()), width: img.width, height: img.height, pixels: Buffer.from(img.pixels) };
}

/** Rough measure of how much is going on: fraction of distinct quantised colours. */
export function pixelVariety(pixels: Buffer): number {
  const seen = new Set<number>();
  const stride = 4 * 37; // prime-ish stride so we sample across rows too
  for (let i = 0; i + 3 < pixels.length; i += stride) {
    const r = (pixels[i] as number) >> 4;
    const g = (pixels[i + 1] as number) >> 4;
    const b = (pixels[i + 2] as number) >> 4;
    seen.add((r << 8) | (g << 4) | b);
  }
  return seen.size;
}

/** Fraction of sampled pixels that differ from the top-left pixel. */
export function nonBackgroundFraction(pixels: Buffer): number {
  const r0 = pixels[0] as number;
  const g0 = pixels[1] as number;
  const b0 = pixels[2] as number;
  let n = 0;
  let hit = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4 * 17) {
    n++;
    const dr = Math.abs((pixels[i] as number) - r0);
    const dg = Math.abs((pixels[i + 1] as number) - g0);
    const db = Math.abs((pixels[i + 2] as number) - b0);
    if (dr + dg + db > 12) hit++;
  }
  return n === 0 ? 0 : hit / n;
}

/**
 * A packed picture for tests, built rather than pasted.
 *
 * The image param is the one parameter whose value is a whole picture, and a
 * test that only ever exercises the empty default would not touch the codec,
 * the blur and the thresholds that read it, or the share link's ability to carry ten
 * thousand characters in one field. A smooth blob is enough to be a picture and is
 * reproducible without a fixture file.
 */
export function sampleGrid(size: number = GRID_SIZE): string {
  const cells = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const nx = (i + 0.5) / size - 0.5;
      const ny = (j + 0.5) / size - 0.5;
      cells[j * size + i] = Math.max(0, 1 - Math.hypot(nx, ny) * 2.6);
    }
  }
  return packGrid(cells, size);
}

/**
 * A render that does not clamp to the sliders.
 *
 * The app coerces every setting to its slider's range, and `renderToSvg` does
 * too, which is right for everything a person can reach. But the owner has
 * since narrowed several sliders, and a test written at the old top — sixty
 * contour lines, twelve divisions, a heavy pen — would then quietly run at
 * the new top instead, which is the "a test whose extreme has moved" hazard
 * CLAUDE.md records: it can go on passing with the mechanism it guards
 * deleted. The renderers still draw whatever they are handed, so tests that
 * guard a mechanism at its calibrated extreme render through this and keep
 * the extreme they were written at.
 */
export function renderUnclamped(req: RenderRequest): string {
  const ctx = createRenderContext(req);
  return req.generator.render({ ...ctx, params: { ...defaultParams(req.generator), ...(req.params ?? {}) } as RenderContext['params'] });
}
