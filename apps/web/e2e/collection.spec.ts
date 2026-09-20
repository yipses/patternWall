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
    await expect(page.getByTestId('selection-bar')).toContainText('Select all');
    // Nothing to act on yet, so neither action is live.
    await expect(page.getByTestId('delete-selected')).toBeDisabled();
    await expect(page.getByTestId('export-selected')).toBeDisabled();

    await tile(page, 'alpha').click();
    await tile(page, 'charlie').click();
    await expect(tile(page, 'alpha')).toHaveAttribute('aria-pressed', 'true');
    await expect(tile(page, 'bravo')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('selection-bar')).toContainText('2 selected');

    // The export is the selection, not the collection, and the settings are a
    // level inside the sheet rather than a disclosure under the grid.
    await page.getByTestId('export-selected').click();
    await expect(page.getByTestId('export-run')).toHaveText('Export 2');
    await expect(page.getByTestId('export-summary')).toBeVisible();

    await page.getByTestId('export-summary').click();
    await expect(page.getByLabel('Device')).toBeVisible();
    await page.getByTestId('export-back').click();
    await expect(page.getByTestId('export-run')).toBeVisible();
  });

  test('select all, then none', async ({ page }) => {
    await page.goto('/collected');
    await page.getByTestId('select-start').click();
    // One slot, both jobs: it offers Select all at zero and clears once there
    // is something to clear.
    await page.getByTestId('select-toggle-all').click();
    await expect(page.getByTestId('selection-bar')).toContainText('3 selected');
    await page.getByTestId('select-toggle-all').click();
    await expect(page.getByTestId('selection-bar')).toContainText('Select all');
  });

  test('a long press enters select mode with that tile picked, and does not open it', async ({ page }) => {
    await page.goto('/m/collected');
    const tile = page.getByRole('link', { name: /seed bravo$/ });
    const box = (await tile.boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Past the 450ms hold, and without moving, so it is a press and not a
    // scroll that happened to start on a picture.
    await page.waitForTimeout(700);
    await page.mouse.up();

    await expect(page.getByTestId('selection-bar')).toContainText('1 selected');
    await expect(page.getByRole('button', { name: /seed bravo$/ })).toHaveAttribute('aria-pressed', 'true');
    // And the link the press started on did not navigate.
    await expect(page).toHaveURL(/\/m\/collected/);
  });

  test('a press that travels is a scroll, not a selection', async ({ page }) => {
    await page.goto('/m/collected');

    // This assertion is what makes the one below mean anything. Chromium
    // starts a native drag when a pointer moves off a link or an image, and a
    // native drag fires `pointercancel` -- which ends the press being timed.
    // With the tile draggable, the test passes against a slop threshold that
    // has been deleted outright, which is exactly what it did before this line
    // was here. Both the anchor and the picture inside it have to say no.
    await expect(page.getByRole('link', { name: /seed bravo$/ })).toHaveAttribute('draggable', 'false');
    await expect(page.getByRole('link', { name: /seed bravo$/ }).locator('img')).toHaveAttribute('draggable', 'false');

    const box = (await page.getByRole('link', { name: /seed bravo$/ }).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 40, { steps: 6 });
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });

  test('deleting one does not ask, and the undo covers it', async ({ page }) => {
    await page.goto('/collected');
    await page.getByTestId('select-start').click();
    await tile(page, 'bravo').click();
    await page.getByTestId('delete-selected').click();
    // No confirm for one: an undo already covers the only mistake available.
    await expect(page.getByTestId('confirm-bar')).toHaveCount(0);
    await expect(page.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByTestId('undo-delete')).toBeVisible();
  });

  test('a multi-delete can be called off with nothing removed', async ({ page }) => {
    await page.goto('/collected');
    await page.getByTestId('select-start').click();
    await tile(page, 'alpha').click();
    await tile(page, 'bravo').click();
    await page.getByTestId('delete-selected').click();
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByRole('listitem')).toHaveCount(3);
    await expect(page.getByTestId('selection-bar')).toContainText('2 selected');
  });

  test('the selection goes to the platform share sheet when there is one', async ({ page }) => {
    // Headless Chromium has no share target, so the branch is exercised by
    // standing one up. This is the path that matters on iOS: it offers
    // "Save N Images" and they land in Photos, which is the only place a
    // wallpaper can be set from. A zip in Files is a dead end there.
    await page.addInitScript(() => {
      const w = window as unknown as { __shared?: number };
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(navigator, 'share', {
        value: (data: { files?: File[] }) => {
          w.__shared = data.files?.length ?? 0;
          return Promise.resolve();
        },
        configurable: true,
      });
      // And a coarse pointer, because that is what decides it. A share target
      // alone is not a phone.
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q: string) =>
        q.includes('pointer: coarse') ? ({ ...real(q), matches: true } as MediaQueryList) : real(q);
    });
    await page.goto('/m/collected');
    await page.getByTestId('select-start').click();
    await tile(page, 'alpha').click();
    await tile(page, 'charlie').click();
    await page.getByTestId('export-selected').click();

    // Small, so the suite stays quick.
    await page.getByTestId('export-summary').click();
    await page.getByLabel('Device').selectOption('custom');
    await page.getByLabel('Width').fill('120');
    await page.getByLabel('Height').fill('260');
    await page.getByTestId('export-back').click();

    await page.getByTestId('export-run').click();
    await expect(page.getByText('handed to your device')).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => (window as unknown as { __shared?: number }).__shared)).toBe(2);

    // And there is a way past the platform's sheet that is not trying again.
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('export-save-instead').click();
    expect((await downloadPromise).suggestedFilename()).toMatch(/\.zip$/);
  });

  test('a desktop downloads rather than sharing, even where it could share', async ({ page }) => {
    // `canShare` is not the question. macOS Safari answers yes and then offers
    // Messages, Mail, AirDrop and Copy — no Photos, no Save to Files, because
    // those are not share targets on a Mac. Sharing there loses the one thing a
    // desktop is good at, and that is what shipped before this.
    await page.addInitScript(() => {
      const w = window as unknown as { __shared?: number };
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(navigator, 'share', {
        value: (data: { files?: File[] }) => {
          w.__shared = data.files?.length ?? 0;
          return Promise.resolve();
        },
        configurable: true,
      });
    });
    await page.goto('/m/collected');
    await page.getByTestId('select-start').click();
    await tile(page, 'alpha').click();
    await tile(page, 'charlie').click();
    await page.getByTestId('export-selected').click();
    await page.getByTestId('export-summary').click();
    await page.getByLabel('Device').selectOption('custom');
    await page.getByLabel('Width').fill('120');
    await page.getByLabel('Height').fill('260');
    await page.getByTestId('export-back').click();

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('export-run').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    expect(await page.evaluate(() => (window as unknown as { __shared?: number }).__shared)).toBeUndefined();
  });

  test('one wallpaper is never a zip', async ({ page }) => {
    await page.goto('/m/collected');
    await page.getByTestId('select-start').click();
    await tile(page, 'alpha').click();
    await page.getByTestId('export-selected').click();
    await page.getByTestId('export-summary').click();
    await page.getByLabel('Device').selectOption('custom');
    await page.getByLabel('Width').fill('120');
    await page.getByLabel('Height').fill('260');
    await page.getByTestId('export-back').click();

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('export-run').click();
    const download = await downloadPromise;
    // A single PNG, not an archive somebody has to unpack for no reason.
    expect(download.suggestedFilename()).toMatch(/\.png$/);
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
    await page.getByTestId('select-toggle-all').click();
    await page.getByTestId('delete-selected').click();
    // Three at once asks first. This is the Select-all-then-trash case, which
    // is the whole collection in two taps.
    await expect(page.getByTestId('confirm-bar')).toContainText('Delete 3 wallpapers');
    await page.getByTestId('confirm-delete').click();
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

    test('a tile is the shape of the screen, not the shape of its render spec', async ({ page }) => {
      await page.goto('/collected');
      const img = page.getByRole('listitem').first().locator('img');
      const box = (await img.boundingBox())!;
      const want = await page.evaluate(() => window.screen.height / window.screen.width);

      // The guard that was missing. The old test asserted the tile's *width*
      // and nothing else, so it passed against a thumbnail 477px tall in a
      // 111px column -- the `height` attribute on the element is a specified
      // height, and `aspect-ratio` only fills in a dimension that is absent.
      expect(Math.abs(box.height / box.width - want)).toBeLessThan(0.03);

      // And the rendered picture is that shape too, so the tile is the
      // wallpaper rather than a crop of a differently-shaped one.
      //
      // Worth stating what this cannot see: the test viewport's screen is
      // 390x844, which is 2.164, and the old fixed 9:19.5 spec was 2.167. Those
      // are the same number to any bound loose enough to survive rounding, so
      // this catches a render at the wrong shape and not a render that happens
      // to be a phone of almost exactly this shape. It is a guard against
      // regression, not evidence the spec follows the device.
      const spec = await img.evaluate((el: HTMLImageElement) => el.naturalHeight / el.naturalWidth);
      expect(Math.abs(spec - want)).toBeLessThan(0.03);
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

  test('the phone collection is pictures and a rail, and a tile goes back to /m', async ({ page }) => {
    await page.goto('/m/collected');

    // No heading, no explanation, no site header: every word is a row of
    // pictures not shown. What a heading would have said is the rail.
    // There is a landmark heading and it is not drawn. `pw-visually-hidden`
    // clips rather than hides, so Playwright reports it visible -- asserting
    // "not visible" passes only against a heading that is display:none, which
    // is the one thing it must not be.
    await expect(page.getByRole('heading', { level: 1 })).toHaveClass(/pw-visually-hidden/);
    await expect(page.getByText('kept in this browser')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByTestId('collected-rail')).toBeVisible();
    await expect(page.getByTestId('collected-back')).toBeVisible();

    // And no export in browse mode: exporting is an operation on a selection.
    await expect(page.getByTestId('export-collection')).toHaveCount(0);

    await page.getByRole('link', { name: /seed bravo$/ }).click();
    await expect(page).toHaveURL(/\/m\/?\?g=truchet-diagonals/);
    await expect(page.locator('img[src^="data:image/svg"]').first()).toBeVisible();
  });

  test('the phone collection stays a phone in a desktop window', async ({ page }) => {
    // `/m` is the phone experience whatever the window is -- it draws the
    // picture at the device's shape and lets black take the rest. The
    // collection reached from its book has to match, or a wide window hands
    // back the desktop page, which is what was reported.
    await page.goto('/m/collected');
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

  test('a tile leaves the address bar naming the page it went to', async ({ page }) => {
    await page.goto('/m/collected');
    await page.getByRole('link', { name: /seed bravo$/ }).click();
    await expect(page).toHaveURL(/\/m\/\?g=truchet-diagonals/);

    // Past the editor's 220ms URL debounce, which is where this went wrong:
    // the base was captured during the first render, and on a soft navigation
    // React renders the new tree before the router pushes history, so it read
    // the page being left. It was right at +60ms and wrong at +400ms, and a
    // reload landed back on the collection.
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(/\/m\/\?g=truchet-diagonals/);

    // And the address really is the page: reloading it stays on the wallpaper.
    await page.reload();
    await expect(page.getByTestId('preview-book')).toBeVisible();
    await expect(page.getByTestId('collected-rail')).toHaveCount(0);
  });

  test('the site collection keeps its heading, and a tile goes to the editor route', async ({ page }) => {
    await page.goto('/collected');
    await expect(page.getByRole('heading', { level: 1, name: 'Collected' })).toBeVisible();
    await expect(page.getByTestId('collected-rail')).toHaveCount(0);
    await expect(page.getByTestId('collected-back')).toHaveCount(0);
    await page.getByRole('link', { name: /seed bravo$/ }).click();
    await expect(page).toHaveURL(/\/p\/truchet-diagonals/);
  });
});
