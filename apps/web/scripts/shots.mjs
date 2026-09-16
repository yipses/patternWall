// Dev-only: drive the built site and save screenshots so they can be looked at.
//
// Needs a server already up. `npm run dev` (port 3100) or a built export
// served by `node apps/web/scripts/serve.mjs`; override with BASE_URL.
// `npm run shots` runs this.
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
  const res = await page.goto(base + path, { waitUntil: 'networkidle' });
  // `page.goto` resolves happily on a 404, and this script spent a while
  // photographing the "no pattern here" page for routes whose generators had
  // been retired. A shot of the wrong page is worse than no shot.
  if (res && res.status() >= 400) throw new Error(`${path} returned ${res.status()}`);
  if (prep) await prep(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  await ctx.close();
  console.error('shot', name);
}

const W = 1440, M = 390;
await shoot('gallery-desktop', '/', W, 950);
await shoot('gallery-mobile', '/', M, 844);
await shoot('editor-lock-desktop', '/p/contours', W, 950);
await shoot('editor-home-desktop', '/p/truchet-arcs', W, 950, async (p) => {
  await p.getByRole('button', { name: 'Home Screen' }).click();
});
await shoot('editor-flat-desktop', '/p/chevron-blocks', W, 950, async (p) => {
  await p.getByRole('button', { name: 'Flat', exact: true }).click();
});
await shoot('editor-zones', '/p/truchet-diagonals', W, 950, async (p) => {
  await p.getByRole('switch', { name: /safe zone/i }).click();
});
await shoot('palette-desktop', '/p/contours', W, 1100, async (p) => {
  await p.getByRole('tab', { name: 'Palette' }).click();
});
await shoot('palette-edit-desktop', '/p/contours', W, 1100, async (p) => {
  await p.getByRole('tab', { name: 'Palette' }).click();
  await p.getByRole('tab', { name: 'Colours' }).click();
});
// On a phone the palette is a full-width sheet behind the droplet in the
// preview rail, not a tab you scroll the panel to reach.
await shoot('palette-mobile', '/p/contours', M, 844, async (p) => {
  await p.getByRole('button', { name: /palette/i }).first().click();
});
await shoot('editor-mobile', '/p/truchet-arcs', M, 844);
await shoot('export-desktop', '/p/contours', W, 1100, async (p) => {
  await p.getByRole('tab', { name: 'Export' }).click();
});
await shoot('setup-desktop', '/setup', W, 950);
await shoot('collected-empty', '/collected', W, 800);

await browser.close();
