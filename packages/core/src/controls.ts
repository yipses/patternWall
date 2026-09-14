/**
 * What a parameter's next value is.
 *
 * The editor can drive a pattern's three chosen controls from the preview
 * itself — tap to cycle, drag to scrub — and every one of those gestures ends
 * in the same question: given this spec and this value, what is the new value?
 * That is a fact about a `ParamSpec`, the same kind of fact `coerceParams`
 * answers two modules away, so it lives here rather than in the web app.
 *
 * What does *not* live here is anything measured in pixels. How far a finger
 * travels for one step, how far it must move before an axis locks, how long a
 * press may last and still be a tap — all of that is policy about a pointer on
 * a screen, and putting it in a package that renders SVG strings would be an
 * overreach. The division is: core owns what a parameter means, the web app
 * owns what a finger does. Everything here is in *fractions of a range*, and
 * the caller converts.
 */

import { decimalsOf, type Generator, type ParamSpec, type ParamValue } from './types.js';

export type NumberSpec = Extract<ParamSpec, { type: 'number' }>;
export type SelectSpec = Extract<ParamSpec, { type: 'select' }>;

/** Which of the three gestures a binding answers to. */
export type PrimaryRole = 'tap' | 'x' | 'y';

/** A resolved primary: the role, the key it names, and the spec if it is a param. */
export interface PrimaryBinding {
  role: PrimaryRole;
  /** The param key, or `'seed'`. */
  key: string;
  /** The spec this key resolves to, or `null` when the binding is the seed. */
  spec: ParamSpec | null;
}

/**
 * Snap to the step lattice, clamp to the range, and trim to the precision the
 * control can produce.
 *
 * The lattice is measured from `min`, not from wherever the value happens to
 * be, so a scrubbed value lands exactly where a keyboard nudge on the range
 * input would leave it. Drag a value and then arrow it and nothing shifts by
 * half a step.
 *
 * The trim matters more than it looks. A range input hands back exact decimal
 * strings, so until now no float noise ever reached a generator; arithmetic
 * over a lattice produces plenty, and the share encoding would round it away
 * while the live render kept it. The two would then disagree about what the
 * picture is, which is the one thing this app promises they never do.
 */
export function quantise(spec: NumberSpec, raw: number): number {
  if (!Number.isFinite(raw)) return spec.default;
  const clamped = Math.min(spec.max, Math.max(spec.min, raw));
  const steps = Math.round((clamped - spec.min) / spec.step);
  const snapped = Math.min(spec.max, Math.max(spec.min, spec.min + steps * spec.step));
  return Number(snapped.toFixed(decimalsOf(spec.step)));
}

/** How many steps span the range. At least one, so nothing divides by zero. */
export function stepCount(spec: NumberSpec): number {
  return Math.max(1, Math.round((spec.max - spec.min) / spec.step));
}

/**
 * `from`, moved by `fraction` of the full range.
 *
 * Relative to where the gesture started rather than absolute, so a second pass
 * refines the first instead of replacing it, and so putting a finger down
 * cannot move anything.
 */
export function scrubTo(spec: NumberSpec, from: number, fraction: number): number {
  return quantise(spec, from + fraction * (spec.max - spec.min));
}

/**
 * The next value in the cycle: what a tap does.
 *
 * Selects advance through their options and wrap. Booleans toggle. Numbers
 * take one step and wrap at the top, which is what makes a short integer range
 * usable as a mode. An image has no next value and is returned unchanged — a
 * picture is chosen from a file, not cycled to.
 *
 * A value that is not in the spec's options resolves off the default rather
 * than off nothing, so a stale share link still cycles to somewhere sensible.
 */
export function cycleValue(spec: ParamSpec, current: ParamValue): ParamValue {
  if (spec.type === 'select') {
    const found = spec.options.findIndex((o) => o.value === current);
    const at = found < 0 ? spec.options.findIndex((o) => o.value === spec.default) : found;
    const next = spec.options[(Math.max(0, at) + 1) % spec.options.length];
    return next ? next.value : spec.default;
  }
  if (spec.type === 'boolean') return current !== true;
  if (spec.type === 'number') {
    const n = typeof current === 'number' ? current : spec.default;
    const stepped = quantise(spec, n + spec.step);
    // At the top the clamp gives back the value we already had, which is how
    // the wrap is detected without a separate comparison against max.
    return stepped > quantise(spec, n) ? stepped : quantise(spec, spec.min);
  }
  return current;
}

/**
 * The controls a generator nominates, resolved against its own params.
 *
 * In gesture order — tap, then across, then down — because that is the order
 * the editor promotes them in and the order a person reads them. A generator
 * that has chosen nothing returns nothing, and every caller treats that as
 * "render this pattern the way it always rendered".
 */
export function resolvePrimaries(g: Generator): PrimaryBinding[] {
  const primary = g.primary;
  if (!primary) return [];
  const roles: PrimaryRole[] = ['tap', 'x', 'y'];
  const out: PrimaryBinding[] = [];
  for (const role of roles) {
    const key = primary[role];
    if (!key) continue;
    if (key === 'seed') {
      out.push({ role, key, spec: null });
      continue;
    }
    const spec = g.params.find((p) => p.key === key);
    if (spec) out.push({ role, key, spec });
  }
  return out;
}

/** The params a generator declares that are *not* among its three. */
export function secondaryParams(g: Generator): ParamSpec[] {
  const primary = g.primary;
  if (!primary) return g.params;
  const claimed = new Set([primary.tap, primary.x, primary.y]);
  return g.params.filter((p) => !claimed.has(p.key));
}
