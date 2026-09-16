import { expect, test } from '@playwright/test';
import { generators } from '@patternwall/core';
import { previewSrc, settled } from './helpers';

/**
 * `/m` — the preview, and nothing around it.
 *
 * Every control here already existed on `/p/<id>`; what this route removes is
 * the page. So these tests are about the removal and about the canvas, not
 * about the gestures, which `gesture.spec.ts` already owns.
 */
test.describe('phone view', () => {
  test('has no chrome at all', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/m');
    await settled(page);
    // The site's header and footer come from the `(site)` layout, which this
    // route is deliberately not under. If they come back, the picture stops
    // being the whole screen and this is the cheapest way to hear about it.
    await expect(page.locator('header')).toHaveCount(0);
    await expect(page.locator('footer')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Gallery' })).toHaveCount(0);
    // The rail is the exception: it is the point.
    await expect(page.getByTestId('preview-settings')).toBeVisible();
  });

  test('the picture fills the screen on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/m');
    await settled(page);
    const box = await page.locator('img[alt*="rendered with"]').first().boundingBox();
    expect(box).not.toBeNull();
    // Edge to edge, within a pixel of rounding. Not "close to" — a wallpaper
    // that stops short of the edge is the thing this route exists to avoid.
    expect(Math.round(box!.width)).toBe(390);
    expect(Math.round(box!.height)).toBe(844);
    expect(Math.round(box!.x)).toBe(0);
  });

  test('is a phone on a desktop, not a very wide wallpaper', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/m');
    await settled(page);
    const box = await page.locator('img[alt*="rendered with"]').first().boundingBox();
    expect(box).not.toBeNull();
    // Portrait and well short of the window, so black shows either side. A
    // desktop reports a landscape `screen`, and taking that literally is what
    // this guards against: it rendered 1440x857 before the fallback existed.
    expect(box!.height).toBeGreaterThan(box!.width * 1.8);
    expect(box!.width).toBeLessThan(700);
  });

  test('the canvas is shaped by the device, not by a fixed 9:19.5', async ({ page }) => {
    // A squarer phone. The render has to follow it, or `/m` is showing a
    // wallpaper for a handset nobody is holding.
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/m');
    await settled(page);
    const natural = await page
      .locator('img[alt*="rendered with"]')
      .first()
      .evaluate((el) => ({ w: (el as HTMLImageElement).naturalWidth, h: (el as HTMLImageElement).naturalHeight }));
    const ratio = natural.h / natural.w;
    expect(ratio).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(1.9);
    // 9:19.5 is 2.167, which is what it would be if the device were ignored.
    expect(Math.abs(ratio - 19.5 / 9)).toBeGreaterThan(0.2);
  });

  test('opens the pattern named in the link', async ({ page }) => {
    const second = generators[1]!;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/m?g=${second.id}`);
    await settled(page);
    await expect(page.locator('img[alt*="rendered with"]').first()).toHaveAttribute('alt', new RegExp(second.name));
  });

  test('keeps the pattern in the URL rather than navigating away from /m', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/m');
    await settled(page);
    const before = await previewSrc(page);

    // A tap on the picture moves to the next pattern. The URL has to follow it
    // without leaving this route: the editor writes `p/<id>/`, and doing that
    // here would send `/m` to `/m/p/<id>/`, which is a 404.
    const box = await page.locator('img[alt*="rendered with"]').first().boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await settled(page);

    expect(await previewSrc(page)).not.toBe(before);
    await expect(page).toHaveURL(/\/m\/?\?/);
    await expect(page).toHaveURL(/[?&]g=/);
  });
});
