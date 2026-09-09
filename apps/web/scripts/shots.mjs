// Dev-only: drive the built site and save screenshots so they can be looked at.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '/tmp/shots';
const base = process.env.BASE_URL || 'http://127.0.0.1:3100';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });

async function shoot(name, path, width, height, prep) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(base + path, { waitUntil: 'networkidle' });
  if (prep) await prep(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  await ctx.close();
  console.error('shot', name);
}

const W = 1440, M = 390;
await shoot('gallery-desktop', '/', W, 950);
await shoot('gallery-mobile', '/', M, 844);
await shoot('editor-lock-desktop', '/p/flow-dots', W, 950);
await shoot('editor-home-desktop', '/p/truchet', W, 950, async (p) => {
  await p.getByRole('button', { name: 'Home Screen' }).click();
});
await shoot('editor-flat-desktop', '/p/ridgelines', W, 950, async (p) => {
  await p.getByRole('button', { name: 'Flat', exact: true }).click();
});
await shoot('editor-zones', '/p/phyllotaxis', W, 950, async (p) => {
  await p.getByRole('switch', { name: /safe zone/i }).click();
});
await shoot('palette-desktop', '/p/flow-dots', W, 1100, async (p) => {
  await p.getByRole('tab', { name: 'Palette' }).click();
});
await shoot('palette-edit-desktop', '/p/flow-dots', W, 1100, async (p) => {
  await p.getByRole('tab', { name: 'Palette' }).click();
  await p.getByRole('tab', { name: 'Colours' }).click();
});
await shoot('palette-mobile', '/p/flow-dots', M, 844, async (p) => {
  await p.getByRole('tab', { name: 'Palette' }).click();
  await p.getByRole('tab', { name: 'Palette' }).scrollIntoViewIfNeeded();
});
await shoot('editor-mobile', '/p/truchet', M, 844);
await shoot('export-desktop', '/p/flow-dots', W, 1100, async (p) => {
  await p.getByRole('tab', { name: 'Export' }).click();
});
await shoot('setup-desktop', '/setup', W, 950);
await shoot('collected-empty', '/collected', W, 800);

await browser.close();
