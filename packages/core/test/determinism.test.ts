import { describe, expect, it, vi } from 'vitest';
import { renderToSvg } from '../src/index.js';
import { ALL_GENERATORS, baseParams, TEST_PALETTES } from './helpers.js';

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
