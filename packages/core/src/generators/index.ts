import type { Generator } from '../types.js';
import { flowDots } from './flow-dots.js';

/**
 * The registry.
 *
 * Adding a generator is: write the module, import it, put it in this array.
 * Nothing else in the codebase enumerates generators by hand — the gallery,
 * the router's static params, the related-patterns list and the test suite all
 * read from here.
 */
export const generators: Generator[] = [flowDots];

export function getGenerator(id: string): Generator | undefined {
  return generators.find((g) => g.id === id);
}
