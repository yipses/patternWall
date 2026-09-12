'use client';

import { useMemo } from 'react';
import { renderSpec, svgToDataUrl, type RenderSpec } from '../lib/render';

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
}: {
  spec: RenderSpec;
  alt: string;
  className?: string;
  onRenderError?: (message: string) => void;
}) {
  // Keyed on the spec's content rather than on `spec` itself. See specKey.
  const key = specKey(spec);
  const result = useMemo(() => {
    try {
      return { url: svgToDataUrl(renderSpec(spec)), error: null as string | null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'This pattern could not be drawn.';
      return { url: null, error: message };
    }
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
    <img className={className} src={result.url ?? ''} alt={alt} width={spec.width} height={spec.height} decoding="async" />
  );
}
