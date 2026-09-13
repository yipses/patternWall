import type { Page } from '@playwright/test';

/** The data URL of the pattern currently shown in the editor preview. */
export async function previewSrc(page: Page): Promise<string> {
  const img = page.locator('main img[alt*="rendered with"]').first();
  await img.waitFor({ state: 'attached' });
  return (await img.getAttribute('src')) ?? '';
}

/**
 * Wait until the preview has settled on a full-quality render.
 *
 * This used to be a fixed 700ms sleep, which worked only because rendering was
 * synchronous: the editor's debounce elapsed, the main thread blocked, and by
 * the time the sleep was over the picture was on screen. Renders happen in a
 * worker now, so the debounce and the render are two waits in series and the
 * second one is as long as the pattern is expensive — string art solves for the
 * better part of a second. A sleep long enough for that would be a sleep in
 * every test.
 *
 * So it watches the thing it actually cares about instead: the preview's `src`
 * has to stop changing and stay stopped. The quiet period is longer than the
 * editor's longest debounce (260ms), so a render that has not started yet
 * cannot be mistaken for one that has finished.
 */
export async function settled(page: Page): Promise<void> {
  const img = page.locator('main img[alt*="rendered with"]').first();
  // Not every page that waits to settle has a preview on it — the gallery and
  // /setup both call this — so a missing one is "nothing to wait for" rather
  // than something to block on. Without the short timeout and this fallback,
  // those pages waited out the locator's own 30s instead.
  try {
    await img.waitFor({ state: 'attached', timeout: 1500 });
  } catch {
    await page.waitForTimeout(400);
    return;
  }

  const QUIET_MS = 450;
  const deadline = Date.now() + 25_000;
  let last: string | null = null;
  let since = 0;

  for (;;) {
    const src = (await img.getAttribute('src')) ?? '';
    const now = Date.now();
    if (src.length > 0 && src === last) {
      if (since === 0) since = now;
      if (now - since >= QUIET_MS) return;
    } else {
      last = src;
      since = 0;
    }
    // Give up rather than hang: a preview that never settles is a failure the
    // assertion that follows should report, not one this helper should.
    if (now > deadline) return;
    await page.waitForTimeout(70);
  }
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(buf: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(signature)) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
