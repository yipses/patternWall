import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

  /**
   * The WAI-ARIA tabs pattern, which the hand-rolled strips did not follow:
   * every tab was a tab stop, aria-controls pointed at panels that are only in
   * the DOM when selected, and the panels were not focusable.
   */
  test('the tab strip is one tab stop and the arrows move between tabs', async ({ page }) => {
    await page.goto('/p/flow-dots');
    await settled(page);

    // Scoped to the editor's own strip: opening the Palette panel reveals a
    // second tablist inside it, and both are legitimately selected.
    const strip = page.getByRole('tablist', { name: 'Editor panels' });
    const selected = () => strip.locator('[role="tab"][aria-selected="true"]');
    await expect(selected()).toHaveText('Pattern');

    // One stop for the whole strip: the unselected tabs are not tabbable.
    const tabStops = await strip.locator('[role="tab"]').evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).tabIndex),
    );
    expect(tabStops.filter((t) => t === 0), `tab stops in the strip: ${tabStops.join(',')}`).toHaveLength(1);

    // Arrows move selection and carry focus with it.
    await selected().focus();
    await page.keyboard.press('ArrowRight');
    await expect(selected()).toHaveText('Palette');
    await expect(selected()).toBeFocused();
    await page.keyboard.press('End');
    await expect(selected()).toHaveText('Export');
    await page.keyboard.press('Home');
    await expect(selected()).toHaveText('Pattern');
    // Wrapping, so the strip has no dead end.
    await page.keyboard.press('ArrowLeft');
    await expect(selected()).toHaveText('Export');

    // aria-controls only where it resolves, and the panel it names is focusable.
    const controls = await selected().getAttribute('aria-controls');
    expect(controls, 'the selected tab names no panel').toBeTruthy();
    const panel = page.locator(`#${controls}`);
    await expect(panel).toHaveAttribute('role', 'tabpanel');
    await expect(panel).toHaveAttribute('tabindex', '0');
    for (const el of await strip.locator('[role="tab"][aria-selected="false"]').all()) {
      expect(await el.getAttribute('aria-controls'), 'an unselected tab points at a panel that is not rendered').toBeNull();
    }
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

  /**
   * The build stamp has to be ONE value, not two that happen to agree.
   *
   * Next evaluates next.config.mjs more than once per build, and a bare
   * `new Date()` there gave the prerendered HTML an earlier instant than the
   * client bundle -- 3.6s to 11.3s earlier, measured over six builds. Since the
   * footer renders it to the minute, the two agreed almost always and diverged
   * exactly when the loads straddled a minute boundary: a text hydration
   * mismatch on roughly 6% of warm builds and 19% of cold ones, which is what
   * the intermittent React #418 in this suite turned out to be.
   *
   * The symptom is a bad thing to test -- it only appears a few percent of the
   * time. The cause is not: read both stamps out of the built export and
   * require them to be identical. This fails on every straddled build and, more
   * usefully, on every non-straddled one too.
   */
  test('the build stamp is one value, not two that usually agree', () => {
    const out = join(__dirname, '..', 'out');
    const ISO = /20\d\d-\d\d-\d\dT[\d:.]+Z/g;

    const html = readFileSync(join(out, 'index.html'), 'utf8').match(ISO) ?? [];
    expect(html.length, 'no build stamp found in the prerendered HTML').toBeGreaterThan(0);

    const chunks = join(out, '_next', 'static', 'chunks');
    const fromJs = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) for (const m of readFileSync(full, 'utf8').match(ISO) ?? []) fromJs.add(m);
      }
    };
    walk(chunks);
    expect(fromJs.size, 'no build stamp found in the client bundle').toBeGreaterThan(0);

    const all = new Set([...html, ...fromJs]);
    expect(
      [...all],
      `the prerendered HTML and the client bundle disagree about the build time: ${[...all].join(' vs ')}`,
    ).toHaveLength(1);
  });
});
