import type { Metadata, Viewport } from 'next';
import { generators } from '@patternwall/core';
import { Editor } from '../../components/Editor';

export const metadata: Metadata = {
  title: 'Phone view',
  description: 'PatternWall as it would look on the phone: the pattern filling the screen, driven by swipe and tap.',
};

/**
 * `viewport-fit=cover` so the picture reaches the physical edges of the
 * screen rather than stopping at the notch, which is what a wallpaper does —
 * and it is also what makes `env(safe-area-inset-*)` report anything, which
 * the settings rail needs so its bottom button clears the home indicator.
 * Merged with the root's `width` and `initialScale`; only these two differ.
 */
export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: '#000000',
};

/**
 * The preview, and nothing else.
 *
 * Every control here already existed — swipe across for the first of a
 * pattern's two driven params, up and down for the second, tap for the next
 * pattern, and the rail in the corner for the rest. What this route removes is
 * the page around them: no header, no footer, no panel, no mock handset. On a
 * phone that means the render is the screen, at the screen's own aspect and
 * resolution, which is the only place a wallpaper can honestly be judged.
 *
 * It prerenders against the first registered pattern, and the real one is read
 * from `?g=` after mount — deferred on purpose, because the static export
 * bakes this page's opening picture into the HTML and disagreeing with it
 * during the first render is a text hydration mismatch. `Editor` reads its
 * params from `?q=` the same way and for the same reason.
 */
export default function MobileView() {
  return <Editor generatorId={generators[0]!.id} bare />;
}
