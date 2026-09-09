'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './SiteHeader.module.css';

const NAV = [
  { href: '/', label: 'Gallery' },
  { href: '/collected', label: 'Collected' },
  { href: '/setup', label: 'Automate' },
];

export function SiteHeader() {
  const pathname = usePathname() ?? '/';
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link className={styles.mark} href="/">
          Pattern<em>Wall</em>
        </Link>
        <nav className={styles.nav} aria-label="Primary">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? `${styles.link} ${styles.active}` : styles.link}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
