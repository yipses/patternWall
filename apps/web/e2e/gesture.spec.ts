import { expect, test, type Page } from '@playwright/test';
import { previewSrc, settled } from './helpers';

/**
 * The two controls a pattern is scrubbed by, driven from the picture.
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

/**
 * The same drag a thumb makes: many small moves rather than a few big ones.
 *
 * `dragBy` moves in 24 increments, which on a 150px swipe is 6.25px an event.
 * A finger on a 120Hz screen covers a fraction of that, and the difference is
 * not cosmetic — it decides whether a single move crosses half a step of the
 * control, which is what one bug here turned on.
 */
async function dragSmoothly(page: Page, dx: number, dy: number): Promise<void> {
  const { cx, cy } = await phoneBox(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const steps = 60;
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

/**
 * The pattern select, by role rather than by label.
 *
 * `getByLabel('Pattern')` matches two things: this control, whose accessible
 * name is "TapPattern" because the gesture chip sits inside its label, and the
 * editor's own tab panel, which is named "Pattern" by its tab. Both are
 * legitimately called that, so the locator has to say which kind of thing it
 * wants rather than either of them being renamed.
 */
function patternSelect(page: Page) {
  return page.getByRole('combobox', { name: /Pattern/ });
}

test.describe('gesture', () => {
  test('a drag across the preview scrubs the horizontal control', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);

    const before = await numberOf(page, 'Grid density');
    const divisionsBefore = await numberOf(page, 'Divisions');
    await dragBy(page, 200, 0);
    await settled(page);
    const after = await numberOf(page, 'Grid density');

    expect(after, `grid density went ${before} -> ${after} across a 200px drag`).toBeGreaterThan(before);
    // The axis locks to whichever way the pointer went first and stays there,
    // so a horizontal drag must leave the vertical control alone even though
    // twenty-four separate moves went through the handler.
    expect(await numberOf(page, 'Divisions'), 'a sideways drag moved the vertical control too').toBe(divisionsBefore);
    expect(page.url(), 'the share link did not follow the drag').toContain('q=');
  });

  test('a drag up the preview scrubs the vertical control, and increases it', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);

    const densityBefore = await numberOf(page, 'Grid density');
    const before = await numberOf(page, 'Divisions');
    // Up. Screen coordinates grow downward and a fader does not, so a negative
    // dy has to raise the value — the assertion is the direction, not just the
    // change, because an inverted axis is the kind of bug that reads as taste.
    await dragBy(page, 0, -160);
    await settled(page);

    expect(await numberOf(page, 'Divisions'), `divisions went ${before} -> ${await numberOf(page, 'Divisions')} dragging up`).toBeGreaterThan(before);
    expect(await numberOf(page, 'Grid density'), 'a vertical drag moved the horizontal control too').toBe(densityBefore);
  });

  test('a swipe into an end drives the control back, smoothly, and only from the lock', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);

    const density = page.getByLabel('Grid density');
    const min = Number(await density.getAttribute('min'));
    const max = Number(await density.getAttribute('max'));
    // On the step lattice: density steps by one, so a bare midpoint of 3 and
    // 26 is 14.5 and `fill` refuses it.
    const step = Number(await density.getAttribute('step')) || 1;
    const mid = min + Math.round((max - min) / 2 / step) * step;

    await density.fill(String(min));
    await density.blur();
    await settled(page);

    // Swiping left with nothing to the left of you is a dead gesture, and a
    // dead gesture cannot be told apart from a broken one. So the axis turns
    // round: at the minimum, dragging either way climbs.
    //
    // Smoothly is the whole point, and it is what the assertion has to say.
    // The wrap this replaced satisfied "the value moved" perfectly by jumping
    // to the maximum, so a bound of "greater than min" would pass against the
    // behaviour being removed. A short drag must move it a *short* way.
    await dragBy(page, -40, 0);
    await settled(page);
    const after = await numberOf(page, 'Grid density');
    expect(after, 'a fresh swipe left at the minimum did not move the control').toBeGreaterThan(min);
    expect(after, `a 40px swipe took density to ${after}, which is a jump rather than a scrub`).toBeLessThan(mid);

    // The other half, and the reason it happens at the lock rather than at the
    // bound: within one drag the value clamps. An axis that turned round every
    // time it touched an end would make settling beside one impossible.
    await density.fill(String(mid));
    await density.blur();
    await settled(page);

    const box = await page.locator('[class*="phone"]').first().boundingBox();
    if (!box) throw new Error('the preview frame has no box');
    const midY = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width - 1, midY);
    await page.mouse.down();
    // Far enough left to spend the whole range and then some.
    for (let i = 1; i <= 60; i++) await page.mouse.move(box.x + box.width - 1 - (box.width * 1.6 * i) / 60, midY);
    await page.mouse.up();
    await settled(page);

    expect(
      await numberOf(page, 'Grid density'),
      'a single drag turned round at the end instead of stopping at it',
    ).toBe(min);
  });

  test('edge to edge covers the whole range, on each axis', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);

    const box = await page.locator('[class*="phone"]').first().boundingBox();
    if (!box) throw new Error('the preview frame has no box');

    // The promise the surface makes: the picture is the control, so one side
    // of the picture to the other is everywhere the parameter goes. It is not
    // approximately — the axis lock spends the first few pixels deciding which
    // way the drag is going, and a range measured against the full width
    // instead of the width that is left arrives about 5% short of the end,
    // which reads as a control that will not quite reach.
    const density = page.getByLabel('Grid density');
    await density.fill(await density.getAttribute('min') ?? '0');
    await density.blur();
    await settled(page);
    const min = Number(await density.getAttribute('min'));
    const max = Number(await density.getAttribute('max'));
    expect(await numberOf(page, 'Grid density'), 'setup: density did not start at its minimum').toBe(min);

    const midY = box.y + box.height / 2;
    await page.mouse.move(box.x + 1, midY);
    await page.mouse.down();
    for (let i = 1; i <= 40; i++) await page.mouse.move(box.x + 1 + ((box.width - 2) * i) / 40, midY);
    await page.mouse.up();
    await settled(page);

    expect(
      await numberOf(page, 'Grid density'),
      `a drag across the full ${Math.round(box.width)}px of the preview left density short of its maximum`,
    ).toBe(max);

    // And the same down the other axis, which measures against the height.
    const divisions = page.getByLabel('Divisions');
    const dMax = Number(await divisions.getAttribute('max'));
    const midX = box.x + box.width / 2;
    await page.mouse.move(midX, box.y + box.height - 1);
    await page.mouse.down();
    for (let i = 1; i <= 40; i++) await page.mouse.move(midX, box.y + box.height - 1 - ((box.height - 2) * i) / 40);
    await page.mouse.up();
    await settled(page);

    expect(
      await numberOf(page, 'Divisions'),
      `a drag up the full ${Math.round(box.height)}px of the preview left divisions short of its maximum`,
    ).toBe(dMax);
  });

  test('a smooth swipe moves a control that starts on its minimum', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);

    // Divisions defaults to 1, which is also its minimum, and that is the
    // case the re-anchor rule used to destroy: it fired whenever the value sat
    // on a bound, which such a control does from the first move of every drag.
    // Re-anchoring discards the travel accumulated so far, so each move began
    // again from nothing and the value never climbed off the end.
    const before = await numberOf(page, 'Divisions');
    expect(before, 'this test is about a control sitting on its minimum').toBe(1);

    // Sixty moves over 150px is 2.5px each — under half a step at any travel
    // this file uses, so no single move can escape the minimum on its own.
    // That is why it had to be a smooth drag: the coarser helper's 6.25px
    // moves cleared half a step on the first one and hid the fault.
    await dragSmoothly(page, 0, -150);
    await settled(page);

    expect(
      await numberOf(page, 'Divisions'),
      'a smooth swipe up left divisions on its minimum, so the drag accumulated nothing',
    ).toBeGreaterThan(before);
  });

  test('a moderate swipe up does not spend the whole control', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);

    const divisions = page.getByLabel('Divisions');
    const max = Number(await divisions.getAttribute('max'));
    const before = await numberOf(page, 'Divisions');

    // 150px: a third of the preview's height on a phone, and nobody's idea of
    // a full sweep. Divisions used to cross its entire range inside 140px, so
    // this pinned it at the ceiling and every swipe after it did nothing —
    // which is indistinguishable, from the outside, from a gesture that never
    // registered at all. The horizontal axis moved 29% of its range over the
    // same distance, so the two axes did not feel like one control scheme.
    await dragBy(page, 0, -150);
    await settled(page);
    const after = await numberOf(page, 'Divisions');

    expect(after, 'a moderate swipe did not move the vertical control').toBeGreaterThan(before);
    expect(after, `a 150px swipe took divisions to ${after} of a possible ${max}`).toBeLessThan(max);
  });

  test('a swipe that sets off sideways is still a swipe up', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);

    const densityBefore = await numberOf(page, 'Grid density');
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
    expect(await numberOf(page, 'Grid density'), 'the swipe locked to the direction it set off in').toBe(densityBefore);
  });

  test('a tap moves to the next pattern, and wraps', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);
    const pattern = patternSelect(page);
    await expect(pattern).toHaveValue('truchet-arcs');

    // The registry order is the cycle, and the address bar follows it without
    // a navigation: the editor swaps the generator in place, so the path is
    // rewritten rather than loaded. A reload on that path has to land here.
    const ids = ['truchet-diagonals', 'chevron-blocks', 'contours', 'truchet-arcs'];
    for (const id of ids) {
      await tapPreview(page);
      await settled(page);
      await expect(pattern, `a tap did not reach ${id}`).toHaveValue(id);
      expect(page.url(), `the address bar did not follow to ${id}`).toContain(`/p/${id}/`);
    }
  });

  test('a tap keeps the seed and the palette, and takes the params to their defaults', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);

    const seed = page.getByTestId('seed-input');
    await seed.fill('carried-across');
    await seed.blur();
    await settled(page);

    const density = page.getByLabel('Grid density');
    await density.fill('20');
    await density.blur();
    await settled(page);

    await tapPreview(page);
    await settled(page);

    // Seed and palette come with you; params cannot, because a pattern's
    // parameters are its own. Tapping round the whole cycle therefore gets
    // back what you had, which is the only reading under which overshooting
    // the pattern you wanted is recoverable.
    await expect(patternSelect(page)).toHaveValue('truchet-diagonals');
    await expect(seed, 'the seed did not come across').toHaveValue('carried-across');
    expect(page.url()).toContain('s=carried-across');
    await expect(page.getByLabel('Grid density'), 'the new pattern kept the old one’s value').toHaveValue('8');
  });

  test('a press that barely moves is a tap, not a scrub', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);
    const densityBefore = await numberOf(page, 'Grid density');

    // Four pixels, which is under the lock threshold. A finger never lands
    // perfectly still; without the threshold every tap would also nudge
    // whichever axis it happened to drift toward.
    await dragBy(page, 4, 3);
    await settled(page);

    await expect(patternSelect(page), 'a small movement was not taken as a tap').toHaveValue('truchet-diagonals');
    expect(await numberOf(page, 'Grid density'), 'a tap nudged a scrubbed control').toBe(densityBefore);
  });

  test('the picture tracks the finger, before it lifts', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
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

  // There is no longer a pattern in the app with no gesture bound: the core
  // contract test requires every *registered* generator to name two, because a
  // preview that does nothing under a thumb cannot be told apart from one that
  // is broken — three faults in this repo presented as exactly that. The
  // undeclared case is still covered, against a fabricated generator, in
  // `controls.test.ts`.

  test.describe('the rail on the preview', () => {
    /**
     * Five round buttons down the right edge of the picture. They are there
     * rather than in the panel because every one of them is judged by looking
     * at the preview, and on a phone the panel is a scroll away from it.
     */
    test('the dice draws a new seed', async ({ page }) => {
      await page.goto('/p/truchet-arcs');
      await settled(page);
      const seed = await page.getByTestId('seed-input').inputValue();
      const before = await previewSrc(page);

      await page.getByTestId('preview-dice').click();
      await settled(page);

      expect(await page.getByTestId('seed-input').inputValue(), 'the seed field did not follow the dice').not.toBe(seed);
      expect(await previewSrc(page), 'the dice changed the seed without changing the picture').not.toBe(before);
    });

    test('the droplet opens the palette over the picture, and a palette applies', async ({ page }) => {
      await page.goto('/p/truchet-arcs');
      await settled(page);
      const before = await previewSrc(page);

      const droplet = page.getByTestId('preview-palette');
      await expect(droplet).toHaveAttribute('aria-expanded', 'false');
      await droplet.click();
      await expect(droplet).toHaveAttribute('aria-expanded', 'true');

      await page.getByRole('button', { name: 'Use the Riso Pink palette' }).first().click();
      await settled(page);
      expect(await previewSrc(page), 'choosing a palette in the overlay changed nothing').not.toBe(before);
      expect(page.url(), 'the palette did not reach the share link').toContain('c=riso-pink');
    });

    test('only one sheet is up at a time', async ({ page }) => {
      await page.goto('/p/truchet-arcs');
      await settled(page);

      await page.getByTestId('preview-settings').click();
      await expect(page.getByLabel('Stroke weight')).toBeVisible();

      // The gear and the droplet share a rail and a corner. Opening one has to
      // close the other, or two sheets stack over the picture they are both
      // supposed to be letting you see.
      await page.getByTestId('preview-palette').click();
      await expect(page.getByLabel('Stroke weight')).toHaveCount(0);
      await expect(page.getByTestId('preview-settings')).toHaveAttribute('aria-expanded', 'false');
    });

    test('the heart keeps what is on screen, and says so', async ({ page }) => {
      await page.goto('/p/truchet-arcs');
      await settled(page);

      const heart = page.getByTestId('preview-heart');
      await expect(heart, 'a fresh configuration was already saved').toHaveAttribute('aria-pressed', 'false');

      await heart.click();
      await expect(heart, 'the heart did not fill after saving').toHaveAttribute('aria-pressed', 'true');

      // The same thing the panel's Collect button writes, which is the point of
      // them sharing one action: two writers would be two places for the two to
      // disagree about what is already kept. So the panel reads the same state
      // back without being told.
      await expect(page.getByTestId('collect')).toHaveText('Collected');
      await expect(page.getByTestId('collect')).toHaveAttribute('aria-pressed', 'true');

      // And it survives the trip, which is what "saved" has to mean.
      await page.reload();
      await settled(page);
      await expect(page.getByTestId('preview-heart')).toHaveAttribute('aria-pressed', 'true');
    });

    test('the heart lets go again, from either control', async ({ page }) => {
      /*
       * It only ever added. A filled heart reported "already collected" and
       * pressing it again did nothing at all, so undoing a mistap meant
       * leaving for the collection screen and deleting there — a screen away
       * from the mistake, which is not where anybody looks for it.
       *
       * The heart carries `aria-pressed`, so it was already claiming to be a
       * toggle; this asserts the claim. Both controls, because they share one
       * action and the bug was in that action rather than in either button.
       */
      await page.goto('/p/truchet-arcs');
      await settled(page);
      const heart = page.getByTestId('preview-heart');

      await heart.click();
      await expect(heart).toHaveAttribute('aria-pressed', 'true');
      await heart.click();
      await expect(heart, 'a second press on a full heart did not empty it').toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('collect')).toHaveText('Collect');

      // And it really left storage rather than only the button, which is the
      // half a state-only fix would pass.
      await page.reload();
      await settled(page);
      await expect(page.getByTestId('preview-heart'), 'the wallpaper came back after a reload').toHaveAttribute(
        'aria-pressed',
        'false',
      );

      // The panel button is the same toggle, not a second one that only adds.
      await page.getByTestId('collect').click();
      await expect(heart).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('collect').click();
      await expect(heart, 'the panel button would not let go').toHaveAttribute('aria-pressed', 'false');
    });

    test('the heart does not follow the picture when the picture changes', async ({ page }) => {
      await page.goto('/p/truchet-arcs');
      await settled(page);
      await page.getByTestId('preview-heart').click();
      await expect(page.getByTestId('preview-heart')).toHaveAttribute('aria-pressed', 'true');

      // A different seed is a different wallpaper, so the heart has to empty
      // again. Keyed on the configuration rather than on "something was saved
      // recently", which is the version that would lie.
      await page.getByTestId('preview-dice').click();
      await settled(page);
      await expect(page.getByTestId('preview-heart'), 'the heart stayed full for a wallpaper nobody saved').toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    test('the book goes to the saved wallpapers', async ({ page }) => {
      await page.goto('/p/truchet-arcs');
      await settled(page);
      await page.getByTestId('preview-heart').click();
      await expect(page.getByTestId('preview-heart')).toHaveAttribute('aria-pressed', 'true');

      await page.getByTestId('preview-book').click();
      await expect(page).toHaveURL(/\/collected/);
      await expect(page.locator('img[src^="data:image/svg"]').first()).toBeVisible();
    });
  });

  test.describe('at phone width', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the controls that are not the two are behind the gear', async ({ page }) => {
      await page.goto('/p/truchet-arcs');
      await settled(page);

      // The pattern and its two axes are promoted, visible with nothing to press.
      await expect(patternSelect(page)).toBeVisible();
      await expect(page.getByLabel('Grid density')).toBeVisible();
      await expect(page.getByLabel('Divisions')).toBeVisible();

      // Everything else is not in the page at all until the gear is pressed,
      // which is what keeps one parameter to one slider.
      await expect(page.getByLabel('Stroke weight')).toHaveCount(0);

      const gear = page.getByTestId('preview-settings');
      await expect(gear).toHaveAttribute('aria-expanded', 'false');
      await gear.click();
      await expect(gear).toHaveAttribute('aria-expanded', 'true');

      const weight = page.getByLabel('Stroke weight');
      await expect(weight).toBeVisible();
      await expect(page.getByLabel('Arc spread')).toBeVisible();
      await expect(page.getByLabel('Colour spread')).toBeVisible();
      // Name and slider only: no paragraph of explanation in a sheet this size.
      await expect(page.locator('text=Line width as a fraction')).toHaveCount(0);

      await gear.click();
      await expect(page.getByLabel('Stroke weight')).toHaveCount(0);
    });

    test('a press outside the sheet dismisses it instead of cycling the pattern', async ({ page }) => {
      await page.goto('/p/truchet-arcs');
      await settled(page);

      const gear = page.getByTestId('preview-settings');
      await gear.click();
      await expect(page.getByLabel('Stroke weight')).toBeVisible();

      // Over the picture, clear of the sheet, and squarely on the gesture
      // surface — which would have taken this as a tap and moved to the next pattern
      // under a menu asking about something else.
      //
      // Measured against the sheet rather than assumed. This used to press a
      // fifth of the way down, which was clear of the sheet until a seventh
      // param took it to its 78% cap and moved its top edge to 19.5%; the press
      // then landed half a percent inside it and the test failed for a reason
      // that had nothing to do with dismissal. Anything that changes how many
      // controls live behind the gear moves that edge.
      const box = await page.locator('[class*="phone"]').first().boundingBox();
      if (!box) throw new Error('the preview frame has no box');
      const sheetBox = await page.locator('[class*="sheet"]').first().boundingBox();
      if (!sheetBox) throw new Error('the settings sheet has no box');
      const clearOfSheet = (sheetBox.y - box.y) / 2;
      expect(clearOfSheet, 'no room above the sheet to press in').toBeGreaterThan(8);
      await page.mouse.click(box.x + box.width / 2, box.y + clearOfSheet);
      await settled(page);

      await expect(gear, 'the press outside the sheet did not close it').toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByLabel('Stroke weight')).toHaveCount(0);
      await expect(patternSelect(page), 'dismissing the sheet also changed the pattern').toHaveValue('truchet-arcs');
    });

    test('the preview leaves room to scroll past it', async ({ page }) => {
      await page.goto('/p/truchet-arcs');
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

/**
 * A coarse control must not cost a full sweep of the screen per step.
 *
 * "Edge to edge is the whole range" spreads a range over the surface, so a
 * step costs surface/steps — right for a fine control and wrong for a control
 * with four of them, where one change takes most of the preview's height.
 * Contours' detail is the worst of these and truchet's diagonal divisions are
 * next; truchet's arc divisions have eleven steps and are the one everybody
 * drives, so they are the control this must not disturb.
 *
 * The assertion is the rule rather than the arithmetic: a short drag on a
 * coarse control moves it, and the same drag on a fine one does not run away.
 */
test.describe('scrub travel', () => {
  test('a short drag moves a four-step control more than one step', async ({ page }) => {
    await page.goto('/p/contours');
    await settled(page);
    const detail = page.getByLabel('Detail');
    const min = Number(await detail.getAttribute('min'));
    const max = Number(await detail.getAttribute('max'));
    await detail.fill(String(min));
    await detail.blur();
    await settled(page);

    // A third of the preview's height. Spread over the whole surface a
    // four-step control moves one step in this, or none at all once the axis
    // lock has taken its lead out.
    const box = await page.locator('[class*="phone"]').first().boundingBox();
    if (!box) throw new Error('the preview frame has no box');
    await dragSmoothly(page, 0, -Math.round(box.height / 3));
    await settled(page);

    const after = await numberOf(page, 'Detail');
    expect(after, 'a third of the surface should cover more than one step of four').toBeGreaterThan(min + 1);
    // `toBeLessThanOrEqual(max)` could not fail: `quantise` clamps to max, so
    // the value the message is worried about is the value that satisfied it.
    expect(after, 'and should not slam it to the end either').toBeLessThan(max);
  });

  test('the eleven-step control is untouched: half a sweep is still half its range', async ({ page }) => {
    await page.goto('/p/truchet-arcs');
    await settled(page);
    const divisions = page.getByLabel('Divisions');
    const min = Number(await divisions.getAttribute('min'));
    await divisions.fill(String(min));
    await divisions.blur();
    await settled(page);

    const box = await page.locator('[class*="phone"]').first().boundingBox();
    if (!box) throw new Error('the preview frame has no box');
    const cx = box.x + box.width / 2;
    const from = box.y + box.height - 1;
    const distance = Math.round(box.height / 2);
    await page.mouse.move(cx, from);
    await page.mouse.down();
    const n = 60;
    for (let i = 1; i <= n; i++) await page.mouse.move(cx, from - (distance * i) / n);
    await page.mouse.up();
    await settled(page);

    // Half the surface is half the range, which is the promise the whole
    // design rests on and the thing a floor must not quietly rescale.
    //
    // Half a sweep rather than a full one on purpose: a full sweep reaches the
    // end whether the travel is right or merely *short*, because it clamps.
    // The first version of this test dragged edge to edge and passed happily
    // with the floor raised to sixteen, which would have squeezed this very
    // control — the one it exists to protect.
    const after = await numberOf(page, 'Divisions');
    expect(after, `half a sweep took divisions to ${after}, where half the range is about 6`).toBeGreaterThanOrEqual(5);
    expect(after, `half a sweep took divisions to ${after}, where half the range is about 6`).toBeLessThanOrEqual(7);
  });
});
