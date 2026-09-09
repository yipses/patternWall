'use client';

import UPNG from 'upng-js';
import { svgToDataUrl } from './render';

/**
 * PNG export.
 *
 * These wallpapers are flat vector art: a few dozen distinct colours across
 * three million pixels. A truecolour PNG spends most of its bytes describing
 * variation that is not there, so the default path quantises to a 64-entry
 * palette and writes a PNG-8. On a typical render that is a five-to-ten times
 * saving with no visible difference. Gradient-heavy configurations are the
 * exception, and get a PNG-24 toggle rather than a worse-looking default.
 */

export type PngDepth = 'png8' | 'png24';

export interface EncodeOptions {
  depth: PngDepth;
  /** Palette size for PNG-8. Ignored for PNG-24. */
  colors: number;
}

export async function svgToImageData(svg: string, width: number, height: number): Promise<ImageData> {
  const url = svgToDataUrl(svg);
  const img = new Image();
  img.width = width;
  img.height = height;
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('The pattern could not be rasterised by this browser.'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('This browser did not provide a 2D canvas context.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export function encodePng(data: ImageData, options: EncodeOptions): Blob {
  const cnum = options.depth === 'png24' ? 0 : Math.max(2, Math.min(256, Math.round(options.colors)));
  const buffer = UPNG.encode([data.data.buffer as ArrayBuffer], data.width, data.height, cnum);
  return new Blob([buffer], { type: 'image/png' });
}

export async function renderPngBlob(svg: string, width: number, height: number, options: EncodeOptions): Promise<Blob> {
  const data = await svgToImageData(svg, width, height);
  return encodePng(data, options);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 20000);
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Yield to the browser so long batches never freeze scrolling or typing. */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => window.setTimeout(resolve, 0));
    else window.setTimeout(resolve, 0);
  });
}

export function safeFilename(parts: (string | number)[]): string {
  return parts
    .map((p) => String(p).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean)
    .join('_');
}
