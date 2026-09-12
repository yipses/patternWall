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
  maximumScale: 1,
  userScalable: false,
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
        <main id="main">{children}</main>
        <SiteFooter />
        <RenderBridge />
      </body>
    </html>
  );
}
