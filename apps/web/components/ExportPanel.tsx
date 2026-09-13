'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Palette, ParamValue } from '@patternwall/core';
import { Button, Notice } from './ui';
import { ExportSettingsFields, useExportSettings } from './ExportSettings';
import { downloadBlob, formatBytes, renderPngBlob, safeFilename } from '../lib/export-png';
import { boostForHomeScreen } from '../lib/harmony';
import { renderSpec } from '../lib/render';
import styles from './ExportPanel.module.css';

export interface ExportSubject {
  generatorId: string;
  generatorName: string;
  seed: string;
  params: Record<string, ParamValue>;
  palette: Palette;
}

export function ExportPanel({ subject }: { subject: ExportSubject }) {
  const s = useExportSettings();

  const [size, setSize] = useState<number | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { outWidth, outHeight, bleed, depth, colors, homeVariant, base } = s;

  const palette = useMemo(
    () => (homeVariant ? boostForHomeScreen(subject.palette) : subject.palette),
    [homeVariant, subject.palette],
  );

  const buildSvg = useCallback(
    () =>
      renderSpec({
        generatorId: subject.generatorId,
        seed: subject.seed,
        params: subject.params,
        palette,
        width: outWidth,
        height: outHeight,
        bleed,
      }),
    [subject.generatorId, subject.seed, subject.params, palette, outWidth, outHeight, bleed],
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

  // A settings change invalidates the number but does not re-measure. Showing
  // a stale size would be worse than showing none.
  useEffect(() => {
    setSize(null);
  }, [buildSvg, outWidth, outHeight, depth, colors]);

  /**
   * The measurement is the real encoder at the real resolution, so the number
   * is a fact rather than an estimate. It is also expensive: at 1399x3042,
   * measured on a desktop, the render is 68ms, the rasterise 188ms and
   * UPNG.encode 949ms — and all of it is synchronous on the main thread.
   *
   * It used to run automatically 450ms after the panel opened and after every
   * settings change, so moving the palette-size slider froze the UI for about a
   * second per step. On a phone that is several seconds nobody asked for. It is
   * now asked for explicitly. Downloading still fills the number in, since the
   * encode has happened anyway.
   */
  const onMeasure = async () => {
    setMeasuring(true);
    setError(null);
    try {
      const blob = await renderPngBlob(buildSvg(), outWidth, outHeight, { depth, colors });
      setSize(blob.size);
    } catch (err) {
      setSize(null);
      setError(err instanceof Error ? err.message : 'That size could not be measured. Try PNG-24, or a smaller size.');
    } finally {
      setMeasuring(false);
    }
  };

  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(false), 2600);
    return () => window.clearTimeout(id);
  }, [done]);

  const onDownload = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await renderPngBlob(buildSvg(), outWidth, outHeight, { depth, colors });
      setSize(blob.size);
      downloadBlob(blob, filename);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The export failed. Try PNG-24, or a smaller size.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ExportSettingsFields settings={s} onDetectFailed={setError} />

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
          <dd data-testid="export-size">
            {measuring ? (
              'measuring…'
            ) : size === null ? (
              <Button size="small" variant="ghost" onClick={() => void onMeasure()} data-testid="measure-size">
                Check size
              </Button>
            ) : (
              formatBytes(size)
            )}
          </dd>
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
        <div className={styles.batchHead}>Exporting several at once</div>
        <p className={styles.hint}>
          Press <strong>Collect</strong> on the configurations you want to keep, then export the whole collection as one zip
          from the <Link href="/collected">Collected</Link> page. That gives you an album you chose rather than a pile of
          random seeds — see <Link href="/setup">Automate</Link> for how a Shortcut picks from it each morning.
        </p>
      </div>
    </div>
  );
}
