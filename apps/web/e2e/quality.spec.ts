import { expect, test } from '@playwright/test';
import { settled } from './helpers';

const PAGES = ['/', '/collected', '/setup', '/p/flow-dots', '/p/truchet'];

test.describe('layout and accessibility', () => {
  for (const width of [375, 768, 1440, 2560]) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of PAGES) {
        await page.goto(path);
        await settled(page);
        const overflow = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(overflow.scroll, `${path} at ${width}px scrolls horizontally`).toBeLessThanOrEqual(overflow.client + 1);
      }
    });
  }

  test('keyboard reaches the editor controls and operates them', async ({ page }) => {
    await page.goto('/p/truchet');
    await settled(page);

    // Tab forward until a slider takes focus, then move it with the keyboard.
    let reachedSlider = false;
    for (let i = 0; i < 60 && !reachedSlider; i++) {
      await page.keyboard.press('Tab');
      reachedSlider = await page.evaluate(() => {
        const el = document.activeElement as HTMLInputElement | null;
        return !!el && el.tagName === 'INPUT' && el.type === 'range';
      });
    }
    expect(reachedSlider, 'a slider was never reachable by Tab').toBe(true);

    const before = await page.evaluate(() => (document.activeElement as HTMLInputElement).value);
    await page.keyboard.press('ArrowRight');
    const after = await page.evaluate(() => (document.activeElement as HTMLInputElement).value);
    expect(after).not.toBe(before);

    // Every focusable element must show a focus ring rather than nothing.
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      return getComputedStyle(el).getPropertyValue('outline-style');
    });
    expect(['solid', 'auto']).toContain(outline);
  });

  test('the skip link is the first stop and jumps to the content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const text = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(text).toContain('Skip to content');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.location.hash === '#main');
    await expect(page.locator('#main')).toBeVisible();
  });

  test('tabs and switches expose the right roles and state', async ({ page }) => {
    await page.goto('/p/flow-dots');
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(page.getByRole('tab', { name: 'Pattern' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Palette' }).click();
    await expect(page.getByRole('tab', { name: 'Palette' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel').first()).toBeVisible();

    const zones = page.getByRole('switch', { name: /safe zone/i });
    await expect(zones).toHaveAttribute('aria-checked', 'false');
  });

  test('every page has a title, a description and one h1', async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page).toHaveTitle(/\S/);
      const description = await page.locator('meta[name="description"]').getAttribute('content');
      expect(description, `${path} description`).toBeTruthy();
      expect((description ?? '').length).toBeGreaterThan(40);
      await expect(page.getByRole('heading', { level: 1 }), `${path} h1`).toHaveCount(1);
    }
  });

  test('a favicon is served', async ({ page, request }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="icon"]').first().getAttribute('href');
    expect(href).toBeTruthy();
    const res = await request.get(href as string);
    expect(res.status()).toBe(200);
  });

  test('images that convey meaning carry alt text', async ({ page }) => {
    await page.goto('/');
    const alts = await page.locator('main img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).alt));
    expect(alts.length).toBeGreaterThan(0);
    for (const alt of alts) expect(alt.length).toBeGreaterThan(5);
  });

  // Seen failing twice, intermittently, with React's minified error #418 -- a
  // text hydration mismatch -- and passing on every attempt to reproduce it
  // since, including this exact sequence driven by hand at the same viewport.
  // It was not localised: no page produces it on a fresh load, the prerendered
  // HTML and the hydrated DOM differ only in the three places that are
  // deliberately upgraded after mount (the preview clock, its date, and the
  // build stamp), and nothing under app/ reads Date, Math.random or the window
  // during render. If it reappears, capture which page and whether stored state
  // was present, and do not assume the change you are making is the cause --
  // both sightings were during unrelated work.
  test('nothing is written to the console on a normal visit', async ({ page }) => {
    const noisy: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'log' || m.type() === 'info' || m.type() === 'error') noisy.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => noisy.push(`pageerror: ${e.message}`));
    await page.goto('/');
    await page.goto('/p/phyllotaxis');
    await settled(page);
    await page.getByRole('tab', { name: 'Palette' }).click();
    await settled(page);
    expect(noisy).toEqual([]);
  });

  test('reduced motion is honoured', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/p/flow-dots');
    const duration = await page.evaluate(() => {
      const el = document.querySelector('button');
      return el ? getComputedStyle(el).transitionDuration : '';
    });
    // Chromium reports the 0.001ms override as "1e-06s".
    expect(Number.parseFloat(duration)).toBeLessThan(0.01);
  });

  test('every page carries a build stamp', async ({ page }) => {
    // The stamp exists so a reader can tell whether they are looking at the
    // version that was just published. A green deploy is not proof the site
    // changed, so the page has to be able to answer that itself.
    for (const path of ['/', '/collected', '/setup', '/p/truchet']) {
      await page.goto(path);
      const stamp = page.getByTestId('build-stamp');
      await expect(stamp).toBeVisible();
      const iso = await stamp.locator('time').getAttribute('datetime');
      expect(iso).toBeTruthy();
      // A real, recent, parseable instant — not a placeholder.
      const when = new Date(iso ?? '').getTime();
      expect(Number.isNaN(when)).toBe(false);
      expect(when).toBeGreaterThan(Date.now() - 1000 * 60 * 60 * 24);
      expect(when).toBeLessThan(Date.now() + 1000 * 60 * 5);
    }
  });
});
