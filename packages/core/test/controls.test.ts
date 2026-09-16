import { describe, expect, it } from 'vitest';
import {
  coerceParams,
  effectiveSpec,
  retuneParams,
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
  wrapPastEnd,
  defaultParams,
  type Generator,
  type NumberSpec,
  type ParamValue,
} from '../src/index.js';
import { TEST_PALETTES } from './helpers.js';

const arcs = getGenerator('truchet-arcs')!;
const numberSpecs = (g: (typeof generators)[number]): NumberSpec[] =>
  g.params.filter((p): p is NumberSpec => p.type === 'number');

/**
 * A generator that exists only here.
 *
 * Nothing in the registry declares `limits` any more — the ceiling that needed
 * it was truchet's divisions depending on its tile set, and the tile sets are
 * two patterns now with a number in each spec. The machinery stays because a
 * mode switch with a dependent range is the obvious next thing a generator
 * will reach for, and this is what keeps it honest in the meantime.
 *
 * It declares the condition *after* the parameter it limits, which is the
 * order that catches a single-pass implementation. Truchet declared its tile
 * set first and so would have passed either way; `params` is append-only, so
 * the next generator to add a mode switch to a list it already had will land
 * in exactly this order.
 */
const backwards: Generator = {
  id: 'backwards',
  name: 'Backwards',
  tagline: 'A ceiling whose condition is declared after it.',
  tags: ['grid'],
  description: '',
  params: [
    { key: 'count', label: 'Count', type: 'number', min: 1, max: 12, step: 1, default: 1, description: '' },
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      options: [
        { value: 'wide', label: 'Wide' },
        { value: 'narrow', label: 'Narrow' },
      ],
      default: 'wide',
      description: '',
    },
  ],
  limits: { count: { when: 'mode', max: { narrow: 6 } } },
  render: () => '',
};

/** And one that has nominated nothing, which every caller must leave alone. */
const undeclared: Generator = {
  id: 'undeclared',
  name: 'Undeclared',
  tagline: 'Chooses no primaries.',
  tags: ['grid'],
  description: '',
  params: [{ key: 'size', label: 'Size', type: 'number', min: 1, max: 10, step: 1, default: 5, description: '' }],
  render: () => '',
};

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
    const weight = arcs.params.find((p) => p.key === 'weight') as NumberSpec;
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
   * A bounded control has two dead directions, and a gesture that does nothing
   * cannot be told apart from one that is broken. A swipe that *begins* by
   * pushing further into the end it is already on comes round to the other.
   */
  it('wraps a gesture that starts by pushing past an end, and only that one', () => {
    const arcCount = arcs.params.find((p) => p.key === 'arcCount') as NumberSpec;
    const weight = arcs.params.find((p) => p.key === 'weight') as NumberSpec;

    expect(wrapPastEnd(arcCount, arcCount.min, -1), 'down from the bottom').toBe(arcCount.max);
    expect(wrapPastEnd(arcCount, arcCount.max, 1), 'up from the top').toBe(arcCount.min);

    // Everything else is left alone. Wrapping a gesture that has somewhere to
    // go would make the control discontinuous where it has no reason to be.
    expect(wrapPastEnd(arcCount, arcCount.min, 1), 'up from the bottom is just up').toBe(arcCount.min);
    expect(wrapPastEnd(arcCount, arcCount.max, -1), 'down from the top is just down').toBe(arcCount.max);
    expect(wrapPastEnd(arcCount, 6, -1), 'from the middle').toBe(6);
    expect(wrapPastEnd(arcCount, 6, 1), 'from the middle').toBe(6);

    // A float bound has to count as sitting on itself: weight floors at 0.02,
    // and an equality test against a quantised value there is a coin toss.
    expect(wrapPastEnd(weight, weight.min, -1), 'a float minimum still wraps').toBe(weight.max);
    expect(wrapPastEnd(weight, weight.max, 1), 'a float maximum still wraps').toBe(weight.min);
  });

  /**
   * A scrub is relative to where it started, so a second pass refines the
   * first rather than replacing it, and putting a finger down moves nothing.
   */
  it('scrubs a fraction of the range, relative to where the gesture began', () => {
    const arcCount = arcs.params.find((p) => p.key === 'arcCount') as NumberSpec;
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

  /**
   * The contract every generator's two have to keep.
   *
   * This is the test that makes choosing a new pattern's bindings a safe,
   * boring job: a typo in a key, a select bound to a drag, or the same param
   * used twice fails here rather than in a preview nobody looked at.
   *
   * It says *every registered* generator, not every generator that declares
   * something. A pattern in the registry has a page, a gallery card and a slot
   * in the tap cycle, and a person who drags on its preview and gets nothing
   * has no way to tell that from a gesture that is broken — three separate
   * faults in this repo presented as exactly that. So bindings are not
   * optional for anything shipped, and `primary` stays optional on the type
   * for the retired four and for a pattern still being written.
   */
  it('holds every registered generator to two named number params', () => {
    for (const g of generators) {
      expect(g.primary, `${g.id} is in the registry with no gesture bindings`).toBeTruthy();
      const bindings = resolvePrimaries(g);
      expect(bindings.map((b) => b.role), `${g.id} did not resolve both axes`).toEqual(['x', 'y']);

      const keys = bindings.map((b) => b.key);
      expect(new Set(keys).size, `${g.id} drives both axes from '${keys[0]}'`).toBe(2);

      for (const b of bindings) {
        expect(b.spec.type, `${g.id} drags '${b.key}', a ${b.spec.type} — a drag needs a number`).toBe('number');
        const n = stepCount(b.spec as NumberSpec);
        expect(n, `${g.id} drags '${b.key}', which has ${n} step`).toBeGreaterThan(1);
      }

      // Every param is either promoted or behind the gear. Neither list may
      // drop one: a param in neither place is a control nobody can reach.
      const secondary = secondaryParams(g);
      expect(secondary.length + 2, `${g.id} lost a param between the two groups`).toBe(g.params.length);
      for (const key of keys) {
        expect(secondary.some((p) => p.key === key), `${g.id} shows '${key}' twice`).toBe(false);
      }
    }
  });

  /**
   * A range that depends on another control, and what happens when it moves.
   *
   * The half worth testing hardest is the carry-across. Clamping alone would
   * put eleven of the twelve settings on the same place, so moving between
   * modes would lose where you were and hand back "the top" whatever you had.
   * Scaled to the ceiling, half way along stays half way along.
   */
  it('limits a value by another param, and carries it across proportionally', () => {
    const spec = backwards.params.find((p) => p.key === 'count') as NumberSpec;
    expect(spec.max, 'the declared ceiling is unchanged').toBe(12);

    const on = (mode: string): number => {
      const eff = effectiveSpec(backwards, spec, { ...defaultParams(backwards), mode });
      return eff.type === 'number' ? eff.max : Number.NaN;
    };
    expect(on('narrow')).toBe(6);
    expect(on('wide')).toBe(12);

    const at = (mode: string, count: number): Record<string, ParamValue> => ({ ...defaultParams(backwards), mode, count });
    const moved = (from: Record<string, ParamValue>, mode: string): number =>
      Number(retuneParams(backwards, from, { ...from, mode }).count);

    expect(moved(at('wide', 6), 'narrow'), 'half of twelve should be half of six').toBe(3);
    expect(moved(at('narrow', 3), 'wide'), 'and back again').toBe(6);
    expect(moved(at('wide', 12), 'narrow')).toBe(6);
    expect(moved(at('wide', 1), 'narrow'), 'the floor stays the floor').toBe(1);

    // Round trips, which is the whole reason this is proportional to the
    // ceiling rather than across the range. Scaling the span would send six to
    // three and three back to five, so moving twice between modes would walk
    // the value down a step at a time and never say so.
    for (let v = 1; v <= 12; v++) {
      const there = moved(at('wide', v), 'narrow');
      const back = moved(at('narrow', there), 'wide');
      expect(Math.abs(back - v), `${v} -> ${there} -> ${back} drifted`).toBeLessThanOrEqual(1);
    }

    // A change that moves nothing leaves everything alone, including a change
    // to the limited control itself.
    const same = at('wide', 9);
    expect(retuneParams(backwards, same, { ...same, count: 4 }).count).toBe(4);
    expect(retuneParams(backwards, same, { ...same, mode: 'wide' }).count).toBe(9);
  });

  /**
   * A link that asks for more than the mode allows is clamped, not obeyed.
   *
   * `coerceParams` is where untrusted input is made safe, and a conditional
   * ceiling belongs there for the same reason the unconditional one does: a
   * generator should never have to validate anything, and the slider, the link
   * and the picture should agree about what the value is rather than the
   * control showing a ceiling the render quietly ignores.
   *
   * It has to be a second pass. The ceiling depends on `mode`, and the two
   * sit in whatever order the share encoding put them.
   */
  it('clamps a link that asks for more than its mode allows', () => {
    expect(coerceParams(backwards, { count: 12, mode: 'narrow' }).count).toBe(6);
    expect(coerceParams(backwards, { count: 12, mode: 'wide' }).count).toBe(12);
    expect(coerceParams(backwards, { count: 4, mode: 'narrow' }).count).toBe(4);
  });

  /** A generator that has chosen nothing is left exactly as it was. */
  it('leaves an undeclared generator flat', () => {
    expect(resolvePrimaries(undeclared)).toEqual([]);
    expect(secondaryParams(undeclared), 'every control stays in the one list').toEqual(undeclared.params);
  });

  it('reads the precision a step implies', () => {
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(0.05)).toBe(2);
    expect(decimalsOf(0.005)).toBe(3);
    expect(decimalsOf(0)).toBe(3);
  });
});
