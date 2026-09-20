'use client';

import { useRef, useState } from 'react';
import JSZip from 'jszip';
import { Button, Notice, Progress } from './ui';
import { ExportSettingsFields, useExportSettings } from './ExportSettings';
import { DEVICE_PRESETS } from '../lib/devices';
import { downloadBlob, formatBytes, safeFilename } from '../lib/export-png';
import { deliverWallpapers, exportableItems, renderCollection, type RenderedWallpaper } from '../lib/export-collection';
import type { CollectedItem } from '../lib/storage';
import styles from './ExportSheet.module.css';

type Stage = 'summary' | 'settings' | 'running' | 'done';

/**
 * Exporting a selection, as one sheet you move through.
 *
 * It replaces a disclosure under the grid that expanded a column of fields in
 * place — reported as "export settings should be a popup dialog in the export
 * flow, not like this". The settings are a second level *inside* this sheet
 * rather than a dialog on top of it: a dialog over a sheet is two dismissals
 * deep on a phone and neither of them is where the thumb is.
 *
 * The summary row is the whole of what most people need to check — what device
 * it is sized for, how big the files are, what format — and it is one tap from
 * the thing that changes it.
 */
export function ExportSheet({ items, onClose }: { items: CollectedItem[]; onClose: () => void }) {
  const s = useExportSettings();
  const [stage, setStage] = useState<Stage>('summary');
  const [done, setDone] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [rendered, setRendered] = useState<RenderedWallpaper[] | null>(null);
  const cancelRef = useRef(false);

  const deviceName = s.custom ? 'Custom size' : (DEVICE_PRESETS.find((d) => d.id === s.presetId)?.label ?? 'Custom size');

  const total = exportableItems(items).length;

  const zipUp = async (files: RenderedWallpaper[]): Promise<void> => {
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f.blob);
    const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    downloadBlob(out, `${safeFilename(['patternwall', 'collection', `${files.length}`])}.zip`);
    setNote(`${files.length} wallpapers zipped — ${formatBytes(out.size)}. Import them into a Photos album called PatternWall and see Automate.`);
  };

  const deliver = async (files: RenderedWallpaper[], force?: 'share' | 'download'): Promise<void> => {
    const how = await deliverWallpapers(
      files,
      zipUp,
      (f) => {
        downloadBlob(f.blob, f.name);
        setNote(`Saved ${f.name} — ${formatBytes(f.blob.size)}.`);
      },
      force,
    );
    if (how === 'shared') {
      setNote(`${files.length} wallpaper${files.length === 1 ? '' : 's'} handed to your device. Save them to Photos to set one.`);
    }
  };

  const run = async (): Promise<void> => {
    cancelRef.current = false;
    setStage('running');
    setDone(0);
    setNote(null);
    setError(null);
    try {
      const files = await renderCollection(items, s, {
        onProgress: (n) => setDone(n),
        cancelled: () => cancelRef.current,
      });
      if (cancelRef.current) {
        setStage('summary');
        setNote('Export cancelled. Nothing was saved.');
        return;
      }
      setRendered(files);
      await deliver(files);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The export failed part way through. Try PNG-24, or a smaller size.');
      setStage('summary');
    }
  };

  return (
    /* `pw-sheet` is a plain global hook, not decoration: the collection page
       narrows itself to a phone-width column on a desktop and pins its fixed
       furniture to that column, and it cannot reach a CSS-module class name
       from another file to do it. */
    <div className={`${styles.sheet} pw-sheet`} role="dialog" aria-label="Export the selection" data-testid="export-sheet">
      <div className={styles.grabber} aria-hidden="true" />

      <div className={styles.head}>
        {stage === 'settings' ? (
          <Button size="small" variant="ghost" onClick={() => setStage('summary')} data-testid="export-back">
            ‹ Back
          </Button>
        ) : (
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              cancelRef.current = true;
              onClose();
            }}
            data-testid="export-cancel"
          >
            {stage === 'running' ? 'Cancel' : 'Done'}
          </Button>
        )}
        {/* The count is on the button, where the tap is. Repeating it here
            was the same words twice on a screen with room for neither. */}
        <span className={styles.headTitle}>{stage === 'settings' ? 'Size and format' : ''}</span>
      </div>

      {stage === 'settings' ? (
        <div className={styles.body}>
          <ExportSettingsFields settings={s} onDetectFailed={setError} only="size" />
          {/* Bleed, depth, palette size and the Home Screen variant, each with
              a paragraph explaining itself. Right on the desktop page and a
              wall of text under the one control anybody touches here. */}
          <Button
            size="small"
            variant="ghost"
            className={styles.advanced}
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
            data-testid="export-advanced"
          >
            {advanced ? 'Hide advanced' : 'Advanced'}
          </Button>
          {advanced ? <ExportSettingsFields settings={s} onDetectFailed={setError} only="rest" /> : null}
        </div>
      ) : null}

      {stage === 'summary' ? (
        <div className={styles.body}>
          {/* One row carrying every answer, and one tap from changing them. */}
          <button type="button" className={styles.summary} onClick={() => setStage('settings')} data-testid="export-summary">
            <span className={styles.summaryText}>
              <span className={styles.summaryTop}>
                {deviceName} · {s.outWidth} × {s.outHeight}
              </span>
              <span className={styles.summarySub}>
                {s.depth === 'png8' ? `PNG-8 · ${s.colors} colours` : 'PNG-24'}
                {s.bleed > 0 ? ' · 8% bleed' : ''}
              </span>
            </span>
            <span className={styles.chev} aria-hidden="true">
              ›
            </span>
          </button>
          <Button variant="primary" className={styles.go} onClick={() => void run()} data-testid="export-run">
            Export {total}
          </Button>
        </div>
      ) : null}

      {stage === 'running' ? (
        <div className={styles.body}>
          <p className={styles.count} aria-live="polite">
            {done} of {total}
          </p>
          <Progress value={total === 0 ? 0 : done / total} label="Export progress" />
        </div>
      ) : null}

      {stage === 'done' ? (
        <div className={styles.body}>
          {/* The platform's sheet is not always the right answer -- on a Mac it
              offers Messages and AirDrop and no way to put a file anywhere --
              so there is always a route past it that is not trying again. The
              files are already rendered; this only changes where they go. */}
          <Button
            size="small"
            variant="ghost"
            onClick={() => void (rendered ? deliver(rendered, 'download') : undefined)}
            data-testid="export-save-instead"
          >
            Save {rendered && rendered.length === 1 ? 'the file' : 'the files'} instead
          </Button>
        </div>
      ) : null}

      {note ? (
        <div className={styles.body}>
          <Notice onDismiss={() => setNote(null)}>{note}</Notice>
        </div>
      ) : null}
      {error ? (
        <div className={styles.body}>
          <Notice level="error" onDismiss={() => setError(null)}>
            {error}
          </Notice>
        </div>
      ) : null}
    </div>
  );
}
