import { expect, test } from '@playwright/test';
import { previewSrc, settled } from './helpers';

/**
 * The renderer runs in a worker, and the only honest way to know that is to
 * look for the worker.
 *
 * The client falls back to rendering inline whenever a worker cannot be had --
 * which is correct behaviour, and also exactly what a silently broken worker
 * looks like from the outside. The pictures would still be right, the editor
 * would still be slow, and nothing would say so. The bundler's worker chunk
 * pulls its dependencies with `importScripts`, whose URL is resolved at
 * runtime against the public path, and this app is served from a sub-path on
 * GitHub Pages; that is the specific thing most likely to break it.
 *
 * So both halves are asserted: a worker exists after a render, and the picture
 * it produced is a real one.
 */
test.describe('render worker', () => {
  test('draws later renders off the main thread', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);
    const before = await previewSrc(page);

    // The first render is deliberately inline -- it has to match the
    // prerendered HTML exactly or hydration fails -- so the worker is only
    // asked for anything once a control moves.
    const slider = page.getByLabel('Grid density');
    await slider.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await settled(page);

    const after = await previewSrc(page);
    expect(after, 'the render did not change').not.toBe(before);
    expect(after.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(after.length).toBeGreaterThan(2000);

    const workers = page.workers();
    expect(
      workers.length,
      'no worker was started, so the render fell back to the main thread',
    ).toBeGreaterThan(0);
  });

  test('the worker starts without console errors', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

    await page.goto('/p/contours');
    await settled(page);
    await page.getByTestId('seed-input').fill('worker-check');
    await settled(page);

    expect(await previewSrc(page)).toContain('data:image/svg+xml;base64,');
    expect(problems, problems.join('\n')).toHaveLength(0);
  });
});
