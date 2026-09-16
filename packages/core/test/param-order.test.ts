import { describe, expect, it } from 'vitest';
import { generators, getGenerator, retired } from '../src/index.js';
import { ALL_GENERATORS } from './helpers.js';

/**
 * Params are positional in the share URL, and nothing guarded the order.
 *
 * `share.ts` packs values into `q` by index, so inserting a param anywhere but
 * the end silently reinterprets every existing link from that slot on, and
 * removing one does the same in reverse. The invariant is written down as
 * append-only and the encoding has neither a version nor named keys to fall
 * back on -- but every share test encodes and decodes inside one build, so
 * they agree with each other whatever the order is. Moving a param in the
 * middle of any generator's list passed the entire suite.
 *
 * A snapshot turns a silent link break into a red test that has to be answered
 * deliberately. Appending to the end is the safe operation and updating this
 * list for it is a one-line diff; anything else is the thing the invariant
 * exists to stop, and the failure names which generator and which slot.
 *
 * `ALL_GENERATORS` rather than `generators`, because the retired four keep
 * their slots too -- their links stop working the same way if the order moves
 * under them, and the whole point of retiring rather than deleting is that
 * they can come back.
 */
const ORDER: Record<string, string[]> = {
  'truchet-arcs': ['density', 'weight', 'colorSpread', 'arcCount', 'arcSpacing'],
  'truchet-diagonals': ['density', 'weight', 'colorSpread', 'arcCount'],
  'chevron-blocks': ['blockSize', 'relief', 'skyline', 'clumping', 'faceLight', 'colorSpread', 'mortar'],
  contours: [
    'levels', 'scale', 'detail', 'resolution', 'weight', 'indexEvery', 'colorSpread',
    'seaLevel', 'elevationTint', 'hachures', 'supplementary', 'roughness',
  ],
  'flow-dots': [
    'density', 'trail', 'scale', 'turbulence', 'spacing', 'dotSize', 'sweep',
    'colorSpread', 'quietTop', 'taper',
  ],
  phyllotaxis: [
    'count', 'detune', 'falloff', 'dotScale', 'originX', 'originY', 'shape',
    'colorSpread', 'jitter', 'quietTop',
  ],
  ridgelines: [
    'lines', 'resolution', 'amplitude', 'scale', 'envelope', 'roughness', 'weight',
    'tint', 'colorSpread', 'quietTop',
  ],
  'string-art': [
    'image', 'tones', 'coverage', 'simplify', 'nailSpacing', 'shading', 'scale',
    'offsetX', 'offsetY', 'thickness', 'nailsVisible', 'reading', 'detail',
  ],
};

describe('share slots', () => {
  it('covers every generator, so a new one cannot slip past unpinned', () => {
    expect(ALL_GENERATORS.map((g) => g.id).sort()).toEqual(Object.keys(ORDER).sort());
  });

  for (const g of ALL_GENERATORS) {
    it(`${g.id}: params keep the order their links were written against`, () => {
      expect(g.params.map((p) => p.key)).toEqual(ORDER[g.id]);
    });
  }
});

/**
 * A pattern that is not in the app must not resolve from a URL or from a saved
 * collection item, or it renders a page the gallery says does not exist. That
 * is why `getGenerator` searches `generators` and not `retired`, and it was
 * true and unasserted -- it feeds `share.ts`, `storage.ts`, the editor and the
 * collection export, so un-retiring by accident would reach all of them.
 */
describe('the retired four are not reachable by id', () => {
  it('resolves every registered pattern', () => {
    for (const g of generators) expect(getGenerator(g.id)?.id).toBe(g.id);
  });

  it('resolves no retired pattern', () => {
    expect(retired.length).toBeGreaterThan(0);
    for (const g of retired) expect(getGenerator(g.id)).toBeUndefined();
  });
});
