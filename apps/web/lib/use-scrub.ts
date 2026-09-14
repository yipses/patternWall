'use client';

import { useCallback, useRef, useState } from 'react';
import { quantise, scrubTo, stepCount, type NumberSpec, type ParamSpec, type PrimaryBinding } from '@patternwall/core';

/**
 * Driving a pattern's three controls from the picture itself.
 *
 * Pointer events only, which is the whole reason this is one code path rather
 * than two: a mouse, a finger and a pen all arrive here identically, so the
 * gesture works on a desktop without being written twice, and Playwright's
 * `page.mouse` exercises the same handler a thumb does.
 *
 * Core owns what a parameter means and this owns what a finger does. Every
 * value question — what is the next option, where does this fraction of the
 * range land, what is on the step lattice — goes to `controls.ts`. What lives
 * here is the part measured in pixels and milliseconds.
 */

/**
 * Travel per step, and the band a full sweep is held to.
 *
 * Twelve pixels per step, not "one sweep across the surface". Surface-relative
 * travel sounds natural and is wrong in both directions: on a phone the
 * preview is about 200px wide, so truchet's stroke weight — 49 steps — would
 * get four pixels a step and be untunable, while divisions at 12 steps would
 * get seventeen. Worse, the same drag would mean different things on a desktop
 * and a phone, which is precisely what this design is trying not to be. Fixed
 * pixels per *step* is the one mapping that feels the same everywhere.
 *
 * The clamp keeps a two-step parameter from being a hair trigger and a
 * two-hundred-step one from needing a swipe nobody has room for. With pointer
 * capture the gesture continues past the edge of the surface, so a 520px sweep
 * on a 200px preview is fine.
 */
const PX_PER_STEP = 12;
const TRAVEL_MIN = 140;
const TRAVEL_MAX = 520;

/**
 * How far a pointer moves before it has chosen an axis, and how far before it
 * has to choose whether it wants to or not.
 *
 * Below the first of these nothing happens at all, which is what makes a tap a
 * tap: a finger never lands perfectly still, and without a threshold every tap
 * would also nudge whichever axis it drifted toward.
 *
 * What the threshold is measured on is the part that matters, and getting it
 * wrong is what made vertical swipes miss. The first version locked to
 * whichever axis was larger the moment *either* passed ten pixels — so a drag
 * that had gone eleven across and four down locked to across, which is correct
 * for that sample and wrong for the gesture. A thumb swiping up on a phone
 * pivots from the knuckle and travels sideways first; the intent is only
 * visible a little later. The wrong axis then held for the whole gesture and
 * the control the person was watching never moved, intermittently, depending
 * on how they happened to sweep.
 *
 * So the axis is claimed on the *lead* — one direction must be ahead of the
 * other by the threshold — and an even diagonal simply keeps waiting. It
 * cannot wait forever, so past the second distance the larger one takes it.
 */
const AXIS_LOCK_PX = 10;
const AXIS_FORCE_PX = 26;

/** A press held longer than this is not a tap, however still it was. */
const TAP_MS = 500;

/** A full sweep of this parameter, in CSS pixels. */
export function travelFor(spec: NumberSpec): number {
  return Math.min(TRAVEL_MAX, Math.max(TRAVEL_MIN, stepCount(spec) * PX_PER_STEP));
}

/** What the gesture is doing right now, for the readout on the preview. */
export interface ScrubReadout {
  key: string;
  spec: ParamSpec;
  value: number;
}

interface Drag {
  pointerId: number;
  x0: number;
  y0: number;
  startedAt: number;
  axis: 'x' | 'y' | null;
  /** True once an axis was claimed and `onStart` was announced. */
  started: boolean;
  /** Furthest the pointer has been from where it landed. */
  moved: number;
  spec: NumberSpec | null;
  key: string;
  /** The value the axis held when it was claimed. */
  from: number;
  /** The coordinate the current run is measured from. Moves when a clamp bites. */
  anchor: number;
  /** The last value handed out, so a move that changes nothing says nothing. */
  emitted: number;
}

export interface ScrubHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
}

export function useScrub(options: {
  bindings: PrimaryBinding[];
  /** The current value of a param, read when an axis is claimed. */
  read: (key: string) => number;
  /** A scrubbed value. Called only when the quantised value actually changed. */
  onScrub: (key: string, value: number) => void;
  /** A tap. The caller decides whether that cycles a param or rerolls the seed. */
  onTap: () => void;
  /**
   * A drag claimed an axis. Deliberately not "a finger landed": a tap would
   * otherwise open and close a gesture, which drops the preview to draft
   * resolution and back for no reason and shows as a flicker on every tap.
   */
  onStart: () => void;
  /** A drag ended, by release or by the browser taking it away. */
  onEnd: () => void;
}): { handlers: ScrubHandlers; readout: ScrubReadout | null } {
  const { bindings, read, onScrub, onTap, onStart, onEnd } = options;
  const drag = useRef<Drag | null>(null);
  const [readout, setReadout] = useState<ScrubReadout | null>(null);

  const bindingFor = useCallback(
    (axis: 'x' | 'y'): { key: string; spec: NumberSpec } | null => {
      const found = bindings.find((b) => b.role === axis);
      if (!found || !found.spec || found.spec.type !== 'number') return null;
      return { key: found.key, spec: found.spec };
    },
    [bindings],
  );

  const finish = useCallback(() => {
    const started = drag.current?.started ?? false;
    drag.current = null;
    setReadout(null);
    if (started) onEnd();
  }, [onEnd]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (drag.current) return;
      // Claims the pointer for the rest of the gesture, so a drag that leaves
      // the preview keeps scrubbing instead of stopping at the edge — which is
      // what makes a 520px sweep possible on a 200px-wide surface. It also
      // kills the browser's native image drag on a desktop.
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      drag.current = {
        pointerId: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        startedAt: Date.now(),
        axis: null,
        started: false,
        moved: 0,
        spec: null,
        key: '',
        from: 0,
        anchor: 0,
        emitted: Number.NaN,
      };
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;

      const dx0 = e.clientX - d.x0;
      const dy0 = e.clientY - d.y0;
      d.moved = Math.max(d.moved, Math.sqrt(dx0 * dx0 + dy0 * dy0));

      if (d.axis === null) {
        const adx = Math.abs(dx0);
        const ady = Math.abs(dy0);
        // One direction has to be clearly ahead of the other, or the gesture is
        // still a diagonal and committing to either is a guess.
        const decided = Math.abs(adx - ady) >= AXIS_LOCK_PX || Math.max(adx, ady) >= AXIS_FORCE_PX;
        if (!decided) return;
        const axis = adx >= ady ? 'x' : 'y';
        const bound = bindingFor(axis);
        if (!bound) {
          // Nothing is bound to this direction. Claim it anyway so the gesture
          // does not then lurch into the other axis halfway through.
          d.axis = axis;
          d.spec = null;
          return;
        }
        d.axis = axis;
        d.started = true;
        onStart();
        d.spec = bound.spec;
        d.key = bound.key;
        d.from = quantise(bound.spec, read(bound.key));
        // Anchored where the axis was claimed, so the value does not jump by a
        // threshold's worth the instant it locks.
        d.anchor = axis === 'x' ? e.clientX : e.clientY;
        d.emitted = d.from;
        return;
      }

      const spec = d.spec;
      if (!spec) return;
      // Up increases. Screen coordinates grow downward and a fader does not.
      const dir = d.axis === 'x' ? 1 : -1;
      const coord = d.axis === 'x' ? e.clientX : e.clientY;
      const travel = travelFor(spec);
      const value = scrubTo(spec, d.from, (dir * (coord - d.anchor)) / travel);

      // At either end, re-anchor so that reversing responds on the first pixel
      // rather than after paying back however far past the end you dragged.
      // Rubber-banding is right for a scroll and wrong for a fader.
      if (value === spec.min || value === spec.max) {
        const reached = (value - d.from) / (spec.max - spec.min);
        d.anchor = coord - dir * reached * travel;
      }

      if (value === d.emitted) return;
      d.emitted = value;
      setReadout({ key: d.key, spec, value });
      onScrub(d.key, value);
    },
    [bindingFor, onScrub, onStart, read],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      // A tap has to have stayed put as well as never claimed an axis: a
      // deliberate diagonal that never resolved is not a tap, and cycling the
      // tile set because somebody swiped at forty-five degrees would be worse
      // than doing nothing.
      const wasTap = !d.started && d.moved < AXIS_LOCK_PX && Date.now() - d.startedAt < TAP_MS;
      finish();
      if (wasTap) onTap();
    },
    [finish, onTap],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      // The browser took the gesture away — a system edge swipe, a phone call.
      // Whatever value it had reached stands; what must not happen is the
      // gesture staying open, which would strand the preview at draft
      // resolution for the rest of the session.
      finish();
    },
    [finish],
  );

  return { handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }, readout };
}
