'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * The last line of defence, for every route in the app.
 *
 * Without one of these, a throw anywhere below the layout replaces the page
 * with React's own blank "Application error: a client-side exception has
 * occurred" and loses whatever the person was doing. That is not hypothetical
 * here: a single collected item missing its palette used to do it, taking the
 * valid items and the batch export down with it.
 *
 * Storage is now coerced on the way in, so this should be unreachable by that
 * route. It stays because the next schema change will find a path nobody
 * predicted, and the difference between a screen that names the problem and
 * offers a way out and a white page is the whole of what a person can do about
 * it. The recovery advice is specific rather than a bare "try again": what
 * actually goes wrong in a client-only app with no server is stored state, and
 * clearing it is a thing the reader can do.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Nothing collects these — there is no server — but a person who opens the
    // console after hitting this should find the real error rather than a
    // summary of it.
    console.error('PatternWall failed to render this page:', error);
  }, [error]);

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '80px 20px' }}>
      <h1 style={{ fontSize: 38, marginBottom: 14 }}>That did not draw.</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 18 }}>
        Something went wrong rendering this page. Everything PatternWall keeps lives in this browser, so the most likely
        cause is a saved pattern or palette from an older version of the site that this build cannot read.
      </p>
      <p style={{ color: 'var(--text-dim)', marginBottom: 24 }}>
        Try again first. If it keeps happening, clearing this site&rsquo;s stored data will fix it — at the cost of your
        collection, so export anything you want to keep from another browser first if you can.
      </p>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={reset}
          style={{ textDecoration: 'underline', background: 'none', border: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', padding: 0 }}
        >
          Try again
        </button>
        <Link href="/" style={{ textDecoration: 'underline' }}>
          Back to the gallery
        </Link>
      </div>
    </div>
  );
}
