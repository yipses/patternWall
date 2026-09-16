/**
 * A picture, reduced to a grid of 4-bit darknesses and packed into characters
 * a share link can carry.
 *
 * The whole point is that the picture *is* a parameter. A link is the portrait
 * rather than a reference to one, nothing about an upload leaves the browser,
 * and a saved configuration keeps working with no server behind it.
 *
 * `GRID_SIZES` is the set a grid may be stored at, and the trade is length:
 * about 1,500 characters of URL at 48 and about 11,000 at 128. The grid names
 * its own size in its first character, so a link made at one setting still
 * reads at another.
 *
 * The sizes were once justified here by a table of correlation numbers, which
 * measured how well a greedy tonal solver reproduced its target. That solver
 * is gone. What reads the grid now is a blur and a set of quantile thresholds,
 * and it wants stored resolution for a different reason: an outline traced
 * from a coarse grid is a smooth curve with the small features already gone,
 * and no amount of tracing puts them back.
 *
 * The alphabet deliberately excludes `_`, which is what `share.ts` separates
 * params with.
 */

/** Standard base64 digits with `+/` swapped for `-.`, and no padding. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-.';

const INDEX: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) INDEX[ALPHABET[i] as string] = i;

/**
 * The sizes a grid may be stored at, finest last.
 *
 * Each is a multiple of four so that the cell count divides by two into whole
 * bytes and by three into whole base64 groups, which keeps the packed length
 * exact rather than padded.
 */
export const GRID_SIZES = [48, 64, 96, 128] as const;

/** The size used when nothing says otherwise. */
export const GRID_SIZE = 128;

/** Distinct darkness values a cell may take. Four bits. */
export const GRID_LEVELS = 16;

/** Characters a packed grid of `size` occupies, including its size marker. */
export function gridChars(size: number): number {
  return 1 + Math.ceil((size * size) / 2 / 3) * 4;
}

/** The size marker for a grid, as its index into `GRID_SIZES`. */
function markerFor(size: number): string | null {
  const i = GRID_SIZES.indexOf(size as (typeof GRID_SIZES)[number]);
  return i < 0 ? null : (ALPHABET[i] as string);
}

function sizeFromMarker(ch: string): number | null {
  const i = INDEX[ch];
  return i === undefined ? null : (GRID_SIZES[i] ?? null);
}

/**
 * Pack darkness values in 0..1 into a link-safe string.
 *
 * Values beyond the grid are ignored and values missing from it read as zero
 * rather than being refused: a grid is data from outside — a link somebody
 * edited, a browser that resized differently — and the rule everywhere in this
 * encoding is to recover rather than to fail. An unsupported size is the one
 * thing that cannot be recovered from, since the reader would have no way to
 * know the shape, so it snaps to the nearest supported one.
 */
export function packGrid(values: ArrayLike<number>, size: number = GRID_SIZE): string {
  const use = markerFor(size) ? size : nearestSize(size);
  const cells = use * use;
  const bytes = new Uint8Array(cells / 2);
  for (let i = 0; i < cells; i += 2) {
    bytes[i >> 1] = (quantise(values[i]) << 4) | quantise(values[i + 1]);
  }
  let out = markerFor(use) as string;
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] as number) : 0;
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] as number) : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  return out;
}

function nearestSize(size: number): number {
  let best = GRID_SIZE;
  let gap = Infinity;
  for (const s of GRID_SIZES) {
    const d = Math.abs(s - size);
    if (d < gap) {
      gap = d;
      best = s;
    }
  }
  return best;
}

function quantise(v: number | undefined): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(GRID_LEVELS - 1, Math.round(n * (GRID_LEVELS - 1))));
}

/** The grid size a packed string declares, or `null` if it is not one. */
export function gridSizeOf(s: string): number | null {
  if (s.length < 5) return null;
  const size = sizeFromMarker(s[0] as string);
  if (size === null || s.length !== gridChars(size)) return null;
  for (let i = 1; i < s.length; i++) if (INDEX[s[i] as string] === undefined) return null;
  return size;
}

/** True if `s` is a grid this build can read. */
export function isPackedGrid(s: string): boolean {
  return gridSizeOf(s) !== null;
}

/**
 * Unpack to darkness values in 0..1 with the size they were stored at, or
 * `null` if the string is not a grid.
 *
 * Null rather than a blank grid, so a caller can tell "no picture was given"
 * from "a picture of nothing" — the generator draws its own target in the
 * first case and would draw silence in the second.
 */
export function unpackGrid(s: string): { size: number; values: Float32Array } | null {
  const size = gridSizeOf(s);
  if (size === null) return null;
  const cells = size * size;
  const bytes = new Uint8Array(cells / 2);
  let at = 0;
  for (let i = 1; i < s.length; i += 4) {
    const n =
      ((INDEX[s[i] as string] as number) << 18) |
      ((INDEX[s[i + 1] as string] as number) << 12) |
      ((INDEX[s[i + 2] as string] as number) << 6) |
      (INDEX[s[i + 3] as string] as number);
    if (at < bytes.length) bytes[at++] = (n >> 16) & 255;
    if (at < bytes.length) bytes[at++] = (n >> 8) & 255;
    if (at < bytes.length) bytes[at++] = n & 255;
  }
  const values = new Float32Array(cells);
  for (let i = 0; i < cells; i += 2) {
    const byte = bytes[i >> 1] as number;
    values[i] = (byte >> 4) / (GRID_LEVELS - 1);
    values[i + 1] = (byte & 15) / (GRID_LEVELS - 1);
  }
  return { size, values };
}
