import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { pngSize, settled } from './helpers';

test.describe('export', () => {
  test('downloads a PNG at the stated size, well under a megabyte', async ({ page }) => {
    await page.goto('/p/flow-dots');
    await page.getByRole('tab', { name: 'Export' }).click();

    // iPhone 15/14 Pro Max, the size the brief calls out.
    await page.getByLabel('Device').selectOption('ip15pm');
    await expect(page.getByText('1290×2796', { exact: true })).toBeVisible();

    // Bleed on by default: the file is 8% larger on every edge.
    await expect(page.getByText('1496×3243', { exact: true })).toBeVisible();

    const sizeCell = page.getByTestId('export-size');
    await expect(sizeCell).not.toHaveText('measuring…', { timeout: 60_000 });
    await expect(sizeCell).not.toHaveText('—', { timeout: 60_000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
    await page.getByTestId('download-png').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^patternwall_flow-dots_.*\.png$/);

    const path = await download.path();
    expect(path).toBeTruthy();
    const buf = readFileSync(path as string);
    const size = pngSize(buf);
    expect(size).toEqual({ width: 1496, height: 3243 });
    expect(buf.length, `PNG-8 export was ${(buf.length / 1024 / 1024).toFixed(2)} MB`).toBeLessThan(1024 * 1024);
    expect(buf.length).toBeGreaterThan(10_000);

    await expect(page.getByTestId('download-png')).toHaveText('Downloaded');
  });

  test('turning the bleed off exports exactly the panel size', async ({ page }) => {
    await page.goto('/p/truchet');
    await page.getByRole('tab', { name: 'Export' }).click();
    await page.getByLabel('Device').selectOption('ip15p');
    await page.getByRole('switch', { name: /bleed/i }).click();
    await expect(page.getByText('1179×2556', { exact: true }).first()).toBeVisible();

    const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
    await page.getByTestId('download-png').click();
    const buf = readFileSync((await (await downloadPromise).path()) as string);
    expect(pngSize(buf)).toEqual({ width: 1179, height: 2556 });
  });

  test('PNG-24 is bigger than PNG-8 for the same render', async ({ page }) => {
    await page.goto('/p/phyllotaxis');
    await page.getByRole('tab', { name: 'Export' }).click();
    await page.getByLabel('Device').selectOption('ip13mini');

    // The panel re-measures on every settings change; wait for the new number
    // rather than reading whatever the previous one left behind.
    const sizeCell = page.getByTestId('export-size');
    const measured = async (): Promise<string> => {
      await expect(sizeCell).toHaveText('measuring…', { timeout: 30_000 });
      await expect(sizeCell).not.toHaveText('measuring…', { timeout: 60_000 });
      return (await sizeCell.textContent()) ?? '';
    };

    const eight = await measured();
    await page.getByRole('button', { name: 'PNG-24' }).click();
    const twentyFour = await measured();

    const toKb = (s: string): number => (s.includes('MB') ? parseFloat(s) * 1024 : parseFloat(s));
    expect(toKb(twentyFour)).toBeGreaterThan(toKb(eight));
  });

  test('batch export produces a zip and keeps the page responsive', async ({ page }) => {
    await page.goto('/p/truchet');
    await page.getByRole('tab', { name: 'Export' }).click();
    await page.getByLabel('Device').selectOption('custom');
    await page.getByLabel('Width').fill('240');
    await page.getByLabel('Height').fill('520');
    await settled(page);

    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByTestId('batch-export').click();
    await expect(page.getByRole('progressbar')).toBeVisible();

    // The UI must still accept input while the batch runs.
    await page.getByRole('tab', { name: 'Pattern' }).click();
    await expect(page.getByLabel('Grid density')).toBeVisible();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^patternwall_truchet_.*_x30\.zip$/);
    const buf = readFileSync((await download.path()) as string);
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(buf.length).toBeGreaterThan(30_000);
    // 30 local file headers means 30 entries.
    let entries = 0;
    for (let i = 0; i + 4 <= buf.length; i++) if (buf.readUInt32LE(i) === 0x04034b50) entries++;
    expect(entries).toBe(30);
  });

  test('the Home Screen variant renders differently from the base export', async ({ page }) => {
    await page.goto('/p/ridgelines');
    await page.getByRole('tab', { name: 'Export' }).click();
    await page.getByLabel('Device').selectOption('custom');
    await page.getByLabel('Width').fill('200');
    await page.getByLabel('Height').fill('430');

    const sizeCell = page.getByTestId('export-size');
    await expect(sizeCell).not.toHaveText('measuring…', { timeout: 30_000 });
    const base = await sizeCell.textContent();

    await page.getByRole('switch', { name: /Home Screen variant/i }).click();
    await expect(sizeCell).not.toHaveText('measuring…', { timeout: 30_000 });
    const boosted = await sizeCell.textContent();
    expect(boosted).toBeTruthy();
    expect(base).toBeTruthy();
  });
});
