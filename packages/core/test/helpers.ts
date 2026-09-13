import { Resvg } from '@resvg/resvg-js';
import { curatedPalettes, defaultParams, generators, GRID_SIZE, packGrid, type Generator, type Palette } from '../src/index.js';

export const TEST_PALETTES: Palette[] = ['obsidian', 'paper', 'riso-pink', 'crt-green', 'fog', 'neon-rain']
  .map((id) => curatedPalettes.find((p) => p.id === id))
  .filter((p): p is Palette => Boolean(p));

export const ALL_GENERATORS: Generator[] = generators;

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
 * the solver's bilinear read of it, or the share link's ability to carry ten
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
