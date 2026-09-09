'use client';

import { useEffect, useState } from 'react';
import { safeZonesFor, type Rect } from '@patternwall/core';
import { PatternImage } from './PatternImage';
import type { RenderSpec } from '../lib/render';
import styles from './PreviewFrame.module.css';

export type PreviewMode = 'lock' | 'home' | 'flat';

export const PREVIEW_MODES: { value: PreviewMode; label: string; hint: string }[] = [
  { value: 'lock', label: 'Lock Screen', hint: 'Clock, date, widget row and the two bottom controls, drawn where iOS draws them.' },
  { value: 'home', label: 'Home Screen', hint: "iOS's blur and dim over the wallpaper, with an app grid and dock in front of it." },
  { value: 'flat', label: 'Flat', hint: 'The pattern on its own, with nothing on top of it.' },
];

// Percentages derived from the same function the generators compose against,
// so the overlay can never drift from what a generator thinks the safe zones
// are.
const REF = safeZonesFor(1000, 2000);
const pct = (r: Rect): { left: string; top: string; width: string; height: string } => ({
  left: `${(r.x / 1000) * 100}%`,
  top: `${(r.y / 2000) * 100}%`,
  width: `${(r.w / 1000) * 100}%`,
  height: `${(r.h / 2000) * 100}%`,
});

function useClock(enabled: boolean): { time: string; date: string } {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    if (!enabled) return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 20000);
    return () => window.clearInterval(id);
  }, [enabled]);
  if (!now) return { time: '9:41', date: 'Monday, 9 June' };
  return {
    time: now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/i, ''),
    date: now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
  };
}

export function PreviewFrame({
  spec,
  mode,
  showZones,
  alt,
  caption,
  onRenderError,
}: {
  spec: RenderSpec;
  mode: PreviewMode;
  showZones: boolean;
  alt: string;
  caption?: string;
  onRenderError?: (message: string) => void;
}) {
  const { time, date } = useClock(mode === 'lock');

  return (
    <div className={styles.wrap}>
      <div className={styles.phone}>
        <PatternImage spec={spec} alt={alt} className={styles.pattern} onRenderError={onRenderError} />

        {mode === 'home' ? <div className={styles.homeVeil} aria-hidden="true" /> : null}
        <div className={styles.island} aria-hidden="true" />

        {mode !== 'flat' ? (
          <div className={styles.statusBar} aria-hidden="true">
            <span>{mode === 'lock' ? '' : time}</span>
            <span className={styles.statusRight}>
              <span className={styles.bars}>
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className={styles.battery} />
            </span>
          </div>
        ) : null}

        {mode === 'lock' ? (
          <div className={styles.lock} aria-hidden="true">
            <div className={styles.date}>{date}</div>
            <div className={styles.clock}>{time}</div>
            <div className={styles.widgets}>
              <div className={styles.widget} />
              <div className={styles.widget} />
            </div>
            <div className={styles.controls}>
              <div className={styles.controlBtn} />
              <div className={styles.controlBtn} />
            </div>
            <div className={styles.indicator} />
          </div>
        ) : null}

        {mode === 'home' ? (
          <div className={styles.home} aria-hidden="true">
            <div className={styles.iconGrid}>
              {Array.from({ length: 20 }, (_, i) => (
                <div key={i} className={styles.icon} />
              ))}
            </div>
            <div className={styles.dock}>
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className={styles.icon} />
              ))}
            </div>
            <div className={styles.indicator} />
          </div>
        ) : null}

        {showZones ? (
          <div className={styles.zones} aria-hidden="true">
            <div className={styles.zone} style={pct(REF.clock)}>
              <span className={styles.zoneLabel}>Clock</span>
            </div>
            <div className={styles.zone} style={pct(REF.widgets)}>
              <span className={styles.zoneLabel}>Widgets</span>
            </div>
            <div className={styles.zone} style={pct(REF.controls)}>
              <span className={styles.zoneLabel}>Controls</span>
            </div>
          </div>
        ) : null}
      </div>
      {caption ? <p className={styles.caption}>{caption}</p> : null}
    </div>
  );
}
