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
 * Whether handing the files to the platform beats downloading them.
 *
 * `canShare` is not the question. macOS Safari answers yes and then offers
 * Messages, Mail, AirDrop and Copy — no Photos, no Save to Files, because
 * those are not share targets on a Mac. So a desktop that shared instead of
 * downloading lost the one thing it was good at, and that is what shipped
 * before this: the files went into a sheet with nowhere useful to put them.
 *
 * A coarse pointer is the honest test. On a phone the share sheet is the only
 * route into Photos, which is the only place a wallpaper can be set from; on
 * anything with a mouse the file system is right there and a download lands in
 * it. Not a user-agent sniff — what differs is the platform's idea of where a
 * file goes, and that tracks the input device closely enough.
 */
function shareIsBetterHere(files: File[]): boolean {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  if (!nav?.canShare?.({ files })) return false;
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Hand the files to the platform where that is the better route, and download
 * them where it is not.
 *
 * On a phone `navigator.share` offers "Save N Images" and they land in Photos,
 * which is where a wallpaper has to be to be set as one. A zip in Files is a
 * dead end there — nothing on the device will open it and put the pictures
 * anywhere useful. On a desktop the reverse is true, which `shareIsBetterHere`
 * is about.
 *
 * `force` overrides the choice, for the "save them instead" the sheet offers
 * once a share is done: the platform's sheet is not always the right answer
 * and there has to be a way past it that is not trying again.
 *
 * One file is never a zip, on any platform. Zipping a single PNG is an archive
 * somebody has to unpack for no reason.
 */
export async function deliverWallpapers(
  files: RenderedWallpaper[],
  zip: (files: RenderedWallpaper[]) => Promise<void>,
  download: (file: RenderedWallpaper) => void,
  force?: 'share' | 'download',
): Promise<'shared' | 'downloaded' | 'zipped'> {
  const shareable = files.map((f) => new File([f.blob], f.name, { type: 'image/png' }));
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const share = force === 'download' ? false : force === 'share' ? !!nav?.canShare?.({ files: shareable }) : shareIsBetterHere(shareable);
  if (share && nav) {
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
