'use client';

import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './ui.module.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'default' | 'small';
  loading?: boolean;
  success?: boolean;
};

export function Button({ variant = 'default', size = 'default', loading = false, success = false, children, className, disabled, ...rest }: ButtonProps) {
  const classes = [
    styles.btn,
    variant === 'primary' ? styles.primary : '',
    variant === 'ghost' ? styles.ghost : '',
    size === 'small' ? styles.small : '',
    success ? styles.success : '',
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

export const uiStyles = styles;
