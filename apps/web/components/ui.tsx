'use client';

import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './ui.module.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'default' | 'small';
  loading?: boolean;
  success?: boolean;
  selected?: boolean;
};

export function Button({ variant = 'default', size = 'default', loading = false, success = false, selected = false, children, className, disabled, ...rest }: ButtonProps) {
  const classes = [
    styles.btn,
    variant === 'primary' ? styles.primary : '',
    variant === 'ghost' ? styles.ghost : '',
    size === 'small' ? styles.small : '',
    success ? styles.success : '',
    selected ? styles.selected : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Notice({
  level = 'info',
  children,
  onDismiss,
  role,
}: {
  level?: 'info' | 'warn' | 'error';
  children: ReactNode;
  onDismiss?: () => void;
  role?: 'status' | 'alert';
}) {
  const cls = [styles.notice, level === 'warn' ? styles.noticeWarn : '', level === 'error' ? styles.noticeError : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} role={role ?? (level === 'error' ? 'alert' : 'status')}>
      <div className={styles.noticeBody}>{children}</div>
      {onDismiss ? (
        <button type="button" className={styles.noticeDismiss} onClick={onDismiss} aria-label="Dismiss this note">
          ×
        </button>
      ) : null}
    </div>
  );
}

export function Chip({ on, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }) {
  return (
    <button type="button" className={on ? `${styles.chip} ${styles.chipOn}` : styles.chip} aria-pressed={on} {...rest}>
      {children}
    </button>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className={styles.tag}>{children}</span>;
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  const auto = useId();
  const buttonId = id ?? auto;
  return (
    <span className={styles.switchRow}>
      <button
        type="button"
        id={buttonId}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={checked ? `${styles.switch} ${styles.switchOn}` : styles.switch}
        onClick={() => onChange(!checked)}
      />
    </span>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className={styles.progress} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={styles.progressBar} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * A tab strip that follows the WAI-ARIA tabs pattern, shared by the editor and
 * the palette panel because the keyboard handling is the whole point and two
 * copies of it would drift.
 *
 * Three things the hand-rolled strips got wrong. Every tab was in the tab
 * order, so reaching the content past a four-tab strip took four presses
 * instead of one — the pattern is a single tab stop with the arrow keys moving
 * between tabs. `aria-controls` pointed at panel ids on every tab, but only the
 * selected panel is rendered, so three of the four references resolved to
 * nothing; it is set only where it points at something. And the panels were not
 * focusable, so moving to a tab and pressing Tab landed past the content the
 * tab had just revealed.
 */
export function TabList<T extends string>({
  label,
  tabs,
  value,
  onChange,
  idFor,
  panelIdFor,
  className,
  tabClassName,
}: {
  label: string;
  tabs: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  idFor: (v: T) => string;
  panelIdFor: (v: T) => string;
  className?: string;
  tabClassName: (selected: boolean) => string | undefined;
}) {
  const move = (delta: number): void => {
    const i = tabs.findIndex((t) => t.value === value);
    const next = tabs[(i + delta + tabs.length) % tabs.length];
    if (next) {
      onChange(next.value);
      document.getElementById(idFor(next.value))?.focus();
    }
  };

  return (
    <div className={className} role="tablist" aria-label={label}>
      {tabs.map((t) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={idFor(t.value)}
            aria-selected={selected}
            // Only the selected panel is in the DOM, so this is the only tab
            // whose aria-controls resolves.
            {...(selected ? { 'aria-controls': panelIdFor(t.value) } : {})}
            // One tab stop for the strip; the arrows do the rest.
            tabIndex={selected ? 0 : -1}
            className={tabClassName(selected)}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                move(1);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                move(-1);
              } else if (e.key === 'Home') {
                e.preventDefault();
                move(-tabs.findIndex((x) => x.value === value));
              } else if (e.key === 'End') {
                e.preventDefault();
                move(tabs.length - 1 - tabs.findIndex((x) => x.value === value));
              }
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export const uiStyles = styles;
