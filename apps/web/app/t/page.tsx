import type { Metadata, Viewport } from 'next';
import { Feed } from '../../components/Feed';

export const metadata: Metadata = {
  title: 'Browse',
  description: 'Wallpapers one at a time: swipe right to keep one, left to pass, tap for new settings, flick up or down for colours.',
};

/**
 * Matches `/m`: the picture reaches the physical edges of the screen, and
 * `env(safe-area-inset-*)` only reports anything once the viewport covers —
 * which the verdict row needs, to clear the home indicator.
 */
export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: '#000000',
};

/**
 * The swipe feed, alongside `/m` rather than instead of it.
 *
 * `/m` is the editor, where a drag scrubs a setting; this is browsing, where
 * the same drag is a verdict. They are two routes so that neither has to
 * explain the other's gestures, and so this can be tried without changing
 * anything that already works.
 *
 * Nothing random happens during the prerender. The first paint is the ground,
 * and the card arrives after mount — see `useFeed` for why.
 */
export default function BrowsePage() {
  return <Feed />;
}
