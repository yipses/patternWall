'use client';

import { useEffect, useState } from 'react';
import styles from './SiteFooter.module.css';

const ISO = process.env.NEXT_PUBLIC_BUILD_TIME ?? '';
const COMMIT = process.env.NEXT_PUBLIC_BUILD_COMMIT ?? '';

/** UTC, so the server-rendered text is stable and hydration cannot mismatch. */
function utcLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function SiteFooter() {
  // Render UTC first and upgrade to the reader's own timezone after mount.
  // Formatting in local time during render would produce different markup on
  // the build machine than in the browser, which React reports as a hydration
  // error — and the whole point of this line is to be trustworthy.
  const [label, setLabel] = useState(() => utcLabel(ISO));

  useEffect(() => {
    const d = new Date(ISO);
    if (Number.isNaN(d.getTime())) return;
    setLabel(
      d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  }, []);

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <span className={styles.name}>PatternWall</span>
        <span className={styles.build} data-testid="build-stamp">
          Built{' '}
          {ISO ? (
            <time dateTime={ISO} title={ISO}>
              {label}
            </time>
          ) : (
            'in development'
          )}
          {COMMIT ? <span className={styles.commit}>· {COMMIT}</span> : null}
        </span>
      </div>
    </footer>
  );
}
