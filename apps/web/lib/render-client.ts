import { renderSpec, svgToDataUrl, type RenderSpec } from './render';
import type { RenderRequest, RenderResponse } from './render.worker';

/**
 * The main thread's side of the render worker.
 *
 * One worker, not a pool. Renders here are CPU-bound and strictly ordered by
 * usefulness: while you drag a control, every render but the last is already
 * stale by the time it finishes, so a pool would spend cores computing
 * pictures nobody will see. What matters instead is that the newest request is
 * answered.
 *
 * This comment used to say that was "what `supersede` is for", and there was
 * no supersede. Every request was posted the moment it arrived and the worker
 * rendered all of them in order, so a continuous gesture built a queue and the
 * preview fell further behind the finger the longer you dragged. There is one
 * now, and the shape of it is the interesting part.
 *
 * **It is scoped to a channel, not global.** A single global slot looks right
 * until you count the callers: `/collected` mounts one `PatternImage` per
 * saved configuration and they all go async in the same tick, and changing the
 * palette in the editor re-specs three related-pattern thumbnails at once.
 * Under a global supersede all but the last of each group would be dropped and
 * never re-requested — permanently blank or permanently wrong pictures, with
 * nothing to suggest why. So requests supersede only requests that share their
 * channel, and a request with no channel never supersedes anything and is
 * never superseded. Only the editor preview passes one.
 *
 * The ceiling this buys is one wasted render rather than none: a synchronous
 * render already inside the worker cannot be interrupted from outside.
 *
 * Falls back to rendering inline whenever there is no worker to be had --
 * during the static export's prerender, in a browser without `Worker`, or if
 * constructing one throws because the bundle could not be fetched. The
 * fallback is the same function the worker calls, so the only difference is
 * which thread is blocked.
 */

/** The reason a request rejects when a newer one on its channel replaced it. */
export const SUPERSEDED = 'render superseded';

/** True for the rejection of a request that was replaced rather than failed. */
export function isSuperseded(err: unknown): boolean {
  return err instanceof Error && err.message === SUPERSEDED;
}

export interface RenderOptions {
  /**
   * Requests sharing a channel replace one another while one is in flight.
   * Omit it and the request queues normally, which is what every caller but
   * the editor preview wants.
   */
  channel?: string;
}

interface Job {
  id: number;
  spec: RenderSpec;
  channel: string | undefined;
  resolve: (url: string) => void;
  reject: (err: Error) => void;
}

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;

const pending = new Map<number, Job>();
/** Jobs accepted but not yet posted. At most one per channel. */
let queue: Job[] = [];
/** The job the worker is working on, or null. */
let inFlight: number | null = null;

function drop(job: Job, reason: string): void {
  pending.delete(job.id);
  job.reject(new Error(reason));
}

/** Post the head of the queue, if the worker is free to take it. */
function pump(): void {
  if (inFlight !== null) return;
  const next = queue.shift();
  if (!next) return;
  const w = getWorker();
  if (!w) {
    // The worker died between accepting this and posting it. Everything still
    // waiting is failed the same way, and the caller retries inline.
    drop(next, 'render worker unavailable');
    for (const job of queue) drop(job, 'render worker unavailable');
    queue = [];
    return;
  }
  inFlight = next.id;
  w.postMessage({ id: next.id, spec: next.spec } satisfies RenderRequest);
}

function settle(data: RenderResponse): void {
  if (inFlight === data.id) inFlight = null;
  const entry = pending.get(data.id);
  if (entry) {
    pending.delete(data.id);
    if ('url' in data) entry.resolve(data.url);
    else entry.reject(new Error(data.error));
  }
  pump();
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
      inFlight = null;
      // Queued jobs are failed along with in-flight ones, or a job accepted
      // but never posted waits forever on a worker that is gone. Every queued
      // job is in `pending` too -- it goes in there before it is queued -- so
      // draining that map covers both.
      const stranded = [...pending.values()];
      pending.clear();
      queue = [];
      for (const job of stranded) job.reject(new Error('render worker unavailable'));
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
export function renderDataUrlAsync(spec: RenderSpec, options?: RenderOptions): Promise<string> {
  if (!getWorker()) {
    try {
      return Promise.resolve(renderDataUrl(spec));
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error('This pattern could not be drawn.'));
    }
  }
  const id = nextId++;
  const channel = options?.channel;
  return new Promise<string>((resolve, reject) => {
    const job: Job = { id, spec, channel, resolve, reject };
    pending.set(id, job);
    if (channel !== undefined) {
      // One waiting job per channel. The one being replaced rejects rather
      // than simply vanishing: a promise that never settles keeps its spec --
      // params and palette both -- reachable for the life of the page, and a
      // caller has no way to tell it apart from a render that is merely slow.
      const at = queue.findIndex((j) => j.channel === channel);
      if (at >= 0) {
        drop(queue[at] as Job, SUPERSEDED);
        queue[at] = job;
      } else {
        queue.push(job);
      }
    } else {
      queue.push(job);
    }
    pump();
  });
}
