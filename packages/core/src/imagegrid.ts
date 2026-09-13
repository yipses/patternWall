/**
 * A picture, small enough to put in a link.
 *
 * String art is the first pattern here that takes an input, and that input has
 * to survive the share encoding or the link stops being the picture — which is
 * the one promise every other part of this app keeps. A photograph obviously
 * cannot go in a URL. A photograph *reduced to what the solver actually reads*
 * can: the solver only ever asks the target how dark it is around a point, and
 * measured against a full 300x300 target, a 48x48 grid at sixteen levels gets
 * 0.752 correlation where the full resolution gets 0.784 — 96% of the quality
 * for 1,152 bytes. Going finer stops paying: 64x64 scores 0.754.
 *
 * So the grid is 4-bit, two cells to a byte, in a base64 alphabet chosen to
 * avoid `_` because that is what `share.ts` separates parameters with, and `+`
 * and `/` and `=` because those have their own meanings in a query string.
 */

/** Standard base64 digits with `+/` swapped for `-.`, and no padding. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-.';

const INDEX: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) INDEX[ALPHABET[i] as string] = i;

/** Cells along each edge of a packed grid. */
export const GRID_SIZE = 48;

/** Distinct darkness values a cell may take. Four bits. */
export const GRID_LEVELS = 16;

/** Characters a packed grid of `GRID_SIZE` occupies. */
export const GRID_CHARS = Math.ceil((GRID_SIZE * GRID_SIZE) / 2 / 3) * 4;

/**
 * Pack darkness values in 0..1 into a link-safe string.
 *
 * Anything shorter or longer than one grid is padded or truncated rather than
 * refused: the grid is data from outside — a link somebody edited, a file from
 * a browser that resized differently — and the rule everywhere in this
 * encoding is to recover rather than to fail.
 */
export function packGrid(values: ArrayLike<number>): string {
  const cells = GRID_SIZE * GRID_SIZE;
  const bytes = new Uint8Array(cells / 2);
  for (let i = 0; i < cells; i += 2) {
    const a = quantise(values[i]);
    const b = quantise(values[i + 1]);
    bytes[i >> 1] = (a << 4) | b;
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] as number) : 0;
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] as number) : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  return out;
}

function quantise(v: number | undefined): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(GRID_LEVELS - 1, Math.round(n * (GRID_LEVELS - 1))));
}

/** True if `s` is a grid this build can read. */
export function isPackedGrid(s: string): boolean {
  if (s.length !== GRID_CHARS) return false;
  for (let i = 0; i < s.length; i++) if (INDEX[s[i] as string] === undefined) return false;
  return true;
}

/**
 * Unpack to darkness values in 0..1, or `null` if the string is not a grid.
 *
 * Null rather than a blank grid, so a caller can tell "no picture was given"
 * from "a picture of nothing" — the generator draws its own target in the
 * first case and would draw silence in the second.
 */
export function unpackGrid(s: string): Float32Array | null {
  if (!isPackedGrid(s)) return null;
  const cells = GRID_SIZE * GRID_SIZE;
  const bytes = new Uint8Array(cells / 2);
  let at = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n =
      ((INDEX[s[i] as string] as number) << 18) |
      ((INDEX[s[i + 1] as string] as number) << 12) |
      ((INDEX[s[i + 2] as string] as number) << 6) |
      (INDEX[s[i + 3] as string] as number);
    if (at < bytes.length) bytes[at++] = (n >> 16) & 255;
    if (at < bytes.length) bytes[at++] = (n >> 8) & 255;
    if (at < bytes.length) bytes[at++] = n & 255;
  }
  const out = new Float32Array(cells);
  for (let i = 0; i < cells; i += 2) {
    const byte = bytes[i >> 1] as number;
    out[i] = (byte >> 4) / (GRID_LEVELS - 1);
    out[i + 1] = (byte & 15) / (GRID_LEVELS - 1);
  }
  return out;
}
