import type { Metadata } from 'next';
import { Collected } from '../../components/Collected';

export const metadata: Metadata = {
  title: 'Collected',
  description: 'Wallpaper configurations you have saved in this browser.',
};

export default function CollectedPage() {
  return <Collected />;
}
