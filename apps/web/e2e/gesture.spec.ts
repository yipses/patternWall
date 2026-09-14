import { expect, test, type Page } from '@playwright/test';
import { previewSrc, settled } from './helpers';

/**
 * The three controls a pattern is driven by, driven from the picture.
 *
 * Everything here goes through `page.mouse`, and that is not a compromise: the
 * surface listens for pointer events, which a mouse raises exactly as a finger
 * does, so this drives the identical handler. What it cannot reach is the part
 * a browser decides rather than the page — whether a vertical drag scrolls or
 * scrubs, which `touch-action` latches before the first move event exists.
 * Playwright's synthesised touch does not reproduce that arbitration either,
 * so a mobile project here would be false comfort. **The scroll-versus-scrub
 * behaviour is verified by hand on a real phone and by nothing else.**
 */

async function phoneBox(page: Page): Promise<{ cx: number; cy: number }> {
  const box = await page.locator('[class*="phone"]').first().boundingBox();
  if (!box) throw new Error('the preview frame has no box');
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/** Press, move in `steps` increments so pointermove fires repeatedly, release. */
async function dragBy(page: Page, dx: number, dy: number): Promise<void> {
  const { cx, cy } = await phoneBox(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const steps = 24;
  for (let i = 1; i <= steps; i++) await page.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps);
  await page.mouse.up();
}

async function tapPreview(page: Page): Promise<void> {
  const { cx, cy } = await phoneBox(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
}

const numberOf = async (page: Page, label: string): Promise<number> =>
  Number(await page.getByLabel(label).inputValue());

test.describe('gesture', () => {
  test('a drag across the preview scrubs the horizontal control', async ({ page }) => {
    await page.goto('/p/truchet');
    await settled(page);

    const before = await numberOf(page, 'Stroke weight');
    const divisionsBefore = await numberOf(page, 'Divisions');
    await dragBy(page, 200, 0);
    await settled(page);
    const after = await numberOf(page, 'Stroke weight');

    expect(after, `stroke weight went ${before} -> ${after} across a 200px drag`).toBeGreaterThan(before);
    // The axis locks to whichever way the pointer went first and stays there,
    // so a horizontal drag must leave the vertical control alone even though
    // twenty-four separate moves went through the handler.
    expect(await numberOf(page, 'Divisions'), 'a sideways drag moved the vertical control too').toBe(divisionsBefore);
    expect(page.url(), 'the share link did not follow the drag').toContain('q=');
  });

  test('a drag up the preview scrubs the vertical control, and increases it', async ({ page }) => {
    await page.goto('/p/truchet');
    await settled(page);

    const weightBefore = await numberOf(page, 'Stroke weight');
    const before = await numberOf(page, 'Divisions');
    // Up. Screen coordinates grow downward and a fader does not, so a negative
    // dy has to raise the value — the assertion is the direction, not just the
    // change, because an inverted axis is the kind of bug that reads as taste.
    await dragBy(page, 0, -160);
    await settled(page);

    expect(await numberOf(page, 'Divisions'), `divisions went ${before} -> ${await numberOf(page, 'Divisions')} dragging up`).toBeGreaterThan(before);
    expect(await numberOf(page, 'Stroke weight'), 'a vertical drag moved the horizontal control too').toBe(weightBefore);
  });

  test('a swipe that sets off sideways is still a swipe up', async ({ page }) => {
    await page.goto('/p/truchet');
    await settled(page);

    const weightBefore = await numberOf(page, 'Stroke weight');
    const before = await numberOf(page, 'Divisions');

    // A thumb pivots from the knuckle, so the first few millimetres of a swipe
    // up a phone travel sideways before the intent shows. These samples are
    // that shape: eleven across and four down at the point an axis-lock keyed
    // on "whichever is larger the moment either passes ten pixels" would fire,
    // and unambiguously vertical a moment later. That rule locked to across
    // here and held it for the whole gesture, so the control the person was
    // watching never moved — intermittently, depending on how they swept.
    const { cx, cy } = await phoneBox(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    const arc: [number, number][] = [
      [6, 1],
      [11, 4],
      [14, -6],
      [13, -24],
      [9, -56],
      [5, -100],
      [2, -150],
    ];
    for (const [dx, dy] of arc) await page.mouse.move(cx + dx, cy + dy);
    await page.mouse.up();
    await settled(page);

    expect(
      await numberOf(page, 'Divisions'),
      `divisions went ${before} -> ${await numberOf(page, 'Divisions')} across a swipe that arced up`,
    ).toBeGreaterThan(before);
    expect(await numberOf(page, 'Stroke weight'), 'the swipe locked to the direction it set off in').toBe(weightBefore);
  });

  test('a tap cycles the option, and wraps', async ({ page }) => {
    await page.goto('/p/truchet');
    await settled(page);
    const tileSet = page.getByLabel('Tile set');
    await expect(tileSet).toHaveValue('arcs');

    // The URL fingerprint is the one the existing select test established: a
    // select packs as its index, so slot 1 reading _1_ is diagonals.
    await tapPreview(page);
    await settled(page);
    await expect(tileSet).toHaveValue('diagonals');
    expect(page.url()).toMatch(/q=[^&]*_1_/);

    await tapPreview(page);
    await settled(page);
    await expect(tileSet).toHaveValue('triangles');

    await tapPreview(page);
    await settled(page);
    await expect(tileSet, 'the cycle did not wrap').toHaveValue('arcs');
  });

  test('a press that barely moves is a tap, not a scrub', async ({ page }) => {
    await page.goto('/p/truchet');
    await settled(page);
    const weightBefore = await numberOf(page, 'Stroke weight');

    // Four pixels, which is under the lock threshold. A finger never lands
    // perfectly still; without the threshold every tap would also nudge
    // whichever axis it happened to drift toward.
    await dragBy(page, 4, 3);
    await settled(page);

    await expect(page.getByLabel('Tile set'), 'a small movement was not taken as a tap').toHaveValue('diagonals');
    expect(await numberOf(page, 'Stroke weight'), 'a tap nudged a scrubbed control').toBe(weightBefore);
  });

  test('the picture tracks the finger, before it lifts', async ({ page }) => {
    await page.goto('/p/truchet');
    await settled(page);
    const start = await previewSrc(page);

    const { cx, cy } = await phoneBox(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down();

    // Sampled between moves, with no pause anywhere. That is the whole design
    // of this test and it took two goes to get right: the first version moved,
    // waited 600ms and then looked, which a 110ms debounce satisfies just as
    // well as live tracking does — the pause was longer than the debounce, so
    // the commit landed during it and the assertion could not tell the two
    // apart. Keeping the pointer moving is what starves a restart-on-every-call
    // debounce, because each move cancels the timer the last one set.
    const seen = new Set<string>();
    for (let i = 1; i <= 14; i++) {
      await page.mouse.move(cx + i * 18, cy);
      seen.add(await previewSrc(page));
    }
    const draftWidth = await page.locator('main img[alt*="rendered with"]').first().getAttribute('width');
    await page.mouse.up();
    await settled(page);

    expect(
      seen.size,
      `${seen.size} distinct pictures over fourteen moves, so the preview is not tracking the drag`,
    ).toBeGreaterThan(3);
    expect(seen.has(start), 'the preview never moved off where it started').toBe(true);
    // Drafts render small. A gesture commits on every move, so the moment it
    // does `committed.params` *is* `params` and the editor's identity-compared
    // `dirty` goes false — which would put every frame of a drag through a
    // full-resolution render, making the editor slower during the one
    // interaction built for speed. Nothing else here would notice.
    expect(draftWidth, 'the preview rendered at full size mid-drag').toBe('250');
    expect(
      await page.locator('main img[alt*="rendered with"]').first().getAttribute('width'),
      'the preview never came back up to full size',
    ).toBe('460');
  });

  test('tapping to a tile set with a tighter range carries the value across', async ({ page }) => {
    await page.goto('/p/truchet');
    await settled(page);

    const divisions = page.getByLabel('Divisions');
    await divisions.fill('6');
    await divisions.blur();
    await settled(page);
    await expect(divisions).toHaveAttribute('max', '12');

    // Diagonals draw 2n-1 chords a cell, so the count stops at six there. Half
    // way along has to stay half way along, or tapping round the tile sets
    // would lose where you were and hand back the ceiling whatever you had.
    await tapPreview(page);
    await settled(page);
    await expect(page.getByLabel('Tile set')).toHaveValue('diagonals');
    await expect(divisions, 'the slider still offers a range the render will not honour').toHaveAttribute('max', '6');
    await expect(divisions).toHaveValue('3');

    await tapPreview(page);
    await settled(page);
    await expect(page.getByLabel('Tile set')).toHaveValue('triangles');
    await expect(divisions).toHaveAttribute('max', '12');
    await expect(divisions, 'the value did not come back where it started').toHaveValue('6');
  });

  test('a pattern that has not chosen its three is left alone', async ({ page }) => {
    await page.goto('/p/phyllotaxis');
    await settled(page);
    const before = await previewSrc(page);
    const url = page.url();

    await dragBy(page, 220, 0);
    await page.waitForTimeout(600);

    expect(await previewSrc(page), 'dragging changed a pattern with no gesture bound').toBe(before);
    expect(page.url(), 'dragging changed the share link of a pattern with no gesture bound').toBe(url);
    await expect(page.getByRole('button', { name: /Advanced/ }), 'an undeclared pattern grew a disclosure').toHaveCount(0);
  });

  test.describe('at phone width', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the controls that are not the three are behind the gear', async ({ page }) => {
      await page.goto('/p/truchet');
      await settled(page);

      // The three are promoted and visible with nothing to press.
      await expect(page.getByLabel('Tile set')).toBeVisible();
      await expect(page.getByLabel('Stroke weight')).toBeVisible();
      await expect(page.getByLabel('Divisions')).toBeVisible();

      // Everything else is not in the page at all until the gear is pressed,
      // which is what keeps one parameter to one slider.
      await expect(page.getByLabel('Grid density')).toHaveCount(0);

      const gear = page.getByTestId('preview-settings');
      await expect(gear).toHaveAttribute('aria-expanded', 'false');
      await gear.click();
      await expect(gear).toHaveAttribute('aria-expanded', 'true');

      const density = page.getByLabel('Grid density');
      await expect(density).toBeVisible();
      await expect(page.getByLabel('Arc spread')).toBeVisible();
      await expect(page.getByLabel('Colour spread')).toBeVisible();
      // Name and slider only: no paragraph of explanation in a sheet this size.
      await expect(page.locator('text=Columns across the canvas')).toHaveCount(0);

      // And a way to reroll without reaching for the seed field below.
      const before = await previewSrc(page);
      await page.getByRole('button', { name: 'New seed' }).click();
      await settled(page);
      expect(await previewSrc(page), 'the seed button changed nothing').not.toBe(before);

      await gear.click();
      await expect(page.getByLabel('Grid density')).toHaveCount(0);
    });

    test('the preview leaves room to scroll past it', async ({ page }) => {
      await page.goto('/p/truchet');
      await settled(page);

      const box = await page.locator('[class*="phone"]').first().boundingBox();
      expect(box).not.toBeNull();
      // The surface takes the gesture outright, so a preview taller than the
      // viewport would be a region of the page nobody could scroll through.
      expect(box!.height, `the preview is ${Math.round(box!.height)}px tall in an 844px viewport`).toBeLessThan(844 * 0.7);
      // And gutters either side of it, which is where a thumb scrolls from.
      expect(box!.width, `the preview is ${Math.round(box!.width)}px wide in a 390px viewport`).toBeLessThan(320);
    });
  });
});
