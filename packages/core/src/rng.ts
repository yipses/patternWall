/**
 * Deterministic pseudo-randomness.
 *
 * Every pixel PatternWall draws has to be reproducible from a seed: a share
 * link is only worth having if the person who opens it sees exactly what the
 * person who sent it saw. So this package contains no `Math.random` anywhere,
 * and every stochastic decision in a generator flows through an `Rng` created
 * from an integer seed.
 */

/** A seeded random source. All methods advance the same internal state. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniformly chosen element. Throws on an empty array. */
  pick<T>(a: readonly T[]): T;
  /** True with probability `p` (default 0.5). */
  bool(p?: number): boolean;
  /** Standard normal sample, mean 0, variance 1. */
  gaussian(): number;
}

/**
 * mulberry32 — a 32-bit state PRNG. Small, fast, and good enough for visual
 * work: it passes gjrand's smallcrush and has no visible lattice structure at
 * the scales we sample it.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Box–Muller needs two uniforms and produces two normals; we cache the spare
  // so that a run of gaussian() calls consumes the stream at a steady rate.
  let spare: number | null = null;

  const rng: Rng = {
    next,
    int(min: number, max: number): number {
      if (max < min) [min, max] = [max, min];
      return min + Math.floor(next() * (max - min + 1));
    },
    range(min: number, max: number): number {
      return min + next() * (max - min);
    },
    pick<T>(a: readonly T[]): T {
      if (a.length === 0) throw new Error('rng.pick: empty array');
      const v = a[Math.floor(next() * a.length)];
      // `noUncheckedIndexedAccess` cannot see that the index is in range.
      return v as T;
    },
    bool(p = 0.5): boolean {
      return next() < p;
    },
    gaussian(): number {
      if (spare !== null) {
        const v = spare;
        spare = null;
        return v;
      }
      let u = 0;
      let v = 0;
      let s = 0;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        s = u * u + v * v;
      } while (s === 0 || s >= 1);
      const mul = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * mul;
      return u * mul;
    },
  };

  return rng;
}

/**
 * FNV-1a, folded to an unsigned 32-bit integer. Used so that a human-typed
 * seed ("bergamot") maps to a stable numeric seed, and so that generators can
 * derive independent sub-streams from a label without colliding.
 */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
