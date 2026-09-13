import { describe, expect, it } from 'vitest';
import {
  createRng,
  curatedPalettes,
  decodeConfig,
  defaultPalette,
  defaultParams,
  encodeConfig,
  generators,
  initialConfig,
  normalizePalette,
  packPalette,
  renderToSvg,
  unpackPalette,
  type ParamValue,
  type PatternConfig,
} from '../src/index.js';

describe('share links', () => {
  it('round-trips the default configuration for every generator', () => {
    for (const g of generators) {
      const config = initialConfig(g.id);
      const { config: back, notes } = decodeConfig(g.id, encodeConfig(config));
      expect(notes).toEqual([]);
      expect(back.generatorId).toBe(config.generatorId);
      expect(back.seed).toBe(config.seed);
      expect(back.params).toEqual(config.params);
      expect(back.palette.background).toBe(config.palette.background);
    }
  });

  it('round-trips randomised configurations to an identical render', () => {
    const rng = createRng(1234);
    for (let i = 0; i < 40; i++) {
      const g = generators[rng.int(0, generators.length - 1)]!;
      const params: Record<string, ParamValue> = { ...defaultParams(g) };
      for (const spec of g.params) {
        if (spec.type === 'number') {
          const steps = Math.max(1, Math.round((spec.max - spec.min) / spec.step));
          params[spec.key] = Number((spec.min + rng.int(0, steps) * spec.step).toFixed(4));
        } else if (spec.type === 'boolean') params[spec.key] = rng.bool();
        else params[spec.key] = rng.pick(spec.options).value;
      }
      const palette = rng.pick(curatedPalettes);
      const config: PatternConfig = { generatorId: g.id, seed: `s-${i}`, params, palette };
      const { config: back } = decodeConfig(g.id, encodeConfig(config));
      const a = renderToSvg({ generator: g, width: 200, height: 430, palette: config.palette, params: config.params, seed: config.seed, bleed: 0.08 });
      const b = renderToSvg({ generator: g, width: 200, height: 430, palette: back.palette, params: back.params, seed: back.seed, bleed: 0.08 });
      expect(b === a, `config ${i} for ${g.id} did not round-trip`).toBe(true);
    }
  });

  it('round-trips a custom palette that is not in the library', () => {
    const g = generators[0]!;
    const palette = {
      id: 'custom',
      name: 'Custom',
      background: '#0a0b0c',
      ink: '#fafbfc',
      accents: ['#112233', '#445566', '#778899'],
      mode: 'dark' as const,
    };
    const encoded = encodeConfig({ generatorId: g.id, seed: 'zz', params: defaultParams(g), palette });
    const { config, notes } = decodeConfig(g.id, encoded);
    expect(notes).toEqual([]);
    expect(config.palette.background).toBe('#0a0b0c');
    expect(config.palette.ink).toBe('#fafbfc');
    expect(config.palette.accents).toEqual(['#112233', '#445566', '#778899']);
    expect(config.palette.mode).toBe('dark');
  });

  it('keeps library palettes as a slug so links stay short', () => {
    const g = generators[0]!;
    const encoded = encodeConfig({ generatorId: g.id, seed: 'a', params: defaultParams(g), palette: curatedPalettes[0]! });
    expect(encoded).toContain(`c=${curatedPalettes[0]!.id}`);
    expect(encoded.length).toBeLessThan(140);
  });

  it('recovers from malformed links with a note instead of throwing', () => {
    const g = generators[0]!;
    const cases = ['', '?', 's=&q=&c=', 'q=1_2_3', 'c=~znotahex', 'c=nope', 's=' + 'x'.repeat(200), 'q=' + 'a_'.repeat(60)];
    for (const search of cases) {
      const r = decodeConfig(g.id, search);
      expect(r.config.generatorId).toBe(g.id);
      expect(() =>
        renderToSvg({ generator: g, width: 120, height: 260, palette: r.config.palette, params: r.config.params, seed: r.config.seed, bleed: 0 }),
      ).not.toThrow();
    }
    const bogus = decodeConfig('no-such-pattern', '');
    expect(bogus.notes.length).toBeGreaterThan(0);
    expect(bogus.config.generatorId).toBe(generators[0]!.id);
  });

  /**
   * A palette that has been through the front door must survive its own link.
   *
   * It did not. The Colours tab accepted eight-digit hex, `oklchToHex`
   * round-tripped the alpha, `mixOklch` carried it into two generators'
   * background gradients — and `packHex` truncated it, so the link rendered a
   * different picture from the editor that produced it. A four-digit hex was
   * worse: it fell through to '000000' and turned the colour black.
   *
   * Alpha is now dropped at the door instead, and shorthand is expanded, so
   * every colour has one spelling that the whole chain can carry. The cases
   * below are exactly the ones that used to break.
   */
  it('round-trips a palette whose colours arrived in every accepted spelling', () => {
    const p = normalizePalette(
      {
        id: 'spellings',
        name: 'Spellings',
        background: '#171520f7', // 8-digit, alpha
        ink: '#fff', //             3-digit shorthand
        accents: ['#ff7a3daa', '#0af', '#1234', '#112233'],
        mode: 'dark',
        tags: [],
      },
      defaultPalette,
    );

    // Normalisation is what makes the round trip possible: six digits, no alpha.
    for (const hex of [p.background, p.ink, ...p.accents]) {
      expect(hex, `${hex} is not a plain six-digit colour`).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Specifically: alpha dropped, not truncated into a different colour, and
    // the four-digit case not blackened.
    expect(p.background).toBe('#171520');
    expect(p.accents[2]).toBe('#112233');

    const back = unpackPalette(packPalette(p));
    expect(back).not.toBeNull();
    expect(back!.background).toBe(p.background);
    expect(back!.ink).toBe(p.ink);
    expect(back!.accents).toEqual(p.accents);
  });

  /**
   * packPalette is exported and does not normalise what it is handed —
   * saveCollected, for one, stores whatever palette the config carried. So its
   * own handling of a four-digit hex matters: it used to fall through to
   * '000000', turning a colour black in the link rather than merely losing its
   * transparency. Normalisation now expands shorthand before it gets here,
   * which is why this exercises packPalette directly rather than through it.
   */
  it('does not blacken a four-digit hex it is handed unnormalised', () => {
    const packed = packPalette({
      id: 'raw',
      name: 'Raw',
      background: '#1234',
      ink: '#ffffff',
      accents: ['#f00a'],
      mode: 'dark',
      tags: [],
    });
    const back = unpackPalette(packed);
    expect(back).not.toBeNull();
    expect(back!.background, 'a four-digit background packed to black').toBe('#112233');
    expect(back!.accents[0], 'a four-digit accent packed to black').toBe('#ff0000');
  });

  it('rejects palette tokens that are the wrong shape', () => {
    expect(unpackPalette('~dabc')).toBeNull();
    expect(unpackPalette('~d0000001111112222')).toBeNull();
    expect(unpackPalette('')).toBeNull();
    expect(unpackPalette('~d000000111111222222')).not.toBeNull();
  });
});
