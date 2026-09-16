import type { Palette } from './palette.js';
import type { Rng } from './rng.js';
import type { SafeZones } from './geometry.js';
import { isPackedGrid } from './imagegrid.js';

/** The fixed tag taxonomy. Generators pick from this list and nothing else. */
export const TAXONOMY = ['grid', 'radial', 'noise', 'flow', 'isometric', 'organic', 'distortion', 'physics'] as const;
export type Tag = (typeof TAXONOMY)[number];

export type ParamValue = number | string | boolean;

export type ParamSpec =
  | {
      key: string;
      label: string;
      type: 'number';
      min: number;
      max: number;
      step: number;
      default: number;
      description: string;
    }
  | {
      key: string;
      label: string;
      type: 'select';
      options: { value: string; label: string }[];
      default: string;
      description: string;
    }
  | {
      key: string;
      label: string;
      type: 'boolean';
      default: boolean;
      description: string;
    }
  | {
      /**
       * A picture, packed small enough to ride in the share link.
       *
       * The value is a `packGrid` string — see `imagegrid.ts` for why a
       * photograph reduces to something a URL can carry. The grid names its
       * own size, so a link made at one detail setting still reads at another.
       * An empty string means no picture was given, which generators
       * are expected to answer with something of their own rather than with a
       * blank canvas.
       */
      key: string;
      label: string;
      type: 'image';
      default: string;
      description: string;
    };

export interface RenderContext {
  width: number;
  height: number;
  palette: Palette;
  params: Record<string, ParamValue>;
  rng: Rng;
  /** Fraction of each edge that will be cropped by iOS perspective zoom. 0..0.15 */
  bleed: number;
  /** Safe-zone geometry in px for composition-aware generators. */
  safeZones: SafeZones;
}

/**
 * The two controls a pattern is driven by, when they have been chosen.
 *
 * A pattern declares thirteen parameters and a person wants two. These name
 * the pair that carry the picture, so the editor can promote them and bind
 * them to the preview itself — drag across to scrub one, drag up and down to
 * scrub the other — and put the rest behind a disclosure.
 *
 * There were three. Tap used to be a pattern's own as well, cycling whichever
 * parameter it nominated, and it is the registry's now: a tap moves to the
 * next pattern. That is the better use of the only gesture that does not carry
 * a quantity, and it costs nothing here — the one generator that spent its tap
 * on a mode switch was choosing between two things that are now two patterns.
 *
 * Keys, never indices. The share encoding is positional and `params` is
 * append-only for that reason; naming a param by key means this can be chosen,
 * changed and reordered freely without any of that mattering. It is also why
 * this is a field on the generator rather than a flag on each spec: which
 * controls carry a pattern is a fact about the pattern as a whole, in
 * the same way that string art's picture needing to see its detail setting is
 * a fact about string art rather than about `ParamSpec`.
 *
 * Optional, and absent means absent: a generator that has not had its two
 * chosen renders every control in a flat list exactly as it always did. There
 * is no guessing on a pattern's behalf.
 */
export interface Primaries {
  /** Scrubbed by a horizontal drag. Names a number param. */
  x: string;
  /** Scrubbed by a vertical drag. Names a number param. */
  y: string;
}

/**
 * A range that depends on what another parameter is set to.
 *
 * Some controls mean different things in different modes, and a range that
 * suits one mode can be useless in another: truchet's divisions draw 2n-1
 * chords per cell on diagonals, so twelve is twenty-three lines through a cell
 * and unreadable, while the same twelve on quarter arcs is exactly the point.
 *
 * Declared on the generator rather than on the spec, for the reason string
 * art's picture-and-detail lookup gives: a spec describes itself, and one
 * parameter's range depending on another's value is a fact about the pattern
 * they both belong to. `ParamSpec` stays a description of one control.
 */
export interface ParamLimit {
  /** The parameter whose value decides the range. */
  when: string;
  /** The ceiling for each value of it. Anything unlisted keeps the declared max. */
  max: Record<string, number>;
}

export interface Generator {
  /** Slug, e.g. 'flow-dots'. Also the URL key and the registry key. */
  id: string;
  name: string;
  /** One line, shown on the gallery card. */
  tagline: string;
  tags: Tag[];
  params: ParamSpec[];
  /** Plain-language explanation of the algorithm. Markdown. */
  description: string;
  /** Pure: same inputs, same string, every time. */
  render(ctx: RenderContext): string;
  /** The two scrubbed controls this pattern is driven by, if they have been chosen. */
  primary?: Primaries;
  /** Ranges that depend on another parameter's value, keyed by the one limited. */
  limits?: Record<string, ParamLimit>;
}

/**
 * Decimal places implied by a slider step, e.g. 0.005 -> 3.
 *
 * This is the precision a control can actually produce, and therefore the
 * precision a value is allowed to have. The share encoding has always trimmed
 * to it; a scrubbed value has to be trimmed to it too, because floating-point
 * arithmetic over a step lattice does not land on the lattice — 49 steps of
 * 0.01 from 0.02 gives 0.49000000000000005, which a link would carry as 0.49
 * while the render used the longer one. One copy, so the two cannot drift.
 */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 3;
  const s = String(step);
  if (s.includes('e-')) return Math.min(8, Number(s.split('e-')[1] ?? 3));
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(8, s.length - dot - 1);
}

/** The declared defaults of a generator, as a plain params object. */
export function defaultParams(g: Generator): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of g.params) out[p.key] = p.default;
  return out;
}

/**
 * Coerce an untrusted params bag (a share URL, localStorage, a future API)
 * into something the generator can rely on. Unknown keys are dropped, numbers
 * are clamped to their declared range, selects fall back to their default if
 * the value is not an option. Generators therefore never validate anything.
 */
export function coerceParams(g: Generator, input: Record<string, unknown> | undefined | null): Record<string, ParamValue> {
  const out = defaultParams(g);
  if (!input || typeof input !== 'object') return out;
  for (const spec of g.params) {
    const raw = (input as Record<string, unknown>)[spec.key];
    if (raw === undefined || raw === null) continue;
    if (spec.type === 'number') {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) continue;
      out[spec.key] = Math.min(spec.max, Math.max(spec.min, n));
    } else if (spec.type === 'select') {
      const s = String(raw);
      if (spec.options.some((o) => o.value === s)) out[spec.key] = s;
    } else if (spec.type === 'image') {
      // Empty is meaningful — it says "no picture" — and anything that is not
      // a grid this build can read falls back to the default rather than
      // reaching a generator that would have to validate it.
      const s = String(raw);
      if (s === '' || isPackedGrid(s)) out[spec.key] = s;
    } else {
      // Every other branch leaves the declared default alone when it cannot
      // read the value; this one used to coerce instead, so anything it did
      // not recognise became `false` -- the opposite of a default of `true`,
      // which is what both boolean params in the registry declare. Recognise
      // both sets and fall back on anything else, like the rest of them.
      if (raw === true || raw === 'true' || raw === 1 || raw === '1') out[spec.key] = true;
      else if (raw === false || raw === 'false' || raw === 0 || raw === '0') out[spec.key] = false;
    }
  }
  // A second pass, and it has to be second: a ceiling that depends on another
  // parameter cannot be applied until that parameter has been settled, and the
  // two are in whatever order the share encoding happens to put them.
  //
  // Clamping here rather than leaving it to the generator is the same argument
  // the rest of this function makes — a generator should never have to
  // validate anything — and it means the slider, the link and the picture
  // agree about what the value is, instead of the control showing a ceiling
  // the render is quietly ignoring.
  for (const [key, limit] of Object.entries(g.limits ?? {})) {
    const spec = g.params.find((p) => p.key === key);
    if (!spec || spec.type !== 'number') continue;
    const ceiling = limit.max[String(out[limit.when])];
    if (ceiling === undefined) continue;
    const v = out[key];
    if (typeof v === 'number' && v > ceiling) out[key] = ceiling;
  }
  return out;
}

/** Read a number param with a fallback, for generators. */
export function pNum(params: Record<string, ParamValue>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Read a string param with a fallback, for generators. */
export function pStr(params: Record<string, ParamValue>, key: string, fallback: string): string {
  const v = params[key];
  return typeof v === 'string' ? v : fallback;
}

/** Read a boolean param with a fallback, for generators. */
export function pBool(params: Record<string, ParamValue>, key: string, fallback: boolean): boolean {
  const v = params[key];
  return typeof v === 'boolean' ? v : fallback;
}
