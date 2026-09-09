import type { Palette } from './palette.js';
import type { Rng } from './rng.js';
import type { SafeZones } from './geometry.js';

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
    } else {
      out[spec.key] = raw === true || raw === 'true' || raw === 1 || raw === '1';
    }
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
