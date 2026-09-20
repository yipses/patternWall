'use client';

import { getGenerator } from '@patternwall/core';
import type { ExportSettings } from '../components/ExportSettings';
import { boostForHomeScreen } from './harmony';
import { renderPngBlob, safeFilename, yieldToBrowser } from './export-png';
import { renderSpec } from './render';
import type { CollectedItem } from './storage';

export interface RenderedWallpaper {
  name: string;
  blob: Blob;
}

/**
 * Only what can actually be drawn.
 *
 * An item whose generator is missing from this build is kept rather than
 * dropped on load, so it reaches here — and counting it made an "Export all 3"
 * on a zip that would hold two.
 */
export function exportableItems(items: CollectedItem[]): CollectedItem[] {
  return items.filter((i) => getGenerator(i.generatorId));
}

/**
 * Render a set of saved configurations to PNGs, one at a time.
 *
 * One at a time is not laziness. A dozen files at a modern phone's native
 * resolution is well over a hundred megabytes of live canvas if they are held
 * at once, and the tab is killed rather than slowed. Each blob is compressed
 * before the next render starts, and the frame is handed back between them so
 * the sheet's progress and the grid behind it stay live.
 */
export async function renderCollection(
  items: CollectedItem[],
  s: Pick<ExportSettings, 'homeVariant' | 'outWidth' | 'outHeight' | 'bleed' | 'depth' | 'colors'>,
  hooks: { onProgress?: (done: number, total: number) => void; cancelled?: () => boolean } = {},
): Promise<RenderedWallpaper[]> {
  const list = exportableItems(items);
  const width = String(list.length).length;
  const out: RenderedWallpaper[] = [];

  for (const [i, item] of list.entries()) {
    if (hooks.cancelled?.()) break;
    const palette = s.homeVariant ? boostForHomeScreen(item.palette) : item.palette;
    const svg = renderSpec({
      generatorId: item.generatorId,
      seed: item.seed,
      params: item.params,
      palette,
      width: s.outWidth,
      height: s.outHeight,
      bleed: s.bleed,
    });
    const blob = await renderPngBlob(svg, s.outWidth, s.outHeight, { depth: s.depth, colors: s.colors });
    const index = String(i + 1).padStart(width, '0');
    out.push({ name: `${safeFilename([index, 'patternwall', item.generatorId, item.seed])}.png`, blob });
    hooks.onProgress?.(i + 1, list.length);
    await yieldToBrowser();
  }
  return out;
}

/**
 * Hand the files to the platform if it will take them, and fall back to a
 * download if it will not.
 *
 * `navigator.share` with files is what makes this usable on a phone: iOS offers
 * "Save N Images" and they land in Photos, which is where a wallpaper has to be
 * to be set as one. A zip in Files is a dead end there — nothing on the device
 * will open it and put the pictures anywhere useful.
 *
 * One file is never a zip, on any platform. Zipping a single PNG is an
 * archive somebody has to unpack for no reason.
 */
export async function deliverWallpapers(
  files: RenderedWallpaper[],
  zip: (files: RenderedWallpaper[]) => Promise<void>,
  download: (file: RenderedWallpaper) => void,
): Promise<'shared' | 'downloaded' | 'zipped'> {
  const shareable = files.map((f) => new File([f.blob], f.name, { type: 'image/png' }));
  const nav = typeof navigator === 'undefined' ? null : navigator;
  if (nav?.canShare?.({ files: shareable })) {
    try {
      await nav.share({ files: shareable, title: 'PatternWall' });
      return 'shared';
    } catch (err) {
      // A cancelled share is a decision, not a failure, and must not fall
      // through to a download the person just declined.
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
      // Anything else — a share target that refused, a transient platform
      // error — is worth falling back for rather than reporting as broken.
    }
  }
  if (files.length === 1) {
    download(files[0]!);
    return 'downloaded';
  }
  await zip(files);
  return 'zipped';
}
