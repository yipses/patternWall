'use client';

import { useEffect, useState } from 'react';

const ISO = process.env.NEXT_PUBLIC_BUILD_TIME ?? '';
const COMMIT = process.env.NEXT_PUBLIC_BUILD_COMMIT ?? '';

/** UTC, so the server-rendered text is stable and hydration cannot mismatch. */
function utcLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/**
 * When this build was made, and from which commit.
 *
 * A green deploy is not proof the served page changed, so the page has to be
 * able to answer that itself. It lives in the footer on every page of the site
 * — and in `/m`'s settings sheet, because that route has no footer and a
 * wallpaper filling the screen is the last place to print a build time. Same
 * component either way, so there is one copy of the hydration care below.
 *
 * Renders UTC first and upgrades to the reader's own timezone after mount.
 * Formatting in local time during render would produce different markup on the
 * build machine than in the browser, which React reports as a hydration error
 * — and the whole point of this line is to be trustworthy.
 */
export function BuildStamp({ className, commitClassName }: { className?: string; commitClassName?: string }) {
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
    <span className={className} data-testid="build-stamp">
      Built{' '}
      {ISO ? (
        <time dateTime={ISO} title={ISO}>
          {label}
        </time>
      ) : (
        'in development'
      )}
      {COMMIT ? <span className={commitClassName}>· {COMMIT}</span> : null}
    </span>
  );
}
