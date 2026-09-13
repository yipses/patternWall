import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SiteHeader } from '../components/SiteHeader';
import { SiteFooter } from '../components/SiteFooter';
import { RenderBridge } from '../components/RenderBridge';

export const metadata: Metadata = {
  title: {
    default: 'PatternWall — generative iPhone wallpapers',
    template: '%s — PatternWall',
  },
  description:
    'A studio for generative iPhone wallpapers. Browse a gallery of pattern families, tune them against a curated palette library, preview them on the Lock and Home Screens, and export a PNG at device resolution.',
  applicationName: 'PatternWall',
  authors: [{ name: 'PatternWall' }],
  openGraph: {
    title: 'PatternWall — generative iPhone wallpapers',
    description: 'Tune a generative pattern, preview it on the Lock Screen, export it at device resolution.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // No maximumScale or userScalable: false. Locking zoom is the reflex for an
  // app-like layout and it takes pinch-to-zoom away from anyone who needs it,
  // which WCAG 1.4.4 is explicit about. Nothing here needs it either — the
  // inputs are 16px or larger, so iOS has no reason to zoom on focus, which is
  // the problem the lock is usually reached for.
  themeColor: '#0a0a0b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="pw-skip" href="#main">
          Skip to content
        </a>
        <SiteHeader />
        {/* tabIndex -1 so the skip link actually moves focus. Without it the
            hash changes and the next Tab continues from wherever focus already
            was, which is the header the link exists to skip. */}
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
        <RenderBridge />
      </body>
    </html>
  );
}
