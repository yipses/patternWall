import { renderSpec, svgToDataUrl, type RenderSpec } from './render';
import type { RenderRequest, RenderResponse } from './render.worker';

/**
 * The main thread's side of the render worker.
 *
 * One worker, not a pool. Renders here are CPU-bound and strictly ordered by
 * usefulness: while you drag a slider, every render but the last is already
 * stale by the time it finishes, so a pool would spend cores computing
 * pictures nobody will see. What matters instead is that the newest request is
 * answered, and that is what `supersede` is for.
 *
 * Falls back to rendering inline whenever there is no worker to be had --
 * during the static export's prerender, in a browser without `Worker`, or if
 * constructing one throws because the bundle could not be fetched. The
 * fallback is the same function the worker calls, so the only difference is
 * which thread is blocked.
 */

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;

const pending = new Map<number, { resolve: (url: string) => void; reject: (err: Error) => void }>();

function settle(data: RenderResponse): void {
  const entry = pending.get(data.id);
  if (!entry) return;
  pending.delete(data.id);
  if ('url' in data) entry.resolve(data.url);
  else entry.reject(new Error(data.error));
}

function getWorker(): Worker | null {
  if (workerFailed || typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    // `new URL(..., import.meta.url)` is the form the bundler recognises; it
    // emits the worker as its own chunk and rewrites this to its real URL,
    // base path included. Anything more dynamic and it ships nothing.
    worker = new Worker(new URL('./render.worker.ts', import.meta.url));
    worker.onmessage = (event: MessageEvent<RenderResponse>) => settle(event.data);
    worker.onerror = () => {
      // A worker that cannot start is not worth retrying on every render: give
      // up on it once, fail everything waiting, and let the inline path take
      // over for the rest of the session.
      workerFailed = true;
      worker?.terminate();
      worker = null;
      for (const [id, entry] of pending) {
        pending.delete(id);
        entry.reject(new Error('render worker unavailable'));
      }
    };
  } catch {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

/** Render inline, on whichever thread is asking. */
export function renderDataUrl(spec: RenderSpec): string {
  return svgToDataUrl(renderSpec(spec));
}

/**
 * Render off the main thread where that is possible.
 *
 * Rejects with the render's own error message, so a caller can show the same
 * "this pattern could not be drawn" copy it always did; rejects with
 * `render worker unavailable` if the worker dies, and callers should retry
 * inline rather than treat that as a broken pattern.
 */
export function renderDataUrlAsync(spec: RenderSpec): Promise<string> {
  const w = getWorker();
  if (!w) {
    try {
      return Promise.resolve(renderDataUrl(spec));
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error('This pattern could not be drawn.'));
    }
  }
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, spec } satisfies RenderRequest);
  });
}
