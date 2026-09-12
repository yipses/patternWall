import { describe, expect, it, vi } from 'vitest';
import { renderToSvg } from '../src/index.js';
import { ALL_GENERATORS, baseParams, rasterize, TEST_PALETTES } from './helpers.js';

const W = 320;
const H = 693;

describe('determinism', () => {
  for (const g of ALL_GENERATORS) {
    const palette = TEST_PALETTES[0]!;

    it(`${g.id}: repeated calls with the same inputs are byte-identical`, () => {
      const req = { generator: g, width: W, height: H, palette, params: baseParams(g), seed: 'anchor', bleed: 0.08 };
      const a = renderToSvg(req);
      const b = renderToSvg(req);
      const c = renderToSvg({ ...req, params: { ...baseParams(g) } });
      expect(a).toBe(b);
      expect(a).toBe(c);
      expect(a.length).toBeGreaterThan(200);
    });

    it(`${g.id}: a different seed produces a different render`, () => {
      const req = { generator: g, width: W, height: H, palette, params: baseParams(g), seed: 'anchor', bleed: 0.08 };
      const a = renderToSvg(req);
      const b = renderToSvg({ ...req, seed: 'anchor-2' });
      expect(a).not.toBe(b);
    });

    it(`${g.id}: a different palette produces a different render`, () => {
      const req = { generator: g, width: W, height: H, palette, params: baseParams(g), seed: 'anchor', bleed: 0.08 };
      const a = renderToSvg(req);
      const b = renderToSvg({ ...req, palette: TEST_PALETTES[1]! });
      expect(a).not.toBe(b);
    });
  }

  it('a freshly loaded module produces the identical string', async () => {
    vi.resetModules();
    const first = await import('../src/index.js');
    const g1 = first.generators[0]!;
    const p1 = first.curatedPalettes.find((p) => p.id === 'obsidian')!;
    const s1 = first.renderToSvg({
      generator: g1,
      width: W,
      height: H,
      palette: p1,
      params: first.defaultParams(g1),
      seed: 'fresh-load',
      bleed: 0.08,
    });

    vi.resetModules();
    const second = await import('../src/index.js');
    expect(second).not.toBe(first);
    const g2 = second.generators[0]!;
    const p2 = second.curatedPalettes.find((p) => p.id === 'obsidian')!;
    const s2 = second.renderToSvg({
      generator: g2,
      width: W,
      height: H,
      palette: p2,
      params: second.defaultParams(g2),
      seed: 'fresh-load',
      bleed: 0.08,
    });

    expect(s2).toBe(s1);
  });

  it('unknown and malformed params fall back to declared defaults', async () => {
    const g = ALL_GENERATORS[0]!;
    const palette = TEST_PALETTES[0]!;
    const clean = renderToSvg({ generator: g, width: W, height: H, palette, params: baseParams(g), seed: 's', bleed: 0 });
    const dirty = renderToSvg({
      generator: g,
      width: W,
      height: H,
      palette,
      params: { ...baseParams(g), notARealKey: 42, quietTop: Number.NaN },
      seed: 's',
      bleed: 0,
    });
    expect(dirty).toBe(clean);
  });
});

/**
 * Generators must be resolution-independent: a 108px thumbnail and a 1399px
 * export of the same configuration have to be the same picture, not two
 * different ones. A threshold expressed in absolute pixels breaks this, and
 * because such a threshold usually gates a random decision, it desynchronises
 * the whole stream rather than just changing a detail.
 *
 * Exact equality is not achievable — dots that land within a rounding error of
 * the canvas edge fall inside at one scale and outside at another — so the
 * contract is that the shape counts agree to within a fraction of a percent.
 */
describe('scale invariance', () => {
  const countTag = (svg: string, tag: string): number => (svg.match(new RegExp(`<${tag}[ /]`, 'g')) ?? []).length;
  const TAGS = ['circle', 'path', 'polygon', 'polyline', 'ellipse', 'rect'];

  for (const g of ALL_GENERATORS) {
    it(`${g.id} emits the same structure at 108px, 430px and 1399px`, () => {
      const palette = TEST_PALETTES[0]!;
      const render = (w: number): string =>
        renderToSvg({
          generator: g,
          width: w,
          height: Math.round((w * 19.5) / 9),
          palette,
          params: baseParams(g),
          seed: 'scale',
          bleed: 0.08,
        });
      const [small, mid, big] = [render(108), render(430), render(1399)];
      for (const tag of TAGS) {
        const counts = [countTag(small, tag), countTag(mid, tag), countTag(big, tag)];
        const lo = Math.min(...counts);
        const hi = Math.max(...counts);
        const tolerance = Math.max(1, Math.ceil(hi * 0.005));
        expect(hi - lo, `${g.id} <${tag}> counts drift across scales: ${counts.join(' / ')}`).toBeLessThanOrEqual(tolerance);
      }
    });
  }

  /**
   * The counts above are necessary and nowhere near sufficient, and phyllotaxis
   * proved it: two noise fields keyed on pixel coordinates drew a visibly
   * different picture at 108px and 1399px — different dot positions, the
   * desaturated region in a different place, six accent bands against eight —
   * while emitting 809 / 812 / 807 circles, a drift of 5 against a tolerance of
   * 5. A count cannot see where anything is or what colour it came out.
   *
   * So compare the pictures. Render at two sizes an exact factor of four apart,
   * rasterise both down to the same width, and take the mean absolute
   * difference per channel. The threshold comes from measuring both cases
   * rather than from what sounds reasonable: with the bug, phyllotaxis scores
   * 9.55; without it, the four generators score 0.00 to 0.47, and the floor set
   * by resampling alone — the same render at 864 and 865 px — is 0.08 to 0.23.
   * 2.0 sits four times above the worst honest score and nearly five times
   * below the broken one.
   */
  const COMMON = 216;
  const MAX_DRIFT = 2;

  const meanChannelDiff = (a: Buffer, b: Buffer): number => {
    const n = Math.min(a.length, b.length);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.abs((a[i] as number) - (b[i] as number));
    return sum / n;
  };

  const drift = (g: (typeof ALL_GENERATORS)[number], params: Record<string, number | string | boolean>): number => {
    const shot = (w: number): Buffer =>
      rasterize(
        renderToSvg({
          generator: g,
          width: w,
          height: Math.round((w * 19.5) / 9),
          palette: TEST_PALETTES[0]!,
          params,
          seed: 'scale',
          bleed: 0.08,
        }),
        COMMON,
      ).pixels;
    return meanChannelDiff(shot(COMMON), shot(COMMON * 4));
  };

  for (const g of ALL_GENERATORS) {
    it(`${g.id} draws the same picture at ${COMMON}px and ${COMMON * 4}px`, () => {
      const d = drift(g, baseParams(g));
      expect(d, `${g.id} renders differently at the two sizes: mean channel difference ${d.toFixed(2)}`).toBeLessThan(
        MAX_DRIFT,
      );
    });
  }

  /**
   * The default phyllotaxis shape is a filled dot, which has no stroke, so the
   * loop above never touches the ring path at all. Its stroke width used to be
   * floored at an absolute 0.35px, which is a different fraction of the canvas
   * at every size.
   *
   * The raster comparison above is the wrong instrument for this one, and
   * writing it that way first produced a test that could not fail: at 216px
   * only 56% of rings sit on the old floor and the excess is a fraction of a
   * pixel, which resampling swallows whole. Measure the quantity that is
   * actually wrong instead — stroke width as a fraction of the canvas — and at
   * the size where it bites, the 108px gallery thumbnail. With the absolute
   * floor, 100% of rings sit on it at 108px and none do at 864px, so the mean
   * relative width is 3.24e-3 against 1.40e-3, a ratio of 2.31. With a relative
   * floor both sizes read 1.40e-3. The bound is 1.2.
   */
  it('phyllotaxis draws rings at the same relative weight at 108px and 864px', () => {
    const g = ALL_GENERATORS.find((x) => x.id === 'phyllotaxis')!;
    const params = { ...baseParams(g), shape: 'ring', dotScale: 0.25, count: 4200 };
    const meanRelativeWidth = (w: number): number => {
      const h = Math.round((w * 19.5) / 9);
      const svg = renderToSvg({ generator: g, width: w, height: h, palette: TEST_PALETTES[0]!, params, seed: 'scale', bleed: 0.08 });
      const widths = [...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
      expect(widths.length, 'the ring shape emitted no strokes to measure').toBeGreaterThan(100);
      return widths.reduce((a, b) => a + b, 0) / widths.length / Math.min(w, h);
    };
    const small = meanRelativeWidth(108);
    const big = meanRelativeWidth(864);
    const ratio = small / big;
    expect(ratio, `phyllotaxis rings are ${ratio.toFixed(2)}x heavier at 108px than at 864px, relative to the canvas`).toBeLessThan(1.2);
  });
});
