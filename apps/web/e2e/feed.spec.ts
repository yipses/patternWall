import { expect, test, type Page } from '@playwright/test';

/**
 * `/t`, the swipe feed.
 *
 * Every card here is random, so the tests are organised around the one promise
 * the screen makes: nothing you have seen is lost by accident. A swipe keeps
 * or passes, rewind undoes any change of card, a card that has not drawn
 * cannot be judged, and the whole thing survives the tab going away.
 *
 * Driven with the mouse, which reaches the same pointer handlers a finger does.
 * What it cannot reach is Safari: its edge swipes, its toolbar, its
 * pull-to-refresh. Those were designed around and have to be tried on a phone.
 */

test.use({ viewport: { width: 390, height: 844 } });

const COLLECTED = 'patternwall.collected.v1';

async function ready(page: Page): Promise<void> {
  await expect(page.getByTestId('feed-card')).toHaveAttribute('data-ready', 'true');
}

/** The card on screen, as the three things that make it that card. */
async function cardId(page: Page): Promise<{ generator: string; seed: string; palette: string }> {
  return page.getByTestId('feed-card').evaluate((el: HTMLElement) => ({
    generator: el.dataset.generator ?? '',
    seed: el.dataset.seed ?? '',
    palette: el.dataset.palette ?? '',
  }));
}

const idText = (c: { generator: string; seed: string; palette: string }): string => `${c.generator}|${c.seed}|${c.palette}`;

/** Wait for the card to stop being `before`, and settle on its picture. */
async function changedFrom(page: Page, before: { generator: string; seed: string; palette: string }): Promise<void> {
  await expect.poll(async () => idText(await cardId(page))).not.toBe(idText(before));
  await ready(page);
}

async function savedCount(page: Page): Promise<number> {
  return page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? '[]').length as number, COLLECTED);
}

/**
 * A drag, in small even steps from a starting point on the card.
 *
 * Small steps on purpose: the axis lock reads the lead between the two axes,
 * and a drag that arrives in two big jumps tests none of that.
 */
async function drag(page: Page, dx: number, dy: number, from?: { x: number; y: number }, steps = 20): Promise<void> {
  const box = (await page.getByTestId('feed-card').boundingBox())!;
  const x0 = from?.x ?? box.x + box.width / 2;
  const y0 = from?.y ?? box.y + box.height * 0.45;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/t');
  await ready(page);
});

test('the first card arrives after the page, with nothing written to the console', async ({ page }) => {
  // Random choices during the prerender would disagree with the baked HTML,
  // the text hydration mismatch this repo has paid for twice. So the static
  // page is only the ground and the card comes in after mount.
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.reload();
  await ready(page);
  expect(errors).toEqual([]);

  const html = await (await page.request.get('/t/')).text();
  expect(html, 'a card was baked into the static page').not.toContain('data-testid="feed-card"');
});

test('swiping right keeps the card on screen, and moves on', async ({ page }) => {
  const before = await cardId(page);
  await expect(page.getByTestId('feed-gallery')).toHaveAttribute('data-empty', 'true');

  await drag(page, 220, 6);
  await changedFrom(page, before);

  // What was saved is the card that was judged, not the one that replaced it.
  const saved = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? '[]'), COLLECTED);
  expect(saved).toHaveLength(1);
  expect(`${saved[0].generatorId}|${saved[0].seed}|${saved[0].palette.id}`).toBe(idText(before));
  await expect(page.getByTestId('feed-gallery')).not.toHaveAttribute('data-empty', 'true');
});

test('swiping left passes, and keeps nothing', async ({ page }) => {
  const before = await cardId(page);
  await drag(page, -220, 6);
  await changedFrom(page, before);
  expect(await savedCount(page)).toBe(0);
});

test('a drag that does not reach the commit point goes back', async ({ page }) => {
  // Thirty percent of the width, or a fast flick. 60px slowly is neither.
  const before = await cardId(page);
  await drag(page, 60, 2, undefined, 30);
  await page.waitForTimeout(500);
  expect(idText(await cardId(page))).toBe(idText(before));
  expect(await savedCount(page)).toBe(0);
});

test('a drag that starts at the edge of the screen is left to the browser', async ({ page }) => {
  // Safari owns both side edges — back from the left, forward from the right
  // once there is somewhere forward to go. The card does not compete for them.
  const before = await cardId(page);
  const box = (await page.getByTestId('feed-card').boundingBox())!;
  await drag(page, 250, 4, { x: 8, y: box.y + box.height / 2 });
  await drag(page, -250, 4, { x: 390 - 8, y: box.y + box.height / 2 });
  await page.waitForTimeout(500);
  expect(idText(await cardId(page))).toBe(idText(before));
});

test('a tap is a new wallpaper in the same pattern, and its colours change', async ({ page }) => {
  // "When I tap on the screen and get a new wallpaper, colour should change."
  // It first kept the colours, and that read as the colours being broken. So
  // the palette is asserted on the picture actually drawn, not only on the
  // card's own record of it — a record that changed under a picture that did
  // not would pass a test about the record.
  const pictureOf = async (): Promise<string> =>
    page.getByTestId('feed-card').evaluate((el) => {
      const imgs = el.querySelectorAll('img');
      return imgs[imgs.length - 1]?.getAttribute('src') ?? '';
    });
  for (let i = 0; i < 3; i++) {
    const before = await cardId(page);
    const drawn = await pictureOf();
    const box = (await page.getByTestId('feed-card').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4);
    await expect.poll(async () => (await cardId(page)).seed).not.toBe(before.seed);
    const after = await cardId(page);
    expect(after.generator).toBe(before.generator);
    expect(after.palette, `tap ${i + 1} kept the colours`).not.toBe(before.palette);
    await ready(page);
    await expect.poll(pictureOf, { message: `tap ${i + 1} did not redraw` }).not.toBe(drawn);
  }
});

test('a press that lasts is not a tap', async ({ page }) => {
  // Tap is the most accidental gesture on the screen and on a random feed it
  // replaces the card, so a resting thumb must not count.
  const before = await cardId(page);
  const box = (await page.getByTestId('feed-card').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(idText(await cardId(page))).toBe(idText(before));
});

test('a vertical swipe changes the colours, and says which', async ({ page }) => {
  const before = await cardId(page);
  await drag(page, 4, -140);
  await expect.poll(async () => (await cardId(page)).palette).not.toBe(before.palette);
  const after = await cardId(page);
  // The card is the same card: only its colours moved.
  expect(after.generator).toBe(before.generator);
  expect(after.seed).toBe(before.seed);
  await expect(page.getByTestId('feed-palette-pill')).toContainText(/\d+\/\d+/);

  // And the same swipe the other way undoes it — which is why colours stay
  // out of rewind's history.
  await drag(page, -4, 140);
  await expect.poll(async () => (await cardId(page)).palette).toBe(before.palette);
});

test('a vertical drag scrubs the colours while the finger is still down', async ({ page }) => {
  /*
   * Reported: "as I'm swiping up/down it should continuously change colours,
   * not like now where each swipe changes it once". So everything here is
   * read with the button still held — a version that changes the palette on
   * release, once, sees one palette the whole way and fails.
   */
  const before = await cardId(page);
  const picture = page.getByTestId('feed-card').locator('img[alt]:not([alt=""])');
  const firstSrc = await picture.getAttribute('src');
  const box = (await page.getByTestId('feed-card').boundingBox())!;
  const x = box.x + box.width / 2;
  const y0 = box.y + box.height * 0.7;

  await page.mouse.move(x, y0);
  await page.mouse.down();
  const seen = new Set<string>();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(x, y0 - i * 10);
    seen.add((await cardId(page)).palette);
  }
  expect(seen.size, 'the colours moved only once, or not at all, during the drag').toBeGreaterThanOrEqual(5);
  // And the picture itself redrew mid-drag, not only the data attribute.
  await expect.poll(() => picture.getAttribute('src')).not.toBe(firstSrc);
  await expect(page.getByTestId('feed-palette-pill')).toContainText(/\d+\/\d+/);

  // Back to where the finger started, still in the same drag: the colours
  // are the ones it started with, because every step counts from there.
  for (let i = 23; i >= 0; i--) await page.mouse.move(x, y0 - i * 10);
  expect((await cardId(page)).palette).toBe(before.palette);
  await page.mouse.up();
  const after = await cardId(page);
  expect(after.palette).toBe(before.palette);
  expect(after.seed, 'a scrub changed the card, not only its colours').toBe(before.seed);
});

test.describe('rewind', () => {
  test('is dimmed with nothing to bring back, never hidden', async ({ page }) => {
    // Hidden would shift the row under a thumb that learned where it is.
    await expect(page.getByTestId('feed-rewind')).toBeVisible();
    await expect(page.getByTestId('feed-rewind')).toBeDisabled();
  });

  test('brings a skipped card back, and the one you were on waits in line', async ({ page }) => {
    const a = await cardId(page);
    await page.getByTestId('feed-skip').click();
    await changedFrom(page, a);
    const b = await cardId(page);

    await page.getByTestId('feed-rewind').click();
    await expect.poll(async () => idText(await cardId(page))).toBe(idText(a));

    // b had no verdict, so it is not thrown away: passing a again shows b.
    await ready(page);
    await page.getByTestId('feed-skip').click();
    await expect.poll(async () => idText(await cardId(page))).toBe(idText(b));
  });

  test('takes a liked card back out of the gallery', async ({ page }) => {
    const a = await cardId(page);
    await page.getByTestId('feed-like').click();
    await changedFrom(page, a);
    expect(await savedCount(page)).toBe(1);

    await page.getByTestId('feed-rewind').click();
    await expect.poll(async () => idText(await cardId(page))).toBe(idText(a));
    expect(await savedCount(page), 'undoing a like left it in the gallery').toBe(0);
    await expect(page.getByTestId('feed-gallery')).toHaveAttribute('data-empty', 'true');
  });

  test('brings back the settings a tap replaced', async ({ page }) => {
    const a = await cardId(page);
    const box = (await page.getByTestId('feed-card').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4);
    await expect.poll(async () => (await cardId(page)).seed).not.toBe(a.seed);

    await page.getByTestId('feed-rewind').click();
    await expect.poll(async () => idText(await cardId(page))).toBe(idText(a));
  });
});

test('the feed comes back exactly where it was after the tab goes away', async ({ page }) => {
  // Safari's own edge swipe winning, or iOS unloading a background tab, must
  // cost nothing — otherwise the browser is the "gone forever" rewind exists
  // to prevent.
  const a = await cardId(page);
  await page.getByTestId('feed-skip').click();
  await changedFrom(page, a);
  const b = await cardId(page);

  await page.reload();
  await ready(page);
  expect(idText(await cardId(page))).toBe(idText(b));

  await page.getByTestId('feed-rewind').click();
  await expect.poll(async () => idText(await cardId(page))).toBe(idText(a));
});

test.describe('the menu', () => {
  test('opens words, not a fan of icons', async ({ page }) => {
    await page.getByTestId('feed-more').click();
    const menu = page.getByTestId('feed-menu');
    await expect(menu).toBeVisible();
    await expect(page.getByTestId('feed-adjust')).toHaveText('Adjust');
    await expect(page.getByTestId('feed-colours')).toHaveText('Colours');
    await expect(page.getByTestId('feed-share')).toHaveText('Share Image');

    // Bottom-right, where a thumb is, and it opens upward from there.
    const more = (await page.getByTestId('feed-more').boundingBox())!;
    const box = (await menu.boundingBox())!;
    expect(more.x).toBeGreaterThan(390 / 2);
    expect(more.y).toBeGreaterThan(844 / 2);
    expect(box.y + box.height).toBeLessThan(more.y);
  });

  test('tapping outside it closes it and does nothing else', async ({ page }) => {
    // The press is used up by closing. If it reached the card underneath, it
    // would re-roll the thing being judged.
    const before = await cardId(page);
    await page.getByTestId('feed-more').click();
    await expect(page.getByTestId('feed-menu')).toBeVisible();
    await page.mouse.click(195, 300);
    await expect(page.getByTestId('feed-menu')).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(idText(await cardId(page))).toBe(idText(before));
  });

  test('Escape closes it and gives focus back to the button', async ({ page }) => {
    await page.getByTestId('feed-more').click();
    await expect(page.getByTestId('feed-adjust')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('feed-menu')).toHaveCount(0);
    await expect(page.getByTestId('feed-more')).toBeFocused();
  });

  test('Adjust holds every setting, and a way to shuffle them without a tap', async ({ page }) => {
    // The swipes are verdicts and colours here, so no drag drives a setting —
    // the sheet has to hold all of them or two become unreachable.
    const before = await cardId(page);
    await page.getByTestId('feed-more').click();
    await page.getByTestId('feed-adjust').click();
    const sheet = page.getByRole('group', { name: /adjust$/i });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Grid density')).toBeVisible();
    await expect(sheet.getByLabel('Divisions')).toBeVisible();
    // And the build stamp: /t has no footer to carry it.
    await expect(sheet.getByTestId('build-stamp')).toBeVisible();

    await page.getByTestId('feed-shuffle').click();
    await expect.poll(async () => (await cardId(page)).seed).not.toBe(before.seed);
  });

  test('Colours opens the palette sheet', async ({ page }) => {
    await page.getByTestId('feed-more').click();
    await page.getByTestId('feed-colours').click();
    await expect(page.getByRole('group', { name: 'Colours' })).toBeVisible();
  });
});

test('the gallery opens the liked wallpapers, and its back arrow comes back here', async ({ page }) => {
  const a = await cardId(page);
  await page.getByTestId('feed-like').click();
  await changedFrom(page, a);
  const b = await cardId(page);

  await page.getByTestId('feed-gallery').click();
  await expect(page).toHaveURL(/\/m\/collected/);
  await expect(page.getByRole('listitem')).toHaveCount(1);

  await page.getByTestId('collected-back').click();
  await expect(page).toHaveURL(/\/t\/?$/);
  await ready(page);
  expect(idText(await cardId(page)), 'coming back from the gallery dealt a different card').toBe(idText(b));
});

test('a wallpaper opened from the gallery opens here, not in the editor', async ({ page }) => {
  // "It should take me to the screen I was on." Opened from the feed, the
  // gallery sends a tile back to the feed showing that wallpaper — and the
  // card that was on screen is one swipe away, not lost.
  const kept = await cardId(page);
  await page.getByTestId('feed-like').click();
  await changedFrom(page, kept);
  const onScreen = await cardId(page);

  await page.getByTestId('feed-gallery').click();
  await expect(page).toHaveURL(/\/m\/collected/);
  await page.getByRole('link', { name: new RegExp(`seed ${kept.seed}$`) }).click();

  await expect(page).toHaveURL(/\/t\/?$/);
  await ready(page);
  expect(idText(await cardId(page)), 'the gallery did not open the wallpaper that was tapped').toBe(idText(kept));

  await page.getByTestId('feed-skip').click();
  await expect.poll(async () => idText(await cardId(page)), { message: 'the card that was on screen was lost' }).toBe(idText(onScreen));

  // And a reload after moving on stays where you are, rather than opening the
  // kept wallpaper again from an address that still names it. A reload while
  // still looking at it would pass either way, which is why it happens here.
  await ready(page);
  await page.reload();
  await ready(page);
  expect(idText(await cardId(page)), 'a reload reopened the gallery wallpaper').toBe(idText(onScreen));
});

test('a like that cannot be saved does not move on', async ({ page }) => {
  // Advancing past a card that did not save would be the worst outcome on the
  // screen: the person asked to keep it, and it is gone.
  await page.addInitScript((key) => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === key) throw new DOMException('full', 'QuotaExceededError');
      return real.call(this, k, v);
    };
  }, COLLECTED);
  await page.reload();
  await ready(page);

  const before = await cardId(page);
  await page.getByTestId('feed-like').click();
  await expect(page.getByTestId('feed-toast')).toHaveText("Couldn't save");
  await page.waitForTimeout(300);
  expect(idText(await cardId(page))).toBe(idText(before));
});

test('one tip after the third card, and never again', async ({ page }) => {
  await expect(page.getByTestId('feed-tip')).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    const before = await cardId(page);
    await page.getByTestId('feed-skip').click();
    await changedFrom(page, before);
  }
  await expect(page.getByTestId('feed-tip')).toContainText('Tap to reshuffle');

  // Any gesture dismisses it...
  await drag(page, 4, -140);
  await expect(page.getByTestId('feed-tip')).toHaveCount(0);

  // ...for good.
  await page.reload();
  await ready(page);
  for (let i = 0; i < 3; i++) {
    const before = await cardId(page);
    await page.getByTestId('feed-skip').click();
    await changedFrom(page, before);
  }
  await page.waitForTimeout(300);
  await expect(page.getByTestId('feed-tip')).toHaveCount(0);
});

test('the arrow keys judge and recolour, for a keyboard', async ({ page }) => {
  const a = await cardId(page);
  await page.keyboard.press('ArrowRight');
  await changedFrom(page, a);
  expect(await savedCount(page)).toBe(1);

  const b = await cardId(page);
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await cardId(page)).palette).not.toBe(b.palette);
});
