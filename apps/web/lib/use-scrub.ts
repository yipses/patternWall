'use client';

import { useCallback, useRef, useState } from 'react';
import { quantise, scrubTo, wrapPastEnd, type NumberSpec, type ParamSpec, type PrimaryBinding } from '@patternwall/core';

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
 * A full sweep is the surface itself: edge to edge covers the whole range.
 *
 * This replaced a fixed twelve pixels per *step*, clamped into a band, and the
 * argument for that is worth keeping because it is not wrong — it made a drag
 * mean the same thing on a phone and a desktop, where this deliberately does
 * not. What it could not do is mean anything a person could point at. The
 * travel came out of the step count, the step count is an implementation
 * detail of the parameter, and the result was two axes on scales 3.7x apart
 * with nothing on screen to explain why: weight took 520px to cross, divisions
 * 140px, and the only fix available was to keep re-guessing the constants.
 *
 * The picture is the control, so the picture is the scale. Drag from one side
 * to the other and you have been everywhere the parameter goes; let go half
 * way and you are half way along it. That is a promise the surface itself
 * states, and it holds on every parameter without being calibrated per
 * parameter — which is the part the old rule could never manage.
 *
 * Each axis measures against its own dimension. The preview is 9:19.5, so the
 * vertical axis gets roughly twice the room, which is right: it is also the
 * direction with space to swipe in.
 *
 * The cost, stated rather than discovered later. A fine control on a narrow
 * phone gets very little travel per step — truchet's stroke weight has 48 of
 * them across a preview about 210px wide, so about 4px each. That is fine for
 * what it is, an aesthetic quantity nobody is trying to land on a specific
 * step of, and it would not be fine for a control where the exact step
 * mattered. If one ever exists here, it wants a way to say so rather than a
 * constant that pushes every parameter around to protect it.
 */

/** The size of the surface a drag is happening on, measured when it starts. */
interface Surface {
  w: number;
  h: number;
}

/**
 * A degenerate box — a surface not laid out yet — would divide by zero and
 * send the value to an end on the first move. Fall back to something a drag
 * can happen in rather than to a NaN.
 */
const FALLBACK_TRAVEL = 300;

/** Enough travel left to be a scrub rather than a switch. */
const TRAVEL_FLOOR = 60;

/**
 * The distance a full range is spread over: the surface, less whatever the
 * axis lock spent deciding which way this drag was going.
 *
 * Subtracting the lead is what makes "edge to edge is the whole range" true
 * rather than approximately true. The value is anchored where the axis was
 * claimed — it has to be, or it would jump by a threshold's worth the instant
 * it locked — so the pixels before that point move the finger without moving
 * the value. Measure the range against the full width anyway and a drag from
 * one edge to the other arrives about 5% short of the end, which on a phone,
 * where the lead is a larger share of a narrower surface, is closer to 6%.
 * Near enough to look like the control simply will not reach.
 */
function travelFor(surface: Surface, axis: 'x' | 'y', lead: number): number {
  const measured = axis === 'x' ? surface.w : surface.h;
  const full = measured > 1 ? measured : FALLBACK_TRAVEL;
  return Math.max(TRAVEL_FLOOR, full - Math.abs(lead));
}

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

/** What the gesture is doing right now, for the readout on the preview. */
export interface ScrubReadout {
  key: string;
  spec: ParamSpec;
  value: number;
}

interface Drag {
  pointerId: number;
  /** The surface's size when the gesture began, which is what travel is. */
  surface: Surface;
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
  /** Pixels a full range is spread over, settled when the axis was claimed. */
  travel: number;
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
      // Measured once, here. Reading layout on every move would be a forced
      // reflow per pointer event, and a surface that resized mid-drag would
      // move the value without the finger moving.
      const box = e.currentTarget.getBoundingClientRect();
      drag.current = {
        pointerId: e.pointerId,
        surface: { w: box.width, h: box.height },
        x0: e.clientX,
        y0: e.clientY,
        startedAt: Date.now(),
        axis: null,
        started: false,
        moved: 0,
        travel: FALLBACK_TRAVEL,
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
        const lead = axis === 'x' ? dx0 : dy0;
        // Up increases, so the y lead is read against the screen.
        const heading = axis === 'x' ? lead : -lead;
        const at = quantise(bound.spec, read(bound.key));

        // A gesture that *begins* by pushing further into the end it is
        // already on comes round to the other one. Only at the lock, which is
        // what keeps a drag a fader: reach an end mid-drag and it clamps, so
        // settling beside one does not keep throwing the value across the
        // range. Lifting and swiping the same way again is the second,
        // deliberate statement, and that is the one that wraps.
        d.from = wrapPastEnd(bound.spec, at, heading);

        // Anchored where the axis was claimed, so the value does not jump by a
        // threshold's worth the instant it locks — and the range is then
        // spread over the travel that is actually left, so that reaching the
        // far edge reaches the end of the parameter.
        d.anchor = axis === 'x' ? e.clientX : e.clientY;
        d.travel = travelFor(d.surface, axis, lead);
        d.emitted = d.from;
        // A wrap is a change, and the lock otherwise announces nothing. Say it
        // now rather than waiting for the next move, which on a swipe that
        // stops dead at the threshold would never arrive.
        if (d.from !== at) {
          setReadout({ key: d.key, spec: bound.spec, value: d.from });
          onScrub(d.key, d.from);
        }
        return;
      }

      const spec = d.spec;
      if (!spec) return;
      // Up increases. Screen coordinates grow downward and a fader does not.
      const dir = d.axis === 'x' ? 1 : -1;
      const coord = d.axis === 'x' ? e.clientX : e.clientY;
      const travel = d.travel;
      const span = spec.max - spec.min;
      const fraction = (dir * (coord - d.anchor)) / travel;
      const value = scrubTo(spec, d.from, fraction);

      // Past either end, re-anchor so that reversing responds on the first
      // pixel rather than after paying back however far beyond it you dragged.
      // Rubber-banding is right for a scroll and wrong for a fader.
      //
      // The test is whether the *fraction* overshot, not whether the value is
      // sitting on the bound. Those read as equivalent and are not, and the
      // difference is the rest of why vertical swipes were unreliable. A
      // control whose current value already is a bound — divisions defaults to
      // its minimum — sits on that bound from the first move of every drag,
      // long before the drag has covered a step. Keying on the value therefore
      // re-anchored on every one of those moves, and re-anchoring discards the
      // displacement accumulated so far, so the value could never climb off
      // the end: each move started again from nothing.
      //
      // What made it intermittent is that one move can escape on its own. Drag
      // fast and the first move crosses half a step, quantises upward, and
      // everything from there works; drag smoothly, as a thumb does at 120Hz,
      // and no single move ever crosses half a step, so nothing happens at
      // all. Raising the travel floor made every move smaller and turned an
      // intermittent fault into a total one, which is how it was finally
      // caught — by a test that had passed for the wrong reason.
      const overshot = fraction > (spec.max - d.from) / span || fraction < (spec.min - d.from) / span;
      if (overshot) {
        const reached = (value - d.from) / span;
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
