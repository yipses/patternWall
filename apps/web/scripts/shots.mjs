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

async function shoot(name, path, width, height, prep, seed) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  // Some screens are only interesting with something saved in them, and the
  // collection is empty on a fresh context by construction.
  if (seed) await ctx.addInitScript((d) => window.localStorage.setItem('patternwall.collected.v1', JSON.stringify(d)), seed);
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

/*
 * The two phone routes, which this script did not cover.
 *
 * Both of the phone layout faults in CLAUDE.md were found by rasterising a
 * built page at 390px and looking at it -- "neither is visible in a test, both
 * are obvious in a screenshot" -- and the one tool for that photographed
 * thirteen views, none of them these. Every bug reported on the collection
 * since it was built has been a looking bug.
 */
const PAL = {
  id: 'obsidian',
  name: 'Obsidian',
  background: '#0b0b0d',
  ink: '#f4f2ec',
  accents: ['#e0a458', '#c2552e'],
  mode: 'dark',
  tags: [],
};
const SAVED = ['chevron-blocks', 'contours', 'truchet-arcs', 'truchet-diagonals'].flatMap((id, n) =>
  [0, 1].map((k) => ({ id: `shot-${id}-${k}`, generatorId: id, seed: `shot-${n}${k}`, params: {}, savedAt: Date.now() - n * 8.64e7, palette: PAL })),
);

await shoot('phone-view', '/m', M, 844);
await shoot('phone-view-settings', '/m', M, 844, async (p) => {
  await p.getByTestId('preview-settings').click();
});
/*
 * Three content states, not one.
 *
 * The eight-item fixture fills the grid, and a grid that fills the screen
 * hides every fault that only appears when it does not. The build stamp sat
 * 24px above the corner button on a two-item collection for as long as this
 * script photographed eight, and the shot everybody looked at was the
 * comfortable one. A content-driven screen gets photographed empty, sparse and
 * full, and the sparse one is the shot to look at first.
 */
await shoot('collected-phone-empty', '/m/collected', M, 844, undefined, []);
await shoot('collected-phone-sparse', '/m/collected', M, 844, undefined, SAVED.slice(0, 2));
await shoot('collected-phone', '/m/collected', M, 844, undefined, SAVED);
await shoot('collected-phone-select', '/m/collected', M, 844, async (p) => {
  await p.getByTestId('select-start').click();
  await p.getByRole('button', { name: /shot-00$/ }).click();
}, SAVED);
await shoot('collected-phone-export', '/m/collected', M, 844, async (p) => {
  await p.getByTestId('select-start').click();
  await p.getByRole('button', { name: /shot-00$/ }).click();
  await p.getByTestId('export-selected').click();
}, SAVED);
// The collection on a desktop window, which is where it is most different.
await shoot('collected-desktop', '/collected', W, 950, undefined, SAVED);

await browser.close();
