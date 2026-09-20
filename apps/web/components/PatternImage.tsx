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
    try {
      return { url: renderDataUrl(spec), error: null as string | null };
    } catch (err) {
      return { url: null, error: err instanceof Error ? err.message : 'This pattern could not be drawn.' };
    }
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
  const renderedKey = useRef(key);

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
    // `channel` is deliberately not a dependency: it identifies the stream,
    // not the picture, and re-running on it would redraw for nothing.
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
