import type { Generator } from '../types.js';
import { truchetArcs, truchetDiagonals } from './truchet.js';
import { contours } from './contours.js';
import { chevronBlocks } from './chevron-blocks.js';
import { flowDots } from './flow-dots.js';
import { phyllotaxis } from './phyllotaxis.js';
import { ridgelines } from './ridgelines.js';
import { stringArt } from './string-art.js';

/**
 * The registry, and the order a tap walks.
 *
 * Adding a generator is: write the module, import it, put it in this array.
 * Nothing else in the codebase enumerates generators by hand — the gallery,
 * the router's static params, the related-patterns list and the test suite all
 * read from here.
 *
 * The order is load-bearing now in a way it was not before. Tap on the preview
 * moves to the next pattern and wraps, so this array is the cycle a thumb walks
 * and neighbours should be worth seeing next to each other. The two truchets
 * sit together because they are the same tile read two ways.
 */
export const generators: Generator[] = [truchetArcs, truchetDiagonals, chevronBlocks, contours];

/**
 * Written, working, and not in the app.
 *
 * These four have no page, no gallery card and no place in the tap cycle,
 * because the app is being narrowed to the patterns that earn a slot on a
 * phone. They are not deleted: the code is sound, the tests still run against
 * it through `ALL_GENERATORS` in the test helpers, and bringing one back is
 * moving its name from this array to the one above.
 *
 * `getGenerator` deliberately does not search here. A retired pattern must not
 * resolve from a URL or a saved collection item, or it would render a page the
 * gallery says does not exist.
 */
export const retired: Generator[] = [flowDots, phyllotaxis, ridgelines, stringArt];

export function getGenerator(id: string): Generator | undefined {
  return generators.find((g) => g.id === id);
}
