import { expect, test } from '@playwright/test';
import { curatedPalettes, defaultParams, generators, renderToSvg } from '@patternwall/core';
import { previewSrc, settled } from './helpers';

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
    await page.goto('/p/truchet');
    await settled(page);
    const before = await previewSrc(page);

    const slider = page.getByLabel('Grid density');
    await slider.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    await settled(page);

    const after = await previewSrc(page);
    expect(after).not.toBe(before);
    await expect(page.locator('text=/^14$/').first()).toBeVisible();
  });

  test('the seed field and shuffle both change the render', async ({ page }) => {
    await page.goto('/p/phyllotaxis');
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
    await page.goto('/p/truchet');
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
    await page.goto('/p/truchet');
    await settled(page);

    await page.getByTestId('seed-input').fill('half-typed');
    await page.getByTestId('shuffle-seed').click();
    await settled(page);

    await expect(page.getByTestId('seed-input')).not.toHaveValue('half-typed');
    expect(page.url()).not.toContain('s=half-typed');
  });

  test('the share URL round-trips to an identical render', async ({ page, context }) => {
    await page.goto('/p/ridgelines');
    await settled(page);

    await page.getByRole('slider', { name: 'Line count' }).focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await page.getByRole('slider', { name: 'Amplitude', exact: true }).focus();
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
    await page.goto('/p/flow-dots?s=&q=nonsense_values&c=~zzzz');
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
    await page.goto('/p/flow-dots');
    await page.waitForFunction(() => typeof window.patternwall?.render === 'function');
    const g = generators.find((x) => x.id === 'flow-dots')!;
    const palette = curatedPalettes.find((p) => p.id === 'obsidian')!;
    const params = defaultParams(g) as Record<string, number | string | boolean>;
    const fromBrowser = await page.evaluate(
      (i) => window.patternwall!.render(i),
      { generatorId: 'flow-dots', seed: 'flowdots-001', width: 460, height: 997, bleed: 0.08, paletteId: 'obsidian', params },
    );
    const fromNode = renderToSvg({ generator: g, width: 460, height: 997, palette, params, seed: 'flowdots-001', bleed: 0.08 });
    expect(fromBrowser).toBe(fromNode);

    // …and that is exactly what the preview element is showing.
    await settled(page);
    const src = await previewSrc(page);
    const decoded = Buffer.from(src.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf8');
    expect(decoded).toBe(fromNode);
  });

  test('preview modes, safe zones and collecting all work', async ({ page }) => {
    await page.goto('/p/truchet');
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
    await page.getByRole('link', { name: /saved/ }).click();
    await expect(page).toHaveURL(/\/collected/);
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await page.getByRole('button', { name: /Remove the saved/ }).click();
    await expect(page.getByText('Nothing collected yet.')).toBeVisible();
  });

  test('the palette panel applies a library palette and shows warnings', async ({ page }) => {
    await page.goto('/p/flow-dots');
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
    await page.goto('/p/flow-dots');
    await settled(page);
    const related = page.getByRole('heading', { name: 'Related patterns' });
    await expect(related).toBeVisible();
    await page.getByRole('link', { name: /Ridgelines/ }).first().click();
    await expect(page).toHaveURL(/\/p\/ridgelines/);
  });

  test('copy link puts a restorable URL on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/p/phyllotaxis');
    await settled(page);
    await page.getByTestId('copy-link').click();
    await expect(page.getByTestId('copy-link')).toHaveText('Link copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('/p/phyllotaxis?');
    expect(copied).toContain('c=');
  });

  test('a select commits the value just chosen, not the previous one', async ({ page }) => {
    // Regression: selects fire onChange and onCommit in the same event, so a
    // commit that read React state instead of a synchronously-written ref
    // settled the value the control had just replaced. The preview and the URL
    // sat one change behind, and picking "Triangles" drew the previous set.
    await page.goto('/p/truchet');
    const select = page.getByLabel('Tile set');
    const marks = async () => {
      const src = await page.locator('img[src^="data:image/svg"]').first().getAttribute('src');
      const svg = Buffer.from((src ?? '').split(';base64,')[1] ?? '', 'base64').toString('utf8');
      return { poly: (svg.match(/<polygon/g) ?? []).length, path: (svg.match(/<path/g) ?? []).length };
    };
    // Triangles are the only tile set drawn as polygons, so they are a clean
    // fingerprint for "the render matches the control". Stepping through all
    // three also pins their encoded order, which is what a share link stores.
    await select.selectOption('diagonals');
    await expect.poll(async () => (await marks()).poly).toBe(0);
    await expect(page).toHaveURL(/q=[^&]*_1_/);
    await select.selectOption('triangles');
    await expect.poll(async () => (await marks()).path).toBe(0);
    expect((await marks()).poly).toBeGreaterThan(0);
    await expect(page).toHaveURL(/q=[^&]*_2_/);
    await select.selectOption('arcs');
    await expect.poll(async () => (await marks()).poly).toBe(0);
    await expect(page).toHaveURL(/q=[^&]*_0_/);
  });
});
