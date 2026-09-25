'use client';

import { useCallback, useRef } from 'react';

/**
 * One card, three gestures: drag it sideways to judge it, drag up or down to
 * scrub through its colours, tap it for a new wallpaper.
 *
 * The card follows the finger only on the horizontal axis. A card moving up
 * reads as being thrown away, so a vertical drag leaves the card where it is
 * and scrubs through the palettes instead: the colours change step by step
 * under the finger, and dragging back to where you started puts back the
 * colours you started with.
 */

/** Past this lead one axis claims the gesture. The same number /m uses. */
const AXIS_LOCK_PX = 10;
/** Past this distance a gesture that has not picked an axis never will. */
const AXIS_FORCE_PX = 26;

/**
 * Touches starting this close to a side edge never drag the card.
 *
 * Safari owns both edges: a rightward swipe from the left edge is its back
 * gesture, and a leftward one from the right edge is forward once there is a
 * forward entry — which there is after any trip to the gallery and back. Page
 * script cannot win either, so the card does not compete for them. A thumb
 * starts a swipe well inside this anyway.
 */
export const EDGE_PX = 24;

/** A verdict commits past this share of the card's width... */
const COMMIT_FRACTION = 0.3;
/** ...or on a flick this fast (px per ms), once it has moved at least this far. */
const FLICK_VELOCITY = 0.6;
const FLICK_MIN_PX = 40;

/**
 * The shortest vertical travel that changes the palette.
 *
 * Otherwise the card's height covers the whole list — the picture is the
 * scale, as it is for /m's scrub — which on a phone is about sixteen pixels a
 * palette. This floor only binds on a short card, where each step would
 * otherwise be a redraw every few pixels and the picture could not keep up.
 */
const PALETTE_MIN_STEP_PX = 12;

/**
 * A tap is short and still. A press that lasts, or wanders, is not one.
 *
 * Tap is the most accidental gesture on the screen — a resting thumb, a swipe
 * that barely started, a touch meant for something else — and on a random feed
 * it replaces the card. So it is strict, and rewind covers what gets through.
 */
const TAP_MOVE_PX = 10;
const TAP_MS = 300;

/** How far the card leans at the commit point, in degrees. */
const MAX_TILT = 8;

export interface SwipeHandlers {
  /** The card is being dragged: progress runs -1 (skip) to 1 (like), and past either end is committed. */
  onDrag: (dx: number, progress: number, tilt: number) => void;
  /** A drag let go without committing. */
  onCancel: () => void;
  onVerdict: (kind: 'skip' | 'like', dx: number, velocity: number) => void;
  /**
   * A vertical drag has moved the palette `steps` places from where it began —
   * up is forward. Called each time the count changes, including back to 0.
   */
  onPaletteScrub: (steps: number) => void;
  /** The vertical drag let go, `steps` palettes from where it began. */
  onPaletteEnd: (steps: number) => void;
  onTap: (x: number, y: number) => void;
}

interface Gesture {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  axis: 'x' | 'y' | 'none' | null;
  edge: boolean;
  width: number;
  /** Pixels of vertical travel per palette. */
  step: number;
  /**
   * How far the finger had gone when the vertical axis was claimed. That much
   * either side of where it started is dead, so the travel spent deciding
   * moves nothing — and going back to the start is going back to 0.
   */
  yLock: number;
  /** Palettes scrubbed so far. */
  steps: number;
  /** Recent samples, for release velocity. */
  samples: { x: number; y: number; t: number }[];
  /** Where in the card the finger grabbed, -1 top to 1 bottom, which way to lean. */
  grip: number;
}

export function useCardSwipe(handlers: SwipeHandlers, enabled: boolean, reducedMotion: boolean, paletteCount: number) {
  const h = useRef(handlers);
  h.current = handlers;
  const g = useRef<Gesture | null>(null);

  const velocityOf = (samples: Gesture['samples']): number => {
    const last = samples[samples.length - 1];
    const first = samples.find((s) => last && last.t - s.t <= 100) ?? samples[0];
    if (!last || !first || last.t === first.t) return 0;
    return (last.x - first.x) / (last.t - first.t);
  };

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled || g.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const box = e.currentTarget.getBoundingClientRect();
      const vw = window.innerWidth;
      const gesture: Gesture = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        t0: performance.now(),
        axis: null,
        edge: e.clientX < EDGE_PX || e.clientX > vw - EDGE_PX,
        width: box.width,
        step: Math.max(PALETTE_MIN_STEP_PX, box.height / Math.max(1, paletteCount)),
        yLock: 0,
        steps: 0,
        samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }],
        grip: box.height > 0 ? ((e.clientY - box.top) / box.height) * 2 - 1 : 0,
      };
      g.current = gesture;

      /*
       * Listeners on the window, attached here and not in an effect. Pointer
       * capture did not survive a second gesture on the same element, and
       * listeners attached by an effect race React's commit — both were found
       * the hard way on the sheet drag, whose hook this follows.
       */
      const move = (ev: PointerEvent): void => {
        const s = g.current;
        if (!s || ev.pointerId !== s.id) return;
        const now = performance.now();
        s.samples = [...s.samples.filter((p) => now - p.t < 160), { x: ev.clientX, y: ev.clientY, t: now }];
        const dx = ev.clientX - s.x0;
        const dy = ev.clientY - s.y0;

        if (s.axis === null) {
          // On the lead, not on the larger of the two: a thumb swiping up a
          // phone pivots from the knuckle and travels sideways first.
          const lead = Math.abs(dx) - Math.abs(dy);
          if (lead > AXIS_LOCK_PX) s.axis = s.edge ? 'none' : 'x';
          else if (-lead > AXIS_LOCK_PX) {
            s.axis = 'y';
            s.yLock = Math.abs(dy);
          }
          else if (Math.max(Math.abs(dx), Math.abs(dy)) > AXIS_FORCE_PX) s.axis = 'none';
        }
        if (s.axis === 'x') {
          const progress = Math.max(-1.5, Math.min(1.5, dx / (s.width * COMMIT_FRACTION)));
          const tilt = reducedMotion ? 0 : Math.max(-1, Math.min(1, dx / s.width)) * MAX_TILT * (s.grip > 0 ? -1 : 1);
          h.current.onDrag(dx, progress, tilt);
        }
        if (s.axis === 'y') {
          // Rounded rather than truncated, so the drag is symmetric: the same
          // travel up and back down is the same number of steps each way.
          const travel = Math.sign(-dy) * Math.max(0, Math.abs(dy) - s.yLock);
          const steps = Math.round(travel / s.step);
          if (steps !== s.steps) {
            s.steps = steps;
            h.current.onPaletteScrub(steps);
          }
        }
      };

      const end = (ev: PointerEvent, cancelled: boolean): void => {
        const s = g.current;
        if (!s || ev.pointerId !== s.id) return;
        g.current = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);

        const dx = ev.clientX - s.x0;
        const dy = ev.clientY - s.y0;
        if (cancelled) {
          if (s.axis === 'x') h.current.onCancel();
          // A cancelled scrub keeps what it showed: every step was already on
          // screen, and snapping back would undo colours somebody was looking at.
          if (s.axis === 'y') h.current.onPaletteEnd(s.steps);
          return;
        }
        if (s.axis === 'x') {
          const v = velocityOf(s.samples);
          const far = Math.abs(dx) > s.width * COMMIT_FRACTION;
          const flung = Math.abs(v) > FLICK_VELOCITY && Math.abs(dx) > FLICK_MIN_PX && Math.sign(v) === Math.sign(dx);
          if (far || flung) h.current.onVerdict(dx > 0 ? 'like' : 'skip', dx, v);
          else h.current.onCancel();
          return;
        }
        if (s.axis === 'y') {
          // No flick to honour: the step is a fraction of the flick distance,
          // so any flick has already crossed several palettes on its way.
          h.current.onPaletteEnd(s.steps);
          return;
        }
        if (s.axis === null && Math.hypot(dx, dy) < TAP_MOVE_PX && performance.now() - s.t0 < TAP_MS) {
          h.current.onTap(ev.clientX, ev.clientY);
        }
      };
      const up = (ev: PointerEvent): void => end(ev, false);
      const cancel = (ev: PointerEvent): void => end(ev, true);

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    },
    [enabled, reducedMotion, paletteCount],
  );

  return { onPointerDown };
}
