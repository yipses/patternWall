/**
 * Procedural noise, implemented in geometry rather than in SVG filters.
 *
 * The render path has to survive resvg, which supports only a subset of SVG
 * filters and rasterises them differently from a browser. So PatternWall bans
 * `feTurbulence` outright and computes its own noise here, on the CPU, before
 * a single shape is emitted. The same numbers come out in Node and in the
 * browser, which is what makes "the preview is the export" true.
 */

import type { Rng } from './rng.js';

const TABLE = 512;
const MASK = 255;

export interface Noise2D {
  /** Smooth value noise in [-1, 1]. */
  value(x: number, y: number): number;
  /** Gradient (Perlin-style) noise in roughly [-1, 1]. */
  gradient(x: number, y: number): number;
  /** Fractal sum of `gradient`, normalised to roughly [-1, 1]. */
  fbm(x: number, y: number, octaves?: number, lacunarity?: number, gain?: number): number;
  /** Ridged fractal noise in [0, 1]; useful for crests and ridgelines. */
  ridged(x: number, y: number, octaves?: number): number;
}

// Quintic smoothstep: zero first and second derivatives at the ends, so
// stitched cells never show a visible grid crease.
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Build a noise field from a seeded Rng. Consumes a fixed amount of stream. */
export function createNoise2D(rng: Rng): Noise2D {
  const perm = new Uint8Array(TABLE);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  // Fisher–Yates with the seeded stream.
  for (let i = 255; i > 0; i--) {
    const j = rng.int(0, i);
    const t = base[i] as number;
    base[i] = base[j] as number;
    base[j] = t;
  }
  for (let i = 0; i < TABLE; i++) perm[i] = base[i & MASK] as number;

  const vals = new Float64Array(256);
  for (let i = 0; i < 256; i++) vals[i] = rng.next() * 2 - 1;

  const gx = new Float64Array(256);
  const gy = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const a = (i / 256) * Math.PI * 2 + rng.next() * 0.7;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }

  const hash = (xi: number, yi: number): number =>
    (perm[((perm[xi & MASK] as number) + yi) & MASK] as number) & MASK;

  const value = (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = fade(x - x0);
    const fy = fade(y - y0);
    const v00 = vals[hash(x0, y0)] as number;
    const v10 = vals[hash(x0 + 1, y0)] as number;
    const v01 = vals[hash(x0, y0 + 1)] as number;
    const v11 = vals[hash(x0 + 1, y0 + 1)] as number;
    return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
  };

  const gradient = (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const dx = x - x0;
    const dy = y - y0;
    const u = fade(dx);
    const v = fade(dy);
    const dot = (ix: number, iy: number, ox: number, oy: number): number => {
      const h = hash(ix, iy);
      return (gx[h] as number) * ox + (gy[h] as number) * oy;
    };
    const n00 = dot(x0, y0, dx, dy);
    const n10 = dot(x0 + 1, y0, dx - 1, dy);
    const n01 = dot(x0, y0 + 1, dx, dy - 1);
    const n11 = dot(x0 + 1, y0 + 1, dx - 1, dy - 1);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.4;
  };

  const fbm = (x: number, y: number, octaves = 4, lacunarity = 2.03, gain = 0.5): number => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let fx = x;
    let fy = y;
    const n = Math.max(1, Math.floor(octaves));
    for (let i = 0; i < n; i++) {
      sum += gradient(fx, fy) * amp;
      norm += amp;
      amp *= gain;
      fx *= lacunarity;
      fy *= lacunarity;
      // Rotate each octave so the axis-aligned lobes of the lattice do not
      // stack into a visible plaid.
      const rx = fx * 0.8 - fy * 0.6 + 11.3;
      const ry = fx * 0.6 + fy * 0.8 - 7.1;
      fx = rx;
      fy = ry;
    }
    return norm === 0 ? 0 : sum / norm;
  };

  const ridged = (x: number, y: number, octaves = 4): number => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let fx = x;
    let fy = y;
    const n = Math.max(1, Math.floor(octaves));
    for (let i = 0; i < n; i++) {
      const s = 1 - Math.abs(gradient(fx, fy));
      sum += s * s * amp;
      norm += amp;
      amp *= 0.5;
      fx *= 2.07;
      fy *= 2.07;
    }
    return norm === 0 ? 0 : sum / norm;
  };

  return { value, gradient, fbm, ridged };
}

/** One-dimensional smooth noise, sampled from a 2D field along a fixed row. */
export function noise1D(n: Noise2D, x: number, row = 0.5): number {
  return n.gradient(x, row);
}
