import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Not found',
  description: 'That page does not exist.',
};

export default function NotFound() {
  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '80px 20px' }}>
      <h1 style={{ fontSize: 38, marginBottom: 14 }}>There is no pattern here.</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 24 }}>
        The address you followed does not match any pattern in the registry. It may have been renamed, or the link may have
        been trimmed on its way to you.
      </p>
      <Link href="/" style={{ textDecoration: 'underline' }}>
        Back to the gallery
      </Link>
    </div>
  );
}
