import type { Metadata, Viewport } from 'next';
import { Collected } from '../../../components/Collected';

export const metadata: Metadata = {
  title: 'Your collection',
  description: 'The wallpapers you kept, as pictures and nothing else.',
};

/**
 * Matches `/m`: the grid reaches the physical edges of the screen, and
 * `env(safe-area-inset-*)` only reports anything once the viewport covers.
 */
export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: '#000000',
};

/**
 * The collection, with nothing around it.
 *
 * A route rather than a flag on `/collected`, because that is what the chrome
 * question actually is. The site's collection has a header, a heading and a
 * paragraph explaining localStorage, all of which are right on a page you
 * arrived at by navigating; none of them are right on a screen you opened from
 * a wallpaper by pressing a button in its corner. `/m` made the same split for
 * the same reason and shares one `Editor` between the two — this shares one
 * `Collected`.
 *
 * It also retires the `?from=m` flag. Reading the query during render is a
 * hydration hazard the component had to work around, and the route says the
 * same thing without asking anybody to remember a query parameter.
 */
export default function MobileCollectedPage() {
  return <Collected bare />;
}
