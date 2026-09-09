import type { Page } from '@playwright/test';

/** The data URL of the pattern currently shown in the editor preview. */
export async function previewSrc(page: Page): Promise<string> {
  const img = page.locator('main img[alt*="rendered with"]').first();
  await img.waitFor({ state: 'attached' });
  return (await img.getAttribute('src')) ?? '';
}

/** Wait until the preview has settled on a full-quality render. */
export async function settled(page: Page): Promise<void> {
  await page.waitForTimeout(700);
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(buf: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(signature)) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
