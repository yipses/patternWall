import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_BLEED, defaultParams, generators, initialConfig, renderToSvg, safeZonesForCanvas } from '@patternwall/core';
import { previewSrc, settled } from './helpers';

/**
 * The pattern select, by role rather than by label.
 *
 * `getByLabel('Pattern')` matches two things: this control, whose accessible
 * name is "TapPattern" because the gesture chip sits inside its label, and the
 * editor's own tab panel, which is named "Pattern" by its tab. Both are
 * legitimately called that, so the locator has to say which kind of thing it
 * wants rather than either of them being renamed.
 */
function patternSelect(page: Page) {
  return page.getByRole('combobox', { name: /Pattern/ });
}

test.describe('editor', () => {
  test('every pattern opens and renders', async ({ page }) => {
    for (const g of generators) {
      await page.goto(`/p/${g.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(g.name);
      await settled(page);
      const src = await previewSrc(page);
      expect(src.startsWith('data:image/svg+xml;base64,'), `${g.id} preview`).toBe(true);
      expect(src.length).toBeGreaterThan(2000);
      await expect(page.getByRole('heading', { name: `How ${g.name} works` })).toBeVisible();
    }
  });

  test('changing a parameter changes the render', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);
    const before = await previewSrc(page);

    // A promoted control: the ones that are not promoted live behind the gear
    // on the preview now, and this test is about the editor's plumbing rather
    // than about which slider was moved.
    const slider = page.getByLabel('Grid density');
    await slider.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    await settled(page);

    const after = await previewSrc(page);
    expect(after).not.toBe(before);
    // Asserted on the control rather than on loose page text: a bare "14"
    // could match anything, and what this is about is the value the slider
    // settled on.
    await expect(page.getByLabel('Grid density')).toHaveValue('14');
  });

  test('the seed field and shuffle both change the render', async ({ page }) => {
    await page.goto('/p/contours');
    await settled(page);
    const before = await previewSrc(page);

    await page.getByTestId('seed-input').fill('a-deliberate-seed');
    await settled(page);
    const typed = await previewSrc(page);
    expect(typed).not.toBe(before);

    await page.getByTestId('shuffle-seed').click();
    await settled(page);
    const shuffled = await previewSrc(page);
    expect(shuffled).not.toBe(typed);
    await expect(page.getByTestId('seed-input')).not.toHaveValue('a-deliberate-seed');
  });

  // Two controls touched inside one debounce window. The commit used to keep
  // only its newest argument, so the seed typed a moment earlier was dropped
  // and the field, the render and the share link stopped agreeing with each
  // other. Both of these have to interleave the two changes: doing either one
  // alone passes against the bug, which is why the suite missed it.
  test('a change to one control does not discard a pending change to another', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);

    // Starts a 260ms debounce; the slider lands well inside it.
    await page.getByTestId('seed-input').fill('mountain');
    const slider = page.getByLabel('Grid density');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await settled(page);

    await expect(page.getByTestId('seed-input')).toHaveValue('mountain');
    expect(page.url()).toContain('s=mountain');
  });

  test('shuffling the seed is not undone by the one being typed', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);

    await page.getByTestId('seed-input').fill('half-typed');
    await page.getByTestId('shuffle-seed').click();
    await settled(page);

    await expect(page.getByTestId('seed-input')).not.toHaveValue('half-typed');
    expect(page.url()).not.toContain('s=half-typed');
  });

  // Typed one character at a time, which is the only way to catch this: the
  // three-digit shorthand is valid, so `#1a2` used to commit mid-word, the
  // parent normalised it to `#11aa22`, and the effect that syncs the field
  // replaced the draft under the cursor. fill() sets the whole string in one
  // event and never sees it.
  test('a six-digit hex can be typed one character at a time', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await page.getByRole('tab', { name: 'Palette' }).click();
    await page.getByRole('tab', { name: 'Colours' }).click();
    const field = page.getByLabel('Background hex value');
    await field.click();
    await field.press('Control+a');
    await page.keyboard.type('#1a2b3c', { delay: 80 });
    await expect(field).toHaveValue('#1a2b3c');
    await expect(field).not.toHaveAttribute('aria-invalid', 'true');
  });

  /**
   * The overlay has to point at the band the generator actually quieted.
   *
   * It did not: the zones were positioned as fractions of the whole preview,
   * while generators compose against safeZonesForCanvas, which insets by the
   * bleed first. At the default 8% that put the clock outline 5.7% of the
   * canvas height above the real one -- the single feature whose job is to show
   * where the furniture lands, pointing at the wrong place.
   *
   * Measured against the DOM rather than against the formula, so this fails if
   * the overlay drifts for any reason, not only this one.
   */
  test('the safe-zone overlay lands where the generator quiets', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);
    await page.getByRole('switch', { name: 'Show the iOS safe zone outlines' }).click();

    const phone = await page.locator('[class*="phone"]').first().boundingBox();
    const clock = await page.getByTestId('zone-clock').boundingBox();
    expect(phone, 'no phone frame').toBeTruthy();
    expect(clock, 'no clock zone -- is the overlay switch on?').toBeTruthy();

    // Where the overlay draws it, as a fraction of the exported image.
    const drawnTop = (clock!.y - phone!.y) / phone!.height;
    const drawnBottom = (clock!.y + clock!.height - phone!.y) / phone!.height;

    // Where a generator asking for the same canvas is told the clock sits.
    const zones = safeZonesForCanvas(1000, 2000, DEFAULT_BLEED);
    const realTop = zones.clock.y / 2000;
    const realBottom = (zones.clock.y + zones.clock.h) / 2000;

    expect(drawnTop, `overlay top ${(drawnTop * 100).toFixed(1)}% vs generator ${(realTop * 100).toFixed(1)}%`).toBeCloseTo(realTop, 2);
    expect(drawnBottom, `overlay bottom ${(drawnBottom * 100).toFixed(1)}% vs generator ${(realBottom * 100).toFixed(1)}%`).toBeCloseTo(realBottom, 2);
  });

  test('the share URL round-trips to an identical render', async ({ page, context }) => {
    await page.goto('/p/chevron-blocks');
    await settled(page);

    await page.getByRole('slider', { name: 'Block size' }).focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await page.getByRole('slider', { name: 'Relief', exact: true }).focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    await page.getByTestId('seed-input').fill('share-me');
    await settled(page);

    const url = page.url();
    expect(url).toContain('s=share-me');
    const original = await previewSrc(page);

    const other = await context.newPage();
    await other.goto(url);
    await settled(other);
    const restored = await previewSrc(other);
    expect(restored).toBe(original);
    await other.close();
  });

  test('a malformed share URL recovers to defaults with a visible note', async ({ page }) => {
    await page.goto('/p/chevron-blocks?s=&q=nonsense_values&c=~zzzz');
    await settled(page);
    await expect(page.getByRole('status').or(page.getByRole('alert')).first()).toBeVisible();
    const src = await previewSrc(page);
    expect(src.length).toBeGreaterThan(2000);
  });

  test('an unknown pattern id gives a real 404 page', async ({ page }) => {
    const res = await page.goto('/p/not-a-real-pattern');
    expect(res?.status()).toBe(404);
    await expect(page.getByText('There is no pattern here.')).toBeVisible();
  });

  test('the browser render matches Node for the exact editor configuration', async ({ page }) => {
    await page.goto('/p/chevron-blocks');
    await page.waitForFunction(() => typeof window.patternwall?.render === 'function');
    const g = generators.find((x) => x.id === 'chevron-blocks')!;
    // The editor's own opening configuration, not a hardcoded one. The second
    // half of this test compares against what the preview is actually showing,
    // so naming a seed and a palette here only works while they happen to be
    // the ones the editor starts on — which they were for the pattern this
    // test used to run against, and are not for any other.
    const start = initialConfig(g.id);
    const palette = start.palette;
    const params = defaultParams(g) as Record<string, number | string | boolean>;
    const fromBrowser = await page.evaluate(
      (i) => window.patternwall!.render(i),
      { generatorId: g.id, seed: start.seed, width: 460, height: 997, bleed: 0.08, palette, params },
    );
    const fromNode = renderToSvg({ generator: g, width: 460, height: 997, palette, params, seed: start.seed, bleed: 0.08 });
    expect(fromBrowser).toBe(fromNode);

    // …and that is exactly what the preview element is showing.
    await settled(page);
    const src = await previewSrc(page);
    const decoded = Buffer.from(src.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf8');
    expect(decoded).toBe(fromNode);
  });

  test('preview modes, safe zones and collecting all work', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);

    await page.getByRole('button', { name: 'Home Screen' }).click();
    await expect(page.getByRole('button', { name: 'Home Screen' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Flat', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Flat', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Lock Screen' }).click();

    const zones = page.getByRole('switch', { name: /safe zone/i });
    await expect(zones).toHaveAttribute('aria-checked', 'false');
    await zones.click();
    await expect(zones).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Clock', { exact: true })).toBeVisible();

    await page.getByTestId('collect').click();
    await expect(page.getByTestId('collect')).toHaveText('Collected');
    await page.getByRole('link', { name: /^\d+ saved$/ }).click();
    await expect(page).toHaveURL(/\/collected/);
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await page.getByRole('button', { name: /Remove the saved/ }).click();
    await expect(page.getByText('Nothing collected yet.')).toBeVisible();
  });

  test('the palette panel applies a library palette and shows warnings', async ({ page }) => {
    await page.goto('/p/chevron-blocks');
    await settled(page);
    const before = await previewSrc(page);

    await page.getByRole('tab', { name: 'Palette' }).click();
    await page.getByRole('button', { name: 'Use the Riso Pink palette' }).click();
    await settled(page);
    expect(await previewSrc(page)).not.toBe(before);
    await expect(page.getByText('Riso Pink').first()).toBeVisible();

    await page.getByRole('tab', { name: 'Colours' }).click();
    const bgHex = page.getByLabel('Background hex value');
    await bgHex.fill('#101820');
    await settled(page);
    await expect(page.getByText('Custom').first()).toBeVisible();

    await bgHex.fill('not-a-colour');
    await expect(page.getByText('That is not a hex colour.')).toBeVisible();

    await page.getByRole('tab', { name: 'Harmony' }).click();
    await page.getByRole('button', { name: 'Use this palette' }).click();
    await settled(page);

    await page.getByRole('tab', { name: 'From a photo' }).click();
    await expect(page.getByLabel('Choose an image to extract a palette from')).toBeVisible();
  });

  test('related patterns link onward', async ({ page }) => {
    // Which pattern is related to which comes from the registry, not from
    // here. Naming one made this test a hostage to the tag list: adding a
    // pattern that shares a tag with chevron-blocks pushed the expected one out of
    // the top three and failed a test about navigation for a reason that had
    // nothing to do with navigation.
    const from = generators.find((g) => g.id === 'chevron-blocks')!;
    const target = generators
      .filter((g) => g.id !== from.id)
      .map((g) => ({ g, shared: g.tags.filter((t) => from.tags.includes(t)).length }))
      .sort((a, b) => b.shared - a.shared || a.g.name.localeCompare(b.g.name))[0]!.g;

    await page.goto(`/p/${from.id}`);
    await settled(page);
    await expect(page.getByRole('heading', { name: 'Related patterns' })).toBeVisible();
    await page.getByRole('link', { name: new RegExp(target.name) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/p/${target.id}`));
  });

  test('copy link puts a restorable URL on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/p/contours');
    await settled(page);
    await page.getByTestId('copy-link').click();
    await expect(page.getByTestId('copy-link')).toHaveText('Link copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('/p/contours/?');
    expect(copied).toContain('c=');
  });

  test('a select commits the value just chosen, not the previous one', async ({ page }) => {
    // Regression: selects fire onChange and onCommit in the same event, so a
    // commit that read React state instead of a synchronously-written ref
    // settled the value the control had just replaced. The preview and the URL
    // sat one change behind.
    //
    // The select this was written against was truchet's tile set, and the tile
    // sets are separate patterns now. The Pattern control is the select that
    // replaced it and it is a harder case, not an easier one: choosing a
    // pattern swaps the generator *and* its params in one go, so a stale read
    // would render one pattern's parameters through another's code.
    await page.goto('/p/truchet-arcs');
    await settled(page);
    const select = patternSelect(page);

    const marks = async () => {
      const src = await page.locator('img[src^="data:image/svg"]').first().getAttribute('src');
      const svg = Buffer.from((src ?? '').split(';base64,')[1] ?? '', 'base64').toString('utf8');
      return { rect: (svg.match(/<(polygon|rect)/g) ?? []).length, path: (svg.match(/<path/g) ?? []).length };
    };

    await select.selectOption('chevron-blocks');
    await expect(page).toHaveURL(/\/p\/chevron-blocks\//);
    await expect(page.getByLabel('Block size')).toBeVisible();
    await expect.poll(async () => (await marks()).rect).toBeGreaterThan(0);

    await select.selectOption('truchet-arcs');
    await expect(page).toHaveURL(/\/p\/truchet-arcs\//);
    await expect(page.getByLabel('Grid density')).toBeVisible();
    await expect.poll(async () => (await marks()).path).toBeGreaterThan(0);
  });
});
