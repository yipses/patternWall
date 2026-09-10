'use client';

import { useId, useMemo, useState } from 'react';
import { DEFAULT_BLEED } from '@patternwall/core';
import { Button, Switch, uiStyles as ui } from './ui';
import { DEFAULT_DEVICE, DEVICE_PRESETS, detectScreen } from '../lib/devices';
import type { PngDepth } from '../lib/export-png';
// One stylesheet for both consumers: the editor's single-file export and the
// collection's batch. Duplicating it would let the two drift apart visually.
import styles from './ExportPanel.module.css';

export interface ExportSettings {
  withBleed: boolean;
  depth: PngDepth;
  colors: number;
  homeVariant: boolean;
  /** Target panel size, before bleed. */
  base: { width: number; height: number };
  /** Rendered file size, bleed included. */
  outWidth: number;
  outHeight: number;
  bleed: number;
}

export interface ExportSettingsController extends ExportSettings {
  presetId: string;
  custom: { width: number; height: number } | null;
  setPresetId: (id: string) => void;
  setCustom: (v: { width: number; height: number } | null) => void;
  setWithBleed: (v: boolean) => void;
  setDepth: (v: PngDepth) => void;
  setColors: (v: number) => void;
  setHomeVariant: (v: boolean) => void;
}

/** Every knob that decides what a PNG comes out as, in one place. */
export function useExportSettings(): ExportSettingsController {
  const [presetId, setPresetId] = useState(DEFAULT_DEVICE.id);
  const [custom, setCustom] = useState<{ width: number; height: number } | null>(null);
  const [withBleed, setWithBleed] = useState(true);
  const [depth, setDepth] = useState<PngDepth>('png8');
  const [colors, setColors] = useState(64);
  const [homeVariant, setHomeVariant] = useState(false);

  const base = useMemo(() => {
    if (custom) return custom;
    const preset = DEVICE_PRESETS.find((d) => d.id === presetId) ?? DEFAULT_DEVICE;
    return { width: preset.width, height: preset.height };
  }, [presetId, custom]);

  const bleed = withBleed ? DEFAULT_BLEED : 0;

  return {
    presetId,
    custom,
    withBleed,
    depth,
    colors,
    homeVariant,
    base,
    bleed,
    outWidth: Math.round(base.width * (1 + bleed * 2)),
    outHeight: Math.round(base.height * (1 + bleed * 2)),
    setPresetId,
    setCustom,
    setWithBleed,
    setDepth,
    setColors,
    setHomeVariant,
  };
}

export function ExportSettingsFields({
  settings: s,
  onDetectFailed,
}: {
  settings: ExportSettingsController;
  onDetectFailed: (message: string) => void;
}) {
  const id = useId();
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof DEVICE_PRESETS>();
    for (const d of DEVICE_PRESETS) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
    return [...groups.entries()];
  }, []);

  return (
    <>
      <div className={ui.field}>
        <label className={ui.label} htmlFor={`${id}-device`}>
          Device
        </label>
        <select
          id={`${id}-device`}
          className={ui.select}
          value={s.custom ? 'custom' : s.presetId}
          onChange={(e) => {
            if (e.target.value === 'custom') s.setCustom({ width: s.base.width, height: s.base.height });
            else {
              s.setCustom(null);
              s.setPresetId(e.target.value);
            }
          }}
        >
          {grouped.map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} — {d.width}×{d.height}
                </option>
              ))}
            </optgroup>
          ))}
          <option value="custom">Custom size…</option>
        </select>
        <p className={ui.help}>Panel pixels, not points. Several phones share a panel, so one entry can cover two models.</p>
      </div>

      {s.custom ? (
        <div className={styles.row}>
          <div className={ui.field}>
            <label className={ui.label} htmlFor={`${id}-w`}>
              Width
            </label>
            <input
              id={`${id}-w`}
              className={ui.input}
              type="number"
              min={64}
              max={8000}
              value={s.custom.width}
              onChange={(e) =>
                s.setCustom({ ...(s.custom ?? s.base), width: Math.max(64, Math.min(8000, Number(e.target.value) || 64)) })
              }
            />
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor={`${id}-h`}>
              Height
            </label>
            <input
              id={`${id}-h`}
              className={ui.input}
              type="number"
              min={64}
              max={8000}
              value={s.custom.height}
              onChange={(e) =>
                s.setCustom({ ...(s.custom ?? s.base), height: Math.max(64, Math.min(8000, Number(e.target.value) || 64)) })
              }
            />
          </div>
        </div>
      ) : null}

      <div className={styles.buttons}>
        <Button
          size="small"
          onClick={() => {
            const screen = detectScreen();
            if (screen) s.setCustom(screen);
            else onDetectFailed('This browser did not report a usable screen size. Pick a preset instead.');
          }}
        >
          Detect my screen
        </Button>
      </div>

      <div className={ui.field} style={{ marginTop: 18 }}>
        <div className={ui.labelRow}>
          <span className={ui.label}>Include 8% bleed</span>
          <span className={ui.value}>{s.withBleed ? 'on' : 'off'}</span>
        </div>
        <Switch checked={s.withBleed} onChange={s.setWithBleed} label="Include 8% bleed on every edge" />
        <p className={ui.help}>
          iOS zooms the wallpaper slightly as you tilt the phone. Exporting 8% larger on every edge gives it room to move
          without ever pulling an unpainted edge into view. Turn it off if you want the file to be exactly your panel size.
        </p>
      </div>

      <div className={ui.field}>
        <div className={ui.labelRow}>
          <span className={ui.label}>Colour depth</span>
          <span className={ui.value}>{s.depth === 'png8' ? `PNG-8 · ${s.colors}` : 'PNG-24'}</span>
        </div>
        <div className={styles.buttons}>
          <Button size="small" onClick={() => s.setDepth('png8')} aria-pressed={s.depth === 'png8'} selected={s.depth === 'png8'}>
            PNG-8
          </Button>
          <Button size="small" onClick={() => s.setDepth('png24')} aria-pressed={s.depth === 'png24'} selected={s.depth === 'png24'}>
            PNG-24
          </Button>
        </div>
        <p className={ui.help}>
          These are flat vector patterns, so a quantised 64-colour PNG is very close to lossless and roughly an order of
          magnitude smaller. Switch to PNG-24 if a gradient-heavy configuration starts to band.
        </p>
      </div>

      {s.depth === 'png8' ? (
        <div className={ui.field}>
          <div className={ui.labelRow}>
            <label className={ui.label} htmlFor={`${id}-colors`}>
              Palette size
            </label>
            <span className={ui.value}>{s.colors}</span>
          </div>
          <input
            id={`${id}-colors`}
            className={ui.range}
            type="range"
            min={8}
            max={256}
            step={8}
            value={s.colors}
            onChange={(e) => s.setColors(Number(e.target.value))}
          />
          <p className={ui.help}>How many colours the quantiser is allowed. 64 is the sweet spot; 16 gets posterised.</p>
        </div>
      ) : null}

      <div className={ui.field}>
        <div className={ui.labelRow}>
          <span className={ui.label}>Home Screen variant</span>
          <span className={ui.value}>{s.homeVariant ? 'on' : 'off'}</span>
        </div>
        <Switch checked={s.homeVariant} onChange={s.setHomeVariant} label="Export a higher-contrast Home Screen variant" />
        <p className={ui.help}>
          iOS blurs and dims the Home Screen wallpaper behind the app grid, which costs roughly a stop of contrast. This
          pushes lightness apart and chroma up to put it back.
        </p>
      </div>
    </>
  );
}
