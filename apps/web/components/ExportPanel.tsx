'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { DEFAULT_BLEED, type Palette, type ParamValue } from '@patternwall/core';
import { Button, Notice, Progress, Switch, uiStyles as ui } from './ui';
import { DEFAULT_DEVICE, DEVICE_PRESETS, detectScreen } from '../lib/devices';
import { downloadBlob, formatBytes, renderPngBlob, safeFilename, yieldToBrowser, type PngDepth } from '../lib/export-png';
import { boostForHomeScreen } from '../lib/harmony';
import { renderSpec } from '../lib/render';
import styles from './ExportPanel.module.css';

const BATCH_COUNT = 30;

export interface ExportSubject {
  generatorId: string;
  generatorName: string;
  seed: string;
  params: Record<string, ParamValue>;
  palette: Palette;
}

export function ExportPanel({ subject }: { subject: ExportSubject }) {
  const [presetId, setPresetId] = useState(DEFAULT_DEVICE.id);
  const [custom, setCustom] = useState<{ width: number; height: number } | null>(null);
  const [withBleed, setWithBleed] = useState(true);
  const [depth, setDepth] = useState<PngDepth>('png8');
  const [colors, setColors] = useState(64);
  const [homeVariant, setHomeVariant] = useState(false);

  const [size, setSize] = useState<number | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchNote, setBatchNote] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const base = useMemo(() => {
    if (custom) return custom;
    const preset = DEVICE_PRESETS.find((d) => d.id === presetId) ?? DEFAULT_DEVICE;
    return { width: preset.width, height: preset.height };
  }, [presetId, custom]);

  const bleed = withBleed ? DEFAULT_BLEED : 0;
  const outWidth = Math.round(base.width * (1 + bleed * 2));
  const outHeight = Math.round(base.height * (1 + bleed * 2));

  const palette = useMemo(() => (homeVariant ? boostForHomeScreen(subject.palette) : subject.palette), [homeVariant, subject.palette]);

  const buildSvg = useCallback(
    (seed: string) =>
      renderSpec({
        generatorId: subject.generatorId,
        seed,
        params: subject.params,
        palette,
        width: outWidth,
        height: outHeight,
        bleed,
      }),
    [subject.generatorId, subject.params, palette, outWidth, outHeight, bleed],
  );

  const filename = useMemo(
    () =>
      `${safeFilename([
        'patternwall',
        subject.generatorId,
        subject.seed,
        `${outWidth}x${outHeight}`,
        homeVariant ? 'home' : '',
      ])}.png`,
    [subject.generatorId, subject.seed, outWidth, outHeight, homeVariant],
  );

  // Measure the real encoded size in the background whenever the settings that
  // affect it change. It is the actual encoder on the actual resolution, so the
  // number next to the button is a fact rather than an estimate.
  useEffect(() => {
    let cancelled = false;
    setSize(null);
    setMeasuring(true);
    const id = window.setTimeout(() => {
      void (async () => {
        try {
          const blob = await renderPngBlob(buildSvg(subject.seed), outWidth, outHeight, { depth, colors });
          if (!cancelled) setSize(blob.size);
        } catch {
          if (!cancelled) setSize(null);
        } finally {
          if (!cancelled) setMeasuring(false);
        }
      })();
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
      window.clearTimeout(id);
    };
  }, [buildSvg, subject.seed, outWidth, outHeight, depth, colors]);

  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(false), 2600);
    return () => window.clearTimeout(id);
  }, [done]);

  const onDownload = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await renderPngBlob(buildSvg(subject.seed), outWidth, outHeight, { depth, colors });
      setSize(blob.size);
      downloadBlob(blob, filename);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The export failed. Try PNG-24, or a smaller size.');
    } finally {
      setBusy(false);
    }
  };

  const onBatch = async () => {
    setBatchRunning(true);
    setBatchProgress(0);
    setBatchNote(null);
    setError(null);
    cancelRef.current = false;
    try {
      const zip = new JSZip();
      for (let i = 0; i < BATCH_COUNT; i++) {
        if (cancelRef.current) break;
        const seed = `${subject.seed}-${String(i + 1).padStart(2, '0')}`;
        const blob = await renderPngBlob(buildSvg(seed), outWidth, outHeight, { depth, colors });
        zip.file(`${safeFilename(['patternwall', subject.generatorId, seed])}.png`, blob);
        setBatchProgress((i + 1) / BATCH_COUNT);
        // Hand the frame back so scrolling, typing and the preview stay live.
        await yieldToBrowser();
      }
      if (cancelRef.current) {
        setBatchNote('Batch cancelled. Nothing was downloaded.');
        return;
      }
      const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => {
        setBatchProgress(0.9 + (meta.percent / 100) * 0.1);
      });
      downloadBlob(out, `${safeFilename(['patternwall', subject.generatorId, subject.seed, 'x30'])}.zip`);
      setBatchNote(`${BATCH_COUNT} variations zipped — ${formatBytes(out.size)}. Drop them into a Photos album and see Automate.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The batch export failed part way through.');
    } finally {
      setBatchRunning(false);
    }
  };

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof DEVICE_PRESETS>();
    for (const d of DEVICE_PRESETS) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
    return [...groups.entries()];
  }, []);

  return (
    <div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="export-device">
          Device
        </label>
        <select
          id="export-device"
          className={ui.select}
          value={custom ? 'custom' : presetId}
          onChange={(e) => {
            if (e.target.value === 'custom') setCustom({ width: base.width, height: base.height });
            else {
              setCustom(null);
              setPresetId(e.target.value);
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

      {custom ? (
        <div className={styles.row}>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="export-w">
              Width
            </label>
            <input
              id="export-w"
              className={ui.input}
              type="number"
              min={64}
              max={8000}
              value={custom.width}
              onChange={(e) => setCustom({ ...custom, width: Math.max(64, Math.min(8000, Number(e.target.value) || 64)) })}
            />
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="export-h">
              Height
            </label>
            <input
              id="export-h"
              className={ui.input}
              type="number"
              min={64}
              max={8000}
              value={custom.height}
              onChange={(e) => setCustom({ ...custom, height: Math.max(64, Math.min(8000, Number(e.target.value) || 64)) })}
            />
          </div>
        </div>
      ) : null}

      <div className={styles.buttons}>
        <Button
          size="small"
          onClick={() => {
            const s = detectScreen();
            if (s) setCustom(s);
            else setError('This browser did not report a usable screen size. Pick a preset instead.');
          }}
        >
          Detect my screen
        </Button>
      </div>

      <div className={ui.field} style={{ marginTop: 18 }}>
        <div className={ui.labelRow}>
          <span className={ui.label} id="bleed-label">
            Include 8% bleed
          </span>
          <span className={ui.value}>{withBleed ? 'on' : 'off'}</span>
        </div>
        <Switch checked={withBleed} onChange={setWithBleed} label="Include 8% bleed on every edge" />
        <p className={ui.help}>
          iOS zooms the wallpaper slightly as you tilt the phone. Exporting 8% larger on every edge gives it room to move
          without ever pulling an unpainted edge into view. Turn it off if you want the file to be exactly your panel size.
        </p>
      </div>

      <div className={ui.field}>
        <div className={ui.labelRow}>
          <span className={ui.label}>Colour depth</span>
          <span className={ui.value}>{depth === 'png8' ? `PNG-8 · ${colors}` : 'PNG-24'}</span>
        </div>
        <div className={styles.buttons}>
          <Button size="small" onClick={() => setDepth('png8')} aria-pressed={depth === 'png8'} selected={depth === 'png8'}>
            PNG-8
          </Button>
          <Button size="small" onClick={() => setDepth('png24')} aria-pressed={depth === 'png24'} selected={depth === 'png24'}>
            PNG-24
          </Button>
        </div>
        <p className={ui.help}>
          These are flat vector patterns, so a quantised 64-colour PNG is very close to lossless and roughly an order of
          magnitude smaller. Switch to PNG-24 if a gradient-heavy configuration starts to band.
        </p>
      </div>

      {depth === 'png8' ? (
        <div className={ui.field}>
          <div className={ui.labelRow}>
            <label className={ui.label} htmlFor="export-colors">
              Palette size
            </label>
            <span className={ui.value}>{colors}</span>
          </div>
          <input
            id="export-colors"
            className={ui.range}
            type="range"
            min={8}
            max={256}
            step={8}
            value={colors}
            onChange={(e) => setColors(Number(e.target.value))}
          />
          <p className={ui.help}>How many colours the quantiser is allowed. 64 is the sweet spot; 16 gets posterised.</p>
        </div>
      ) : null}

      <div className={ui.field}>
        <div className={ui.labelRow}>
          <span className={ui.label}>Home Screen variant</span>
          <span className={ui.value}>{homeVariant ? 'on' : 'off'}</span>
        </div>
        <Switch checked={homeVariant} onChange={setHomeVariant} label="Export a higher-contrast Home Screen variant" />
        <p className={ui.help}>
          iOS blurs and dims the Home Screen wallpaper behind the app grid, which costs roughly a stop of contrast. This
          pushes lightness apart and chroma up to put it back.
        </p>
      </div>

      <div className={styles.summary}>
        <dl>
          <dt>Screen</dt>
          <dd>
            {base.width}×{base.height}
          </dd>
          <dt>File</dt>
          <dd>
            {outWidth}×{outHeight}
          </dd>
          <dt>Format</dt>
          <dd>{depth === 'png8' ? `PNG-8 · ${colors} colours` : 'PNG-24'}</dd>
          <dt>Size</dt>
          <dd data-testid="export-size">{measuring ? 'measuring…' : size === null ? '—' : formatBytes(size)}</dd>
        </dl>
      </div>

      {error ? (
        <Notice level="error" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      ) : null}

      <div className={styles.buttons}>
        <Button variant="primary" onClick={() => void onDownload()} loading={busy} success={done} data-testid="download-png">
          {done ? 'Downloaded' : busy ? 'Encoding…' : 'Download PNG'}
        </Button>
        <span className={styles.sizeNote}>{measuring ? 'measuring…' : size === null ? '' : formatBytes(size)}</span>
      </div>

      <div className={styles.batch}>
        <div className={styles.batchHead}>Thirty variations</div>
        <p className={styles.hint}>
          The same configuration with thirty different seeds, zipped. Import them into a Photos album called PatternWall and
          a Shortcut can pick one at random each morning — see Automate for the recipe. The work is chunked frame by frame,
          so the page stays usable while it runs.
        </p>
        {batchRunning ? (
          <div className={styles.progressWrap}>
            <Progress value={batchProgress} label="Batch export progress" />
          </div>
        ) : null}
        {batchNote ? <Notice onDismiss={() => setBatchNote(null)}>{batchNote}</Notice> : null}
        <div className={styles.buttons}>
          <Button onClick={() => void onBatch()} loading={batchRunning} data-testid="batch-export">
            {batchRunning ? `Rendering ${Math.round(batchProgress * BATCH_COUNT)} of ${BATCH_COUNT}…` : `Export ${BATCH_COUNT} as a zip`}
          </Button>
          {batchRunning ? (
            <Button variant="ghost" size="small" onClick={() => { cancelRef.current = true; }}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
