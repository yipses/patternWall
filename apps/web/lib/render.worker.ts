/// <reference lib="webworker" />

import { renderSpec, svgToDataUrl, type RenderSpec } from './render';

/**
 * The renderer, off the main thread.
 *
 * Every pattern here is drawn synchronously into a string, and the expensive
 * ones are expensive enough to be felt: a dense flow-dots emits tens of
 * thousands of circles, and contours traces a field twice over at ~110ms. All
 * of that used to happen between two paints of the editor, which is why
 * dragging a slider on the heavier patterns stuttered.
 *
 * The case that originally paid for this was string art, whose greedy solver
 * took most of a second; rebuilding it around traced outlines took it to about
 * 30ms, so it is no longer the reason. The worker stays because the reason was
 * never one pattern — a render that happens where the UI is not waiting is the
 * right shape whatever the current slowest thing is.
 *
 * The worker changes nothing about what is drawn. It is the same `renderSpec`
 * the main thread calls, over the same core package, so the string it returns
 * is byte-for-byte the string Node produces for the same inputs -- which is the
 * claim `parity.spec.ts` makes and the whole "the preview is the export"
 * design rests on. It just runs somewhere the UI is not waiting.
 *
 * It answers with the data URL rather than the SVG so that base64-encoding a
 * few hundred kilobytes happens here too, and the string crosses the boundary
 * once instead of twice.
 */

export interface RenderRequest {
  id: number;
  spec: RenderSpec;
}

export type RenderResponse = { id: number; url: string } | { id: number; error: string };

const post = (message: RenderResponse): void => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
};

self.onmessage = (event: MessageEvent<RenderRequest>): void => {
  const { id, spec } = event.data;
  try {
    post({ id, url: svgToDataUrl(renderSpec(spec)) });
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : 'This pattern could not be drawn.' });
  }
};
