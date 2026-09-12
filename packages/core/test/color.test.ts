import { describe, expect, it } from 'vitest';
import {
  accent,
  accentAt,
  checkPalette,
  contrastRatio,
  createRng,
  curatedPalettes,
  hashSeed,
  hexToOklch,
  isHex,
  mixOklch,
  oklchToHex,
  rampBetween,
  relativeLuminance,
  safeZonesFor,
  seedToInt,
  visibleRect,
  type Palette,
} from '../src/index.js';

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

describe('colour maths', () => {
  it('round-trips hex -> oklch -> hex exactly for the curated library', () => {
    for (const p of curatedPalettes) {
      for (const hex of [p.background, p.ink, ...p.accents]) {
        const back = oklchToHex(hexToOklch(hex));
        expect(back, `${p.id} ${hex}`).toBe(hex.toLowerCase());
      }
    }
  });

  it('round-trips a large sample of random colours within 1/255', () => {
    const rng = createRng(20260909);
    for (let i = 0; i < 4000; i++) {
      const hex = `#${Array.from({ length: 6 }, () => '0123456789abcdef'[rng.int(0, 15)]).join('')}`;
      const back = oklchToHex(hexToOklch(hex));
      expect(back).toMatch(HEX);
      for (let c = 1; c < 7; c += 2) {
        const a = parseInt(hex.slice(c, c + 2), 16);
        const b = parseInt(back.slice(c, c + 2), 16);
        expect(Math.abs(a - b), `${hex} -> ${back}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('gamut-maps wildly out-of-range OKLCH without ever producing invalid hex', () => {
    const rng = createRng(7);
    for (let i = 0; i < 3000; i++) {
      const c = { l: rng.range(-0.5, 1.5), c: rng.range(0, 0.9), h: rng.range(-720, 1080) };
      const hex = oklchToHex(c);
      expect(hex, JSON.stringify(c)).toMatch(HEX);
      expect(hex.includes('NaN')).toBe(false);
    }
    for (const bad of [
      { l: Number.NaN, c: Number.NaN, h: Number.NaN },
      { l: Infinity, c: -Infinity, h: 0 },
      { l: 0.5, c: 10, h: 200 },
    ]) {
      expect(oklchToHex(bad)).toMatch(HEX);
    }
  });

  it('tolerates malformed hex input rather than throwing', () => {
    for (const bad of ['', '#', 'nope', '#12345', '#zzzzzz', '#ff00ff00ff']) {
      expect(() => hexToOklch(bad)).not.toThrow();
      expect(oklchToHex(hexToOklch(bad))).toMatch(HEX);
    }
    expect(isHex('#abc')).toBe(true);
    expect(isHex('#abcd12')).toBe(true);
    expect(isHex('#gg0011')).toBe(false);
  });

  it('preserves alpha through a round trip', () => {
    const c = hexToOklch('#3366cc80');
    expect(c.alpha).toBeCloseTo(128 / 255, 3);
    expect(oklchToHex(c)).toBe('#3366cc80');
  });

  it('mixes hue along the short arc', () => {
    const a = hexToOklch('#ff0000');
    const b = hexToOklch('#ff00ff');
    const mid = mixOklch(a, b, 0.5);
    expect(mid.h).toBeGreaterThan(Math.min(a.h, b.h) - 1);
    const wrap = mixOklch({ l: 0.6, c: 0.1, h: 350 }, { l: 0.6, c: 0.1, h: 10 }, 0.5);
    expect(wrap.h % 360).toBeCloseTo(0, 4);
  });

  it('produces monotonic lightness ramps', () => {
    const ramp = rampBetween('#000000', '#ffffff', 9);
    expect(ramp).toHaveLength(9);
    expect(ramp[0]).toBe('#000000');
    expect(ramp[8]).toBe('#ffffff');
    for (let i = 1; i < ramp.length; i++) {
      expect(relativeLuminance(ramp[i]!)).toBeGreaterThan(relativeLuminance(ramp[i - 1]!));
    }
    expect(rampBetween('#123456', '#654321', 1)).toHaveLength(1);
  });

  it('computes the WCAG reference contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 4);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 6);
    expect(contrastRatio('#777777', '#ffffff')).toBeGreaterThan(4.4);
  });
});

describe('palette helpers', () => {
  const p: Palette = { id: 't', name: 'T', background: '#000000', ink: '#ffffff', accents: ['#ff0000', '#00ff00'], mode: 'dark' };

  it('wraps accent indices in both directions and never returns undefined', () => {
    expect(accent(p, 0)).toBe('#ff0000');
    expect(accent(p, 1)).toBe('#00ff00');
    expect(accent(p, 2)).toBe('#ff0000');
    expect(accent(p, -1)).toBe('#00ff00');
    expect(accent(p, 999)).toBeTruthy();
    expect(accent(p, Number.NaN)).toBe('#ff0000');
    expect(accent({ ...p, accents: [] }, 3)).toBe('#ffffff');
  });

  it('gives a continuous ramp even for a single accent', () => {
    const one = { ...p, accents: ['#abcdef'] };
    expect(accentAt(one, 0)).toBe('#abcdef');
    expect(accentAt(one, 1)).toBe('#abcdef');
    expect(accentAt(p, 0.5)).toMatch(HEX);
    expect(accentAt(p, -5)).toMatch(HEX);
  });

  it('warns about low ink contrast but never throws', () => {
    const low = checkPalette({ id: 'x', name: 'x', background: '#555555', ink: '#5a5a5a', accents: ['#565656'], mode: 'dark' });
    expect(low.some((w) => w.id === 'ink-contrast')).toBe(true);
    for (const pal of curatedPalettes) expect(() => checkPalette(pal)).not.toThrow();
  });

  it('leaves the strongest curated palettes unwarned about contrast', () => {
    for (const id of ['obsidian', 'monochrome-light', 'cobalt-paper']) {
      const pal = curatedPalettes.find((c) => c.id === id)!;
      expect(checkPalette(pal).some((w) => w.id === 'ink-contrast')).toBe(false);
    }
  });

  it('ships at least 36 curated palettes, with unique ids and several true blacks', () => {
    expect(curatedPalettes.length).toBeGreaterThanOrEqual(36);
    expect(new Set(curatedPalettes.map((c) => c.id)).size).toBe(curatedPalettes.length);
    expect(curatedPalettes.filter((c) => c.background === '#000000').length).toBeGreaterThanOrEqual(4);
    expect(curatedPalettes.filter((c) => c.pair).length).toBeGreaterThanOrEqual(6);
    for (const c of curatedPalettes) {
      expect(c.accents.length).toBeGreaterThanOrEqual(1);
      expect(c.accents.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('rng', () => {
  it('is reproducible and reasonably uniform', () => {
    const a = Array.from({ length: 5 }, () => createRng(42).next());
    expect(new Set(a).size).toBe(1);
    const r = createRng(1);
    let sum = 0;
    for (let i = 0; i < 20000; i++) sum += r.next();
    expect(sum / 20000).toBeGreaterThan(0.48);
    expect(sum / 20000).toBeLessThan(0.52);
  });

  it('keeps int() in range and gaussian() finite', () => {
    const r = createRng(9);
    for (let i = 0; i < 5000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isFinite(r.gaussian())).toBe(true);
    }
    expect(() => createRng(1).pick([])).toThrow();
  });

  it('hashes strings to distinct uint32 values', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(hashSeed(`seed-${i}`));
    expect(seen.size).toBe(2000);
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('')).toBeGreaterThanOrEqual(0);
  });

  // The behavioural test for the finalising mix, not a test that some
  // particular constant is present. Salting one key per item is the natural way
  // to ask a hash for several independent decisions, and bare FNV-1a does not
  // answer: it ends on a multiply, so the last character barely moves the
  // result. Both thresholds are set from measuring the two implementations
  // rather than from what sounds reasonable — unmixed scores 0.987 and 0.014,
  // mixed scores 0.522 and 0.319, and a fair coin would score 0.5 and 1/3.
  it('decorrelates keys that differ only in their last character', () => {
    const PAIRS = 2000;
    let sameSide = 0;
    let spread = 0;
    for (let i = 0; i < PAIRS; i++) {
      const a = hashSeed(`cell:${i}:1`) / 0x100000000;
      const b = hashSeed(`cell:${i}:2`) / 0x100000000;
      if (a >= 0.5 === b >= 0.5) sameSide += 1;
      spread += Math.abs(a - b);
    }
    expect(sameSide / PAIRS).toBeLessThan(0.6);
    expect(spread / PAIRS).toBeGreaterThan(0.25);
  });

  // The seeding hash is deliberately *not* the mixed one, and these numbers are
  // why it cannot quietly become it: they are the identity of every saved
  // wallpaper. Routing seedToInt through hashSeed repaints all of them, so this
  // fails rather than letting that happen by accident.
  it('pins the seeding hash so saved configurations keep their picture', () => {
    expect(seedToInt('bergamot', 'truchet')).toBe(635128179);
    expect(seedToInt('sample-1', 'flow-dots')).toBe(3559565924);
    expect(seedToInt('zz', 'ridgelines')).toBe(3283354683);
    // Numeric seeds go through the same path as their decimal string.
    expect(seedToInt(42, 'truchet')).toBe(seedToInt('42', 'truchet'));
  });
});

describe('geometry', () => {
  it('keeps safe zones inside the canvas and in the expected order', () => {
    const z = safeZonesFor(1206, 2622);
    for (const r of [z.clock, z.widgets, z.controls, z.iconGrid]) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1206);
      expect(r.y + r.h).toBeLessThanOrEqual(2622);
    }
    expect(z.clock.y).toBeLessThan(z.widgets.y);
    expect(z.widgets.y).toBeLessThan(z.controls.y);
  });

  it('insets the visible rect by the bleed on every edge', () => {
    const v = visibleRect(1000, 2000, 0.08);
    expect(v.x).toBeCloseTo(80);
    expect(v.w).toBeCloseTo(840);
    expect(visibleRect(1000, 2000, 5).w).toBeCloseTo(700);
    expect(visibleRect(1000, 2000, -1).w).toBe(1000);
  });
});
