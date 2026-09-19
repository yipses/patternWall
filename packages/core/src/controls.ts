/**
 * What a parameter's next value is.
 *
 * The editor can drive a pattern's two chosen controls from the preview
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

/** Which of the two scrub axes a binding answers to. */
export type PrimaryRole = 'x' | 'y';

/** A resolved primary: the axis, the key it names, and the spec it resolves to. */
export interface PrimaryBinding {
  role: PrimaryRole;
  key: string;
  spec: ParamSpec;
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
export function scrubTo(spec: NumberSpec, from: number, fraction: number, stride = 1): number {
  const raw = from + fraction * (spec.max - spec.min);
  if (stride <= 1) return quantise(spec, raw);
  // Snap to every `stride`-th step instead of every one. Still the spec's own
  // lattice -- an integer multiple of it -- so a scrubbed value is one the
  // slider and the share link can both express, and the ends stay reachable
  // because `quantise` clamps whatever the coarse lattice overshoots to.
  const coarse = spec.step * stride;
  const clamped = Math.min(spec.max, Math.max(spec.min, raw));
  const n = Math.round((clamped - spec.min) / coarse);
  return quantise(spec, spec.min + n * coarse);
}

/** The finest change a drag should be able to make, in CSS pixels. */
export const MIN_PX_PER_STEP = 10;

/**
 * How close to that counts as already there. "Around ten" rather than "ten or
 * more": without it a control at 9.6px is doubled to 19.2, which moves it
 * further from the target than leaving it alone does.
 */
const TOLERANCE = 0.9;

/**
 * How many of a spec's steps one *felt* change should cover, for a scrub
 * spread over `travel` pixels.
 *
 * The surface divided by the step count is what makes a drag mean the whole
 * range, and on a fine control it is tiny: chevron's relief has a hundred
 * steps, which on a phone preview is 5.2 pixels each, and contours' terrain
 * scale is 7.1. A change every five pixels is a render every five pixels, and
 * the preview cannot keep up — reported as feeling laggy, which is exactly
 * what it is rather than a figure of speech.
 *
 * Coarsening the lattice rather than stretching the travel is what keeps
 * "edge to edge is the whole range" true. Insisting on ten pixels by lengthening
 * the drag would need 1,000 pixels for relief on a 520px preview, so a sweep
 * would cover half the control; snapping to every second step covers all of it
 * and changes half as often.
 */
export function scrubStride(spec: NumberSpec, travel: number, minPx = MIN_PX_PER_STEP): number {
  const steps = stepCount(spec);
  const perStep = travel / steps;
  if (!Number.isFinite(perStep) || perStep <= 0) return 1;
  // "Around ten", so a control already within a tenth of it is left alone.
  // Chevron's block size sits at 9.6px, and doubling it to 19.2 to satisfy a
  // hard ten would be a bigger change than the fault being fixed.
  if (perStep >= minPx * TOLERANCE) return 1;
  // Ceil rather than round past that: ten is the point below which it drags,
  // so landing at 7.1 because 1.4 rounded down would leave the fault in place.
  return Math.max(1, Math.min(steps, Math.ceil(minPx / perStep)));
}

/**
 * Whether a gesture that *starts* at an end, heading further into it, should
 * drive the parameter backwards for the rest of the drag.
 *
 * A bounded control has two dead directions, and on this surface a gesture
 * that does nothing is indistinguishable from one that is broken -- three
 * separate faults here presented as "the swipe isn't registering", so a
 * legitimately dead direction is the same experience as the bug.
 *
 * This used to wrap: at the minimum, a drag further down jumped the value to
 * the maximum. It filled the dead direction and it was jarring, because a
 * control the eye is tracking crosses its whole range in one frame. Reversing
 * the axis instead fills the same gap smoothly -- at an end, both directions
 * move the value the only way it can go, and nothing jumps.
 *
 * Only where a gesture begins, which is the one moment that knows a drag is
 * starting rather than continuing. Flipping mid-drag would make a fader
 * reverse under the finger every time it touched a bound.
 *
 * Compared with `>=` and `<=` rather than equality because a bound can be a
 * float -- truchet's stroke weight floors at 0.02 -- and a value that has been
 * quantised onto the lattice near it should still count as sitting on it.
 */
export function invertsAtEnd(spec: NumberSpec, from: number, direction: number): boolean {
  if (direction > 0 && from >= spec.max) return true;
  if (direction < 0 && from <= spec.min) return true;
  return false;
}

/**
 * The controls a generator nominates, resolved against its own params.
 *
 * In gesture order — across, then down — because that is the order the editor
 * promotes them in and the order a person reads them. A generator that has
 * chosen nothing returns nothing, and every caller treats that as "render this
 * pattern the way it always rendered".
 */
export function resolvePrimaries(g: Generator): PrimaryBinding[] {
  const primary = g.primary;
  if (!primary) return [];
  const roles: PrimaryRole[] = ['x', 'y'];
  const out: PrimaryBinding[] = [];
  for (const role of roles) {
    const key = primary[role];
    if (!key) continue;
    const spec = g.params.find((p) => p.key === key);
    if (spec) out.push({ role, key, spec });
  }
  return out;
}

/** The params a generator declares that are *not* among its three. */
export function secondaryParams(g: Generator): ParamSpec[] {
  const primary = g.primary;
  if (!primary) return g.params;
  const claimed = new Set([primary.x, primary.y]);
  return g.params.filter((p) => !claimed.has(p.key));
}

/**
 * The spec a control is actually working to, given the rest of the params.
 *
 * Identical to the declared spec unless the generator limits this parameter by
 * another one's value. Everything that shows or sets a value should go through
 * here rather than reading `spec.max` directly, or the slider offers a range
 * the render will not honour.
 */
export function effectiveSpec(g: Generator, spec: ParamSpec, params: Record<string, ParamValue>): ParamSpec {
  const limit = g.limits?.[spec.key];
  if (!limit || spec.type !== 'number') return spec;
  const ceiling = limit.max[String(params[limit.when])];
  if (ceiling === undefined || ceiling >= spec.max) return spec;
  return { ...spec, max: ceiling, default: Math.min(spec.default, ceiling) };
}

/**
 * Values carried across a change that moved their range.
 *
 * Truchet's tile-set select was the worked example: it took divisions from a
 * ceiling of twelve to one of six, and clamping alone answers that badly.
 * Eleven of the twelve settings land on the same place, so stepping through
 * the modes means losing where you were and getting it back as "the top"
 * whatever you had chosen. That select is gone -- arcs and diagonals are two
 * patterns now, and nothing in the registry declares `limits` any more -- but
 * the next mode switch with a dependent range will want exactly this. Scaled instead, half way along stays
 * half way along — six of twelve becomes three of six, and three of six comes
 * back as six of twelve.
 *
 * Kept proportional to the ceiling rather than across the range, because that
 * is the reading that survives a round trip: with a floor of one, scaling the
 * span would send six to three and three back to five, and tapping twice
 * through the sets would walk the value downward a step at a time.
 *
 * Only for a change somebody made. A decoded link carries both values
 * explicitly and rescaling it would rewrite what it says.
 */
export function retuneParams(
  g: Generator,
  before: Record<string, ParamValue>,
  after: Record<string, ParamValue>,
): Record<string, ParamValue> {
  if (!g.limits) return after;
  let out = after;
  for (const spec of g.params) {
    if (!g.limits[spec.key] || spec.type !== 'number') continue;
    const was = effectiveSpec(g, spec, before);
    const now = effectiveSpec(g, spec, after);
    if (was.type !== 'number' || now.type !== 'number' || was.max === now.max) continue;
    const value = typeof before[spec.key] === 'number' ? (before[spec.key] as number) : spec.default;
    if (out === after) out = { ...after };
    out[spec.key] = quantise(now, (value * now.max) / was.max);
  }
  return out;
}
