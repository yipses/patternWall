'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { DEFAULT_BLEED } from '@patternwall/core';
import { Button, Switch, uiStyles as ui } from './ui';
import { DEFAULT_DEVICE, DEVICE_PRESETS, detectScreen } from '../lib/devices';
import { loadExportSettings, saveExportSettings } from '../lib/storage';
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
  /**
   * Whether `custom` came from reading the screen rather than from somebody
   * typing a size.
   *
   * The summary row called every custom size "This screen", because `custom`
   * is set both by the detection on open and by hand, and the value cannot
   * tell them apart. It read "This screen · 1431 × 1958" for a width somebody
   * had just typed, while the list one level down called the same setting
   * "Custom size".
   */
  customIsScreen: boolean;
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
  const [custom, setCustomState] = useState<{ width: number; height: number } | null>(null);
  const [customIsScreen, setCustomIsScreen] = useState(false);
  const [withBleed, setWithBleed] = useState(true);
  const [depth, setDepth] = useState<PngDepth>('png8');
  const [colors, setColors] = useState(64);
  const [homeVariant, setHomeVariant] = useState(false);

  /**
   * Restore what was chosen last time, and otherwise detect the screen.
   *
   * Both after mount rather than in the initial state, because this component
   * is prerendered and a first render that reads localStorage or the screen
   * disagrees with the baked HTML.
   *
   * Detecting is the default rather than a button. "Detect my screen" asked
   * somebody to perform a step the browser can do for nothing, at the one
   * moment it matters; the button stays for when the guess is wrong. It only
   * fires on a portrait screen — a desktop's is landscape, and taking it
   * literally would default the export to a very wide wallpaper.
   */
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const saved = loadExportSettings();
    if (saved) {
      if (typeof saved.presetId === 'string') setPresetId(saved.presetId);
      if (saved.custom === null || (saved.custom && typeof saved.custom.width === 'number')) setCustomState(saved.custom ?? null);
      if (typeof saved.withBleed === 'boolean') setWithBleed(saved.withBleed);
      if (saved.depth === 'png8' || saved.depth === 'png24') setDepth(saved.depth);
      if (typeof saved.colors === 'number') setColors(saved.colors);
      if (typeof saved.homeVariant === 'boolean') setHomeVariant(saved.homeVariant);
    } else if (typeof window !== 'undefined' && window.screen && window.screen.height > window.screen.width) {
      const screen = detectScreen();
      if (screen) {
        const match = DEVICE_PRESETS.find((d) => d.width === screen.width && d.height === screen.height);
        if (match) setPresetId(match.id);
        else {
          setCustomState(screen);
          setCustomIsScreen(true);
        }
      }
    }
    /*
     * A state flag, not a ref.
     *
     * A ref set at the end of this effect is already true when the save effect
     * below runs in the *same* commit — and that one still holds the
     * pre-restore state, so every mount wrote the defaults over the saved
     * settings before writing the saved settings back. It self-corrected
     * within a tick and was invisible; anything reading or unloading between
     * the two writes got the defaults. A state change puts the save in the
     * next commit, after the restored values have landed.
     */
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    saveExportSettings({ presetId, custom, withBleed, depth, colors, homeVariant });
  }, [restored, presetId, custom, withBleed, depth, colors, homeVariant]);

  const base = useMemo(() => {
    if (custom) return custom;
    const preset = DEVICE_PRESETS.find((d) => d.id === presetId) ?? DEFAULT_DEVICE;
    return { width: preset.width, height: preset.height };
  }, [presetId, custom]);

  const bleed = withBleed ? DEFAULT_BLEED : 0;

  /** Anything that sets a size by hand stops it being the screen's. */
  const setCustom = (v: { width: number; height: number } | null): void => {
    setCustomIsScreen(false);
    setCustomState(v);
  };

  return {
    presetId,
    custom,
    customIsScreen,
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

/**
 * The device list, as a pushed level rather than a `<select>`.
 *
 * A native select on iOS opens a wheel picker: a sheet, over a sheet, over a
 * scrim, for the one choice on this screen that matters. A list of rows with a
 * tick is the pattern every Settings app uses, and it has room to print the
 * pixel size beside each name, which the select could only do by running the
 * two together in a line nobody can scan.
 *
 * The desktop panel keeps the select. It is a mouse and a dropdown, and the
 * three layers this avoids do not exist there.
 */
export function DeviceList({
  settings: s,
  onPick,
}: {
  settings: ExportSettingsController;
  onPick: () => void;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof DEVICE_PRESETS>();
    for (const d of DEVICE_PRESETS) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
    return [...groups.entries()];
  }, []);

  /*
   * A radio group behaves like one: a roving tabindex and arrow keys.
   *
   * Twelve rows each carrying their own tab stop, with the arrows doing
   * nothing, is a screen reader announcing "radio, 1 of 12" and then not
   * moving. `quality.spec.ts` already asserts exactly this for the editor's
   * tab strip; this was the same pattern without it.
   */
  const move = (e: React.KeyboardEvent<HTMLUListElement | HTMLDivElement>, delta: number): void => {
    const root = e.currentTarget.closest('[role="radiogroup"]');
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    rows[(at + delta + rows.length) % rows.length]?.focus();
  };

  const row = (key: string, label: string, detail: string, picked: boolean, onClick: () => void) => (
    <li key={key}>
      <button
        type="button"
        className={styles.deviceRow}
        role="radio"
        aria-checked={picked}
        tabIndex={picked ? 0 : -1}
        onClick={() => {
          onClick();
          onPick();
        }}
      >
        <span className={styles.deviceName}>{label}</span>
        <span className={styles.deviceSize}>{detail}</span>
        <span className={styles.deviceTick} aria-hidden="true">
          {picked ? '✓' : ''}
        </span>
      </button>
    </li>
  );

  return (
    <div
      className={styles.devices}
      role="radiogroup"
      aria-label="Device"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') move(e, 1);
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') move(e, -1);
      }}
    >
      {grouped.map(([group, items]) => (
        <div key={group}>
          <div className={styles.deviceGroup}>{group}</div>
          <ul className={styles.deviceList}>
            {items.map((d) =>
              row(d.id, d.label, `${d.width} × ${d.height}`, !s.custom && s.presetId === d.id, () => {
                s.setCustom(null);
                s.setPresetId(d.id);
              }),
            )}
          </ul>
        </div>
      ))}
      <div className={styles.deviceGroup}>Anything else</div>
      <ul className={styles.deviceList}>
        {row('custom', 'Custom size', s.custom ? `${s.custom.width} × ${s.custom.height}` : 'Set it yourself', !!s.custom, () =>
          s.setCustom({ width: s.base.width, height: s.base.height }),
        )}
      </ul>
    </div>
  );
}

export function ExportSettingsFields({
  settings: s,
  onDetectFailed,
  only,
}: {
  settings: ExportSettingsController;
  onDetectFailed: (message: string) => void;
  /**
   * Render one half of the panel.
   *
   * The desktop page shows the lot in a column, which is right there. On a
   * phone sheet it is a wall of text with the one control anybody touches at
   * the top, so the size question and everything else are shown separately --
   * `'size'` is the device and its custom fields, `'rest'` is bleed, depth,
   * palette size and the Home Screen variant.
   */
  only?: 'custom' | 'rest';
}) {
  const id = useId();
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof DEVICE_PRESETS>();
    for (const d of DEVICE_PRESETS) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
    return [...groups.entries()];
  }, []);

  return (
    <>
      {only ? null : (
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
      </>
      )}

      {only === 'rest' ? null : (
      <>
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
      </>
      )}

      {/* The advanced group. It used to exclude only `'size'`, so `'custom'`
          fell through and printed all four controls -- and then the sheet
          rendered `'rest'` underneath, giving two of each bound to the same
          state. */}
      {only === 'custom' ? null : (
      <>
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
      )}
    </>
  );
}
