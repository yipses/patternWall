/**
 * The one function that turns a configuration into pixels-to-be.
 *
 * The gallery card, the editor preview, the PNG export, the Node tests and the
 * batch zip all call this. Nothing else builds a RenderContext by hand. That
 * is the whole trick behind "the preview is the export": there is only one
 * code path, so there is nothing for the two to disagree about.
 */

import { createRng, hashSeed } from './rng.js';
import { safeZonesForCanvas } from './geometry.js';
import { coerceParams, type Generator, type ParamValue } from './types.js';
import type { Palette } from './palette.js';
import type { RenderContext } from './types.js';

export interface RenderRequest {
  generator: Generator;
  width: number;
  height: number;
  palette: Palette;
  params?: Record<string, unknown>;
  /** Human-facing seed. Strings are hashed; numbers are used directly. */
  seed: string | number;
  /** Fraction of each edge that may be cropped by iOS. Default 0. */
  bleed?: number;
}

export const DEFAULT_BLEED = 0.08;

export function seedToInt(seed: string | number, generatorId: string): number {
  const s = typeof seed === 'number' && Number.isFinite(seed) ? String(Math.floor(seed)) : String(seed);
  return hashSeed(`${generatorId}::${s}`);
}

export function createRenderContext(req: RenderRequest): RenderContext {
  const width = Math.max(1, Math.round(req.width));
  const height = Math.max(1, Math.round(req.height));
  const bleed = Math.min(0.15, Math.max(0, Number.isFinite(req.bleed ?? 0) ? (req.bleed ?? 0) : 0));
  return {
    width,
    height,
    palette: req.palette,
    params: coerceParams(req.generator, req.params ?? null) as Record<string, ParamValue>,
    rng: createRng(seedToInt(req.seed, req.generator.id)),
    bleed,
    safeZones: safeZonesForCanvas(width, height, bleed),
  };
}

/** Render to a complete SVG string. Deterministic for identical inputs. */
export function renderToSvg(req: RenderRequest): string {
  return req.generator.render(createRenderContext(req));
}
