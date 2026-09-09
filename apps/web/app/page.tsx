import type { Metadata } from 'next';
import { Gallery } from '../components/Gallery';

export const metadata: Metadata = {
  title: 'PatternWall — generative iPhone wallpapers',
  description:
    'Browse generative pattern families, tune them against a curated palette library, and export an iPhone wallpaper at device resolution.',
};

export default function HomePage() {
  return <Gallery />;
}
