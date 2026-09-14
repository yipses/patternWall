import { describe, expect, it } from 'vitest';
import {
  cycleValue,
  decimalsOf,
  decodeConfig,
  encodeConfig,
  generators,
  getGenerator,
  quantise,
  resolvePrimaries,
  scrubTo,
  secondaryParams,
  stepCount,
  defaultParams,
  type NumberSpec,
  type ParamSpec,
  type SelectSpec,
} from '../src/index.js';
import { TEST_PALETTES } from './helpers.js';

const truchet = getGenerator('truchet')!;
const numberSpecs = (g: (typeof generators)[number]): NumberSpec[] =>
  g.params.filter((p): p is NumberSpec => p.type === 'number');

describe('controls', () => {
  /**
   * A scrubbed value has to be a value a link can carry.
   *
   * Until a gesture existed, no float noise could reach a generator: a range
   * input hands back exact decimal strings, so every number in the app was
   * already on its own lattice. Arithmetic over that lattice is not — 49 steps
   * of 0.01 up from 0.02 gives 0.49000000000000005 — and `packParams` trims to
   * the step's precision while the renderer does not. The link would then
   * describe a different picture from the one on screen, which is the single
   * promise this app makes about its URLs.
   *
   * So the assertion is the round trip, over every number param of every
   * generator, at both ends and across the middle: whatever `quantise`
   * produces must survive `encodeConfig` and come back identical. Watched
   * failing by dropping the `toFixed` trim, which breaks 48 of the registry's
   * number params — every generator has some, truchet's `weight` among them.
   */
  it('quantises to values the share encoding carries unchanged', () => {
    for (const g of generators) {
      for (const spec of numberSpecs(g)) {
        const steps = stepCount(spec);
        for (const k of [0, 1, 2, Math.floor(steps / 3), Math.floor(steps / 2), steps - 1, steps]) {
          const value = quantise(spec, spec.min + k * spec.step);
          const params = { ...defaultParams(g), [spec.key]: value };
          const query = encodeConfig({ generatorId: g.id, seed: 'lattice', params, palette: TEST_PALETTES[0]! });
          const back = decodeConfig(g.id, query).config.params[spec.key];
          expect(back, `${g.id}.${spec.key} went out as ${value} and came back as ${String(back)}`).toBe(value);
        }
      }
    }
  });

  /**
   * The lattice is measured from `min`, not from wherever the value happens to
   * be, so a scrub and a keyboard nudge agree about where the steps are. Drag
   * a value and then arrow it and nothing shifts by half a step.
   */
  it('snaps to the same lattice a range input produces, and clamps at both ends', () => {
    const weight = truchet.params.find((p) => p.key === 'weight') as NumberSpec;
    expect(quantise(weight, 0.1649)).toBe(0.16);
    expect(quantise(weight, 0.1651)).toBe(0.17);
    expect(quantise(weight, -5), 'below the floor').toBe(weight.min);
    expect(quantise(weight, 99), 'above the ceiling').toBe(weight.max);
    expect(quantise(weight, Number.NaN), 'not a number at all').toBe(weight.default);

    for (const g of generators) {
      for (const spec of numberSpecs(g)) {
        const v = quantise(spec, spec.min + 0.371 * (spec.max - spec.min));
        const offLattice = Math.abs((v - spec.min) / spec.step - Math.round((v - spec.min) / spec.step));
        expect(offLattice, `${g.id}.${spec.key} landed at ${v}, off its own step grid`).toBeLessThan(1e-6);
        expect(v).toBeGreaterThanOrEqual(spec.min);
        expect(v).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  /**
   * A scrub is relative to where it started, so a second pass refines the
   * first rather than replacing it, and putting a finger down moves nothing.
   */
  it('scrubs a fraction of the range, relative to where the gesture began', () => {
    const arcCount = truchet.params.find((p) => p.key === 'arcCount') as NumberSpec;
    expect(scrubTo(arcCount, arcCount.min, 0), 'no movement, no change').toBe(arcCount.min);
    expect(scrubTo(arcCount, arcCount.min, 1), 'a full sweep reaches the top').toBe(arcCount.max);
    expect(scrubTo(arcCount, arcCount.max, -1), 'and back down again').toBe(arcCount.min);
    expect(scrubTo(arcCount, 6, 0.5), 'from the middle, half a sweep up').toBe(arcCount.max);
    // Past either end clamps rather than wrapping: a fader does not roll over.
    expect(scrubTo(arcCount, arcCount.max, 0.4)).toBe(arcCount.max);
    expect(scrubTo(arcCount, arcCount.min, -0.4)).toBe(arcCount.min);

    const half = scrubTo(arcCount, arcCount.min, 0.5);
    expect(half).toBeGreaterThan(arcCount.min);
    expect(half).toBeLessThan(arcCount.max);
  });

  /** A tap advances and wraps, whatever kind of control it lands on. */
  it('cycles a value round its own options', () => {
    const tileSet = truchet.params.find((p) => p.key === 'tileSet') as SelectSpec;
    expect(cycleValue(tileSet, 'arcs')).toBe('diagonals');
    expect(cycleValue(tileSet, 'diagonals')).toBe('triangles');
    expect(cycleValue(tileSet, 'triangles'), 'wraps back to the start').toBe('arcs');
    expect(cycleValue(tileSet, 'nonsense'), 'a stale link cycles off the default').toBe('diagonals');

    const arcCount = truchet.params.find((p) => p.key === 'arcCount') as NumberSpec;
    expect(cycleValue(arcCount, 1)).toBe(2);
    expect(cycleValue(arcCount, arcCount.max), 'a number wraps at the top too').toBe(arcCount.min);

    const taper = getGenerator('flow-dots')!.params.find((p) => p.key === 'taper') as ParamSpec;
    expect(cycleValue(taper, true)).toBe(false);
    expect(cycleValue(taper, false)).toBe(true);

    const image = getGenerator('string-art')!.params.find((p) => p.key === 'image') as ParamSpec;
    expect(cycleValue(image, 'abc'), 'a picture is chosen, not cycled to').toBe('abc');
  });

  /**
   * The contract every generator's three have to keep.
   *
   * This is the test that makes choosing the other six patterns' bindings a
   * safe, boring job: a typo in a key, a select bound to a drag, or the same
   * param used twice fails here rather than in a preview nobody looked at.
   * The step ceiling on a tapped number is the one judgement call — past about
   * a dozen taps you have built a slider and hidden it behind a gesture that
   * cannot reach the far end.
   */
  it('holds every declared primary to its own params', () => {
    const declared = generators.filter((g) => g.primary);
    expect(declared.length, 'no generator declares its three yet').toBeGreaterThan(0);

    for (const g of declared) {
      const bindings = resolvePrimaries(g);
      expect(bindings.map((b) => b.role), `${g.id} did not resolve all three`).toEqual(['tap', 'x', 'y']);

      const keys = bindings.map((b) => b.key);
      expect(new Set(keys).size, `${g.id} uses the same key twice: ${keys.join(', ')}`).toBe(3);

      const [tap, x, y] = bindings;
      if (tap!.key !== 'seed') {
        expect(tap!.spec, `${g.id} taps '${tap!.key}', which is not one of its params`).not.toBeNull();
        expect(['select', 'boolean', 'number'], `${g.id} taps a ${tap!.spec!.type}`).toContain(tap!.spec!.type);
        if (tap!.spec!.type === 'number') {
          const n = stepCount(tap!.spec as NumberSpec);
          expect(n, `${g.id} taps a number with ${n} steps, which is a slider in disguise`).toBeLessThanOrEqual(12);
        }
      }
      for (const b of [x!, y!]) {
        expect(b.spec, `${g.id} drags '${b.key}', which is not one of its params`).not.toBeNull();
        expect(b.spec!.type, `${g.id} drags '${b.key}', a ${b.spec!.type} — a drag needs a number`).toBe('number');
      }

      // Every param is either promoted or behind the disclosure. Neither list
      // may drop one: a param in neither place is a control nobody can reach.
      const secondary = secondaryParams(g);
      expect(secondary.length + 3, `${g.id} lost a param between the two groups`).toBe(g.params.length);
      for (const key of keys) {
        expect(secondary.some((p) => p.key === key), `${g.id} shows '${key}' twice`).toBe(false);
      }
    }
  });

  /** A generator that has chosen nothing is left exactly as it was. */
  it('leaves an undeclared generator flat', () => {
    const plain = generators.find((g) => !g.primary)!;
    expect(resolvePrimaries(plain)).toEqual([]);
    expect(secondaryParams(plain), 'every control stays in the one list').toEqual(plain.params);
  });

  it('reads the precision a step implies', () => {
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(0.05)).toBe(2);
    expect(decimalsOf(0.005)).toBe(3);
    expect(decimalsOf(0)).toBe(3);
  });
});
