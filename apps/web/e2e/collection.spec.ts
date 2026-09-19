import { expect, test, type Page } from '@playwright/test';

/**
 * The collection, driven the way a phone drives it.
 *
 * Browse mode has no controls on a tile — the tile is the link — and select
 * mode turns every tile into a checkbox and puts delete and export in one bar.
 * That split exists because of the arithmetic: at 390px a three-column tile is
 * 111px wide, and a trash button plus a tick is two 44px targets on top of the
 * picture they are about.
 */

const PALETTE = {
  id: 'obsidian',
  name: 'Obsidian',
  background: '#0b0b0d',
  ink: '#f4f2ec',
  accents: ['#ff7a3d'],
  mode: 'dark',
  tags: [],
};

const seedCollection = async (page: Page) => {
  await page.addInitScript((p) => {
    // Only if there is nothing there. `addInitScript` runs on every navigation,
    // so an unguarded write re-seeds storage on a reload -- which silently made
    // the undo-persistence assertion below pass against an undo that never
    // reached localStorage at all.
    if (window.localStorage.getItem('patternwall.collected.v1')) return;
    window.localStorage.setItem(
      'patternwall.collected.v1',
      JSON.stringify([
        // savedAt deliberately disagrees with list order, so an undo that
        // rebuilt the list by sorting on it would come back bravo, charlie,
        // alpha and the order assertion below would see it.
        { id: 'one', generatorId: 'truchet-arcs', seed: 'alpha', params: {}, savedAt: 1, palette: p },
        { id: 'two', generatorId: 'truchet-diagonals', seed: 'bravo', params: {}, savedAt: 3, palette: p },
        { id: 'three', generatorId: 'contours', seed: 'charlie', params: {}, savedAt: 2, palette: p },
      ]),
    );
  }, PALETTE);
};

const tile = (page: Page, seed: string) =>
  page.getByRole('button', { name: new RegExp(`seed ${seed}$`) });

test.describe('the collection', () => {
  test.beforeEach(async ({ page }) => {
    await seedCollection(page);
  });

  test('browse mode puts no controls on a tile', async ({ page }) => {
    await page.goto('/collected');
    await expect(page.getByRole('listitem')).toHaveCount(3);
    // Every tile is a link and nothing else. The old version carried a Remove
    // button per item, which does not fit beside a tick at phone width.
    await expect(page.getByRole('listitem').first().getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('listitem').first().getByRole('link')).toHaveCount(1);
  });

  test('select mode ticks tiles and scopes the export to them', async ({ page }) => {
    await page.goto('/collected');
    await expect(page.getByTestId('export-collection')).toHaveText(/Export all 3 as a zip/);

    await page.getByTestId('select-start').click();
    await expect(page.getByTestId('selection-bar')).toContainText('None selected');
    // Nothing to act on yet, so neither action is live.
    await expect(page.getByTestId('delete-selected')).toBeDisabled();
    await expect(page.getByTestId('export-selected')).toBeDisabled();

    await tile(page, 'alpha').click();
    await tile(page, 'charlie').click();
    await expect(tile(page, 'alpha')).toHaveAttribute('aria-pressed', 'true');
    await expect(tile(page, 'bravo')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('selection-bar')).toContainText('2 selected');

    // The export is the selection, not the collection. This is the whole point
    // of the mode: CollectionExport zips whatever items it is handed.
    await page.getByTestId('export-selected').click();
    await expect(page.getByTestId('export-collection')).toHaveText(/Export 2 as a zip/);
  });

  test('select all, then none', async ({ page }) => {
    await page.goto('/collected');
    await page.getByTestId('select-start').click();
    await page.getByRole('button', { name: 'Select all' }).click();
    await expect(page.getByTestId('selection-bar')).toContainText('3 selected');
    await page.getByRole('button', { name: 'Select none' }).click();
    await expect(page.getByTestId('selection-bar')).toContainText('None selected');
  });

  test('leaving select mode is on the bar, not in a header that scrolls away', async ({ page }) => {
    await page.goto('/collected');
    await page.getByTestId('select-start').click();
    // The header is gone after the first row of a 240px-tall tile, so a Done
    // that lives up there is a mode you cannot leave without scrolling back.
    await expect(page.getByTestId('selection-bar').getByTestId('select-done')).toBeVisible();
    await page.getByTestId('select-done').click();
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
    await expect(page.getByTestId('select-start')).toBeVisible();
  });

  test('delete acts on the selection and undo puts it back, in order', async ({ page }) => {
    await page.goto('/collected');
    await page.getByTestId('select-start').click();
    await tile(page, 'bravo').click();
    await page.getByTestId('delete-selected').click();

    await expect(page.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByText('1 removed.')).toBeVisible();

    await page.getByTestId('undo-delete').click();
    await expect(page.getByRole('listitem')).toHaveCount(3);

    // The restore has to reach storage, not just the component. It also has to
    // restore the *order*: the list is insertion order and savedAt is a
    // day-resolution display value that cannot rebuild it.
    await page.reload();
    const seeds = await page.getByRole('listitem').allInnerTexts();
    expect(seeds.map((t) => t.match(/· (\w+)/)?.[1])).toEqual(['alpha', 'bravo', 'charlie']);
  });

  test('deleting everything leaves the empty state rather than an empty grid', async ({ page }) => {
    await page.goto('/collected');
    await page.getByTestId('select-start').click();
    await page.getByRole('button', { name: 'Select all' }).click();
    await page.getByTestId('delete-selected').click();
    await expect(page.getByText('Nothing collected yet.')).toBeVisible();
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });

  test.describe('at phone width', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('three columns, wide enough to recognise, with no text under them', async ({ page }) => {
      await page.goto('/collected');
      const grid = page.getByTestId('collected-grid');
      const tracks = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(/\s+/).length);
      expect(tracks).toBe(3);

      const box = await page.getByRole('listitem').first().boundingBox();
      // A recognisable wallpaper rather than a stripe. Two columns would give
      // a 375px-tall tile and barely one and a half rows on this screen.
      expect(box!.width).toBeGreaterThan(100);

      // No tags. The picture's alt text still carries pattern, palette and seed.
      await expect(page.getByText('Obsidian · alpha')).toBeHidden();
      await expect(page.getByRole('link', { name: /seed alpha$/ })).toBeVisible();
    });

    test('the page scrolls clear of the fixed selection bar', async ({ page }) => {
      await page.goto('/collected');
      await page.getByTestId('select-start').click();
      await page.mouse.wheel(0, 4000);
      const bar = await page.getByTestId('selection-bar').boundingBox();
      const last = await page.getByRole('listitem').last().boundingBox();
      // The last row has to end above the bar, or the bottom of the collection
      // is unreachable behind it.
      expect(last!.y + last!.height).toBeLessThan(bar!.y);
    });
  });

  test('opened from the phone view, a tile goes back to the phone view', async ({ page }) => {
    await page.goto('/collected?from=m');
    await expect(page.getByTestId('collected-back')).toBeVisible();

    await page.getByRole('link', { name: /seed bravo$/ }).click();
    await expect(page).toHaveURL(/\/m\/?\?g=truchet-diagonals/);
    await expect(page.locator('img[src^="data:image/svg"]').first()).toBeVisible();
  });

  test('opened from the phone view, it stays a phone in a desktop window', async ({ page }) => {
    // `/m` is the phone experience whatever the window is -- it draws the
    // picture at the device's shape and lets black take the rest. The
    // collection reached from its book has to match, or a wide window hands
    // back the desktop page, which is what was reported.
    await page.goto('/collected?from=m');
    const grid = page.getByTestId('collected-grid');
    expect(await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(/\s+/).length)).toBe(3);
    await expect(page.getByText('Obsidian · alpha')).toBeHidden();
    const box = await page.getByRole('listitem').first().boundingBox();
    expect(box!.width).toBeLessThan(160);

    // And the site's own collection at the same width is untouched: the phone
    // rules are scoped to the column, not turned on for everybody.
    await page.goto('/collected');
    expect(
      await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(/\s+/).length),
    ).toBeGreaterThan(3);
    await expect(page.getByText('Obsidian · alpha')).toBeVisible();
  });

  test('opened from the site, a tile goes to the editor route', async ({ page }) => {
    await page.goto('/collected');
    await expect(page.getByTestId('collected-back')).toHaveCount(0);
    await page.getByRole('link', { name: /seed bravo$/ }).click();
    await expect(page).toHaveURL(/\/p\/truchet-diagonals/);
  });
});
