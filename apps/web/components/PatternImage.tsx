'use client';

import { useMemo } from 'react';
import { renderSpec, svgToDataUrl, type RenderSpec } from '../lib/render';

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
  const result = useMemo(() => {
    try {
      return { url: svgToDataUrl(renderSpec(spec)), error: null as string | null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'This pattern could not be drawn.';
      return { url: null, error: message };
    }
  }, [spec]);

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
