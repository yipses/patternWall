import { describe, expect, it } from 'vitest';
import { ALLOWED_ELEMENTS, renderToSvg, validateSvgVocabulary } from '../src/index.js';
import { ALL_GENERATORS, baseParams, TEST_PALETTES } from './helpers.js';

describe('SVG vocabulary', () => {
  it('rejects things it is supposed to reject', () => {
    expect(validateSvgVocabulary('<svg><text x="1">hi</text></svg>').length).toBeGreaterThan(0);
    expect(validateSvgVocabulary('<svg><style>a{}</style></svg>').length).toBeGreaterThan(0);
    expect(validateSvgVocabulary('<svg><rect class="x"/></svg>').length).toBeGreaterThan(0);
    expect(validateSvgVocabulary('<svg><rect style="fill:red"/></svg>').length).toBeGreaterThan(0);
    expect(validateSvgVocabulary('<svg><filter id="f"><feTurbulence/></filter></svg>').length).toBeGreaterThan(0);
    expect(validateSvgVocabulary('<svg><rect onclick="x()"/></svg>').length).toBeGreaterThan(0);
    expect(validateSvgVocabulary('<svg><foreignObject/></svg>').length).toBeGreaterThan(0);
    expect(validateSvgVocabulary('<svg><image href="https://example.com/a.png"/></svg>').length).toBeGreaterThan(0);
    expect(validateSvgVocabulary('<svg><rect fill="#fff"/></svg>')).toEqual([]);
  });

  for (const g of ALL_GENERATORS) {
    it(`${g.id} emits only allowed elements and attributes`, () => {
      for (const palette of TEST_PALETTES) {
        for (const seed of ['a', 'b', 'c']) {
          const svg = renderToSvg({ generator: g, width: 300, height: 650, palette, params: baseParams(g), seed, bleed: 0.08 });
          const bad = validateSvgVocabulary(svg);
          expect(bad, `${g.id}/${palette.id}/${seed}: ${JSON.stringify(bad.slice(0, 4))}`).toEqual([]);
          expect(svg.startsWith('<svg ')).toBe(true);
          expect(svg.endsWith('</svg>')).toBe(true);
        }
      }
    });

    it(`${g.id} also stays inside the vocabulary at extreme parameter values`, () => {
      const palette = TEST_PALETTES[0]!;
      for (const extreme of ['min', 'max'] as const) {
        const params: Record<string, number | string | boolean> = {};
        for (const spec of g.params) {
          if (spec.type === 'number') params[spec.key] = extreme === 'min' ? spec.min : spec.max;
          else if (spec.type === 'boolean') params[spec.key] = extreme === 'max';
          else params[spec.key] = (extreme === 'min' ? spec.options[0]! : spec.options[spec.options.length - 1]!).value;
        }
        const svg = renderToSvg({ generator: g, width: 240, height: 520, palette, params, seed: 'x', bleed: 0.08 });
        expect(validateSvgVocabulary(svg)).toEqual([]);
      }
    });
  }

  it('the allow list is the documented one', () => {
    expect([...ALLOWED_ELEMENTS].sort()).toEqual(
      [
        'circle', 'clipPath', 'defs', 'ellipse', 'g', 'line', 'linearGradient', 'mask', 'path',
        'polygon', 'polyline', 'radialGradient', 'rect', 'stop', 'svg', 'title', 'use',
      ].sort(),
    );
  });
});
