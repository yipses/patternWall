import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * The two full-screen routes, `/t` and `/m`, on a phone and on a desktop.
 *
 * Reported: "on the phone, the website has a black border". Both routes draw
 * the picture at the whole screen's shape, and Safari's address bar and
 * toolbar take part of that screen away — so fitting all of the picture in
 * left it narrower than the phone, with black down both sides. On a phone it
 * now fills the screen and is trimmed top and bottom; above phone width it
 * keeps the phone's shape, because a desktop window is not the screen the
 * wallpaper is for.
 *
 * The screen and the window have to differ for the fault to exist, and
 * `test.use({ screen })` did not reach the page here: it saw a screen the size
 * of its window, the shape matched the space exactly, and the first version of
 * this test passed with the fix taken out. So each test opens its own window
 * with both sizes stated, and checks the page saw them.
 */

/** An iPhone's 390 by 844 screen, with Safari's address bar and toolbar showing. */
const PHONE = { viewport: { width: 390, height: 664 }, screen: { width: 390, height: 844 } };
const DESKTOP = { viewport: { width: 1440, height: 950 }, screen: { width: 1920, height: 1080 } };

const ROUTES: { path: string; picture: (page: Page) => Locator; ready: (page: Page) => Promise<void> }[] = [
  {
    path: '/t',
    picture: (page) => page.getByTestId('feed-card').locator('img[alt]:not([alt=""])'),
    ready: async (page) => {
      await expect(page.getByTestId('feed-card')).toHaveAttribute('data-ready', 'true');
    },
  },
  {
    path: '/m',
    picture: (page) => page.locator('main img').first(),
    ready: async (page) => {
      await expect(page.locator('main img').first()).toBeVisible();
    },
  },
];

async function open(
  browser: Browser,
  baseURL: string | undefined,
  size: typeof PHONE,
  route: (typeof ROUTES)[number],
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ ...size, baseURL });
  const page = await context.newPage();
  await page.goto(route.path);
  await route.ready(page);
  // The instrument check: the page has to see the screen that was asked for.
  expect(await page.evaluate(() => [window.screen.width, window.screen.height])).toEqual([size.screen.width, size.screen.height]);
  return { page, close: () => context.close() };
}

for (const route of ROUTES) {
  test.describe(route.path, () => {
    test('on a phone the picture fills the screen, trimmed rather than stretched', async ({ browser, baseURL }) => {
      const { page, close } = await open(browser, baseURL, PHONE, route);
      const box = (await route.picture(page).boundingBox())!;
      expect(box.x, 'black down the left').toBeLessThanOrEqual(0.5);
      expect(box.width, 'black down the right').toBeGreaterThanOrEqual(389.5);
      expect(box.y).toBeLessThanOrEqual(0.5);
      expect(box.height).toBeGreaterThanOrEqual(663.5);
      // Filling a shorter space by squashing the picture would pass the above
      // and show a different wallpaper from the one that gets kept.
      expect(await route.picture(page).evaluate((img) => getComputedStyle(img).objectFit)).toBe('cover');
      await close();
    });

    test('in a desktop window it keeps the phone screen shape', async ({ browser, baseURL }) => {
      const { page, close } = await open(browser, baseURL, DESKTOP, route);
      const box = (await route.picture(page).boundingBox())!;
      expect(box.width / box.height).toBeCloseTo(390 / 845, 2);
      expect(box.height).toBeGreaterThanOrEqual(949.5);
      await close();
    });
  });
}
