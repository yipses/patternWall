import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { hexToOklch, renderToSvg } from '../src/index.js';
import { ALL_GENERATORS, baseParams, TEST_PALETTES } from './helpers.js';

const blocks = ALL_GENERATORS.find((g) => g.id === 'chevron-blocks')!;
const W = 430;
const H = 932;

function render(over: Record<string, number | string | boolean> = {}): string {
  return renderToSvg({
    generator: blocks,
    width: W,
    height: H,
    palette: TEST_PALETTES[0]!,
    params: { ...baseParams(blocks), ...over },
    seed: 'blocks',
    bleed: 0,
  });
}

/** Every polygon of a render, as its list of points. */
function faces(svg: string): [number, number][][] {
  return [...svg.matchAll(/<polygon points="([^"]+)"/g)].map((m) =>
    (m[1] as string)
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(',').map(Number) as [number, number]),
  );
}

/**
 * A roof or a wall.
 *
 * The projection tells them apart exactly, with no tolerance needed: a roof is
 * the ground rhombus lifted, so its four corners sit at three different
 * horizontal positions — left, right and the two that share the middle. A wall
 * is a vertical parallelogram between two ground corners, so it has only two.
 */
function isWall(face: [number, number][]): boolean {
  return new Set(face.map((p) => p[0].toFixed(1))).size === 2;
}

describe('chevron-blocks', () => {
  /**
   * The surface has no holes in it.
   *
   * This is a heightfield seen from a fixed angle, so the drawing is a closed
   * surface: every roof is joined to its neighbour by a wall exactly as tall as
   * the step between them, and the lattice has to run far enough past all four
   * edges that the canvas is inside it. Both halves fail the same way — a
   * missing wall and a lattice that stops too early both show as background
   * through the pattern — and neither is visible at the defaults if the margin
   * is merely a little too small, because the hole opens at whichever corner
   * the tallest stack happens to be in.
   *
   * A stack reaches a whole cube upward per storey while a row of ground steps
   * down only half of one, so the walk has to start two rows early per storey
   * of possible height. That factor of two is the easy thing to get wrong, so
   * the extremes are tested rather than the middle: the biggest blocks, the
   * smallest, and the tallest stacks the controls allow.
   *
   * Mortar is off throughout, since it paints background lines on purpose and
   * this test is looking for background where none was asked for.
   */
  it.each([
    ['defaults', {}],
    ['tallest stacks', { relief: 1, skyline: 0 }],
    ['largest blocks', { blockSize: 0.16, relief: 1, skyline: 0 }],
    ['smallest blocks', { blockSize: 0.035 }],
  ])('covers the canvas with no gaps: %s', (_label, over) => {
    const svg = render({ ...over, mortar: 0 });
    const px = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().pixels;
    const paper = TEST_PALETTES[0]!.background;
    const [pr, pg, pb] = [1, 3, 5].map((i) => parseInt(paper.slice(i, i + 2), 16)) as [number, number, number];

    let holes = 0;
    let total = 0;
    for (let i = 0; i + 3 < px.length; i += 4) {
      total += 1;
      const d =
        Math.abs((px[i] as number) - pr) + Math.abs((px[i + 1] as number) - pg) + Math.abs((px[i + 2] as number) - pb);
      if (d < 8) holes += 1;
    }
    const share = holes / total;
    expect(share, `${(share * 100).toFixed(2)}% of the canvas is bare background`).toBeLessThan(0.001);
  });

  /**
   * At no relief there is nothing to be in relief: the walls are the steps
   * between stacks, so when every stack is one cube tall there are no steps and
   * the pattern falls back to the flat rhombic tiling the projection started
   * from.
   *
   * Asserted as an exact zero rather than a threshold, because it is exact —
   * a wall exists only where a column out-tops its neighbour. The bug it
   * guards against is the obvious implementation, which runs every wall down to
   * the ground instead of down to the neighbour: that draws the inside of the
   * solid, costs several times the geometry, and puts a full set of walls into
   * a render that should have none at all.
   */
  it('draws no walls when every stack is the same height', () => {
    const flat = faces(render({ relief: 0 }));
    expect(flat.length, 'nothing was drawn').toBeGreaterThan(200);
    const walls = flat.filter(isWall);
    expect(walls.length, `${walls.length} walls in a render with no steps to wall`).toBe(0);

    // And the other end, so this cannot pass by drawing nothing anywhere.
    const relieved = faces(render({ relief: 1 }));
    expect(relieved.filter(isWall).length, 'no walls at full relief either').toBeGreaterThan(100);
  });

  /**
   * Skyline is a claim about composition and it has to be structural to make
   * it. The rule in this repo is that a factor keyed on height, applied to a
   * uniform tiling, draws a horizontal band across it rather than a
   * composition — so what falls away toward the top here is the relief itself,
   * not the ink. Walls only exist where stacks differ, which makes the share of
   * the drawing that is wall a direct measure of how much is going on.
   *
   * Measured as that share in the top quarter against the bottom third: 0.51 at
   * skyline zero, 0.10 at the default and 0.00 at the top of the control. The
   * zero end is not 1.0 because the top edge clips the stacks that cross it,
   * which is why both ends are measured rather than assuming a flat baseline.
   */
  it('empties the top of the canvas of stacks, and not at zero', () => {
    const wallShare = (skyline: number): number => {
      const f = faces(render({ skyline }));
      let walls = 0;
      let roofs = 0;
      let lowWalls = 0;
      let lowRoofs = 0;
      for (const face of f) {
        const cy = face.reduce((a, p) => a + p[1], 0) / face.length;
        if (cy < H * 0.25) {
          if (isWall(face)) walls += 1;
          else roofs += 1;
        } else if (cy >= H * 0.7) {
          if (isWall(face)) lowWalls += 1;
          else lowRoofs += 1;
        }
      }
      expect(lowWalls + lowRoofs, 'nothing in the lower canvas to compare against').toBeGreaterThan(50);
      const top = walls / Math.max(1, walls + roofs);
      const bottom = lowWalls / Math.max(1, lowWalls + lowRoofs);
      return top / Math.max(1e-6, bottom);
    };

    const level = wallShare(0);
    const composed = wallShare(0.85);
    expect(level, `at skyline 0 the stacks should be as tall up top as below, got ${level.toFixed(3)}`).toBeGreaterThan(0.4);
    expect(
      composed,
      `the default skyline left ${composed.toFixed(3)} of the lower canvas's wall share up top, against ${level.toFixed(3)} at zero`,
    ).toBeLessThan(0.25);
  });

  /**
   * A cube is one colour under a light, not three colours.
   *
   * The three faces are one accent at three lightnesses, and that is the whole
   * reason a flat arrangement of rhombi reads as a solid: change the hue
   * between faces as well and the eye stops seeing a light source and starts
   * seeing a mosaic. So every fill in the document should belong to a hue that
   * carries at most three of them, and those three should differ in lightness
   * and in nothing else that matters.
   *
   * Measured at the defaults: 41 fills across 26 hues, three at most in any of
   * them.
   */
  it('paints each block as one hue at three lightnesses', () => {
    const fills = [...new Set([...render().matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1] as string))];
    expect(fills.length, 'too few fills to say anything').toBeGreaterThan(10);

    const byHue = new Map<number, string[]>();
    for (const fill of fills) {
      const key = Math.round(hexToOklch(fill).h);
      byHue.set(key, [...(byHue.get(key) ?? []), fill]);
    }
    const worst = Math.max(...[...byHue.values()].map((v) => v.length));
    expect(worst, `one hue is used by ${worst} different fills, so a cube is not one colour`).toBeLessThanOrEqual(3);

    // Within a hue the faces differ in lightness. A trio that differs only in
    // chroma would be a shadow that changes colour rather than brightness.
    for (const group of byHue.values()) {
      if (group.length < 2) continue;
      const ls = group.map((f) => hexToOklch(f).l);
      expect(Math.max(...ls) - Math.min(...ls), `a hue's faces span no lightness: ${group.join(' ')}`).toBeGreaterThan(0.03);
    }
  });
});
