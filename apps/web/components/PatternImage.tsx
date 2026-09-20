'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { type RenderSpec } from '../lib/render';
import { isSuperseded, renderDataUrl, renderDataUrlAsync } from '../lib/render-client';

/**
 * A spec's content, as a string, so the render below can be memoised on what
 * the spec *says* rather than on which object it happens to be.
 *
 * Every caller builds its spec as an object literal in JSX, which is a new
 * object on every parent render. Memoising on identity therefore missed every
 * time, and since the editor re-renders on each keystroke and each pointermove
 * of a drag, the three related-pattern thumbnails were re-rendered from scratch
 * while you typed a seed they have nothing to do with. Measured over twelve
 * keystrokes: 13 long tasks totalling 905ms on /p/truchet, and the cost tracked
 * whether flow-dots happened to be in the related list rather than anything
 * being edited — it costs about 27ms at any size, so a 108px thumbnail is as
 * expensive as a full export.
 *
 * Stringifying a dozen params and a palette costs microseconds against a render
 * that costs tens of milliseconds, so this is worth doing on every render even
 * when it finds no change. Key order is stable because each call site writes
 * its literal the same way each time; if it ever were not, the cost is a
 * needless re-render, which is what used to happen anyway.
 */
const specKey = (s: RenderSpec): string =>
  `${s.generatorId}|${s.seed}|${s.width}x${s.height}|${s.bleed ?? 0}|${JSON.stringify(s.params)}|${JSON.stringify(s.palette)}`;

/**
 * A rendered pattern, as an `<img>` rather than inline SVG.
 *
 * These renders can contain twenty thousand circles. As inline SVG that is
 * twenty thousand live DOM nodes per preview, and a gallery of them will drop
 * frames on a laptop, let alone a phone. Handing the identical string to the
 * browser's image decoder gets it rasterised once, off the main document, and
 * the DOM stays a single element. It is also exactly what the PNG exporter
 * does, so what you see really is what you download.
 */
export function PatternImage({
  spec,
  alt,
  className,
  onRenderError,
  channel,
  draggable,
  deferred = false,
}: {
  spec: RenderSpec;
  alt: string;
  className?: string;
  /**
   * Pass `false` where a long press on the picture means something.
   *
   * Chromium starts a native drag when a pointer moves off an image or a link,
   * and a native drag fires `pointercancel` — which silently ends any
   * press-and-hold the caller is timing. It cost a test that appeared to prove
   * a slop threshold worked and was in fact proving the drag cancelled it.
   */
  draggable?: boolean;
  onRenderError?: (message: string) => void;
  /**
   * Names a stream of renders that replace one another. Give it to a preview
   * somebody is dragging; leave it off everywhere else, because a shared
   * channel between two pictures means one of them never gets drawn.
   */
  channel?: string;
  /**
   * Skip the inline first render and go straight to the worker.
   *
   * The inline path below exists so the client's opening `src` matches the data
   * URL the static export baked into the HTML. That argument holds wherever the
   * picture is prerendered and is simply false on a page whose pictures are
   * read from localStorage after mount -- checked in the built export, the two
   * collection routes carry no baked `data:image/svg` at all, while `/` has
   * four and `/m` one.
   *
   * There it is not a neutral cost. Every tile renders synchronously in one
   * commit on the main thread, and a contours tile at the size the grid uses
   * measures 28.3ms against `dist` -- so two hundred of them is about six
   * seconds of frozen page on a laptop and rather worse on a phone, with no
   * paint, no scroll and nothing to cancel. Deferred, the worker serialises
   * them and the grid fills in while you are looking at it.
   */
  deferred?: boolean;
}) {
  // Keyed on the spec's content rather than on `spec` itself. See specKey.
  const key = specKey(spec);

  /**
   * The first picture is drawn here, on whichever thread is asking; every one
   * after it is drawn in the worker.
   *
   * That split is not a compromise, it is the only arrangement that keeps both
   * things this component has to be true. The static export prerenders these
   * to data URLs baked into the HTML, so the page has its pictures before any
   * script runs -- and React then hydrates against that HTML, so the client's
   * *first* render has to produce the identical `src` or it is a hydration
   * mismatch. This app has already been bitten once by exactly that class of
   * bug, and the note in `next.config.mjs` is the scar.
   *
   * So the initial value stays synchronous and identical on both sides, and
   * the worker takes over from the first change onward -- which is where all
   * the cost actually is, since a spec changes on every pointermove of a drag
   * and the initial render happens once.
   */
  const initial = useMemo(() => {
    if (deferred) return { url: null as string | null, error: null as string | null };
    try {
      return { url: renderDataUrl(spec), error: null as string | null };
    } catch (err) {
      return { url: null, error: err instanceof Error ? err.message : 'This pattern could not be drawn.' };
    }
    // Mount-only on purpose, and the whole point of it: this value has to be
    // the one the prerendered HTML was built with, so re-running it on a later
    // `spec` is exactly the hydration mismatch it exists to avoid. `deferred`
    // names which path this component takes and does not change for its life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [result, setResult] = useState(initial);
  /**
   * The key of the picture currently on screen, not the key this component
   * mounted with.
   *
   * The mount render has to be the inline one the prerendered HTML hydrates
   * against, which is what the early return below is for. Keying that on the
   * *mount* key rather than on the last one drawn also skips the redraw
   * whenever a spec comes back to the one the page opened on -- and `key` is
   * content-based, so returning to the opening configuration reproduces it
   * exactly.
   *
   * Stated as a bug that is honest; demonstrated as one it is not. Reset to
   * defaults, a palette round trip and a seed round trip were all driven
   * against the mount-key version and all three redrew correctly, because
   * nothing after the first render ever reproduces the mount key -- the
   * editor's opening spec is not a state any later interaction returns to. So
   * this is hardening rather than a fix, and it is worth having only because
   * tracking what was last drawn says what the guard means and costs the same.
   */
  const renderedKey = useRef<string | null>(deferred ? null : key);

  useEffect(() => {
    if (key === renderedKey.current) return;
    renderedKey.current = key;
    let live = true;
    renderDataUrlAsync(spec, channel === undefined ? undefined : { channel })
      .then((url) => {
        if (live) setResult({ url, error: null });
      })
      .catch((err: Error) => {
        if (!live) return;
        // A newer request on this channel owns the slot now. Nothing failed and
        // there is nothing to draw: the render that replaced this one will
        // arrive on its own.
        if (isSuperseded(err)) return;
        // A worker that could not start is not a broken pattern. Draw it here
        // instead, and let the client fall back for the rest of the session.
        if (err.message === 'render worker unavailable') {
          try {
            setResult({ url: renderDataUrl(spec), error: null });
            return;
          } catch (inner) {
            setResult({ url: null, error: inner instanceof Error ? inner.message : 'This pattern could not be drawn.' });
            return;
          }
        }
        setResult({ url: null, error: err.message });
      });
    return () => {
      // The worker finishes what it started -- a synchronous render cannot be
      // interrupted from outside -- but a picture that is already out of date
      // must not be allowed to land.
      live = false;
    };
    // `key` is the spec's *content*, so depending on `spec` instead would
    // redraw on every parent render — the object is a fresh literal each time,
    // which is the measurement in the note at the top of this file. `channel`
    // identifies the stream rather than the picture, so re-running on it would
    // redraw for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (result.error) {
    if (onRenderError) onRenderError(result.error);
    return (
      <div className={className} role="img" aria-label={`${alt} — failed to render`} style={{ display: 'grid', placeItems: 'center', background: '#151517', color: '#a3a29d', fontSize: 12, padding: 16, textAlign: 'center' }}>
        {result.error}
      </div>
    );
  }

  return (
    /* A data-URL SVG raster. next/image is deliberately not used: it would add
       a loader that a static export cannot run, for an image we generated. */
    <img
      className={className}
      src={result.url ?? ''}
      alt={alt}
      width={spec.width}
      height={spec.height}
      decoding="async"
      {...(draggable === undefined ? {} : { draggable })}
    />
  );
}
