'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Past a quarter of its own height, a sheet is being thrown away. */
const DISMISS_FRACTION = 0.25;
/** Where the finger would be this far into the future, if it kept going. */
const PROJECT_MS = 150;
const PROJECT_FRACTION = 0.4;
/** A flick, in px/s, dismisses whatever the distance was. */
const FLING_VELOCITY = 500;
/** How far a sheet can be pulled *up* past its own top, and how hard. */
const RUBBER_CAP = 12;
const RUBBER_EXP = 0.7;
const RUBBER_SCALE = 0.5;

/**
 * Drag a bottom sheet down to dismiss it.
 *
 * The rule this exists for: every mode is dismissible three ways — a word in
 * the header, a downward drag, and the scrim. The button stays the
 * discoverable and keyboard-reachable path and is never the only one, which is
 * also why this hook only ever *calls* the same dismiss the button calls.
 *
 * It is also what makes a grabber honest. One was drawn on the export sheet
 * for a while with nothing behind it and was reported as exactly that: a
 * handle you cannot pull. A glyph that means drag is either wired up or not
 * drawn.
 *
 * The decision is on projected position rather than raw distance, so a quick
 * flick that has not travelled far still dismisses and a slow drag that has
 * travelled a long way does not snap back under the finger. Upward is rubber
 * banded to about twelve pixels — enough to say the sheet is at its top and
 * not enough to look like it might open further.
 *
 * **The drag starts on the grip only**, not on the body. The fuller behaviour
 * hands off from a scroll container once it is at `scrollTop === 0` and the
 * gesture is downward; that is better and it is also the fiddly case, and this
 * is the half that can be got right without guessing. The grabber sits in the
 * grip, so "pull the handle down" is the whole affordance.
 */
export function useSheetDrag(onDismiss: () => void): {
  sheetRef: React.RefObject<HTMLDivElement | null>;
  gripProps: { onPointerDown: (e: React.PointerEvent) => void };
  sheetStyle: React.CSSProperties;
  dragging: boolean;
} {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  /*
   * The listeners go on `window`, and they are attached inside `pointerdown`
   * rather than by an effect.
   *
   * Two things went wrong before this. `setPointerCapture` did not survive a
   * second gesture on the same sheet — the first drag tracked and dismissed,
   * the second delivered `pointerdown` and then nothing. Moving to window
   * listeners fixed that and introduced a race: an effect keyed on `dragging`
   * only attaches after React has committed, so the moves that arrive in the
   * meantime are lost, and a `pointerup` that beats the commit leaves a
   * gesture that never ends. Attaching here is synchronous and has neither
   * problem. `dragging` is then only what turns the settle transition off.
   */
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button > 0) return;
    /*
     * Not on a control. The grip is the whole top of the sheet so there is
     * something to pull, and the header's buttons live in it — a drag that
     * started on one would swallow its click. Cancel, Back and Done all
     * stopped working the first time this was wired up, which the suite caught
     * as a sheet that would not come back from its settings level.
     */
    if ((e.target as HTMLElement | null)?.closest('button, a, input, select, textarea, [role="button"]')) return;

    const height = sheetRef.current?.getBoundingClientRect().height ?? 0;
    const from = e.clientY;
    let prevY = from;
    let prevT = performance.now();
    setDragging(true);

    const onMove = (ev: PointerEvent): void => {
      const dy = ev.clientY - from;
      prevY = ev.clientY;
      prevT = performance.now();
      setOffset(dy >= 0 ? dy : -Math.min(RUBBER_CAP, Math.pow(-dy, RUBBER_EXP) * RUBBER_SCALE));
    };

    const detach = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    /*
     * A cancel is not a release, and treating it as one reads the wrong
     * coordinates.
     *
     * Chromium fires `pointercancel` when it takes the pointer for something
     * of its own — and a press on the header's text was starting a native
     * text drag, which cancelled every gesture after the first. The event
     * carries `clientY: 0`, so the distance came out as a large negative and
     * the sheet silently refused to move. `user-select: none` on the grip
     * stops the selection; this stops the arithmetic either way.
     */
    const onCancel = (): void => {
      detach();
      setDragging(false);
      setOffset(0);
    };

    const onUp = (ev: PointerEvent): void => {
      detach();
      setDragging(false);
      setOffset(0);
      const dy = ev.clientY - from;
      if (dy <= 0) return;
      const dt = Math.max(1, performance.now() - prevT);
      const velocity = ((ev.clientY - prevY) / dt) * 1000;
      const travel = height || 1;
      const projected = dy + velocity * (PROJECT_MS / 1000);
      if (dy > travel * DISMISS_FRACTION || projected > travel * PROJECT_FRACTION || velocity > FLING_VELOCITY) {
        dismissRef.current();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, []);

  return {
    sheetRef,
    gripProps: { onPointerDown },
    /*
     * A custom property, not `transform`.
     *
     * Writing `transform: translateY(...)` inline replaces whatever transform
     * the stylesheet had, and the collection's phone column centres its fixed
     * furniture with `left: 50%; transform: translateX(-50%)`. So the first
     * pointermove of every drag threw the sheet half its own width to the
     * right — measured, x went 0 to 195 at 390px and 235 to 450 at 900 — and
     * it slid back horizontally on release. The sheets compose this property
     * into their own transform instead, so neither has to know about the
     * other.
     */
    sheetStyle: {
      ['--pw-drag-y' as string]: `${offset}px`,
      // Nothing while the finger is down, so the sheet tracks it exactly; the
      // settle afterwards is the iOS sheet curve.
      transition: dragging ? 'none' : 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)',
    } as React.CSSProperties,
    dragging,
  };
}
