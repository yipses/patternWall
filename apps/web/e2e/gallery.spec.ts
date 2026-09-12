import { expect, test } from '@playwright/test';
import { generators } from '@patternwall/core';

test.describe('gallery', () => {
  test('lists every generator in the registry with a live preview', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/PatternWall/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    for (const g of generators) {
      const card = page.getByRole('listitem').filter({ hasText: g.name });
      await expect(card, `card for ${g.id}`).toBeVisible();
      await expect(card.getByText(g.tagline)).toBeVisible();
      const img = card.locator('img').first();
      await expect(img).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
      // A real render, not a placeholder.
      const src = (await img.getAttribute('src')) ?? '';
      expect(src.length).toBeGreaterThan(2000);
    }
    expect(await page.getByRole('listitem').count()).toBe(generators.length);
  });

  test('filters by tag and offers a way out of an empty result', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'grid', exact: true }).click();
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('listitem').first()).toContainText('Truchet');

    await page.getByRole('button', { name: 'organic', exact: true }).click();
    await expect(page.getByRole('listitem')).toHaveCount(0);
    await expect(page.getByText(/Nothing matches all of those tags/)).toBeVisible();

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('listitem')).toHaveCount(generators.length);
  });

  test('sorts by name', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Sort').selectOption('name');
    const names = await page.locator('li a span').allTextContents();
    const sorted = generators.map((g) => g.name).sort((a, b) => a.localeCompare(b));
    expect(names.filter((n) => sorted.includes(n))).toEqual(sorted);
  });

  test('a card opens its editor with the card configuration intact', async ({ page }) => {
    await page.goto('/');
    const first = generators[generators.length - 1]!; // "Recent" puts the last-registered first
    await page.getByRole('listitem').first().getByRole('link').first().click();
    // `trailingSlash` is on so the export works on static hosts that do no
    // extensionless resolution, which puts a slash before the query string.
    await expect(page).toHaveURL(new RegExp(`/p/${first.id}/?\\?`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
  });

  // Stored state is the one input this app takes that it did not write itself:
  // an older schema, a hand-edited localStorage, a half-finished write. Both of
  // these shapes used to replace the entire page with React's "Application
  // error" screen, because the old filters checked one field and let everything
  // else through. The assertion is deliberately about the *valid* item still
  // being there — surviving the bad entry is the point, not merely not crashing.
  test('a collected item with no palette does not take the page down', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'patternwall.collected.v1',
        JSON.stringify([
          { id: 'wrecked', generatorId: 'truchet', seed: 'no-palette-here', savedAt: 2 },
          { id: 'intact', generatorId: 'truchet', seed: 'still-here', params: {}, savedAt: 1, palette: { id: 'obsidian', name: 'Obsidian', background: '#0b0b0d', ink: '#f4f2ec', accents: ['#ff7a3d'], mode: 'dark', tags: [] } },
        ]),
      );
    });
    await page.goto('/collected');
    await expect(page.getByRole('heading', { level: 1, name: 'Collected' })).toBeVisible();
    await expect(page.getByText('still-here')).toBeVisible();
    await expect(page.getByText('no-palette-here')).toBeVisible();
    expect(errors, `page threw: ${errors.join(' | ')}`).toEqual([]);
  });

  test('a saved palette with no accents does not take the editor down', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'patternwall.palettes.v1',
        JSON.stringify([{ id: 'half-written', name: 'Half written', background: '#101014' }]),
      );
    });
    await page.goto('/p/truchet');
    await page.getByRole('tab', { name: 'Palette' }).click();
    await expect(page.getByText('Half written')).toBeVisible();
    expect(errors, `page threw: ${errors.join(' | ')}`).toEqual([]);
  });

  test('the collected view starts empty and points somewhere', async ({ page }) => {
    await page.goto('/collected');
    await expect(page.getByText('Nothing collected yet.')).toBeVisible();
    await page.getByRole('link', { name: 'Browse the gallery' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('the setup page explains the constraint and the recipe', async ({ page }) => {
    await page.goto('/setup');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/no public API/i)).toBeVisible();
    await expect(page.getByText('Find Photos')).toBeVisible();
    await expect(page.getByText('Set Wallpaper Photo').first()).toBeVisible();
    await expect(page.getByText('Time of Day').first()).toBeVisible();
    await expect(page.getByText(/could not open/i)).toBeVisible();
  });
});
